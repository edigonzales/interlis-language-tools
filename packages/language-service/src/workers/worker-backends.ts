import type {
  CompilationAnalysisResult,
  EditorSnapshot,
  IncrementalStats,
} from "@ilic/compiler-wasm";
import { createWasmCompilerBackend } from "../compiler.js";
import type { CompilerBackend, EditorAnalysisBackend } from "../types.js";
import {
  WorkerLifecycleTracker,
  type WorkerLifecycleStats,
} from "./worker-lifecycle-tracker.js";
import { WorkerRpcClient } from "./worker-rpc-client.js";
import { WorkerSourceMirror } from "./worker-source-mirror.js";
import type {
  CompilerWorkerCommand,
  CompilerWorkerFactory,
  CompilerWorkerRequest,
  CompilerWorkerResponse,
} from "./worker-protocol.js";

interface WorkerEndpoint {
  postMessage(message: CompilerWorkerResponse): void;
  onMessage(listener: (message: CompilerWorkerRequest) => void): void;
}

abstract class WorkerBackendBase {
  protected readonly mirror = new WorkerSourceMirror();
  protected readonly lifecycle = new WorkerLifecycleTracker();
  protected readonly rpc: WorkerRpcClient;
  protected warned = false;
  protected disposed = false;

  protected constructor(
    factory: CompilerWorkerFactory,
    private readonly warning?: (message: string) => void,
    failurePrefix = "INTERLIS worker failed",
  ) {
    this.rpc = new WorkerRpcClient(factory, {
      onAttach: () => this.replay(),
      onFailure: (error) => {
        this.lifecycle.restart();
        if (!this.warned) {
          this.warned = true;
          this.warning?.(error instanceof Error ? error.message : String(error));
        }
      },
      failurePrefix,
    });
    this.replay();
  }

  protected replay(): void {
    const entries = this.mirror.entries();
    if (entries.length === 0) return;
    this.lifecycle.replay(entries.length, this.mirror.byteCount());
    for (const [uri, value] of entries)
      this.rpc.notify({
        method: "putSource",
        uri,
        source: value.source,
        version: value.version,
      });
  }

  protected failure<T>(error: unknown, fallback: () => T): T {
    this.lifecycle.fallback();
    return fallback();
  }

  protected stats(): WorkerLifecycleStats {
    return { ...this.lifecycle.snapshot(), queueSize: this.rpc.pendingCount() };
  }

  protected disposeTransport(message: CompilerWorkerCommand): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rpc.notify(message);
    this.rpc.dispose();
    this.mirror.clear();
  }
}

