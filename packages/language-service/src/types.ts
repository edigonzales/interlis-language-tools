import type {
  CompilationAnalysisResult,
  CompilationRequest,
  CompilationResult,
  FormatResult,
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
  putSource(uri: string, source: string | Uint8Array, version: number): void;
  removeSource(uri: string): boolean;
  parse(uri: string): SyntaxSnapshot;
  analyze(request: CompilationRequest): SemanticSnapshot;
  compileAndAnalyze(request: CompilationRequest): CompilationAnalysisResult;
  compile(request: CompilationRequest): CompilationResult;
  format(
    uri: string,
    options?: { indentSize?: number; requireValidSyntax?: boolean },
  ): FormatResult;
  restart?(): Promise<void> | void;
  dispose(): void;
}

export interface AnalysisEvent {
  readonly result: VersionedResult<SemanticSnapshot>;
  readonly affectedUris: readonly string[];
}

export type CompilationTrigger = "save" | "manual" | "startup";

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
}

export interface WorkspaceSource {
  readonly uri: string;
  readonly text: string;
  readonly version?: number;
}
