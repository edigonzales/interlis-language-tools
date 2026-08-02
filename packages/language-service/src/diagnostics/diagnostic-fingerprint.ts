import type { Diagnostic } from "@ilic/compiler-wasm";

/** Stable identity for merging native, live, saved and repository results. */
export function diagnosticFingerprint(value: Diagnostic): string {
  const range = value.range;
  const related = value.relatedInformation
    .map((entry) => {
      const relatedRange = entry.range;
      return [
        relatedRange?.uri ?? "",
        relatedRange?.start.byteOffset ?? -1,
        relatedRange?.end.byteOffset ?? -1,
        entry.message,
      ].join(":");
    })
    .join("|");
  return [
    value.code,
    value.severity,
    value.source ?? "",
    range?.uri ?? "",
    range?.start.byteOffset ?? -1,
    range?.end.byteOffset ?? -1,
    value.message,
    value.treatedAsError,
    related,
    value.notes.join("|"),
  ].join("\u001f");
}

export function deduplicateDiagnostics(
  values: readonly Diagnostic[],
): Diagnostic[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = diagnosticFingerprint(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