export class CompilerWorkerBackend
  extends WorkerBackendBase
  implements CompilerBackend
{
  readonly #localVersions = new Map<string, number>();
  readonly capabilities;
  constructor(
    private readonly local: CompilerBackend,
    factory: CompilerWorkerFactory,
    options: { readonly onWarning?: (message: string) => void } = {},
  ) {
    super(factory, options.onWarning, "INTERLIS compiler worker failed");
    this.capabilities = {
      ...local.capabilities,
      incrementalSession: local.capabilities?.incrementalSession ?? false,
      incrementalStats: local.capabilities?.incrementalStats ?? false,
      incrementalTrace: local.capabilities?.incrementalTrace ?? false,
      incrementalCacheSnapshot:
        local.capabilities?.incrementalCacheSnapshot ?? false,
      strictEditorSeparation: local.capabilities?.strictEditorSeparation ?? false,
    };
  }

  putSource(uri: string, source: string | Uint8Array, version: number): void {
    this.mirror.put(uri, source, version);
    this.rpc.notify({ method: "putSource", uri, source, version });
  }

  removeSource(uri: string): boolean {
    this.mirror.remove(uri);
    this.#localVersions.delete(uri);
    this.rpc.notify({ method: "removeSource", uri });
    return this.local.removeSource(uri);
  }

  parse(uri: string) { this.#flushLocalSource(uri); return this.local.parse(uri); }
  analyze(request: Parameters<CompilerBackend["analyze"]>[0]) {
    this.#flushLocalSources(request.roots);
    return this.local.analyze(request);
  }
  compile(request: Parameters<CompilerBackend["compile"]>[0]) {
    this.#flushLocalSources(request.roots);
    return this.local.compile(request);
  }
  format(uri: string, options?: Parameters<CompilerBackend["format"]>[1]) {
    this.#flushLocalSource(uri);
    return this.local.format(uri, options);
  }

  compileAndAnalyze(request: Parameters<CompilerBackend["compileAndAnalyze"]>[0]) {
    if (!this.rpc.attached) {
      this.#flushLocalSources(request.roots);
      return this.local.compileAndAnalyze(request);
    }
    return this.rpc
      .request<CompilationAnalysisResult>({ method: "compileAndAnalyze", request })
      .catch((error) =>
        this.failure(error, () => {
          this.#flushLocalSources(request.roots);
          return this.local.compileAndAnalyze(request);
        }),
      );
  }

  incrementalStats() {
    if (!this.rpc.attached)
      return this.local.incrementalStats
        ? this.local.incrementalStats()
        : Promise.reject(new Error("native incremental statistics API is unavailable"));
    return this.rpc
      .request<IncrementalStats>({ method: "incrementalStats" })
      .catch((error) =>
        this.failure(error, () => {
          if (!this.local.incrementalStats)
            throw new Error("native incremental statistics API is unavailable");
          return this.local.incrementalStats();
        }),
      );
  }

  incrementalTrace() {
    if (!this.rpc.attached)
      return this.local.incrementalTrace
        ? this.local.incrementalTrace()
        : Promise.reject(new Error("native incremental trace API is unavailable"));
    return this.rpc
      .request<Record<string, unknown>>({ method: "incrementalTrace" })
      .catch((error) =>
        this.failure(error, () => {
          if (!this.local.incrementalTrace)
            throw new Error("native incremental trace API is unavailable");
          return this.local.incrementalTrace();
        }),
      );
  }

  incrementalCacheSnapshot() {
    if (!this.rpc.attached)
      return this.local.incrementalCacheSnapshot
        ? this.local.incrementalCacheSnapshot()
        : Promise.reject(new Error("native incremental cache snapshot API is unavailable"));
    return this.rpc.request<Record<string, unknown>>({
      method: "incrementalCacheSnapshot",
    });
  }

  resetIncrementalStats() {
    if (!this.rpc.attached) return Promise.resolve(this.local.resetIncrementalStats?.()).then(() => undefined);
    return this.rpc
      .request<unknown>({ method: "resetIncrementalStats" })
      .then(() => undefined)
      .catch((error) =>
        this.failure(error, () =>
          Promise.resolve(this.local.resetIncrementalStats?.()).then(() => undefined),
        ),
      );
  }

  clearIncrementalCaches() {
    if (!this.rpc.attached) return this.local.clearIncrementalCaches?.();
    return this.rpc
      .request<unknown>({ method: "clearIncrementalCaches" })
      .then(() => this.local.clearIncrementalCaches?.())
      .catch((error) =>
        this.failure(error, () => this.local.clearIncrementalCaches?.()),
      );
  }

  async restart(): Promise<void> {
    this.lifecycle.restart();
    await this.local.restart?.();
    this.#localVersions.clear();
    this.#flushLocalSources([...this.mirror.entries()].map(([uri]) => uri));
    this.rpc.restart();
  }

  workerLifecycleStats() { return this.stats(); }

  dispose(): void {
    this.disposeTransport({ method: "dispose" });
    this.#localVersions.clear();
    this.local.dispose();
  }

  #flushLocalSource(uri: string): void {
    const value = this.mirror.get(uri);
    if (!value || this.#localVersions.get(uri) === value.version) return;
    this.local.putSource(uri, value.source, value.version);
    this.#localVersions.set(uri, value.version);
  }

  #flushLocalSources(uris: readonly string[]): void {
    for (const uri of uris) this.#flushLocalSource(uri);
  }
}

