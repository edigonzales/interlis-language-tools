import { describe, expect, it, vi } from "vitest";
import type {
  CompilationAnalysisResult,
  CompilationEvent,
  CompilationRequest,
  CompilerBackend,
  Diagnostic,
  SemanticSnapshot,
  SyntaxSnapshot,
} from "./index.js";
import {
  formatCompilationOutput,
  formatCompilationOutputForDisplay,
  LanguageService,
  MemoryWorkspaceFileSystem,
} from "./index.js";

const rootUri = "memory:///Root.ili";

function localTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function diagnostic(
  code: string,
  uri: string | null = rootUri,
  severity: Diagnostic["severity"] = "error",
): Diagnostic {
  return {
    severity,
    code,
    message: `${code} message`,
    range: uri
      ? {
          uri,
          start: { line: 1, character: 2, byteOffset: 3 },
          end: { line: 1, character: 4, byteOffset: 5 },
        }
      : null,
    relatedInformation: [],
    notes: [],
    treatedAsError: severity === "error",
  };
}

function analysis(
  roots: readonly string[],
  options: {
    diagnostics?: Diagnostic[];
    missingModels?: string[];
    syntax?: SyntaxSnapshot[];
    symbols?: SemanticSnapshot["symbols"];
    dependencies?: SemanticSnapshot["dependencies"];
    documentVersions?: Readonly<Record<string, number>>;
  } = {},
): CompilationAnalysisResult {
  const diagnostics = options.diagnostics ?? [];
  const missingModels = options.missingModels ?? [];
  const common = {
    schemaVersion: 1 as const,
    abiVersion: 1 as const,
    compilerVersion: "test-compiler",
  };
  const semantic: SemanticSnapshot = {
    ...common,
    kind: "semantic",
    success: diagnostics.every((entry) => !entry.treatedAsError),
    cancelled: false,
    roots: [...roots],
    documentVersions:
      options.documentVersions ??
      Object.fromEntries(roots.map((uri) => [uri, 1])),
    missingModels,
    symbols: options.symbols ?? [],
    references: [],
    dependencies: options.dependencies ?? [],
    diagram: { nodes: [], edges: [] },
    documentation: { title: "", sections: [] },
    diagnostics,
    logs: [],
  };
  return {
    ...common,
    kind: "compilation-analysis",
    compilation: {
      ...common,
      kind: "compilation",
      success: semantic.success,
      cancelled: false,
      errorCount: diagnostics.filter(
        (entry) => entry.severity === "error" || entry.treatedAsError,
      ).length,
      warningCount: diagnostics.filter(
        (entry) => entry.severity === "warning" && !entry.treatedAsError,
      ).length,
      missingModels,
      models: [],
      diagnostics,
      logs: [],
    },
    semantic,
    syntax: options.syntax ?? roots.map((uri) => syntax(uri)),
  };
}

function syntax(
  uri: string,
  imports: string[] = [],
  importRange = diagnostic("range", uri).range,
): SyntaxSnapshot {
  return {
    schemaVersion: 1,
    abiVersion: 1,
    compilerVersion: "test-compiler",
    kind: "syntax",
    success: true,
    uri,
    documentVersion: 1,
    iliVersion: "2.4",
    tokens: [],
    nodes: [],
    contexts: [],
    imports,
    importReferences: imports.flatMap((model) =>
      importRange ? [{ model, unqualified: true, range: importRange }] : [],
    ),
    diagnostics: [],
  };
}

function modelSymbol(
  uri: string,
  name: string,
): SemanticSnapshot["symbols"][number] {
  return {
    id: `model:${name}`,
    name,
    qualifiedName: name,
    kind: "model",
    containerId: "",
    range: {
      uri,
      start: { line: 0, character: 0, byteOffset: 0 },
      end: { line: 0, character: 11, byteOffset: 11 },
    },
    selectionRange: {
      uri,
      start: { line: 0, character: 6, byteOffset: 6 },
      end: { line: 0, character: 10, byteOffset: 10 },
    },
    endRange: null,
    abstract: false,
  };
}

