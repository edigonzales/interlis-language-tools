import type { Diagnostic } from "@ilic/compiler-wasm";
import { deduplicateDiagnostics } from "./diagnostic-fingerprint.js";

export type DiagnosticOrigin = "live" | "saved" | "semantic" | "repository";

export interface StoredDiagnostics {
  readonly uri: string;
  readonly documentVersion: number;
  readonly rootUri?: string;
  readonly origin: DiagnosticOrigin;
  readonly diagnostics: readonly Diagnostic[];
}

export class DiagnosticStore {
  readonly #values = new Map<string, StoredDiagnostics>();

  put(value: StoredDiagnostics): void {
    this.#values.set(`${value.origin}:${value.uri}:${value.rootUri ?? ""}`, {
      ...value,
      diagnostics: deduplicateDiagnostics(value.diagnostics),
    });
  }

  removeByUri(uri: string): void {
    for (const [key, value] of this.#values)
      if (value.uri === uri) this.#values.delete(key);
  }

  remove(uri: string, origin: DiagnosticOrigin): void {
    for (const [key, value] of this.#values)
      if (value.uri === uri && value.origin === origin)
        this.#values.delete(key);
  }

  removeByRoot(rootUri: string): void {
    for (const [key, value] of this.#values)
      if (value.rootUri === rootUri) this.#values.delete(key);
  }

  current(uri: string, documentVersion: number): Diagnostic[] {
    return [...this.#values.values()]
      .filter(
        (value) =>
          value.uri === uri && value.documentVersion === documentVersion,
      )
      .flatMap((value) => value.diagnostics);
  }

  clear(): void {
    this.#values.clear();
  }
}
