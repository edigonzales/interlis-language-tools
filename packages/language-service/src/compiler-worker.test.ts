import { describe, expect, it, vi } from "vitest";
import type {
  CompilationAnalysisResult,
  CompilerBackend,
  CompilerWorkerPort,
  CompilerWorkerRequest,
  CompilerWorkerResponse,
  SyntaxSnapshot,
} from "./index.js";
import { createWorkerCompilerBackend } from "./index.js";

const uri = "memory:///Worker.ili";

const syntax = (): SyntaxSnapshot => ({
  schemaVersion: 1,
  abiVersion: 1,
  compilerVersion: "test",
  kind: "syntax",
  success: true,
  uri,
  documentVersion: 1,
  iliVersion: "2.4",
  tokens: [],
  nodes: [],
  contexts: [],
  imports: [],
  diagnostics: [],
});

const analysis = (): CompilationAnalysisResult => ({
  schemaVersion: 1,
  abiVersion: 1,
  compilerVersion: "test",
  kind: "compilation-analysis",
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
  },
  semantic: {
    schemaVersion: 1,
    abiVersion: 1,
    compilerVersion: "test",
    kind: "semantic",
    success: true,
    cancelled: false,
    roots: [uri],
    documentVersions: { [uri]: 1 },
    missingModels: [],
    symbols: [],
    references: [],
    dependencies: [],
    diagram: { nodes: [], edges: [] },
    documentation: { title: "", sections: [] },
    diagnostics: [],
    logs: [],
  },
  syntax: [syntax()],
});

class FakeWorkerPort implements CompilerWorkerPort {
  readonly messages: CompilerWorkerRequest[] = [];
  readonly #messageListeners = new Set<
    (message: CompilerWorkerResponse) => void
  >();
  readonly #errorListeners = new Set<(error: unknown) => void>();
  terminated = false;

  postMessage(message: CompilerWorkerRequest): void {
    this.messages.push(message);
  }

  onMessage(listener: (message: CompilerWorkerResponse) => void) {
    this.#messageListeners.add(listener);
    return { dispose: () => this.#messageListeners.delete(listener) };
  }

  onError(listener: (error: unknown) => void) {
    this.#errorListeners.add(listener);
    return { dispose: () => this.#errorListeners.delete(listener) };
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(id: number, value: unknown): void {
    for (const listener of this.#messageListeners)
      listener({ id, ok: true, value });
  }

  fail(error: unknown): void {
    for (const listener of [...this.#errorListeners]) listener(error);
  }
}

type MockCompilerBackend = CompilerBackend & {
  readonly compileAndAnalyze: ReturnType<typeof vi.fn>;
};

const localBackend = (): MockCompilerBackend => ({
  putSource: vi.fn(),
  removeSource: vi.fn(() => true),
  parse: vi.fn(() => syntax()),
  analyze: vi.fn(() => analysis().semantic),
  compileAndAnalyze: vi.fn(() => analysis()),
  compile: vi.fn(() => analysis().compilation),
  format: vi.fn(() => ({
    schemaVersion: 1 as const,
    abiVersion: 1 as const,
    compilerVersion: "test",
    kind: "formatting" as const,
    success: true,
    applicable: true,
    changed: false,
    text: "",
    diagnostics: [],
  })),
  restart: vi.fn(),
  dispose: vi.fn(),
});

describe("worker compiler backend", () => {
  it("mirrors sources before async compilation while local syntax stays responsive", async () => {
    const worker = new FakeWorkerPort();
    const local = localBackend();
    const compiler = createWorkerCompilerBackend(local, () => worker);
    compiler.putSource(uri, "MODEL Worker", 1);

    const pending = compiler.compileAndAnalyze({ roots: [uri] });
    expect(compiler.parse(uri)).toEqual(syntax());
    expect(worker.messages.map((message) => message.method)).toEqual([
      "putSource",
      "compileAndAnalyze",
    ]);
    expect(local.compileAndAnalyze.mock.calls).toHaveLength(0);

    const request = worker.messages.at(-1)!;
    worker.respond(request.id, analysis());
    await expect(pending).resolves.toEqual(analysis());
  });

  it("rejects an interrupted run, recreates the worker and replays all sources", async () => {
    const first = new FakeWorkerPort();
    const second = new FakeWorkerPort();
    const workers = [first, second];
    const compiler = createWorkerCompilerBackend(localBackend(), () =>
      workers.shift()!,
    );
    compiler.putSource(uri, "MODEL Worker", 7);
    const pending = compiler.compileAndAnalyze({ roots: [uri] });

    first.fail(new Error("crashed"));
    await expect(pending).rejects.toThrow(
      "INTERLIS compiler worker failed: crashed",
    );
    expect(first.terminated).toBe(true);
    expect(second.messages).toEqual([
      expect.objectContaining({
        method: "putSource",
        uri,
        version: 7,
      }),
    ]);

    const recovered = compiler.compileAndAnalyze({ roots: [uri] });
    const request = second.messages.at(-1)!;
    second.respond(request.id, analysis());
    await expect(recovered).resolves.toEqual(analysis());
  });

  it("falls back to the local compiler when workers are unavailable", async () => {
    const local = localBackend();
    const warning = vi.fn();
    const compiler = createWorkerCompilerBackend(
      local,
      () => {
        throw new Error("unsupported");
      },
      { onWarning: warning },
    );
    compiler.putSource(uri, "MODEL Worker", 1);
    await expect(
      Promise.resolve(compiler.compileAndAnalyze({ roots: [uri] })),
    ).resolves.toEqual(analysis());
    expect(local.compileAndAnalyze.mock.calls).toHaveLength(1);
    expect(warning).toHaveBeenCalledOnce();
  });
});
