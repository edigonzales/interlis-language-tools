import type {
  CompilationAnalysisResult,
  CompilationRequest,
  EditorSnapshot,
  IncrementalStats,
} from "@ilic/compiler-wasm";
import { createWasmCompilerBackend } from "./compiler.js";
import type { CompilerBackend, EditorAnalysisBackend } from "./types.js";

export interface CompilerWorkerPort {
  postMessage(message: CompilerWorkerRequest): void;
  onMessage(listener: (message: CompilerWorkerResponse) => void): {
    dispose(): void;
  };
  onError(listener: (error: unknown) => void): { dispose(): void };
  terminate(): void | Promise<unknown>;
}

export type CompilerWorkerFactory = () => CompilerWorkerPort;

export type CompilerWorkerRequest =
  | {
      readonly id: number;
      readonly method: "putSource";
      readonly uri: string;
      readonly source: string | Uint8Array;
      readonly version: number;
    }
  | {
      readonly id: number;
      readonly method: "removeSource";
      readonly uri: string;
    }
  | {
      readonly id: number;
      readonly method: "compileAndAnalyze";
      readonly request: CompilationRequest;
    }
  | {
      readonly id: number;
      readonly method: "editorSnapshot";
      readonly uri: string;
    }
  | { readonly id: number; readonly method: "incrementalStats" }
  | { readonly id: number; readonly method: "clearIncrementalCaches" }
  | { readonly id: number; readonly method: "dispose" };

export type CompilerWorkerResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

type WithoutId<T> = T extends { readonly id: number } ? Omit<T, "id"> : never;
type CompilerWorkerCommand = WithoutId<CompilerWorkerRequest>;

