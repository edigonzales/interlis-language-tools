import type {
  CompilationAnalysisResult,
  CompilationRequest,
} from "@ilic/compiler-wasm";
import { createWasmCompilerBackend } from "./compiler.js";
import type { CompilerBackend } from "./types.js";

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
    if (disposed) return false;
    try {
      port = factory();
      messageSubscription = port.onMessage((message) => {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.ok) request.resolve(message.value);
        else request.reject(new Error(message.error));
      });
      errorSubscription = port.onError((error) => {
        const message = error instanceof Error ? error.message : String(error);
        rejectPending(`INTERLIS compiler worker failed: ${message}`);
        detach();
        if (!disposed) {
          warn(
            "The INTERLIS compiler worker was restarted after an error; pending compilations were cancelled.",
          );
          if (attach()) postReplay();
        }
      });
      return true;
    } catch (error) {
      port = null;
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
      }).catch((error) => {
        if (!port) return local.compileAndAnalyze(compilationRequest);
        throw error;
      });
    },
    compile: (compilationRequest) => local.compile(compilationRequest),
    format: (uri, formatOptions) => local.format(uri, formatOptions),
    async restart() {
      rejectPending("INTERLIS compiler worker restarted");
      detach();
      await local.restart?.();
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

export async function runCompilerWorker(
  endpoint: WorkerEndpoint,
): Promise<void> {
  const compiler = await createWasmCompilerBackend();
  let queue = Promise.resolve();
  endpoint.onMessage((message) => {
    queue = queue
      .then(async () => {
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
}
