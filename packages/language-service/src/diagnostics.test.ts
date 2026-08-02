import { describe, expect, it } from "vitest";
import {
  DiagnosticStore,
  DiagnosticVersionGate,
  deduplicateDiagnostics,
} from "./index.js";
import type { Diagnostic } from "@ilic/compiler-wasm";

const diagnostic = (code: string, message = code): Diagnostic => ({
  severity: "error",
  code,
  message,
  range: {
    uri: "memory:///Root.ili",
    start: { line: 0, character: 0, byteOffset: 0 },
    end: { line: 0, character: 1, byteOffset: 1 },
  },
  relatedInformation: [],
  notes: [],
  treatedAsError: false,
  source: "compiler",
});

describe("diagnostic publication primitives", () => {
  it("deduplicates by structured identity, not by message alone", () => {
    expect(
      deduplicateDiagnostics([
        diagnostic("A"),
        diagnostic("A"),
        diagnostic("B"),
      ]),
    ).toHaveLength(2);
    expect(
      deduplicateDiagnostics([
        diagnostic("A", "same"),
        diagnostic("A", "different"),
      ]),
    ).toHaveLength(2);
  });

  it("stores only current versioned diagnostics", () => {
    const store = new DiagnosticStore();
    store.put({
      uri: "memory:///Root.ili",
      documentVersion: 2,
      rootUri: "memory:///Root.ili",
      origin: "semantic",
      diagnostics: [diagnostic("A")],
    });
    expect(store.current("memory:///Root.ili", 1)).toEqual([]);
    expect(store.current("memory:///Root.ili", 2)).toHaveLength(1);
    store.removeByRoot("memory:///Root.ili");
    expect(store.current("memory:///Root.ili", 2)).toEqual([]);
  });

  it("rejects stale epochs and runs", () => {
    const gate = new DiagnosticVersionGate();
    gate.beginEpoch(3);
    const current = {
      uri: "memory:///Root.ili",
      documentVersion: 2,
      runId: 4,
      compilationEpoch: 1,
      generation: 3,
    } as const;
    gate.accept(current);
    expect(gate.accepts(current)).toBe(true);
    expect(gate.accepts({ ...current, runId: 3 })).toBe(false);
    expect(gate.accepts({ ...current, generation: 2 })).toBe(false);
  });
});
