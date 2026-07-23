export { AnalysisCache } from "./cache.js";
export { createWasmCompilerBackend } from "./compiler.js";
export {
  createWorkerCompilerBackend,
  runCompilerWorker,
} from "./compiler-worker.js";
export type {
  CompilerWorkerFactory,
  CompilerWorkerPort,
  CompilerWorkerRequest,
  CompilerWorkerResponse,
} from "./compiler-worker.js";
export type {
  ModelCatalogEntry,
  ModelRepository,
  RepositoryResolver,
  RepositorySchemaLanguage,
  ResolvedModel,
  ResolvedRepositoryModel,
} from "./repository.js";
export { WorkspaceRepositoryResolver } from "./repository.js";
export { LanguageService } from "./service.js";
export type {
  CompletionItem,
  DocumentSymbol,
  EditorPosition,
  EditorRange,
  HoverResult,
  Location,
  RenameResult,
  TemplateEdit,
  TextEdit,
} from "./features.js";
export { contains, contextAt, toEditorRange } from "./features.js";
export {
  DEFAULT_TEMPLATE_TIMEOUT_MS,
  DEFAULT_TEMPLATE_URL,
  OFFLINE_TEMPLATE,
  OutputBuffer,
  fetchTemplate,
  formatCompilationOutput,
  formatCompilationOutputForDisplay,
  isBlankInterlisDocument,
  resolveTemplateUrl,
  snippetKeyAction,
  suggestionActivation,
} from "./interactions.js";
export type {
  OutputEntry,
  SnippetAction,
  SnippetKey,
  SnippetPlaceholder,
  SuggestionActivation,
  SuggestionReason,
} from "./interactions.js";
export type {
  AnalysisEvent,
  CompilationEvent,
  CompilationOutputEvent,
  CompilationTrigger,
  CompilerBackend,
  LanguageServiceOptions,
  OpenDocument,
  ResultFreshness,
  VersionedResult,
  WorkspaceSource,
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
  CompilationAnalysisResult,
  CompilationRequest,
  Diagnostic,
  DiagramEdge,
  DiagramNode,
  SemanticSnapshot,
  SourceRange,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";
