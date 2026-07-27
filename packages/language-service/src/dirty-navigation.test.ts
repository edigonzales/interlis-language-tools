import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CompilerBackend,
  EditorAnalysisBackend,
  EditorSnapshot,
} from "./index.js";
import { createWasmCompilerBackend, LanguageService } from "./index.js";

const baseUri = "memory:///Base.ili";
const useUri = "memory:///Use.ili";

function positionOf(text: string, needle: string, occurrence = 0) {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1)
    offset = text.indexOf(needle, offset + 1);
  const before = text.slice(0, offset);
  return {
    line: before.split("\n").length - 1,
    character: before.length - (before.lastIndexOf("\n") + 1) + 1,
  };
}

describe("dirty navigation and safe rename", () => {
  let compiler: CompilerBackend;
  let editorCompiler: CompilerBackend;
  let service: LanguageService;

  beforeEach(async () => {
    [compiler, editorCompiler] = await Promise.all([
      createWasmCompilerBackend(),
      createWasmCompilerBackend(),
    ]);
    const editorAnalysis: EditorAnalysisBackend = {
      putSource: (uri, source, version) =>
        editorCompiler.putSource(uri, source, version),
      removeSource: (uri) => {
        editorCompiler.removeSource(uri);
      },
      analyze: (uri) =>
        Promise.resolve(editorCompiler.editorSnapshot?.(uri) as EditorSnapshot),
      restart: () => editorCompiler.restart?.(),
      dispose: () => editorCompiler.dispose(),
    };
    service = new LanguageService(compiler, {
      editorAnalysis,
      liveDiagnosticsDelayMs: 0,
    });
  });

  afterEach(() => service.dispose());

  it("renames a model declaration, END name, import, and qualified prefix together", async () => {
    const baseText = `INTERLIS 2.4;
MODEL Base =
  TOPIC Data =
    CLASS Root =
    END Root;
  END Data;
END Base.
`;
    const useText = `INTERLIS 2.4;
MODEL Use =
  IMPORTS Base;
  CLASS Child EXTENDS Base.Data.Root =
  END Child;
END Use.
`;
    service.openDocument(baseUri, baseText, 1);
    service.openDocument(useUri, useText, 1);
    service.changeDocument(baseUri, `${baseText}!! dirty\n`, 2);
    service.changeDocument(useUri, `${useText}!! dirty\n`, 2);
    await vi.waitFor(() =>
      expect(service.getEditorSnapshot(baseUri)?.value?.documentVersion).toBe(
        2,
      ),
    );
    await vi.waitFor(() =>
      expect(service.getEditorSnapshot(useUri)?.value?.documentVersion).toBe(2),
    );

    const prefix = positionOf(useText, "Base.Data.Root");
    expect(service.definition(useUri, prefix)).toEqual([
      expect.objectContaining({ uri: baseUri }),
    ]);
    expect(service.prepareRename(useUri, prefix)?.placeholder).toBe("Base");

    const rename = service.rename(useUri, prefix, "RenamedBase");
    const useLines = useText.split(/\r?\n/u);
    expect(rename?.changes[baseUri]).toHaveLength(2);
    expect(rename?.changes[useUri]).toHaveLength(2);
    expect(
      rename?.changes[useUri]?.map((edit) =>
        useLines[edit.range.start.line]?.slice(
          edit.range.start.character,
          edit.range.end.character,
        ),
      ),
    ).toEqual(["Base", "Base"]);
  });

  it("refuses collisions and pending snapshots without returning partial edits", async () => {
    const text = `INTERLIS 2.4;
MODEL Local =
  CLASS Parent =
  END Parent;
  CLASS Child EXTENDS Parent =
  END Child;
END Local.
`;
    service.openDocument(baseUri, text, 1);
    service.changeDocument(baseUri, `${text}!! dirty\n`, 2);
    await vi.waitFor(() =>
      expect(service.getEditorSnapshot(baseUri)?.value?.documentVersion).toBe(
        2,
      ),
    );
    const parent = positionOf(text, "Parent");
    expect(service.renameRejectionReason(baseUri, parent, "Child")).toContain(
      "already exists",
    );
    expect(service.rename(baseUri, parent, "Child")).toBeNull();

    service.changeDocument(baseUri, `${text}!! newer\n`, 3);
    expect(service.renameRejectionReason(baseUri, parent, "Renamed")).toContain(
      "still running",
    );
    expect(service.rename(baseUri, parent, "Renamed")).toBeNull();
  });

  it("keeps typical dirty completion below the interactive budget", async () => {
    const attributes = Array.from(
      { length: 350 },
      (_, index) => `      attribute${index}: TEXT*20;`,
    ).join("\n");
    const text = `INTERLIS 2.4;
MODEL Performance =
  TOPIC Data =
    CLASS Existing =
${attributes}
    END Existing;
    CLA
  END Data;
END Performance.
`;
    service.openDocument(baseUri, text, 1);
    service.changeDocument(baseUri, `${text}!! dirty\n`, 2);
    const lines = text.split("\n");
    const line = lines.findIndex((value) => value.trim() === "CLA");
    const position = { line, character: lines[line]!.length };
    const coldStarted = performance.now();
    const items = await service.completion(baseUri, position);
    const coldElapsed = performance.now() - coldStarted;

    expect(
      items.some((item) => item.label === "CLASS Name = ... END Name;"),
    ).toBe(true);
    expect(
      coldElapsed,
      `cold completion took ${coldElapsed.toFixed(2)} ms`,
    ).toBeLessThan(150);

    const warmElapsed: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      const warmItems = await service.completion(baseUri, position);
      warmElapsed.push(performance.now() - started);
      expect(
        warmItems.some((item) => item.label === "CLASS Name = ... END Name;"),
      ).toBe(true);
    }

    const sortedWarmElapsed = [...warmElapsed].sort(
      (left, right) => left - right,
    );
    const warmMedian =
      sortedWarmElapsed[Math.floor(sortedWarmElapsed.length / 2)]!;
    const warmMaximum = Math.max(...warmElapsed);
    const samples = warmElapsed.map((elapsed) => elapsed.toFixed(2)).join(", ");
    expect(warmMedian, `warm completion samples: [${samples}] ms`).toBeLessThan(
      100,
    );
    expect(
      warmMaximum,
      `warm completion samples: [${samples}] ms`,
    ).toBeLessThan(150);
  });
});
