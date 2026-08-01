import type { SemanticSnapshot } from "@ilic/compiler-wasm";

/**
 * Legacy storage-only helper kept for source compatibility. The Language
 * Service does not consult it for compilation decisions; the native session
 * owns semantic cache identity and invalidation.
 */
export class AnalysisCache {
  readonly #entries = new Map<string, SemanticSnapshot>();

  get(
    roots: readonly string[],
    versions: Readonly<Record<string, number>>,
  ): SemanticSnapshot | undefined {
    return this.#entries.get(this.#key(roots, versions));
  }

  set(
    roots: readonly string[],
    versions: Readonly<Record<string, number>>,
    snapshot: SemanticSnapshot,
  ): void {
    this.#entries.set(this.#key(roots, versions), snapshot);
  }

  clear(): void {
    this.#entries.clear();
  }

  #key(
    roots: readonly string[],
    versions: Readonly<Record<string, number>>,
  ): string {
    return JSON.stringify({
      roots: [...roots].sort(),
      versions: Object.entries(versions).sort(([a], [b]) => a.localeCompare(b)),
    });
  }
}
