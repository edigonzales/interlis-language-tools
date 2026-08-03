import type { CompilationRequest, EditorSnapshot } from "@ilic/compiler-wasm";

export interface CompilerWorkerPort {
  postMessage(message: CompilerWorkerRequest): void;
  onMessage(listener: (message: CompilerWorkerResponse) => void): { dispose(): void };
  onError(listener: (error: unknown) => void): { dispose(): void };
  terminate(): void | Promise<unknown>;
}

export type CompilerWorkerFactory = () => CompilerWorkerPort;

export type CompilerWorkerRequest =
  | { readonly id: number; readonly method: "putSource"; readonly uri: string; readonly source: string | Uint8Array; readonly version: number }
  | { readonly id: number; readonly method: "removeSource"; readonly uri: string }
  | { readonly id: number; readonly method: "compileAndAnalyze"; readonly request: CompilationRequest }
  | { readonly id: number; readonly method: "editorSnapshot"; readonly uri: string }
  | { readonly id: number; readonly method: "incrementalStats" }
  | { readonly id: number; readonly method: "incrementalTrace" }
  | { readonly id: number; readonly method: "incrementalCacheSnapshot" }
  | { readonly id: number; readonly method: "resetIncrementalStats" }
  | { readonly id: number; readonly method: "clearIncrementalCaches" }
  | { readonly id: number; readonly method: "dispose" };

export type CompilerWorkerResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

type WithoutId<T> = T extends { readonly id: number } ? Omit<T, "id"> : never;
export type CompilerWorkerCommand = WithoutId<CompilerWorkerRequest>;

export interface CompilerWorkerCapabilities {
  readonly editorSnapshot?: EditorSnapshot;
}
