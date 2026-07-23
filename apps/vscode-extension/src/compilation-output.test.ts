import { describe, expect, it, vi } from "vitest";
import { replaceCompilationOutput } from "./compilation-output.js";

function localTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

describe("replaceCompilationOutput", () => {
  it("appends the local event timestamp to the final completion line", () => {
    const calls: string[] = [];
    const timestamp = "2026-07-20T12:00:00.000Z";
    const output = {
      clear: vi.fn(() => calls.push("clear")),
      append: vi.fn((value: string) => calls.push(value)),
    };
    replaceCompilationOutput(output, {
      runId: 1,
      timestamp,
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
        warningCount: 1,
        missingModels: [],
        models: [],
        diagnostics: [],
        logs: [],
        transcript: [
          "inf: ilic test",
          "inf:",
          "wrn:    warning-code message",
          "inf:",
          "inf: ilic completed with no errors, 1 warning.",
        ],
      },
    });
    expect(calls[0]).toBe("clear");
    expect(calls[1]).toBe(
      [
        "inf: ilic test",
        "inf:",
        "wrn:    warning-code message",
        "inf:",
        `inf: ilic completed with no errors, 1 warning. ${localTimestamp(timestamp)}`,
        "",
      ].join("\n"),
    );
  });

  it("leaves the completion line unchanged for an invalid timestamp", () => {
    const calls: string[] = [];
    const output = {
      clear: vi.fn(() => calls.push("clear")),
      append: vi.fn((value: string) => calls.push(value)),
    };
    replaceCompilationOutput(output, {
      runId: 2,
      timestamp: "invalid-timestamp",
      trigger: "manual",
      rootUri: "file:///Root.ili",
      documentVersion: 3,
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
    expect(calls[1]).toBe("inf: ilic completed with no errors, no warnings.\n");
  });
});
