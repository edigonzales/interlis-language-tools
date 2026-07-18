import { describe, expect, it } from "vitest";
import type { SyntaxSnapshot } from "@ilic/compiler-wasm";
import {
  DEFAULT_TEMPLATE_URL,
  OFFLINE_TEMPLATE,
  OutputBuffer,
  fetchTemplate,
  isBlankInterlisDocument,
  resolveTemplateUrl,
  snippetKeyAction,
  suggestionActivation,
} from "./interactions.js";

const uri = "memory:///Model.ili";
function snapshot(
  kinds: readonly [kind: string, text: string][],
  context?: string,
): SyntaxSnapshot {
  return {
    schemaVersion: 1,
    abiVersion: 1,
    compilerVersion: "test",
    kind: "syntax",
    success: true,
    uri,
    documentVersion: 1,
    iliVersion: "2.4",
    tokens: kinds.map(([kind, text], index) => ({
      kind,
      text,
      channel: 0,
      range: {
        uri,
        start: { line: 0, character: index * 2, byteOffset: index * 2 },
        end: { line: 0, character: index * 2 + 1, byteOffset: index * 2 + 1 },
      },
    })),
    nodes: [],
    contexts: context
      ? [
          {
            kind: context,
            range: {
              uri,
              start: { line: 0, character: 0, byteOffset: 0 },
              end: { line: 0, character: 100, byteOffset: 100 },
            },
          },
        ]
      : [],
    imports: [],
    diagnostics: [],
  };
}

describe("suggestionActivation", () => {
  const atEnd = { line: 0, character: 99 };

  it("activates declaration bodies, modifiers, extends and type expressions", () => {
    expect(
      suggestionActivation(
        snapshot([
          ["MODEL", "MODEL"],
          ["NAME", "M"],
          ["EQUAL", "="],
        ]),
        atEnd,
      ),
    ).toMatchObject({
      open: true,
      reason: "container-body",
    });
    expect(
      suggestionActivation(
        snapshot([
          ["CLASS", "CLASS"],
          ["NAME", "C"],
          ["EXTENDS", "EXTENDS"],
        ]),
        atEnd,
      ).reason,
    ).toBe("extends");
    expect(
      suggestionActivation(
        snapshot([
          ["CLASS", "CLASS"],
          ["NAME", "C"],
          ["ABSTRACT", "ABSTRACT"],
        ]),
        atEnd,
      ).reason,
    ).toBe("header");
    expect(
      suggestionActivation(snapshot([["TEXT", "TEXT"]]), atEnd).reason,
    ).toBe("type-expression");
    expect(
      suggestionActivation(snapshot([["NAME", "value"]], "unitDef"), atEnd)
        .reason,
    ).toBe("type-expression");
  });

  it("suppresses MODEL header suggestions and handles metaattributes", () => {
    expect(
      suggestionActivation(
        snapshot([
          ["MODEL", "MODEL"],
          ["NAME", "M"],
        ]),
        atEnd,
      ),
    ).toEqual({
      open: false,
      reason: "header",
      suppress: true,
    });
    expect(
      suggestionActivation(
        snapshot([
          ["CLASS", "CLASS"],
          ["NAME", "C"],
        ]),
        atEnd,
      ).open,
    ).toBe(true);
    expect(
      suggestionActivation(
        snapshot([["COMMENT", "!!@ili2c.translationOf"]]),
        atEnd,
      ).reason,
    ).toBe("metaattribute");
    expect(suggestionActivation(snapshot([]), atEnd).reason).toBe("none");
    expect(suggestionActivation(snapshot([["SEMI", ";"]]), atEnd).open).toBe(
      false,
    );
  });
});

describe("snippet navigation and guards", () => {
  it("models Enter, Tab and cursor movement without editor-specific commands", () => {
    expect(snippetKeyAction(false, "none", "Tab")).toBe("default");
    expect(snippetKeyAction(true, "model-header", "Enter")).toBe(
      "next-placeholder",
    );
    expect(snippetKeyAction(true, "model-header", "ArrowLeft")).toBe(
      "suppress-suggestions",
    );
    expect(snippetKeyAction(true, "block-header", "ArrowRight")).toBe(
      "leave-and-move",
    );
    expect(snippetKeyAction(true, "body", "Tab")).toBe("next-placeholder");
    expect(snippetKeyAction(true, "body", "Home")).toBe("default");
  });

  it("recognizes blank documents while preserving missing-document distinction", () => {
    expect(isBlankInterlisDocument(" \n\t")).toBe(true);
    expect(isBlankInterlisDocument("MODEL M")).toBe(false);
    expect(isBlankInterlisDocument(undefined)).toBe(false);
    expect(OFFLINE_TEMPLATE).toContain("END NewModel.");
  });
});

describe("template loading", () => {
  it("uses the legacy URL and validates configured protocols", () => {
    expect(resolveTemplateUrl()).toBe(DEFAULT_TEMPLATE_URL);
    expect(resolveTemplateUrl("  https://example.com/Model.ili  ")).toBe(
      "https://example.com/Model.ili",
    );
    expect(() => resolveTemplateUrl("relative.ili")).toThrow("absolute");
    expect(() => resolveTemplateUrl("file:///tmp/Model.ili")).toThrow("http");
  });

  it("loads content and reports HTTP and empty-body failures", async () => {
    await expect(
      fetchTemplate("https://example.com/model.ili", {
        fetch: () => Promise.resolve(new Response("MODEL M")),
      }),
    ).resolves.toBe("MODEL M");
    await expect(
      fetchTemplate("https://example.com/missing.ili", {
        fetch: () =>
          Promise.resolve(
            new Response("missing", { status: 404, statusText: "Not Found" }),
          ),
      }),
    ).rejects.toThrow("HTTP 404 Not Found");
    await expect(
      fetchTemplate("https://example.com/empty.ili", {
        fetch: () => Promise.resolve(new Response(" \n")),
      }),
    ).rejects.toThrow("empty response");
  });

  it("turns an internal abort into a readable timeout", async () => {
    const hangingFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    await expect(
      fetchTemplate("https://example.com/slow.ili", {
        fetch: hangingFetch,
        timeoutMs: 1,
      }),
    ).rejects.toThrow("timed out after 1 ms");
  });
});

describe("OutputBuffer", () => {
  it("keeps timestamped compiler and debug channels separate", () => {
    const output = new OutputBuffer(() => new Date("2026-07-18T12:00:00Z"));
    expect(output.append("compiler", "information", "compiled")).toEqual({
      timestamp: "2026-07-18T12:00:00.000Z",
      channel: "compiler",
      level: "information",
      message: "compiled",
    });
    output.append("debug", "trace", "details");
    expect(output.entries).toHaveLength(2);
    output.clear();
    expect(output.entries).toEqual([]);
  });
});
