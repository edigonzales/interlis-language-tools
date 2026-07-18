import { describe, expect, it, vi } from "vitest";
import type {
  CompilerBackend,
  SemanticSnapshot,
  SyntaxSnapshot,
} from "./index.js";
import { LanguageService, MemoryWorkspaceFileSystem } from "./index.js";

function backend(overrides: Partial<CompilerBackend> = {}): CompilerBackend {
  let version = 0;
  const syntax = (uri: string): SyntaxSnapshot => ({
    schemaVersion: 1,
    abiVersion: 1,
    compilerVersion: "test",
    kind: "syntax",
    success: true,
    uri,
    documentVersion: version,
    iliVersion: "2.4",
    tokens: [],
    nodes: [],
    contexts: [],
    imports: [],
    diagnostics: [],
  });
  const semantic = (roots: string[]): SemanticSnapshot => ({
    schemaVersion: 1,
    abiVersion: 1,
    compilerVersion: "test",
    kind: "semantic",
    success: true,
    cancelled: false,
    roots,
    documentVersions: Object.fromEntries(roots.map((root) => [root, version])),
    symbols: [],
    references: [],
    dependencies: [],
    diagram: { nodes: [], edges: [] },
    documentation: { title: "", sections: [] },
    diagnostics: [],
    logs: [],
  });
  return {
    putSource: (_uri, _source, next) => {
      version = next;
    },
    removeSource: () => true,
    parse: syntax,
    analyze: (request) => semantic(request.roots),
    compile: () => {
      throw new Error("not needed");
    },
    format: () => {
      throw new Error("not needed");
    },
    dispose: vi.fn(),
    ...overrides,
  };
}

