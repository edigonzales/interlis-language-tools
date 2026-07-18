export { AnalysisCache } from "./cache.js";
export { createWasmCompilerBackend } from "./compiler.js";
export type { RepositoryResolver, ResolvedModel } from "./repository.js";
export { WorkspaceRepositoryResolver } from "./repository.js";
export { LanguageService } from "./service.js";
export type {
  AnalysisEvent,
  CompilerBackend,
  LanguageServiceOptions,
  OpenDocument,
  ResultFreshness,
  VersionedResult,
} from "./types.js";
export type {
  Disposable,
  FileChange,
  FileStat,
  FileType,
  WorkspaceFileSystem,
} from "./workspace.js";
export { MemoryWorkspaceFileSystem } from "./workspace.js";
export type {
  CompilationResult,
  Diagnostic,
  SemanticSnapshot,
  SourceRange,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";
