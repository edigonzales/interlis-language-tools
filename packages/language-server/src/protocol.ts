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
export interface CompileParams {
  readonly roots?: readonly string[];
}
export interface ExportDocxParams {
  readonly uri: string;
}
