import type {
  CompilationResult,
  CompilationTrigger,
  SemanticSnapshot,
} from "@ilic/language-service";

export const InterlisProtocol = {
  onTypeEdit: "interlis/onTypeEdit",
  diagramSnapshot: "interlis/diagramSnapshot",
  exportDocx: "interlis/exportDocx",
  compile: "interlis/compile",
  compilationCompleted: "interlis/compilationCompleted",
  semanticSnapshotChanged: "interlis/semanticSnapshotChanged",
  log: "interlis/log",
  workspaceSources: "interlis/workspaceSources",
  workspaceSourceChanged: "interlis/workspaceSourceChanged",
  repositoryConfiguration: "interlis/repositoryConfiguration",
  repositorySource: "interlis/repositorySource",
} as const;

export interface WorkspaceSourcePayload {
  readonly uri: string;
  readonly text: string;
  readonly version?: number;
}

export interface InterlisInitializationOptions {
  readonly modelRepositories?: readonly string[];
  readonly workspaceSources?: readonly WorkspaceSourcePayload[];
  readonly repositoryCachePath?: string;
}

export interface WorkspaceSourcesParams {
  readonly sources: readonly WorkspaceSourcePayload[];
}

export interface WorkspaceSourceChangedParams {
  readonly uri: string;
  readonly text?: string;
  readonly version?: number;
  readonly deleted?: boolean;
}

export interface RepositoryConfigurationParams {
  readonly modelRepositories: readonly string[];
}

export interface RepositorySourceResult {
  readonly uri: string;
  readonly originUri: string;
  readonly text: string;
  readonly readOnly: true;
}

export interface OnTypeEditParams {
  readonly uri: string;
  readonly position: { line: number; character: number };
  readonly character: string;
}

export interface DiagramSnapshotParams {
  readonly uri: string;
}
export interface DiagramSnapshotResult {
  readonly freshness: "fresh" | "stale" | "cancelled";
  readonly generation: number;
  readonly snapshot: SemanticSnapshot;
}
export interface CompileParams {
  readonly uri: string;
  /** A client-initiated compile is manual unless another internal trigger is supplied. */
  readonly trigger?: Exclude<CompilationTrigger, "save">;
}
export interface CompilationCompletedParams {
  readonly runId: number;
  readonly timestamp: string;
  readonly trigger: CompilationTrigger;
  readonly rootUri: string;
  readonly documentVersion: number;
  readonly compilation: CompilationResult;
}
export interface SemanticSnapshotChangedParams {
  readonly runId: number;
  readonly trigger: CompilationTrigger;
  readonly rootUri: string;
  readonly documentVersion: number;
  readonly generation: number;
  readonly success: boolean;
  readonly freshness: "fresh" | "stale" | "cancelled";
  readonly sourceUris: readonly string[];
}
export interface ExportDocxParams {
  readonly uri: string;
}