function backend(
  implementation: CompilerBackend["compileAndAnalyze"] = (request) =>
    analysis(request.roots),
): CompilerBackend & {
  parse: ReturnType<typeof vi.fn>;
  analyze: ReturnType<typeof vi.fn>;
  compileAndAnalyze: ReturnType<typeof vi.fn>;
} {
  const compileAndAnalyze = vi.fn(implementation);
  return {
    putSource: vi.fn(),
    removeSource: vi.fn(() => true),
    parse: vi.fn(),
    analyze: vi.fn(),
    compileAndAnalyze,
    compile: vi.fn(),
    format: vi.fn(() => ({
      schemaVersion: 1,
      abiVersion: 1,
      compilerVersion: "test-compiler",
      kind: "formatting",
      success: true,
      applicable: true,
      changed: false,
      text: "",
      diagnostics: [],
    })),
    dispose: vi.fn(),
  } as CompilerBackend & {
    parse: ReturnType<typeof vi.fn>;
    analyze: ReturnType<typeof vi.fn>;
    compileAndAnalyze: ReturnType<typeof vi.fn>;
  };
}

describe("save-driven LanguageService", () => {
  it("does no parse, analysis, or compilation while opening and typing", () => {
    const compiler = backend();
    const service = new LanguageService(compiler);
    service.openDocument(rootUri, "", 1);
    for (let version = 2; version <= 20; version++)
      service.changeDocument(rootUri, "x".repeat(version), version);
    expect(compiler.parse).not.toHaveBeenCalled();
    expect(compiler.analyze).not.toHaveBeenCalled();
    expect(compiler.compileAndAnalyze).not.toHaveBeenCalled();
    expect(service.getSyntaxSnapshot(rootUri)).toBeNull();
  });

  it("runs every save and manual request for exactly one root", async () => {
    const compiler = backend();
    const service = new LanguageService(compiler);
    service.openDocument(rootUri, "", 1);
    service.markSaved(rootUri);
    await service.compileDocument(rootUri, "save");
    await service.compileDocument(rootUri, "manual");
    expect(compiler.compileAndAnalyze).toHaveBeenNthCalledWith(1, {
      roots: [rootUri],
    });
    expect(compiler.compileAndAnalyze).toHaveBeenNthCalledWith(2, {
      roots: [rootUri],
    });
    await expect(service.compile([])).rejects.toThrow("Exactly one root");
    await expect(
      service.compile([rootUri, "memory:///Other.ili"]),
    ).rejects.toThrow("Exactly one root");
  });

  it("publishes a startup compilation with exactly one root", async () => {
    const compiler = backend();
    const events: CompilationEvent[] = [];
    const service = new LanguageService(compiler, {
      onCompilation: (event) => events.push(event),
    });
    service.openDocument(rootUri, "MODEL Root", 1);

    await service.compileDocument(rootUri, "startup");

    expect(compiler.compileAndAnalyze).toHaveBeenCalledWith({
      roots: [rootUri],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.trigger).toBe("startup");
    expect(events[0]?.rootUri).toBe(rootUri);
  });

  it("serializes requests and prevents an older run from publishing", async () => {
    let release!: (value: CompilationAnalysisResult) => void;
    const first = new Promise<CompilationAnalysisResult>((resolve) => {
      release = resolve;
    });
    const compileAndAnalyze = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockImplementation((request: CompilationRequest) =>
        analysis(request.roots),
      );
    const compiler = backend(compileAndAnalyze);
    const events: CompilationEvent[] = [];
    const service = new LanguageService(compiler, {
      onCompilation: (event) => events.push(event),
    });
    service.openDocument(rootUri, "MODEL Root", 1);
    const oldRun = service.compileDocument(rootUri, "save");
    const newRun = service.compileDocument(rootUri, "manual");
    await vi.waitFor(() => expect(compileAndAnalyze).toHaveBeenCalledTimes(1));
    release(analysis([rootUri]));
    await Promise.all([oldRun, newRun]);
    expect(compileAndAnalyze).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
    expect(events[0]?.runId).toBe(2);
  });

  it("replaces diagnostics instead of adding syntax and semantic copies", async () => {
    const firstDiagnostics = [
      diagnostic("one"),
      diagnostic("two"),
      diagnostic("three"),
    ];
    const secondDiagnostics = [diagnostic("replacement")];
    const compileAndAnalyze = vi
      .fn()
      .mockReturnValueOnce(
        analysis([rootUri], { diagnostics: firstDiagnostics }),
      )
      .mockReturnValueOnce(
        analysis([rootUri], { diagnostics: secondDiagnostics }),
      );
    const service = new LanguageService(backend(compileAndAnalyze));
    service.openDocument(rootUri, "MODEL Root", 1);
    const first = await service.compileDocument(rootUri, "save");
    expect(first.compilation.errorCount).toBe(3);
    expect(service.diagnostics(rootUri)).toHaveLength(3);
    await service.compileDocument(rootUri, "save");
    expect(service.diagnostics(rootUri).map((entry) => entry.code)).toEqual([
      "replacement",
    ]);
  });

  it("keeps the last result while typing and marks snapshots stale", async () => {
    const service = new LanguageService(backend());
    service.openDocument(rootUri, "MODEL Root", 1);
    service.markSaved(rootUri);
    await service.compileDocument(rootUri, "save");
    expect(service.getSemanticSnapshot()?.freshness).toBe("fresh");
    service.changeDocument(rootUri, "MODEL Root =", 2);
    expect(service.getSemanticSnapshot()?.freshness).toBe("stale");
    expect(service.getSyntaxSnapshot(rootUri)).toBeNull();
  });

  it("keeps rename dirty until save, then restores symbols and outline", async () => {
    const source = `TOPIC foo =
  CLASS bar =
  END bar;
END foo;`;
    let version = 1;
    const symbol = (name: string): SemanticSnapshot["symbols"][number] => ({
      id: "topic:foo",
      name,
      qualifiedName: name,
      kind: "topic",
      containerId: "",
      range: {
        uri: rootUri,
        start: { line: 0, character: 0, byteOffset: 0 },
        end: { line: 3, character: 8, byteOffset: source.length },
      },
      selectionRange: {
        uri: rootUri,
        start: { line: 0, character: 6, byteOffset: 6 },
        end: { line: 0, character: 9, byteOffset: 9 },
      },
      endRange: {
        uri: rootUri,
        start: { line: 3, character: 4, byteOffset: source.length - 4 },
        end: { line: 3, character: 7, byteOffset: source.length - 1 },
      },
      abstract: false,
    });
    const compiler = backend(() => {
      const result = analysis([rootUri], {
        symbols: [symbol(version === 1 ? "foo" : "foo2")],
        syntax: [{ ...syntax(rootUri), documentVersion: version }],
      });
      return {
        ...result,
        semantic: {
          ...result.semantic,
          documentVersions: { [rootUri]: version },
        },
      };
    });
    const service = new LanguageService(compiler);
    service.openDocument(rootUri, source, version);
    service.markSaved(rootUri);
    await service.compileDocument(rootUri, "save");

    const rename = service.rename(rootUri, { line: 0, character: 7 }, "foo2");
    expect(rename?.changes[rootUri]).toHaveLength(2);
    expect(rename?.changes[rootUri]?.map((edit) => edit.newText)).toEqual([
      "foo2",
      "foo2",
    ]);
    expect(
      rename?.changes[rootUri]?.map((edit) => edit.range.start.line),
    ).toEqual([0, 3]);
    expect(service.prepareRename(rootUri, { line: 3, character: 5 })).toEqual({
      range: {
        start: { line: 3, character: 4 },
        end: { line: 3, character: 7 },
      },
      placeholder: "foo",
    });

    const changedSource = source
      .replace("TOPIC foo", "TOPIC foo2")
      .replace("END foo", "END foo2");
    version = 2;
    service.changeDocument(rootUri, changedSource, version);
    expect(service.getDocument(rootUri)?.dirty).toBe(true);
    expect(compiler.compileAndAnalyze).toHaveBeenCalledTimes(1);
    expect(service.rename(rootUri, { line: 0, character: 7 }, "foo3")).toBe(
      null,
    );
    expect(service.symbols(rootUri)).toEqual([]);

    service.markSaved(rootUri);
    await service.compileDocument(rootUri, "save");
    expect(service.getDocument(rootUri)?.dirty).toBe(false);
    expect(compiler.compileAndAnalyze).toHaveBeenCalledTimes(2);
    expect(service.symbols(rootUri).map((item) => item.name)).toEqual(["foo2"]);
    expect(
      service.rename(rootUri, { line: 0, character: 7 }, "foo3")?.changes[
        rootUri
      ],
    ).toHaveLength(2);

    service.putWorkspaceSource(rootUri, changedSource, 3);
    expect(service.symbols(rootUri).map((item) => item.name)).toEqual(["foo2"]);
    expect(
      service.rename(rootUri, { line: 3, character: 6 }, "foo3")?.changes[
        rootUri
      ],
    ).toHaveLength(2);
  });

  it("does not invalidate a fresh open-document snapshot on workspace updates", async () => {
    const source = "MODEL Root";
    const symbol: SemanticSnapshot["symbols"][number] = {
      id: "model:root",
      name: "Root",
      qualifiedName: "Root",
      kind: "model",
      containerId: "",
      range: {
        uri: rootUri,
        start: { line: 0, character: 0, byteOffset: 0 },
        end: { line: 0, character: source.length, byteOffset: source.length },
      },
      selectionRange: {
        uri: rootUri,
        start: { line: 0, character: 6, byteOffset: 6 },
        end: { line: 0, character: 10, byteOffset: 10 },
      },
      endRange: null,
      abstract: false,
    };
    const compiler = backend((request) =>
      analysis(request.roots, { symbols: [symbol] }),
    );
    const service = new LanguageService(compiler);
    service.openDocument(rootUri, source, 1);
    service.markSaved(rootUri);
    await service.compileDocument(rootUri, "save");

    expect(service.getSemanticSnapshot()?.freshness).toBe("fresh");
    service.putWorkspaceSource(rootUri, source, 2);

    expect(service.getSemanticSnapshot()?.freshness).toBe("fresh");
    expect(service.symbols(rootUri)).toHaveLength(1);
  });

  it("ignores identical watcher echoes before, during, and after an open-document compile", async () => {
    let release!: (value: CompilationAnalysisResult) => void;
    const pendingAnalysis = new Promise<CompilationAnalysisResult>(
      (resolve) => {
        release = resolve;
      },
    );
    const compileAndAnalyze = vi.fn().mockReturnValueOnce(pendingAnalysis);
    const events: CompilationEvent[] = [];
    const service = new LanguageService(backend(compileAndAnalyze), {
      onCompilation: (event) => events.push(event),
    });
    const source = "MODEL Root";
    service.openDocument(rootUri, source, 1);
    service.markSaved(rootUri);
    service.putWorkspaceSource(rootUri, source, 10);

    const compilation = service.compileDocument(rootUri, "save");
    await vi.waitFor(() => expect(compileAndAnalyze).toHaveBeenCalledOnce());
    service.putWorkspaceSource(rootUri, source, 11);
    release(analysis([rootUri], { documentVersions: { [rootUri]: 1 } }));
    await compilation;
    service.putWorkspaceSource(rootUri, source, 12);

    expect(events).toHaveLength(1);
    expect(events[0]?.semantic.freshness).toBe("fresh");
    expect(service.getSavedSemanticSnapshot(rootUri)?.freshness).toBe("fresh");
  });

  it("keeps an outline request pending until the exact saved version is compiled", async () => {
    let version = 1;
    const compiler = backend((request) =>
      analysis(request.roots, {
        documentVersions: { [rootUri]: version },
        symbols: [modelSymbol(rootUri, version === 1 ? "Root" : "Renamed")],
        syntax: [{ ...syntax(rootUri), documentVersion: version }],
      }),
    );
    const service = new LanguageService(compiler);
    service.openDocument(rootUri, "MODEL Root", version);
    service.markSaved(rootUri);
    await service.compileDocument(rootUri, "save");

    version = 2;
    service.changeDocument(rootUri, "MODEL Renamed", version);
    const pending = service.waitForDocumentSymbols(rootUri, version);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    service.markSaved(rootUri);
    await service.compileDocument(rootUri, "save");
    await expect(pending).resolves.toEqual([
      expect.objectContaining({ name: "Renamed" }),
    ]);
  });

  it("resolves an outline request after a manual compile of the exact dirty version", async () => {
    const compiler = backend((request) =>
      analysis(request.roots, {
        documentVersions: { [rootUri]: 2 },
        symbols: [modelSymbol(rootUri, "Renamed")],
      }),
    );
    const service = new LanguageService(compiler);
    service.openDocument(rootUri, "MODEL Root", 1);
    service.changeDocument(rootUri, "MODEL Renamed", 2);
    const pending = service.waitForDocumentSymbols(rootUri, 2);

    await service.compileDocument(rootUri, "manual");

    await expect(pending).resolves.toEqual([
      expect.objectContaining({ name: "Renamed" }),
    ]);
  });

  it("keeps the last valid outline after an invalid saved compilation", async () => {
    let valid = true;
    const compiler = backend((request) =>
      analysis(request.roots, {
        documentVersions: { [rootUri]: valid ? 1 : 2 },
        symbols: [modelSymbol(rootUri, valid ? "Root" : "Partial")],
        diagnostics: valid ? [] : [diagnostic("invalid")],
      }),
    );
    const service = new LanguageService(compiler);
    service.openDocument(rootUri, "MODEL Root", 1);
    service.markSaved(rootUri);
    await service.compileDocument(rootUri, "save");

    valid = false;
    service.changeDocument(rootUri, "MODEL Partial =", 2);
    const pending = service.waitForDocumentSymbols(rootUri, 2);
    service.markSaved(rootUri);
    await service.compileDocument(rootUri, "save");

    await expect(pending).resolves.toEqual([
      expect.objectContaining({ name: "Root" }),
    ]);
    expect(service.symbols(rootUri)).toEqual([
      expect.objectContaining({ name: "Root" }),
    ]);
  });

  it("cancels an outline waiter superseded by a newer document version", async () => {
    const service = new LanguageService(backend());
    service.openDocument(rootUri, "MODEL Root", 1);
    service.changeDocument(rootUri, "MODEL Root2", 2);
    const pending = service.waitForDocumentSymbols(rootUri, 2);

    service.changeDocument(rootUri, "MODEL Root3", 3);

    await expect(pending).resolves.toEqual([]);
  });

  it("keeps semantic snapshots independent across root documents", async () => {
    const otherUri = "memory:///Other.ili";
    const compiler = backend((request) => {
      const uri = request.roots[0]!;
      const name = uri === rootUri ? "Root" : "Other";
      return analysis(request.roots, { symbols: [modelSymbol(uri, name)] });
    });
    const service = new LanguageService(compiler);
    service.openDocument(rootUri, "MODEL Root", 1);
    service.openDocument(otherUri, "MODEL Other", 1);
    service.markSaved(rootUri);
    service.markSaved(otherUri);

    await service.compileDocument(rootUri, "save");
    await service.compileDocument(otherUri, "save");

    expect(service.symbols(rootUri).map((symbol) => symbol.name)).toEqual([
      "Root",
    ]);
    expect(service.symbols(otherUri).map((symbol) => symbol.name)).toEqual([
      "Other",
    ]);
    service.changeDocument(rootUri, "MODEL Root2", 2);
    expect(service.symbols(rootUri)).toEqual([]);
    expect(service.symbols(otherUri).map((symbol) => symbol.name)).toEqual([
      "Other",
    ]);
  });

  it("invalidates only roots whose compiled closure contains a changed source", async () => {
    const dependencyUri = "memory:///Dependency.ili";
    const otherUri = "memory:///Other.ili";
    const compiler = backend((request) =>
      request.roots[0] === rootUri
        ? analysis(request.roots, {
            documentVersions: { [rootUri]: 1, [dependencyUri]: 7 },
            dependencies: [
              {
                sourceUri: rootUri,
                targetUri: dependencyUri,
                model: "Dependency",
              },
            ],
          })
        : analysis(request.roots),
    );
    const service = new LanguageService(compiler);
    service.putWorkspaceSource(dependencyUri, "MODEL Dependency", 7);
    service.openDocument(rootUri, "MODEL Root", 1);
    service.openDocument(otherUri, "MODEL Other", 1);
    service.markSaved(rootUri);
    service.markSaved(otherUri);
    await service.compileDocument(rootUri, "save");
    await service.compileDocument(otherUri, "save");

    service.putWorkspaceSource(dependencyUri, "MODEL Dependency2", 8);

    expect(service.getSavedSemanticSnapshot(rootUri)?.freshness).toBe("stale");
    expect(service.getSavedSemanticSnapshot(otherUri)?.freshness).toBe("fresh");
  });

  it("conservatively invalidates roots when a newly added source was not in a compiled closure", async () => {
    const service = new LanguageService(backend());
    service.openDocument(rootUri, "MODEL Root", 1);
    service.markSaved(rootUri);
    await service.compileDocument(rootUri, "save");

    service.putWorkspaceSource("memory:///New.ili", "MODEL New", 1);

    expect(service.getSavedSemanticSnapshot(rootUri)?.freshness).toBe("stale");
  });

  it("discards an in-flight result when one of its sources was removed", async () => {
    const dependencyUri = "memory:///Dependency.ili";
    let release!: (value: CompilationAnalysisResult) => void;
    const pendingAnalysis = new Promise<CompilationAnalysisResult>(
      (resolve) => {
        release = resolve;
      },
    );
    const events: CompilationEvent[] = [];
    const compileAndAnalyze = vi.fn().mockReturnValueOnce(pendingAnalysis);
    const compiler = backend(compileAndAnalyze);
    const service = new LanguageService(compiler, {
      onCompilation: (event) => events.push(event),
    });
    service.putWorkspaceSource(dependencyUri, "MODEL Dependency", 7);
    service.openDocument(rootUri, "MODEL Root", 1);
    service.markSaved(rootUri);

    const compilation = service.compileDocument(rootUri, "save");
    await vi.waitFor(() =>
      expect(compiler.compileAndAnalyze).toHaveBeenCalledOnce(),
    );
    service.removeWorkspaceSource(dependencyUri);
    release(
      analysis([rootUri], {
        documentVersions: { [rootUri]: 1, [dependencyUri]: 7 },
      }),
    );

    const result = await compilation;
    expect(result.semantic.freshness).toBe("stale");
    expect(events).toEqual([]);
  });

  it("publishes current compilations independently for different roots", async () => {
    const otherUri = "memory:///Other.ili";
    const events: CompilationEvent[] = [];
    const service = new LanguageService(backend(), {
      onCompilation: (event) => events.push(event),
    });
    service.openDocument(rootUri, "MODEL Root", 1);
    service.openDocument(otherUri, "MODEL Other", 1);
    service.markSaved(rootUri);
    service.markSaved(otherUri);

    await Promise.all([
      service.compileDocument(rootUri, "save"),
      service.compileDocument(otherUri, "save"),
    ]);

    expect(events.map((event) => event.rootUri)).toEqual([rootUri, otherUri]);
  });

  it("keeps a saved snapshot with closed imports fresh", async () => {
    const importedUri = "repository:///Units.ili";
    const compiler = backend((request) => {
      const result = analysis(request.roots, {
        syntax: [syntax(rootUri, ["Units"]), syntax(importedUri)],
      });
      return {
        ...result,
        semantic: {
          ...result.semantic,
          documentVersions: { [rootUri]: 1, [importedUri]: 7 },
        },
      };
    });
    const service = new LanguageService(compiler);
    service.openDocument(rootUri, "MODEL Root", 1);
    service.markSaved(rootUri);
    await service.compileDocument(rootUri, "save");

    expect(service.getSavedSemanticSnapshot(rootUri)?.freshness).toBe("fresh");
  });

  it("turns repository failures into diagnostics in the final result", async () => {
    const snapshots = [syntax(rootUri, ["Remote"])];
    const compiler = backend(
      vi.fn(() =>
        analysis([rootUri], { missingModels: ["Remote"], syntax: snapshots }),
      ),
    );
    const service = new LanguageService(compiler, {
      modelRepository: {
        listModels: vi.fn(() => Promise.resolve([])),
        resolveModels: vi.fn(() => Promise.reject(new Error("offline"))),
      },
    });
    service.openDocument(rootUri, "IMPORTS Remote;", 1);
    const event = await service.compileDocument(rootUri, "save");
    const repository = event.compilation.diagnostics.find(
      (entry) => entry.code === "repository-model-unavailable",
    );
    expect(repository?.message).toContain("offline");
    expect(event.compilation.errorCount).toBe(1);
    expect(event.semantic.value?.diagnostics).toEqual(
      event.compilation.diagnostics,
    );
  });
});

describe("formatCompilationOutput", () => {
  it("renders the compiler transcript and its final status line", () => {
    const warning = diagnostic("warning-code", null, "warning");
    const compilation = analysis([rootUri], {
      diagnostics: [warning],
    }).compilation;
    compilation.transcript = [
      "inf: ilic 0.9.9",
      "inf:",
      "wrn:    warning-code message",
      "inf:",
      "inf: ilic completed with no errors, 1 warning.",
    ];
    const output = formatCompilationOutput({
      runId: 7,
      timestamp: "2026-07-20T12:00:00.000Z",
      trigger: "manual",
      rootUri,
      documentVersion: 4,
      compilation,
    });
    expect(output).toBe(`${compilation.transcript.join("\n")}\n`);
    expect(output).toContain("ilic completed with no errors, 1 warning.");
  });

  it("appends the local event timestamp for user-facing output", () => {
    const timestamp = "2026-07-20T12:00:00.000Z";
    const compilation = analysis([rootUri], {
      diagnostics: [diagnostic("warning-code", null, "warning")],
    }).compilation;
    compilation.transcript = [
      "inf: ilic 0.9.9",
      "inf:",
      "wrn:    warning-code message",
      "inf:",
      "inf: ilic completed with no errors, 1 warning.",
    ];
    expect(
      formatCompilationOutputForDisplay({
        runId: 8,
        timestamp,
        trigger: "manual",
        rootUri,
        documentVersion: 5,
        compilation,
      }),
    ).toBe(
      [
        "inf: ilic 0.9.9",
        "inf:",
        "wrn:    warning-code message",
        "inf:",
        `inf: ilic completed with no errors, 1 warning. ${localTimestamp(timestamp)}`,
        "",
      ].join("\n"),
    );
  });

  it("leaves user-facing output unchanged for an invalid event timestamp", () => {
    const compilation = analysis([rootUri]).compilation;
    compilation.transcript = [
      "inf: ilic completed with no errors, no warnings.",
    ];
    expect(
      formatCompilationOutputForDisplay({
        runId: 9,
        timestamp: "invalid-timestamp",
        trigger: "manual",
        rootUri,
        documentVersion: 6,
        compilation,
      }),
    ).toBe("inf: ilic completed with no errors, no warnings.\n");
  });
});

describe("MemoryWorkspaceFileSystem", () => {
  it("stores, renames, and deletes files", async () => {
    const workspace = new MemoryWorkspaceFileSystem();
    await workspace.write("memory:/A.ili", new TextEncoder().encode("A"));
    await workspace.rename("memory:/A.ili", "memory:/B.ili");
    expect(
      new TextDecoder().decode(await workspace.read("memory:/B.ili")),
    ).toBe("A");
    await workspace.delete("memory:/B.ili");
    await expect(workspace.read("memory:/B.ili")).rejects.toThrow();
  });
});