describe("LanguageService", () => {
  it("treats unsaved content as authoritative and parses every version", async () => {
    const compiler = backend();
    const service = new LanguageService(compiler, {
      semanticDebounceMs: 10_000,
    });
    const first = service.openDocument(
      "memory:///Model.ili",
      "MODEL Model = END Model.",
      1,
    );
    const second = service.changeDocument(
      "memory:///Model.ili",
      "MODEL Model = TOPIC T = END T; END Model.",
      2,
    );
    expect(first.value?.documentVersion).toBe(1);
    expect(second.value?.documentVersion).toBe(2);
    expect(service.getDocument("memory:///Model.ili")?.dirty).toBe(true);
    const analyzed = await service.analyzeNow();
    expect(analyzed.freshness).toBe("fresh");
    expect(analyzed.documentVersions["memory:///Model.ili"]).toBe(2);
    service.dispose();
  });

  it("rejects late semantic results using generation and version gates", async () => {
    let release: ((value: SemanticSnapshot) => void) | undefined;
    const delayed = new Promise<SemanticSnapshot>((resolve) => {
      release = resolve;
    });
    const compiler = backend({
      analyze: () => delayed as unknown as SemanticSnapshot,
    });
    const service = new LanguageService(compiler, {
      semanticDebounceMs: 10_000,
    });
    service.openDocument("memory:///Model.ili", "first", 1);
    const analysis = service.analyzeNow();
    service.changeDocument("memory:///Model.ili", "second", 2);
    release?.(backend().analyze({ roots: ["memory:///Model.ili"] }));
    expect((await analysis).freshness).toBe("cancelled");
    service.dispose();
  });

  it("returns the last good snapshot as visibly stale after an edit", async () => {
    const service = new LanguageService(backend(), {
      semanticDebounceMs: 10_000,
    });
    service.openDocument("memory:///Model.ili", "first", 1);
    await service.analyzeNow();
    service.changeDocument("memory:///Model.ili", "second", 2);
    expect(service.getSemanticSnapshot()?.freshness).toBe("stale");
    service.dispose();
  });

  it("rejects non-increasing versions and tracks save and close lifecycle", () => {
    const compiler = backend();
    const service = new LanguageService(compiler, {
      semanticDebounceMs: 10_000,
    });
    service.openDocument("memory:///Model.ili", "first", 1);
    expect(() =>
      service.changeDocument("memory:///Model.ili", "duplicate", 1),
    ).toThrow("must increase");
    service.changeDocument("memory:///Model.ili", "second", 2);
    service.markSaved("memory:///Model.ili");
    expect(service.getDocument("memory:///Model.ili")?.dirty).toBe(false);
    service.closeDocument("memory:///Model.ili");
    expect(service.getSyntaxSnapshot("memory:///Model.ili")).toBeNull();
    service.dispose();
    service.dispose();
    expect(() => service.openDocument("memory:///Other.ili", "", 1)).toThrow(
      "disposed",
    );
  });

  it("restarts the compiler when hard cancellation is requested", async () => {
    const restart = vi.fn();
    const service = new LanguageService(backend({ restart }), {
      semanticDebounceMs: 10_000,
    });
    service.openDocument("memory:///Model.ili", "first", 1);
    await service.cancelAnalysis();
    expect(restart).toHaveBeenCalledOnce();
    expect(service.lastSemanticSnapshot?.freshness).toBe("cancelled");
    service.dispose();
  });

  it("uses the cache and reports analysis events", async () => {
    const compiler = backend();
    const analyze = vi.spyOn(compiler, "analyze");
    const onAnalysis = vi.fn();
    const service = new LanguageService(compiler, {
      semanticDebounceMs: 10_000,
      onAnalysis,
    });
    service.openDocument("memory:///Model.ili", "first", 1);
    await service.analyzeNow();
    await service.analyzeNow();
    expect(analyze).toHaveBeenCalledOnce();
    expect(onAnalysis).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  it("invalidates only a changed reverse-dependency component", async () => {
    const compiler = backend({
      analyze: (request) => ({
        ...backend().analyze(request),
        dependencies: [
          {
            sourceUri: "memory:///A.ili",
            targetUri: "memory:///B.ili",
            model: "B",
          },
        ],
      }),
    });
    const service = new LanguageService(compiler, {
      semanticDebounceMs: 10_000,
    });
    service.openDocument("memory:///A.ili", "A", 1);
    service.openDocument("memory:///B.ili", "B", 1);
    service.openDocument("memory:///C.ili", "C", 1);
    await service.analyzeNow();
    service.changeDocument("memory:///B.ili", "B2", 2);
    const result = await service.analyzeNow("memory:///B.ili");
    expect(result.value?.roots).toEqual(["memory:///A.ili", "memory:///B.ili"]);
    service.dispose();
  });

  it("does not replace a last-good snapshot after failed analysis", async () => {
    let succeeds = true;
    const compiler = backend({
      analyze: (request) => ({
        ...backend().analyze(request),
        success: succeeds,
      }),
    });
    const service = new LanguageService(compiler, {
      semanticDebounceMs: 10_000,
    });
    service.openDocument("memory:///Model.ili", "first", 1);
    await service.analyzeNow();
    succeeds = false;
    service.changeDocument("memory:///Model.ili", "broken", 2);
    await service.analyzeNow();
    expect(service.getSemanticSnapshot()?.value?.success).toBe(false);
    service.changeDocument("memory:///Model.ili", "still broken", 3);
    expect(service.getSemanticSnapshot()?.value?.success).toBe(true);
    expect(service.getSemanticSnapshot(false)?.freshness).toBe("stale");
    service.dispose();
  });
});

describe("MemoryWorkspaceFileSystem", () => {
  it("provides binary storage, rename and watch semantics", async () => {
    const workspace = new MemoryWorkspaceFileSystem();
    const changes: string[] = [];
    workspace.watch("memory:/project", (events) =>
      changes.push(...events.map((event) => event.type)),
    );
    await workspace.write(
      "memory:/project/Model.ili",
      new TextEncoder().encode("MODEL Model"),
    );
    expect(
      new TextDecoder().decode(
        await workspace.read("memory:/project/Model.ili"),
      ),
    ).toBe("MODEL Model");
    await workspace.rename(
      "memory:/project/Model.ili",
      "memory:/project/Renamed.ili",
    );
    expect((await workspace.readDirectory("memory:/project"))[0]).toEqual([
      "Renamed.ili",
      "file",
    ]);
    expect(changes).toEqual(["created", "deleted", "created"]);
  });
});
