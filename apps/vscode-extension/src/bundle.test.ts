import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const dist = resolve(import.meta.dirname, "../dist");

const readBundle = (name: string): Promise<string> =>
  readFile(resolve(dist, name), "utf8");

const lspMessage = (message: unknown): string => {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
};

interface LspResponse {
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
}

interface LspDocumentSymbol {
  readonly name: string;
  readonly detail?: string;
  readonly kind?: number;
  readonly range: LspRange;
  readonly selectionRange: LspRange;
  readonly children?: readonly LspDocumentSymbol[];
}

interface LspRange {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
}

const lspResponses = (output: string): LspResponse[] => {
  const bytes = Buffer.from(output);
  const separator = Buffer.from("\r\n\r\n");
  const responses: LspResponse[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const headerEnd = bytes.indexOf(separator, offset);
    if (headerEnd < 0) break;
    const header = bytes.subarray(offset, headerEnd).toString();
    const length = /Content-Length: (\d+)/iu.exec(header)?.[1];
    if (!length) break;
    const bodyStart = headerEnd + separator.length;
    const bodyEnd = bodyStart + Number(length);
    if (bodyEnd > bytes.length) break;
    responses.push(
      JSON.parse(bytes.subarray(bodyStart, bodyEnd).toString()) as LspResponse,
    );
    offset = bodyEnd;
  }
  return responses;
};

const comparePositions = (
  left: LspRange["start"],
  right: LspRange["start"],
): number => left.line - right.line || left.character - right.character;

const containsRange = (outer: LspRange, inner: LspRange): boolean =>
  comparePositions(outer.start, inner.start) <= 0 &&
  comparePositions(outer.end, inner.end) >= 0;

const expectValidSymbolRanges = (
  symbol: LspDocumentSymbol,
  parent?: LspRange,
): void => {
  expect(containsRange(symbol.range, symbol.selectionRange)).toBe(true);
  if (parent) expect(containsRange(parent, symbol.range)).toBe(true);
  for (const child of symbol.children ?? [])
    expectValidSymbolRanges(child, symbol.range);
};

const flattenSymbols = (
  symbols: readonly LspDocumentSymbol[],
): LspDocumentSymbol[] =>
  symbols.flatMap((symbol) => [
    symbol,
    ...flattenSymbols(symbol.children ?? []),
  ]);

describe("VS Code extension bundles", () => {
  it("provides CommonJS globals only to the Node bundles", async () => {
    const [extensionNode, serverNode, extensionBrowser, serverBrowser] =
      await Promise.all([
        readBundle("extension-node.js"),
        readBundle("server-node.js"),
        readBundle("extension-browser.js"),
        readBundle("server-browser.js"),
      ]);

    for (const bundle of [extensionNode, serverNode]) {
      expect(bundle).toContain(
        'import { createRequire as __ilicCreateRequire } from "node:module";',
      );
      expect(bundle).toContain(
        "const require = __ilicCreateRequire(import.meta.url);",
      );
      expect(bundle).toContain(
        "const __filename = __ilicFileURLToPath(import.meta.url);",
      );
      expect(bundle).toContain("const __dirname = __ilicDirname(__filename);");
    }

    for (const bundle of [extensionBrowser, serverBrowser]) {
      expect(bundle).not.toContain("__ilicCreateRequire");
      expect(bundle).not.toContain('"child_process"');
    }
  });

  it("packages the executable language-client termination helper", async () => {
    const helper = await stat(resolve(dist, "terminateProcess.sh"));
    expect(helper.isFile()).toBe(true);
    expect(helper.mode & 0o111).not.toBe(0);
  });

  it("serves valid document symbols from the real WASM compiler", async () => {
    const child = spawn(
      process.execPath,
      [resolve(dist, "server-node.js"), "--stdio"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const waitForResponse = async (id: number): Promise<LspResponse> => {
      let response: LspResponse | undefined;
      await vi.waitFor(
        () => {
          response = lspResponses(stdout).find((message) => message.id === id);
          expect(response).toBeDefined();
        },
        { timeout: 10_000, interval: 10 },
      );
      return response!;
    };

    try {
      child.stdin.write(
        lspMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            processId: null,
            rootUri: null,
            capabilities: {},
            initializationOptions: { modelRepositories: [] },
          },
        }),
      );
      const initialized = await waitForResponse(1);
      expect(initialized.error).toBeUndefined();
      expect(initialized.result).toMatchObject({
        serverInfo: { name: "@ilic/language-server" },
      });

      const uri = "memory:///LocalCatalog.ili";
      const text = await readFile(
        resolve(
          import.meta.dirname,
          "../../../examples/dev-workspace/LocalCatalog.ili",
        ),
        "utf8",
      );
      child.stdin.write(
        lspMessage({ jsonrpc: "2.0", method: "initialized", params: {} }),
      );
      child.stdin.write(
        lspMessage({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri,
              languageId: "interlis",
              version: 1,
              text,
            },
          },
        }),
      );
      child.stdin.write(
        lspMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "interlis/compile",
          params: { uri },
        }),
      );
      expect((await waitForResponse(2)).error).toBeUndefined();
      child.stdin.write(
        lspMessage({
          jsonrpc: "2.0",
          id: 3,
          method: "textDocument/documentSymbol",
          params: { textDocument: { uri } },
        }),
      );
      const symbols = (await waitForResponse(3)).result as
        LspDocumentSymbol[] | undefined;
      expect(symbols?.[0]?.name).toBe("LocalCatalog");
      expect(symbols?.[0]?.detail).toBe("MODEL");
      expect(symbols?.[0]?.kind).toBe(2);
      expect(
        flattenSymbols(symbols ?? []).some(
          (symbol) => symbol.name === "BASKET",
        ),
      ).toBe(false);
      for (const symbol of symbols ?? []) expectValidSymbolRanges(symbol);
      expect(stderr).not.toContain("Dynamic require");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await new Promise<void>((resolveExit) => {
          child.once("exit", () => resolveExit());
        });
      }
    }
  }, 15_000);
});
