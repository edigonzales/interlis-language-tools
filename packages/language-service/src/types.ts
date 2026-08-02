import type {
  CompilationAnalysisResult,
  CompilationRequest,
  CompilationResult,
  FormatResult,
  EditorSnapshot,
  IncrementalStats,
  SemanticSnapshot,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";
import type { ModelRepository } from "./repository.js";

export type ResultFreshness = "fresh" | "stale" | "cancelled";

export interface VersionedResult<T> {
  readonly value: T | null;
  readonly freshness: ResultFreshness;
  readonly generation: number;
  readonly documentVersions: Readonly<Record<string, number>>;
}

export interface OpenDocument {
  readonly uri: string;
  readonly text: string;
  readonly version: number;
  readonly dirty: boolean;
}

export interface CompilerBackend {
  readonly capabilities?: {
    readonly incrementalSession?: boolean;
    readonly incrementalStats?: boolean;
    readonly incrementalTrace?: boolean;
    readonly incrementalCacheSnapshot?: boolean;
    readonly strictEditorSeparation?: boolean;
  };
  putSource(uri: string, source: string | Uint8Array, version: number): void;
  removeSource(uri: string): boolean;
  parse(uri: string): SyntaxSnapshot;
  editorSnapshot?(uri: string): EditorSnapshot;
  analyze(request: CompilationRequest): SemanticSnapshot;
  compileAndAnalyze(
    request: CompilationRequest,
  ): CompilationAnalysisResult | Promise<CompilationAnalysisResult>;
  compile(request: CompilationRequest): CompilationResult;
  incrementalStats?(): IncrementalStats | Promise<IncrementalStats>;
  incrementalTrace?(): Record<string, unknown> | Promise<Record<string, unknown>>;
  incrementalCacheSnapshot?(): Record<string, unknown> | Promise<Record<string, unknown>>;
  resetIncrementalStats?(): void | Promise<void>;
  clearIncrementalCaches?(): void | Promise<void>;
  workerLifecycleStats?(): WorkerLifecycleStats;
  format(
    uri: string,
    options?: { indentSize?: number; requireValidSyntax?: boolean },
  ): FormatResult;
  restart?(): Promise<void> | void;
  dispose(): void;
}

export interface WorkerLifecycleStats {
  readonly restarts: number;
  readonly replayBatches: number;
  readonly replayedSources: number;
  readonly replayedBytes: number;
  readonly fallbackExecutions: number;
  readonly queueSize: number;
}

export interface EditorAnalysisBackend {
  putSource(uri: string, source: string | Uint8Array, version: number): void;
  removeSource(uri: string): void;
  analyze(uri: string): Promise<EditorSnapshot>;
  workerLifecycleStats?(): WorkerLifecycleStats;
  restart?(): Promise<void> | void;
  dispose(): void;
}

export interface AnalysisEvent {
  readonly result: VersionedResult<SemanticSnapshot>;
  readonly affectedUris: readonly string[];
}

export type LiveAnalysisStatus =
  "off" | "scheduled" | "running" | "ready" | "unavailable";

export interface DiagnosticsChangedEvent {
  readonly uri: string;
  readonly documentVersion: number | null;
  readonly status: LiveAnalysisStatus;
}

export type CompilationTrigger =
  "save" | "manual" | "open" | "startup" | "dependency" | "diagram";

export interface CompilationOutputEvent {
  readonly runId: number;
  readonly timestamp: string;
  readonly trigger: CompilationTrigger;
  readonly rootUri: string;
  readonly documentVersion: number;
  readonly compilation: CompilationResult;
}

export interface CompilationEvent extends CompilationOutputEvent {
  readonly semantic: VersionedResult<SemanticSnapshot>;
}

export interface LanguageServiceOptions {
  readonly onAnalysis?: (event: AnalysisEvent) => void;
  readonly onCompilation?: (event: CompilationEvent) => void;
  readonly onError?: (error: unknown) => void;
  readonly modelRepository?: ModelRepository;
  readonly editorAnalysis?: EditorAnalysisBackend;
  readonly liveDiagnostics?: "off" | "conservative";
  readonly liveDiagnosticsDelayMs?: number;
  readonly editorAnalysisTimeoutMs?: number;
}

export interface WorkspaceSource {
  readonly uri: string;
  readonly text: string;
  readonly version?: number;
}
