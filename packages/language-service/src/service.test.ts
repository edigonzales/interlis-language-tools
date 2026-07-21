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
  LanguageService,
  MemoryWorkspaceFileSystem,
} from "./index.js";

const rootUri = "memory:///Root.ili";

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
    documentVersions: Object.fromEntries(roots.map((uri) => [uri, 1])),
    missingModels,
    symbols: [],
    references: [],
    dependencies: [],
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
