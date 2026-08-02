export interface DiagnosticPublicationToken {
  readonly uri: string;
  readonly documentVersion: number;
  readonly runId: number;
  readonly compilationEpoch: number;
  readonly generation: number;
  readonly rootUri?: string;
}

/** Rejects asynchronous results that cannot belong to the current workspace state. */
export class DiagnosticVersionGate {
  #tokens = new Map<string, DiagnosticPublicationToken>();
  #epoch = 0;
  #generation = 0;

  beginEpoch(generation: number): void {
    this.#epoch += 1;
    this.#generation = generation;
    this.#tokens.clear();
  }

  accept(token: DiagnosticPublicationToken): void {
    this.#tokens.set(token.uri, token);
  }

  accepts(token: DiagnosticPublicationToken): boolean {
    const current = this.#tokens.get(token.uri);
    return (
      token.compilationEpoch === this.#epoch &&
      token.generation >= this.#generation &&
      (!current ||
        (current.runId <= token.runId &&
          current.documentVersion <= token.documentVersion))
    );
  }
}
