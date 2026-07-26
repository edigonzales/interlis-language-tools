import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CompilerBackend, EditorSnapshot } from "./index.js";
import { createWasmCompilerBackend } from "./index.js";
import { analyzeLiveDocument } from "./live-analysis.js";
import { liveAnalysisGoldenCatalog } from "./live-analysis-golden-catalog.test-data.js";

describe("Java-baseline conservative live diagnostic golden catalog", () => {
  let compiler: CompilerBackend;

  beforeAll(async () => {
    compiler = await createWasmCompilerBackend();
  });

  afterAll(() => compiler.dispose());

  for (const [index, golden] of liveAnalysisGoldenCatalog.entries())
    it(golden.name, () => {
      const uri = `memory:///live-golden-${index}.ili`;
      compiler.putSource(uri, golden.text, 1);
      const snapshot = compiler.editorSnapshot?.(uri) as EditorSnapshot;
      const result = analyzeLiveDocument(snapshot, golden.text, null);
      expect(result.diagnostics.map((value) => value.code).sort()).toEqual(
        [...golden.expectedCodes].sort(),
      );
    });
});
