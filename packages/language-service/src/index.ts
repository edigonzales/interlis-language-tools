export { AnalysisCache } from "./cache.js";
export { createWasmCompilerBackend } from "./compiler.js";
export {
  CompilerWorkerBackend,
  CompilerWorkerHost,
  EditorWorkerBackend,
  createWorkerCompilerBackend,
  createWorkerEditorAnalysisBackend,
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
export { SourceRegistry } from "./source/source-registry.js";
export type { EffectiveSource, SourceChange } from "./source/source-registry.js";
export { SyntaxSnapshotStore } from "./syntax/syntax-snapshot-store.js";
export { EditorSnapshotStore } from "./editor/editor-snapshot-store.js";
export { EditorAnalysisController } from "./editor/editor-analysis-controller.js";
export { SemanticSnapshotStore } from "./semantic/semantic-snapshot-store.js";
export type { SemanticAcceptance } from "./semantic/semantic-snapshot-store.js";
export { CompilationScheduler } from "./compilation/compilation-scheduler.js";
export type { ScheduledCompilation } from "./compilation/compilation-scheduler.js";
export { RepositoryModelController } from "./repository/repository-model-controller.js";
export { LanguageServiceEventHub } from "./events/language-service-event-hub.js";
export { WorkerLifecycleTracker } from "./workers/worker-lifecycle-tracker.js";
export type { WorkerLifecycleStats } from "./workers/worker-lifecycle-tracker.js";
export { WorkerRpcClient } from "./workers/worker-rpc-client.js";
export { WorkerSourceMirror } from "./workers/worker-source-mirror.js";
export type { MirroredSource } from "./workers/worker-source-mirror.js";
export {
  diagnosticFingerprint,
  deduplicateDiagnostics,
} from "./diagnostics/diagnostic-fingerprint.js";
export { DiagnosticStore } from "./diagnostics/diagnostic-store.js";
export { DiagnosticVersionGate } from "./diagnostics/diagnostic-version-gate.js";
export { DiagnosticCoordinator } from "./diagnostics/diagnostic-coordinator.js";
export { DependencyIndex } from "./semantic/dependency-index.js";
export { CompilationRunCoordinator } from "./compilation/compilation-run-coordinator.js";
export { LanguageFeatureCoordinator } from "./features/language-feature-coordinator.js";
export type {
  DiagnosticOrigin,
  StoredDiagnostics,
} from "./diagnostics/diagnostic-store.js";
export type { DiagnosticPublicationToken } from "./diagnostics/diagnostic-version-gate.js";
export type {
  CompletionItem,
  CodeAction,
  DocumentSymbol,
  EditorFormattingOptions,
  EditorPosition,
  EditorRange,
  HoverResult,
  Location,
  RenameResult,
  TemplateEdit,
  TextEdit,
} from "./features.js";
export type {
  CompletionContext,
  CompletionSlot,
  CompletionSymbolKind,
} from "./completion.js";
export {
  completionContextAt,
  contains,
  contextAt,
  toEditorRange,
} from "./features.js";
export {
  DEFAULT_TEMPLATE_TIMEOUT_MS,
  DEFAULT_TEMPLATE_URL,
  OutputBuffer,
  fetchTemplate,
  formatCompilationOutput,
  formatCompilationOutputForDisplay,
  isBlankInterlisDocument,
  resolveTemplateUrl,
  snippetKeyAction,
  suggestionActivation,
  suggestionActivationFromContext,
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
  DiagnosticsChangedEvent,
  CompilerBackend,
  EditorAnalysisBackend,
  LanguageServiceOptions,
  LiveAnalysisStatus,
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
  EditorDeclaration,
  EditorReference,
  EditorSnapshot,
  DiagramEdge,
  DiagramNode,
  SemanticSnapshot,
  SourceRange,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";
