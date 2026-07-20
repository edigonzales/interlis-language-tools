import { describe, expect, it, vi } from "vitest";
import type {
  CompilerBackend,
  ModelRepository,
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
    missingModels: [],
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
  it("returns safe empty feature results before a document is available", async () => {
    const service = new LanguageService(backend(), {
      semanticDebounceMs: 10_000,
    });
    const position = { line: 0, character: 0 };
    await expect(
      service.completion("memory:///Missing.ili", position),
    ).resolves.toEqual([]);
    expect(service.definition("memory:///Missing.ili", position)).toEqual([]);
    expect(service.references("memory:///Missing.ili", position)).toEqual([]);
    expect(service.prepareRename("memory:///Missing.ili", position)).toBeNull();
    expect(
      service.rename("memory:///Missing.ili", position, "Name"),
    ).toBeNull();
    expect(service.symbols("memory:///Missing.ili")).toEqual([]);
    expect(service.hover("memory:///Missing.ili", position)).toBeNull();
    expect(service.formatting("memory:///Missing.ili")).toEqual([]);
    expect(
      service.onTypeEdit("memory:///Missing.ili", position, "\n"),
    ).toBeNull();
    service.dispose();
  });

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

  it("serializes concurrent analysis requests for the WASM session", async () => {
    let active = 0;
    let maximum = 0;
    const base = backend();
    const analyze = vi.fn(async (request: { roots: string[] }) => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return base.analyze(request);
    });
    const service = new LanguageService(
      backend({
        analyze: analyze as unknown as CompilerBackend["analyze"],
      }),
      { semanticDebounceMs: 10_000 },
    );
    service.openDocument("memory:///Model.ili", "first", 1);
    await Promise.all([service.analyzeNow(), service.analyzeNow()]);
    expect(maximum).toBe(1);
    expect(analyze).toHaveBeenCalledOnce();
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
    expect(service.getSyntaxSnapshot("memory:///Model.ili")?.value?.uri).toBe(
      "memory:///Model.ili",
    );
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

  it("synchronizes complete workspace source sets and restores source layers", async () => {
    const putSource = vi.fn();
    const removeSource = vi.fn(() => true);
    const service = new LanguageService(backend({ putSource, removeSource }), {
      semanticDebounceMs: 10_000,
    });
    const listener = vi.fn();
    const subscription = service.onAnalysis(listener);

    expect(service.generation).toBe(0);
    expect(service.documents).toEqual([]);
    service.markSaved("memory:///missing.ili");
    service.replaceWorkspaceSources([
      { uri: "memory:///A.ili", text: "A", version: 3 },
      { uri: "memory:///B.ili", text: "B" },
    ]);
    expect((await service.analyzeNow()).value?.roots).toEqual([
      "memory:///A.ili",
      "memory:///B.ili",
    ]);

    service.openDocument("memory:///B.ili", "overlay", 4);
    service.markSaved("memory:///B.ili");
    service.closeDocument("memory:///B.ili");
    expect(service.getSyntaxSnapshot("memory:///B.ili")).not.toBeNull();
    service.replaceWorkspaceSources([
      { uri: "memory:///B.ili", text: "replacement", version: 5 },
    ]);
    service.removeWorkspaceSource("memory:///missing.ili");
    service.removeWorkspaceSource("memory:///B.ili");
    expect(service.getSyntaxSnapshot("memory:///B.ili")).toBeNull();
    expect(removeSource).toHaveBeenCalledWith("memory:///A.ili");
    expect(removeSource).toHaveBeenCalledWith("memory:///B.ili");
    expect(putSource).toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
    subscription.dispose();
    service.dispose();
  });

  it("runs scheduled analysis and reports asynchronous failures", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const service = new LanguageService(
      backend({
        analyze: () => {
          throw new Error("analysis failed");
        },
      }),
      { semanticDebounceMs: 5, onError },
    );
    service.openDocument("memory:///Model.ili", "MODEL Model", 1);
    await vi.advanceTimersByTimeAsync(5);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "analysis failed",
      }),
    );
    service.dispose();
    vi.useRealTimers();
  });

  it("deduplicates in-flight catalogs and disposes replaced repositories", async () => {
    const dispose = vi.fn();
    const listModels = vi.fn(() =>
      Promise.resolve([
        {
          name: "Catalog",
          schemaLanguage: "ili2_3" as const,
          version: "",
          repository: "memory:///models",
        },
      ]),
    );
    const repository: ModelRepository = {
      listModels,
      resolveModels: () => Promise.resolve([]),
      dispose,
    };
    const service = new LanguageService(backend(), {
      modelRepository: repository,
      semanticDebounceMs: 10_000,
    });
    const [first, second] = await Promise.all([
      service.refreshModelCatalog(),
      service.refreshModelCatalog(),
    ]);
    expect(first).toEqual(second);
    expect(listModels).toHaveBeenCalledOnce();
    await service.setModelRepository({
      listModels: () => Promise.resolve([]),
      resolveModels: () => Promise.resolve([]),
    });
    expect(dispose).toHaveBeenCalledOnce();
    await service.setModelRepository(undefined);
    await expect(service.refreshModelCatalog()).resolves.toEqual([]);
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

  it("exposes protocol-neutral editor features and a versioned compile cache", async () => {
    const uri = "memory:///Model.ili";
    const sourceRange = {
      uri,
      start: { line: 0, character: 6, byteOffset: 6 },
      end: { line: 0, character: 11, byteOffset: 11 },
    };
    const base = backend();
    const compile = vi.fn(() => ({
      schemaVersion: 1 as const,
      abiVersion: 1 as const,
      compilerVersion: "test",
      kind: "compilation" as const,
      success: true,
      cancelled: false,
      errorCount: 0,
      warningCount: 0,
      missingModels: [],
      models: [],
      diagnostics: [],
      logs: [],
    }));
    const compiler = backend({
      parse: () => ({
        ...base.parse(uri),
        tokens: [
          {
            kind: "MODEL",
            text: "MODEL",
            channel: 0,
            range: {
              ...sourceRange,
              start: { ...sourceRange.start, character: 0 },
            },
          },
          { kind: "NAME", text: "Model", channel: 0, range: sourceRange },
          {
            kind: "EQUAL",
            text: "=",
            channel: 0,
            range: {
              ...sourceRange,
              start: { ...sourceRange.start, character: 12 },
              end: { ...sourceRange.end, character: 13 },
            },
          },
        ],
        contexts: [{ kind: "modelDef", range: sourceRange }],
      }),
      analyze: (request) => ({
        ...base.analyze(request),
        symbols: [
          {
            id: "model",
            name: "Model",
            qualifiedName: "Model",
            kind: "Model",
            containerId: "",
            range: sourceRange,
            abstract: false,
          },
        ],
        references: [
          {
            sourceId: "model",
            targetId: "model",
            kind: "name",
            range: {
              ...sourceRange,
              start: { ...sourceRange.start, line: 1 },
              end: { ...sourceRange.end, line: 1 },
            },
          },
        ],
      }),
      compile,
      format: () => ({
        schemaVersion: 1,
        abiVersion: 1,
        compilerVersion: "test",
        kind: "formatting",
        success: true,
        applicable: true,
        changed: true,
        text: "formatted",
        diagnostics: [],
      }),
    });
    const service = new LanguageService(compiler, {
      semanticDebounceMs: 10_000,
    });
    service.openDocument(uri, "MODEL Model =", 1);
    expect(service.diagnostics("memory:///missing")).toEqual([]);
    await service.analyzeNow();
    expect(
      (await service.completion(uri, { line: 0, character: 7 })).map(
        (item) => item.label,
      ),
    ).toContain("Model");
    expect(service.definition(uri, { line: 1, character: 7 })).toHaveLength(1);
    expect(
      service.references(uri, { line: 0, character: 7 }, false),
    ).toHaveLength(1);
    expect(
      service.prepareRename(uri, { line: 0, character: 7 })?.placeholder,
    ).toBe("Model");
    expect(
      service.rename(uri, { line: 0, character: 7 }, "Renamed")?.changes[uri],
    ).toHaveLength(2);
    expect(
      service.rename(uri, { line: 0, character: 7 }, "not valid"),
    ).toBeNull();
    expect(service.symbols(uri)[0]?.name).toBe("Model");
    expect(service.hover(uri, { line: 0, character: 7 })?.markdown).toContain(
      "Model",
    );
    expect(service.formatting(uri)[0]?.newText).toBe("formatted");
    expect(
      service.onTypeEdit(uri, { line: 0, character: 14 }, "\n")?.edits,
    ).toHaveLength(1);
    expect(service.onTypeEdit(uri, { line: 0, character: 14 }, ";")).toBeNull();
    expect((await service.compile()).success).toBe(true);
    expect((await service.compile()).success).toBe(true);
    expect(compile).toHaveBeenCalledOnce();
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

describe("repository-aware language service", () => {
  const rootUri = "memory:///Root.ili";
  const remoteUri = "interlis-repository:/ili2_4/Remote/origin.ili";
  const dependencyUri = "interlis-repository:/ili2_4/Dependency/origin.ili";
  const importRange = {
    uri: rootUri,
    start: { line: 2, character: 10, byteOffset: 70 },
    end: { line: 2, character: 16, byteOffset: 76 },
  };

  function repositoryBackend() {
    const sources = new Map<string, string | Uint8Array>();
    const parse = (uri: string): SyntaxSnapshot => {
      const root = uri === rootUri;
      const dependency = uri === dependencyUri;
      const model = root ? "Root" : dependency ? "Dependency" : "Remote";
      const rootSource = sources.get(rootUri);
      const importsRemote =
        root &&
        (typeof rootSource === "string"
          ? rootSource
          : new TextDecoder().decode(rootSource)
        ).includes("Remote");
      return {
        schemaVersion: 1,
        abiVersion: 1,
        compilerVersion: "test",
        kind: "syntax",
        success: true,
        uri,
        documentVersion: 1,
        iliVersion: "2.4",
        tokens: root
          ? [
              {
                kind: "IMPORTS",
                text: "IMPORTS",
                channel: 0,
                range: {
                  ...importRange,
                  start: { ...importRange.start, character: 2 },
                  end: { ...importRange.end, character: 9 },
                },
              },
              ...(importsRemote
                ? [
                    {
                      kind: "NAME",
                      text: "Remote",
                      channel: 0,
                      range: importRange,
                    },
                  ]
                : []),
            ]
          : [
              {
                kind: "MODEL",
                text: "MODEL",
                channel: 0,
                range: {
                  uri,
                  start: { line: 1, character: 0, byteOffset: 15 },
                  end: { line: 1, character: 5, byteOffset: 20 },
                },
              },
              {
                kind: "NAME",
                text: model,
                channel: 0,
                range: {
                  uri,
                  start: { line: 1, character: 6, byteOffset: 21 },
                  end: {
                    line: 1,
                    character: 6 + model.length,
                    byteOffset: 21 + model.length,
                  },
                },
              },
            ],
        nodes: [],
        contexts: root
          ? [
              {
                kind: "importDef",
                range: {
                  ...importRange,
                  end: { ...importRange.end, character: 40 },
                },
              },
            ]
          : [],
        imports: importsRemote ? ["Remote"] : [],
        importReferences: importsRemote
          ? [{ model: "Remote", unqualified: false, range: importRange }]
          : [],
        diagnostics: [],
      };
    };
    const analyze = (request: { roots: string[] }): SemanticSnapshot => {
      const complete =
        sources.has(dependencyUri) &&
        [...sources.values()].some((source) =>
          (typeof source === "string"
            ? source
            : new TextDecoder().decode(source)
          ).includes("MODEL Remote"),
        );
      const declaration = {
        uri: remoteUri,
        start: { line: 1, character: 6, byteOffset: 21 },
        end: { line: 1, character: 12, byteOffset: 27 },
      };
      return {
        schemaVersion: 1,
        abiVersion: 1,
        compilerVersion: "test",
        kind: "semantic",
        success: complete,
        cancelled: false,
        roots: request.roots,
        documentVersions: {},
        missingModels: complete ? [] : ["Remote"],
        symbols: complete
          ? [
              {
                id: "model:Remote",
                name: "Remote",
                qualifiedName: "Remote",
                kind: "model",
                containerId: "",
                range: declaration,
                selectionRange: declaration,
                abstract: false,
              },
            ]
          : [],
        references: complete
          ? [
              {
                sourceId: "model:Root",
                targetId: "model:Remote",
                kind: "import",
                range: importRange,
              },
            ]
          : [],
        dependencies: [],
        diagram: { nodes: [], edges: [] },
        documentation: { title: "", sections: [] },
        diagnostics: [],
        logs: [],
      };
    };
    const compiler = backend({
      putSource: (uri, source) => void sources.set(uri, source),
      removeSource: (uri) => sources.delete(uri),
      parse,
      analyze,
    });
    return { compiler, sources };
  }

  function repository(): ModelRepository {
    return {
      listModels: vi.fn(() =>
        Promise.resolve([
          {
            name: "Remote",
            schemaLanguage: "ili2_4" as const,
            version: "2026-01",
            repository: "https://models.example",
            browseOnly: false,
          },
          {
            name: "BrowseOnly",
            schemaLanguage: "ili2_4" as const,
            version: "1",
            repository: "https://models.example",
            browseOnly: true,
          },
        ]),
      ),
      resolveModels: vi.fn(() =>
        Promise.resolve([
          {
            model: "Dependency",
            uri: dependencyUri,
            originUri: "https://models.example/Dependency.ili",
            source: "INTERLIS 2.4; MODEL Dependency = END Dependency.",
            schemaLanguage: "ili2_4" as const,
            version: "1",
            fromCache: true,
            readOnly: true as const,
          },
          {
            model: "Remote",
            uri: remoteUri,
            originUri: "https://models.example/Remote.ili",
            source: "INTERLIS 2.4; MODEL Remote = END Remote.",
            schemaLanguage: "ili2_4" as const,
            version: "2026-01",
            fromCache: true,
            readOnly: true as const,
          },
        ]),
      ),
    };
  }

  it("loads a transitive closure, navigates to it and rejects rename", async () => {
    const { compiler, sources } = repositoryBackend();
    const restart = vi.fn();
    compiler.restart = restart;
    const models = repository();
    const service = new LanguageService(compiler, {
      modelRepository: models,
      semanticDebounceMs: 10_000,
    });
    service.openDocument(rootUri, "INTERLIS 2.4; IMPORTS Remote;", 1);
    const result = await service.analyzeNow();
    expect(result.value?.missingModels).toEqual([]);
    expect(restart).toHaveBeenCalledOnce();
    expect(models.resolveModels).toHaveBeenCalledWith(["Remote"], "ili2_4");
    expect(sources.has(dependencyUri)).toBe(true);
    expect(service.getRepositoryDocument(remoteUri)?.fromCache).toBe(true);
    expect(service.prepareRepositoryDocument(remoteUri)?.value?.uri).toBe(
      remoteUri,
    );
    expect(service.prepareRepositoryDocument(remoteUri)?.value?.uri).toBe(
      remoteUri,
    );
    expect(
      service.prepareRepositoryDocument("memory:///missing.ili"),
    ).toBeNull();
    expect(
      service.definition(rootUri, { line: 2, character: 12 })[0]?.uri,
    ).toBe(remoteUri);
    expect(
      service.prepareRename(rootUri, { line: 2, character: 12 }),
    ).toBeNull();
    expect(
      service.rename(rootUri, { line: 2, character: 12 }, "Other"),
    ).toBeNull();
    expect(() => service.changeDocument(remoteUri, "changed", 2)).toThrow(
      "read-only",
    );
    service.openDocument(
      remoteUri,
      "INTERLIS 2.4; MODEL Remote = END Remote.",
      1,
    );
    await service.setModelRepository(undefined);
    expect(service.isReadOnlyUri(remoteUri)).toBe(true);
    service.closeDocument(remoteUri);
    expect(service.isReadOnlyUri(remoteUri)).toBe(false);
    service.dispose();
  });

  it("reports repository failures at the exact import range", async () => {
    const { compiler } = repositoryBackend();
    const onError = vi.fn();
    const service = new LanguageService(compiler, {
      modelRepository: {
        listModels: () => Promise.resolve([]),
        resolveModels: () => Promise.reject(new Error("repository offline")),
      },
      semanticDebounceMs: 10_000,
      onError,
    });
    service.openDocument(rootUri, "INTERLIS 2.4; IMPORTS Remote;", 1);
    const result = await service.analyzeNow();
    const diagnostic = result.value?.diagnostics.find(
      (entry) => entry.code === "repository-model-unavailable",
    );
    expect(diagnostic?.range).toEqual(importRange);
    expect(diagnostic?.message).toContain("repository offline");
    expect(onError).toHaveBeenCalledOnce();
    service.dispose();
  });

  it("resolves compiler-reported implicit dependencies through the fallback loop", async () => {
    const implicitUri = "interlis-repository:/ili2_3/Implicit/origin.ili";
    const sources = new Set<string>();
    const base = backend();
    const compiler = backend({
      putSource: (uri) => void sources.add(uri),
      parse: (uri) => ({ ...base.parse(uri), iliVersion: "2.3" }),
      analyze: (request) => ({
        ...base.analyze(request),
        success: sources.has(implicitUri),
        missingModels: sources.has(implicitUri) ? [] : ["Implicit"],
      }),
    });
    const resolveModels = vi.fn(() =>
      Promise.resolve([
        {
          model: "Implicit",
          uri: implicitUri,
          originUri: "https://models.example/Implicit.ili",
          source: "INTERLIS 2.3; MODEL Implicit = END Implicit.",
          schemaLanguage: "ili2_3" as const,
          version: "1",
          fromCache: false,
          readOnly: true as const,
        },
      ]),
    );
    const service = new LanguageService(compiler, {
      modelRepository: {
        listModels: () => Promise.resolve([]),
        resolveModels,
      },
      semanticDebounceMs: 10_000,
    });
    service.openDocument(rootUri, "INTERLIS 2.3;", 1);
    const result = await service.analyzeNow();
    expect(result.value?.missingModels).toEqual([]);
    expect(resolveModels).toHaveBeenCalledWith(["Implicit"], "ili2_3");
    service.dispose();
  });

  it("adds a range-less diagnostic for an unresolved implicit dependency", async () => {
    const base = backend();
    const compiler = backend({
      parse: (uri) => ({ ...base.parse(uri), iliVersion: "2.3" }),
      analyze: (request) => ({
        ...base.analyze(request),
        success: false,
        missingModels: ["Implicit"],
      }),
    });
    const service = new LanguageService(compiler, {
      modelRepository: {
        listModels: () => Promise.resolve([]),
        resolveModels: () => Promise.reject(new Error("not available")),
      },
      semanticDebounceMs: 10_000,
    });
    service.openDocument(rootUri, "INTERLIS 2.3;", 1);
    const result = await service.analyzeNow();
    const diagnostic = result.value?.diagnostics.find(
      (entry) => entry.code === "repository-model-unavailable",
    );
    expect(diagnostic?.range).toBeNull();
    expect(diagnostic?.message).toContain("not available");
    service.dispose();
  });

  it("offers repository models in IMPORTS while filtering browse-only entries", async () => {
    const { compiler } = repositoryBackend();
    const service = new LanguageService(compiler, {
      modelRepository: repository(),
      semanticDebounceMs: 10_000,
    });
    service.openDocument(rootUri, "INTERLIS 2.4; IMPORTS ;", 1);
    const labels = (
      await service.completion(rootUri, { line: 2, character: 17 })
    ).map((item) => item.label);
    expect(labels).toContain("Remote");
    expect(labels).not.toContain("BrowseOnly");
    service.dispose();
  });

  it("keeps base completion results when catalog refresh fails", async () => {
    const { compiler } = repositoryBackend();
    const onError = vi.fn();
    const service = new LanguageService(compiler, {
      modelRepository: {
        listModels: () => Promise.reject(new Error("catalog unavailable")),
        resolveModels: () => Promise.resolve([]),
      },
      semanticDebounceMs: 10_000,
      onError,
    });
    service.openDocument(rootUri, "INTERLIS 2.4; IMPORTS ;", 1);
    await expect(
      service.completion(rootUri, { line: 2, character: 17 }),
    ).resolves.toBeInstanceOf(Array);
    expect(onError).toHaveBeenCalledOnce();
    service.dispose();
  });

  it("keeps a local model authoritative and does not resolve it remotely", async () => {
    const { compiler, sources } = repositoryBackend();
    const models = repository();
    const service = new LanguageService(compiler, {
      modelRepository: models,
      semanticDebounceMs: 10_000,
    });
    service.putWorkspaceSource(
      "memory:///Remote.ili",
      "INTERLIS 2.4; MODEL Remote = END Remote.",
      1,
    );
    sources.set(dependencyUri, "dependency-present-for-test");
    service.openDocument(rootUri, "INTERLIS 2.4; IMPORTS Remote;", 1);
    await service.analyzeNow();
    expect(models.resolveModels).not.toHaveBeenCalled();
    service.dispose();
  });
});
