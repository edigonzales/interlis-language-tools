import { afterEach, describe, expect, it } from "vitest";
import type { CompilerBackend } from "./index.js";
import { createWasmCompilerBackend } from "./index.js";

const uri = "memory:///WasmLanguageService.ili";
const source = `INTERLIS 2.4;
MODEL WasmLanguageService AT "https://example.invalid/ilic" VERSION "1" =
  TOPIC Catalog =
    CLASS Item =
      Name : TEXT*40;
    END Item;
  END Catalog;
END WasmLanguageService.
`;

describe("createWasmCompilerBackend", () => {
  let compiler: CompilerBackend | undefined;
  afterEach(() => compiler?.dispose());

  it("runs syntax, semantic, compile and format operations through the real WASM ABI", async () => {
    compiler = await createWasmCompilerBackend();
    compiler.putSource(uri, source, 3);
    expect(compiler.parse(uri).documentVersion).toBe(3);
    expect(
      compiler
        .analyze({ roots: [uri] })
        .symbols.some((symbol) => symbol.name === "Item"),
    ).toBe(true);
    expect(compiler.compile({ roots: [uri] }).success).toBe(true);
    const combined = compiler.compileAndAnalyze({ roots: [uri] });
    expect(combined.compilation.success).toBe(true);
    expect(combined.semantic.roots).toEqual([uri]);
    expect(combined.syntax.map((snapshot) => snapshot.uri)).toContain(uri);
    expect(compiler.format(uri).success).toBe(true);

    await compiler.restart?.();
    expect(compiler.parse(uri).documentVersion).toBe(3);
    expect(compiler.removeSource(uri)).toBe(true);
  });

  it("keeps INTERLIS 2.3 and 2.4 on the same snapshot contract", async () => {
    compiler = await createWasmCompilerBackend();
    for (const version of ["2.3", "2.4"] as const) {
      const modelUri = `memory:///Version${version.replace(".", "")}.ili`;
      const model = `INTERLIS ${version};\nMODEL Version${version.replace(".", "")} AT "https://example.invalid/ilic" VERSION "1" =\nEND Version${version.replace(".", "")}.\n`;
      compiler.putSource(modelUri, model, 1);
      expect(compiler.parse(modelUri).iliVersion).toBe(version);
      expect(compiler.analyze({ roots: [modelUri] }).success).toBe(true);
    }
  });
});