interface WorkerEndpoint {
  postMessage(message: CompilerWorkerResponse): void;
  onMessage(listener: (message: CompilerWorkerRequest) => void): void;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

export function createWorkerCompilerBackend(
  local: CompilerBackend,
  factory: CompilerWorkerFactory,
  options: { readonly onWarning?: (message: string) => void } = {},
): CompilerBackend {
  const sources = new Map<
    string,
    { readonly source: string | Uint8Array; readonly version: number }
  >();
  const pending = new Map<number, PendingRequest>();
  let nextId = 0;
  let port: CompilerWorkerPort | null = null;
  let messageSubscription: { dispose(): void } | null = null;
  let errorSubscription: { dispose(): void } | null = null;
  let disposed = false;
  let warned = false;
  let consecutiveFailures = 0;
  let workerUnavailable = false;

  const warn = (message: string): void => {
    if (warned) return;
    warned = true;
    options.onWarning?.(message);
  };
  const rejectPending = (message: string): void => {
    for (const request of pending.values()) request.reject(new Error(message));
    pending.clear();
  };
  const detach = (): void => {
    messageSubscription?.dispose();
    errorSubscription?.dispose();
    messageSubscription = null;
    errorSubscription = null;
    const current = port;
    port = null;
    if (current) void current.terminate();
  };
  const postReplay = (): void => {
    for (const [uri, value] of sources)
      port?.postMessage({
        id: ++nextId,
        method: "putSource",
        uri,
        source: value.source,
        version: value.version,
      });
  };
  const attach = (): boolean => {
    if (disposed || workerUnavailable) return false;
    try {
      port = factory();
      messageSubscription = port.onMessage((message) => {
        consecutiveFailures = 0;
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.ok) request.resolve(message.value);
        else request.reject(new Error(message.error));
      });
      errorSubscription = port.onError((error) => {
        consecutiveFailures += 1;
        const message = error instanceof Error ? error.message : String(error);
        rejectPending(`INTERLIS compiler worker failed: ${message}`);
        detach();
        if (!disposed) {
          warn(
            "The INTERLIS compiler worker was restarted after an error; the interrupted compilation runs locally.",
          );
          if (consecutiveFailures === 1) {
            if (attach()) postReplay();
          } else workerUnavailable = true;
        }
      });
      return true;
    } catch (error) {
      port = null;
      workerUnavailable = true;
      warn(
        `The INTERLIS compiler worker is unavailable; full compilation runs in the language-server process (${error instanceof Error ? error.message : String(error)}).`,
      );
      return false;
    }
  };
  const request = <T>(message: CompilerWorkerCommand): Promise<T> => {
    if (!port && !attach())
      return Promise.reject(new Error("compiler worker unavailable"));
    const current = port;
    if (!current)
      return Promise.reject(new Error("compiler worker unavailable"));
    const id = ++nextId;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      current.postMessage({ id, ...message });
    });
  };
  const notify = (message: CompilerWorkerCommand): void => {
    if (!port && !attach()) return;
    const current = port;
    if (current) current.postMessage({ id: ++nextId, ...message });
  };

  attach();

  return {
    capabilities: {
      ...local.capabilities,
      incrementalSession: local.capabilities?.incrementalSession ?? false,
      incrementalStats: local.capabilities?.incrementalStats ?? false,
    },
    putSource(uri, source, version) {
      sources.set(uri, { source, version });
      local.putSource(uri, source, version);
      notify({ method: "putSource", uri, source, version });
    },
    removeSource(uri) {
      sources.delete(uri);
      notify({ method: "removeSource", uri });
      return local.removeSource(uri);
    },
    parse: (uri) => local.parse(uri),
    analyze: (compilationRequest) => local.analyze(compilationRequest),
    compileAndAnalyze(compilationRequest) {
      if (!port) return local.compileAndAnalyze(compilationRequest);
      return request<CompilationAnalysisResult>({
        method: "compileAndAnalyze",
        request: compilationRequest,
      }).catch(() => local.compileAndAnalyze(compilationRequest));
    },
    compile: (compilationRequest) => local.compile(compilationRequest),
    format: (uri, formatOptions) => local.format(uri, formatOptions),
    incrementalStats() {
      if (!port) {
        if (!local.incrementalStats)
          throw new Error("native incremental statistics API is unavailable");
        return local.incrementalStats();
      }
      return request<IncrementalStats>({ method: "incrementalStats" }).catch(
        () => {
          if (!local.incrementalStats)
            throw new Error("native incremental statistics API is unavailable");
          return local.incrementalStats();
        },
      );
    },
    clearIncrementalCaches() {
      if (!port) {
        return local.clearIncrementalCaches?.();
      }
      return request<unknown>({ method: "clearIncrementalCaches" })
        .then(() => {
          return local.clearIncrementalCaches?.();
        })
        .catch(() => {
          return local.clearIncrementalCaches?.();
        });
    },
    async restart() {
      rejectPending("INTERLIS compiler worker restarted");
      detach();
      await local.restart?.();
      consecutiveFailures = 0;
      workerUnavailable = false;
      if (attach()) postReplay();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rejectPending("INTERLIS compiler backend disposed");
      if (port) notify({ method: "dispose" });
      detach();
      sources.clear();
      local.dispose();
    },
  };
}

