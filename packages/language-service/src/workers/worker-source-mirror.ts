export interface MirroredSource {
  readonly source: string | Uint8Array;
  readonly version: number;
}

/** Owns the replayable source state shared by compiler-worker transports. */
export class WorkerSourceMirror {
  readonly #sources = new Map<string, MirroredSource>();

  put(uri: string, source: string | Uint8Array, version: number): void {
    this.#sources.set(uri, { source, version });
  }

  remove(uri: string): void { this.#sources.delete(uri); }

  get(uri: string): MirroredSource | undefined { return this.#sources.get(uri); }

  entries(): readonly (readonly [string, MirroredSource])[] {
    return [...this.#sources.entries()];
  }

  sourceCount(): number { return this.#sources.size; }

  byteCount(): number {
    let total = 0;
    for (const { source } of this.#sources.values())
      total += typeof source === "string" ? new TextEncoder().encode(source).byteLength : source.byteLength;
    return total;
  }

  clear(): void { this.#sources.clear(); }
}
