import { describe, expect, it, vi } from "vitest";
import { replaceCompilationOutput } from "./compilation-output.js";

describe("replaceCompilationOutput", () => {
  it("clears before appending the complete new run", () => {
    const calls: string[] = [];
    const output = {
      clear: vi.fn(() => calls.push("clear")),
      append: vi.fn((value: string) => calls.push(value)),
    };
    replaceCompilationOutput(output, {
      runId: 1,
      timestamp: "2026-07-20T12:00:00.000Z",
      trigger: "save",
      rootUri: "file:///Root.ili",
      documentVersion: 2,
      compilation: {
        schemaVersion: 1,
        abiVersion: 1,
        compilerVersion: "test",
        kind: "compilation",
        success: true,
        cancelled: false,
        errorCount: 0,
        warningCount: 0,
        missingModels: [],
        models: [],
        diagnostics: [],
        logs: [],
        transcript: ["inf: ilic completed with no errors, no warnings."],
      },
    });
    expect(calls[0]).toBe("clear");
    expect(calls[1]).toContain("ilic completed with no errors, no warnings.");
  });
});
