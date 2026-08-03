import type { SemanticSnapshot } from "@ilic/compiler-wasm";

/** Reverse dependency ownership used to invalidate affected compilation roots. */
export class DependencyIndex {
  readonly #reverse = new Map<string, Set<string>>();

  rebuild(snapshot: SemanticSnapshot): void {
    this.#reverse.clear();
    for (const dependency of snapshot.dependencies) {
      const roots = this.#reverse.get(dependency.targetUri) ?? new Set<string>();
      roots.add(dependency.sourceUri);
      this.#reverse.set(dependency.targetUri, roots);
    }
  }

  affected(uri: string): readonly string[] { return [...(this.#reverse.get(uri) ?? [])]; }
  clear(): void { this.#reverse.clear(); }
}
