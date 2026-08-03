import type { SemanticSnapshot } from "@ilic/compiler-wasm";
import type { VersionedResult } from "../types.js";

export interface SemanticAcceptance {
  readonly current: VersionedResult<SemanticSnapshot>;
  readonly lastGood: boolean;
  readonly saved: boolean;
}

export class SemanticSnapshotStore {
  readonly #current = new Map<string, VersionedResult<SemanticSnapshot>>();
  readonly #lastGood = new Map<string, VersionedResult<SemanticSnapshot>>();
  readonly #saved = new Map<string, VersionedResult<SemanticSnapshot>>();
  #lastRoot: string | null = null;

  accept(rootUri: string, result: VersionedResult<SemanticSnapshot>, options: { readonly saved: boolean; readonly successful: boolean }): SemanticAcceptance {
    this.#current.set(rootUri, result);
    this.#lastRoot = rootUri;
    if (options.successful) this.#lastGood.set(rootUri, result);
    if (options.saved) this.#saved.set(rootUri, result);
    return { current: result, lastGood: options.successful, saved: options.saved };
  }

  current(rootUri: string): VersionedResult<SemanticSnapshot> | null { return this.#current.get(rootUri) ?? null; }
  lastGood(rootUri: string): VersionedResult<SemanticSnapshot> | null { return this.#lastGood.get(rootUri) ?? null; }
  saved(rootUri: string): VersionedResult<SemanticSnapshot> | null { return this.#saved.get(rootUri) ?? null; }

  forDocument(uri: string): VersionedResult<SemanticSnapshot> | null {
    for (const value of this.#current.values()) if (value.value?.documentVersions[uri] !== undefined) return value;
    return null;
  }

  completionForDocument(uri: string): VersionedResult<SemanticSnapshot> | null {
    return this.forDocument(uri) ?? (this.#lastRoot ? this.lastGood(this.#lastRoot) : null);
  }

  invalidateBySource(uri: string): readonly string[] {
    const affected: string[] = [];
    for (const [root, value] of this.#current) if (value.value?.documentVersions[uri] !== undefined) {
      this.#current.set(root, { ...value, freshness: "stale" });
      affected.push(root);
    }
    return affected;
  }

  clear(): void { this.#current.clear(); this.#lastGood.clear(); this.#saved.clear(); this.#lastRoot = null; }
}
