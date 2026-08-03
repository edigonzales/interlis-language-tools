import type { Diagnostic } from "@ilic/compiler-wasm";
import { deduplicateDiagnostics } from "./diagnostic-fingerprint.js";
import { DiagnosticStore } from "./diagnostic-store.js";
import { DiagnosticVersionGate } from "./diagnostic-version-gate.js";

export type DiagnosticLayer = "compiler" | "live" | "saved";

/** Owns diagnostic layers, version-gated publication, and merge semantics. */
export class DiagnosticCoordinator {
  readonly #store = new DiagnosticStore();
  readonly #gate = new DiagnosticVersionGate();
  readonly #layers = new Map<string, Map<DiagnosticLayer, readonly Diagnostic[]>>();
  readonly #listeners = new Set<(uri: string) => void>();

  beginEpoch(generation: number): void { this.#gate.beginEpoch(generation); }

  acceptCompiler(
    uri: string,
    rootUri: string,
    documentVersion: number,
    diagnostics: readonly Diagnostic[],
  ): void {
    const values = deduplicateDiagnostics(diagnostics);
    const layers = this.#layers.get(uri) ?? new Map<DiagnosticLayer, readonly Diagnostic[]>();
    layers.set("compiler", values);
    this.#layers.set(uri, layers);
    this.#store.put({ uri, rootUri, documentVersion, origin: "semantic", diagnostics: values });
    this.#notify(uri);
  }

  putLive(uri: string, documentVersion: number, diagnostics: readonly Diagnostic[]): void {
    this.#putLayer(uri, "live", diagnostics, documentVersion);
  }

  putSaved(uri: string, documentVersion: number, diagnostics: readonly Diagnostic[]): void {
    this.#putLayer(uri, "saved", diagnostics, documentVersion);
  }

  diagnostics(uri: string): Diagnostic[] {
    const layers = this.#layers.get(uri);
    return deduplicateDiagnostics([
      ...(layers?.get("compiler") ?? []),
      ...(layers?.get("live") ?? []),
      ...(layers?.get("saved") ?? []),
    ]);
  }

  remove(uri: string, layer?: DiagnosticLayer): void {
    if (!layer) this.#layers.delete(uri);
    else this.#layers.get(uri)?.delete(layer);
    if (layer) this.#store.remove(uri, layer === "compiler" ? "semantic" : layer);
    else this.#store.remove(uri, "semantic");
    this.#notify(uri);
  }

  onChange(listener: (uri: string) => void): { dispose(): void } {
    this.#listeners.add(listener);
    return { dispose: () => this.#listeners.delete(listener) };
  }

  clear(): void { this.#layers.clear(); this.#store.clear(); }

  #putLayer(uri: string, layer: DiagnosticLayer, diagnostics: readonly Diagnostic[], version: number): void {
    const layers = this.#layers.get(uri) ?? new Map<DiagnosticLayer, readonly Diagnostic[]>();
    layers.set(layer, deduplicateDiagnostics(diagnostics));
    this.#layers.set(uri, layers);
    this.#store.put({ uri, documentVersion: version, origin: layer === "live" ? "live" : "saved", diagnostics: layers.get(layer)! });
    this.#notify(uri);
  }

  #notify(uri: string): void { for (const listener of [...this.#listeners]) listener(uri); }
}
