import type {
  CompilationRequest,
  CompilationResult,
  FormatResult,
  SemanticSnapshot,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";

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

export interface LanguageServiceOptions {
  readonly semanticDebounceMs?: number;
  readonly onAnalysis?: (event: AnalysisEvent) => void;
  readonly onError?: (error: unknown) => void;
}
