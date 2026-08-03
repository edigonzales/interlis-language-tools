import type { SyntaxSnapshot } from "@ilic/compiler-wasm";
import type { VersionedResult } from "../types.js";

export class SyntaxSnapshotStore {
  readonly #values = new Map<string, VersionedResult<SyntaxSnapshot>>();

  get(uri: string, sourceVersion: number): VersionedResult<SyntaxSnapshot> | null {
    const value = this.#values.get(uri);
    return value?.value?.documentVersion === sourceVersion ? value : null;
  }

  put(uri: string, value: VersionedResult<SyntaxSnapshot>): void { this.#values.set(uri, value); }
  invalidate(uri: string): void {
    const value = this.#values.get(uri);
    if (value) this.#values.set(uri, { ...value, freshness: "stale" });
  }
  clear(): void { this.#values.clear(); }
}