export function createWorkerEditorAnalysisBackend(
  factory: CompilerWorkerFactory,
  options: {
    readonly onWarning?: (message: string) => void;
    readonly fallback?: Pick<CompilerBackend, "editorSnapshot">;
  } = {},
): EditorAnalysisBackend {
  const sources = new Map<
    string,
    { readonly source: string | Uint8Array; readonly version: number }
  >();
  const pending = new Map<number, PendingRequest>();
  let nextId = 0;
  let port: CompilerWorkerPort | null = null;
  let messageSubscription: { dispose(): void } | null = null;
  let errorSubscription: { dispose(): void } | null = null;
  let disposed = false;
  let warned = false;
  let consecutiveFailures = 0;
  let workerUnavailable = false;

  const warn = (message: string): void => {
    if (warned) return;
    warned = true;
    options.onWarning?.(message);
  };
  const rejectPending = (message: string): void => {
    for (const request of pending.values()) request.reject(new Error(message));
    pending.clear();
  };
  const detach = (): void => {
    messageSubscription?.dispose();
    errorSubscription?.dispose();
    messageSubscription = null;
    errorSubscription = null;
    const current = port;
    port = null;
    if (current) void current.terminate();
  };
  const replay = (): void => {
    for (const [uri, value] of sources)
      port?.postMessage({
        id: ++nextId,
        method: "putSource",
        uri,
        source: value.source,
        version: value.version,
      });
  };
  const attach = (): boolean => {
    if (disposed || workerUnavailable) return false;
    try {
      port = factory();
      messageSubscription = port.onMessage((message) => {
        consecutiveFailures = 0;
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.ok) request.resolve(message.value);
        else request.reject(new Error(message.error));
      });
      errorSubscription = port.onError((error) => {
        consecutiveFailures += 1;
        const message = error instanceof Error ? error.message : String(error);
        rejectPending(`INTERLIS editor worker failed: ${message}`);
        detach();
        if (!disposed) {
          warn(
            "Live INTERLIS analysis was restarted after an editor worker error.",
          );
          if (consecutiveFailures === 1) attach();
          else workerUnavailable = true;
        }
      });
      replay();
      return true;
    } catch (error) {
      port = null;
      workerUnavailable = true;
      warn(
        `Live INTERLIS analysis is unavailable (${error instanceof Error ? error.message : String(error)}).`,
      );
      return false;
    }
  };
  const notifyRunningWorker = (
    message: Extract<
      CompilerWorkerCommand,
      { method: "putSource" | "removeSource" | "dispose" }
    >,
  ): void => {
    port?.postMessage({ id: ++nextId, ...message });
  };

  const analyzeLocally = (uri: string, error: unknown): EditorSnapshot => {
    const snapshot = options.fallback?.editorSnapshot?.(uri);
    if (snapshot) return snapshot;
    throw error;
  };

  return {
    putSource(uri, source, version) {
      sources.set(uri, { source, version });
      notifyRunningWorker({ method: "putSource", uri, source, version });
    },
    removeSource(uri) {
      sources.delete(uri);
      notifyRunningWorker({ method: "removeSource", uri });
    },
    analyze(uri) {
      if (!port && !attach())
        return Promise.resolve().then(() =>
          analyzeLocally(uri, new Error("editor worker unavailable")),
        );
      const current = port;
      if (!current)
        return Promise.resolve().then(() =>
          analyzeLocally(uri, new Error("editor worker unavailable")),
        );
      const id = ++nextId;
      return new Promise<EditorSnapshot>((resolve, reject) => {
        pending.set(id, {
          resolve: (value) => resolve(value as EditorSnapshot),
          reject,
        });
        current.postMessage({ id, method: "editorSnapshot", uri });
      }).catch((error) => analyzeLocally(uri, error));
    },
    restart() {
      rejectPending("INTERLIS editor worker restarted");
      detach();
      consecutiveFailures = 0;
      workerUnavailable = false;
      attach();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rejectPending("INTERLIS editor worker disposed");
      if (port) notifyRunningWorker({ method: "dispose" });
      detach();
      sources.clear();
    },
  };
}

export async function runCompilerWorker(
  endpoint: WorkerEndpoint,
): Promise<void> {
  const compilerPromise = createWasmCompilerBackend();
  let queue = Promise.resolve();
  endpoint.onMessage((message) => {
    queue = queue
      .then(async () => {
        const compiler = await compilerPromise;
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
              throw new Error(
                "native incremental statistics API is unavailable",
              );
            value = await compiler.incrementalStats();
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
        endpoint.postMessage({ id: message.id, ok: true, value });
      })
      .catch((error) => {
        endpoint.postMessage({
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });
  await compilerPromise;
}
