import type { SemanticSnapshot } from "@ilic/language-service";

export const InterlisProtocol = {
  onTypeEdit: "interlis/onTypeEdit",
  diagramSnapshot: "interlis/diagramSnapshot",
  exportDocx: "interlis/exportDocx",
  compile: "interlis/compile",
  semanticSnapshotChanged: "interlis/semanticSnapshotChanged",
  log: "interlis/log",
} as const;

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
  readonly roots?: readonly string[];
}
export interface ExportDocxParams {
  readonly uri: string;
}