export class EditorWorkerBackend
  extends WorkerBackendBase
  implements EditorAnalysisBackend
{
  readonly #sourceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    factory: CompilerWorkerFactory,
    private readonly fallback?: Pick<CompilerBackend, "editorSnapshot">,
    options: { readonly onWarning?: (message: string) => void } = {},
  ) {
    super(factory, options.onWarning, "INTERLIS editor worker failed");
  }

  putSource(uri: string, source: string | Uint8Array, version: number): void {
    this.mirror.put(uri, source, version);
    const previous = this.#sourceTimers.get(uri);
    if (previous) clearTimeout(previous);
    this.#sourceTimers.set(uri, setTimeout(() => {
      this.#sourceTimers.delete(uri);
      this.#flushSource(uri);
    }, 32));
  }

  removeSource(uri: string): void {
    const timer = this.#sourceTimers.get(uri);
    if (timer) clearTimeout(timer);
    this.#sourceTimers.delete(uri);
    this.mirror.remove(uri);
    this.rpc.notify({ method: "removeSource", uri });
  }

  analyze(uri: string): Promise<EditorSnapshot> {
    this.#flushSource(uri);
    if (!this.rpc.attached)
      return this.analyzeFallback(uri, new Error("editor worker unavailable"));
    return this.rpc
      .request<EditorSnapshot>({ method: "editorSnapshot", uri })
      .catch((error) => this.analyzeFallback(uri, error));
  }

  private analyzeFallback(uri: string, error: unknown): Promise<EditorSnapshot> {
    this.lifecycle.fallback();
    const snapshot = this.fallback?.editorSnapshot?.(uri);
    return snapshot
      ? Promise.resolve(snapshot)
      : Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }

  restart(): void {
    this.#clearSourceTimers();
    this.lifecycle.restart();
    this.rpc.restart();
  }

  workerLifecycleStats() { return this.stats(); }

  dispose(): void { this.#clearSourceTimers(); this.disposeTransport({ method: "dispose" }); }

  #flushSource(uri: string): void {
    const timer = this.#sourceTimers.get(uri);
    if (timer) clearTimeout(timer);
    this.#sourceTimers.delete(uri);
    const value = this.mirror.get(uri);
    if (value) this.rpc.notify({ method: "putSource", uri, source: value.source, version: value.version });
  }

  #clearSourceTimers(): void {
    for (const timer of this.#sourceTimers.values()) clearTimeout(timer);
    this.#sourceTimers.clear();
  }
}

export function createWorkerCompilerBackend(
  local: CompilerBackend,
  factory: CompilerWorkerFactory,
  options: { readonly onWarning?: (message: string) => void } = {},
): CompilerBackend {
  return new CompilerWorkerBackend(local, factory, options);
}

export function createWorkerEditorAnalysisBackend(
  factory: CompilerWorkerFactory,
  options: {
    readonly onWarning?: (message: string) => void;
    readonly fallback?: Pick<CompilerBackend, "editorSnapshot">;
  } = {},
): EditorAnalysisBackend {
  return new EditorWorkerBackend(factory, options.fallback, options);
}

export class CompilerWorkerHost {
  readonly #compilerPromise = createWasmCompilerBackend();
  #queue = Promise.resolve();

  constructor(private readonly endpoint: WorkerEndpoint) {}

  start(): Promise<void> {
    this.endpoint.onMessage((message) => {
      this.#queue = this.#queue
        .then(() => this.#dispatch(message))
        .catch((error) => {
          this.endpoint.postMessage({
            id: message.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
    return this.#compilerPromise.then(() => undefined);
  }

  async #dispatch(message: CompilerWorkerRequest): Promise<void> {
    const compiler = await this.#compilerPromise;
    let value: unknown;
    switch (message.method) {
      case "putSource":
        compiler.putSource(message.uri, message.source, message.version);
        value = true;
        break;
      case "removeSource":
        value = compiler.removeSource(message.uri);
        break;
      case "compileAndAnalyze":
        value = await compiler.compileAndAnalyze(message.request);
        break;
      case "editorSnapshot":
        if (!compiler.editorSnapshot)
          throw new Error("editor snapshots are unavailable");
        value = compiler.editorSnapshot(message.uri);
        break;
      case "incrementalStats":
        if (!compiler.incrementalStats)
          throw new Error("native incremental statistics API is unavailable");
        value = await compiler.incrementalStats();
        break;
      case "incrementalTrace":
        if (!compiler.incrementalTrace)
          throw new Error("native incremental trace API is unavailable");
        value = await compiler.incrementalTrace();
        break;
      case "incrementalCacheSnapshot":
        if (!compiler.incrementalCacheSnapshot)
          throw new Error("native incremental cache snapshot API is unavailable");
        value = await compiler.incrementalCacheSnapshot();
        break;
      case "resetIncrementalStats":
        await compiler.resetIncrementalStats?.();
        value = true;
        break;
      case "clearIncrementalCaches":
        await compiler.clearIncrementalCaches?.();
        value = true;
        break;
      case "dispose":
        compiler.dispose();
        value = true;
        break;
    }
    this.endpoint.postMessage({ id: message.id, ok: true, value });
  }
}

export async function runCompilerWorker(endpoint: WorkerEndpoint): Promise<void> {
  const host = new CompilerWorkerHost(endpoint);
  await host.start();
}
