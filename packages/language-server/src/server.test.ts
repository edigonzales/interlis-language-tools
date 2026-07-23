import { describe, expect, it, vi } from "vitest";
import type {
  CompilationEvent,
  DocumentSymbol,
  LanguageService,
} from "@ilic/language-service";
import type {
  Connection,
  InitializeParams,
  InitializeResult,
} from "vscode-languageserver";
import { InterlisProtocol } from "./protocol.js";
import type {
  RepositorySourceResult,
  WorkspaceSourceChangedParams,
  WorkspaceSourcesParams,
} from "./protocol.js";
import { bindLanguageServer } from "./server.js";

type RegisteredHandler = (...args: unknown[]) => unknown;

function contractHarness() {
  const registered = new Map<string, RegisteredHandler>();
  const sendDiagnostics = vi.fn(
    (params: { uri: string; diagnostics: unknown[] }) => {
      void params;
      return Promise.resolve();
    },
  );
  const consoleError = vi.fn();
  const connectionTarget = {
    sendDiagnostics,
    sendNotification: vi.fn(() => Promise.resolve()),
    console: {
      error: consoleError,
      warn: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
    },
  };
  const connection = new Proxy(connectionTarget, {
    get(target, property, receiver) {
      if (Reflect.has(target, property))
        return Reflect.get(target, property, receiver) as unknown;
      return (...args: unknown[]) => {
        const callback = args.at(-1);
        if (typeof callback !== "function")
          throw new TypeError(`Missing callback for ${String(property)}`);
        const method =
          property === "onRequest" || property === "onNotification"
            ? `:${String(args[0])}`
            : "";
        registered.set(
          `${String(property)}${method}`,
          callback as RegisteredHandler,
        );
      };
    },
  }) as unknown as Connection;

  let compilationListener: ((event: CompilationEvent) => void) | undefined;
  const compilationDispose = vi.fn();
  const spies = {
    replaceWorkspaceSources: vi.fn(),
    putWorkspaceSource: vi.fn(),
    removeWorkspaceSource: vi.fn(),
    openDocument: vi.fn(),
    changeDocument: vi.fn(),
    markSaved: vi.fn(),
    closeDocument: vi.fn(),
    dispose: vi.fn(),
    isReadOnlyUri: vi.fn(() => false),
    getDocument: vi.fn((): unknown => undefined),
    getRepositoryDocument: vi.fn(),
    compileDocument: vi.fn(() => Promise.resolve({ compilation: {} })),
    getSavedSemanticSnapshot: vi.fn(() => null),
    symbols: vi.fn((): DocumentSymbol[] => []),
    waitForDocumentSymbols: vi.fn(
      (uri: string, version: number, signal?: AbortSignal) => {
        void uri;
        void version;
        void signal;
        return Promise.resolve([]);
      },
    ),
    rename: vi.fn((): unknown => null),
  };
  const service = {
    ...spies,
    onCompilation: vi.fn((listener: typeof compilationListener) => {
      compilationListener = listener;
      return { dispose: compilationDispose };
    }),
    completion: vi.fn(() => Promise.resolve([])),
    definition: vi.fn(() => []),
    references: vi.fn(() => []),
    prepareRename: vi.fn(() => null),
    rename: spies.rename,
    symbols: spies.symbols,
    hover: vi.fn(() => null),
    formatting: vi.fn(() => []),
    onTypeEdit: vi.fn(() => null),
  } as unknown as LanguageService;

  const handler = <T>(key: string): T => {
    const value = registered.get(key);
    if (!value) throw new Error(`Handler not registered: ${key}`);
    return value as T;
  };

  return {
    connection,
    consoleError,
    sendDiagnostics,
    sendNotification: connectionTarget.sendNotification,
    service,
    spies,
    compilationDispose,
    fireCompilation: (event: CompilationEvent) => compilationListener?.(event),
    handler,
  };
}

describe("language server repository contract", () => {
  it("initializes workspace sources and repository configuration", async () => {
    const harness = contractHarness();
    const configureRepositories = vi.fn(() => Promise.resolve());
    bindLanguageServer(harness.connection, harness.service, {
      configureRepositories,
    });
    const initialize =
      harness.handler<(params: InitializeParams) => Promise<InitializeResult>>(
        "onInitialize",
      );
    const workspaceSources = [
      { uri: "file:///workspace/Model.ili", text: "MODEL Model", version: 7 },
    ];
    const result = await initialize({
      initializationOptions: {
        workspaceSources,
        modelRepositories: ["https://models.example"],
        repositoryCachePath: "/cache",
      },
    } as unknown as InitializeParams);

    expect(harness.spies.replaceWorkspaceSources).toHaveBeenCalledWith(
      workspaceSources,
    );
    expect(configureRepositories).toHaveBeenCalledWith(
      ["https://models.example"],
      expect.objectContaining({ repositoryCachePath: "/cache" }),
    );
    expect(result.capabilities.definitionProvider).toBe(true);
  });

  it("applies watcher and configuration messages without dropping init options", async () => {
    const harness = contractHarness();
    const configureRepositories = vi
      .fn<
        (
          repositories: readonly string[],
          options: { repositoryCachePath?: string },
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined);
    bindLanguageServer(harness.connection, harness.service, {
      configureRepositories,
    });
    const initialize =
      harness.handler<(params: InitializeParams) => Promise<InitializeResult>>(
        "onInitialize",
      );
    await initialize({
      initializationOptions: { repositoryCachePath: "/cache" },
    } as unknown as InitializeParams);

    harness.handler<(params: WorkspaceSourcesParams) => void>(
      `onNotification:${InterlisProtocol.workspaceSources}`,
    )({ sources: [{ uri: "file:///A.ili", text: "A" }] });
    const changed = harness.handler<
      (params: WorkspaceSourceChangedParams) => void
    >(`onNotification:${InterlisProtocol.workspaceSourceChanged}`);
    changed({ uri: "file:///A.ili", text: "A2", version: 2 });
    changed({ uri: "file:///A.ili", deleted: true });
    harness.handler<(params: { modelRepositories: readonly string[] }) => void>(
      `onNotification:${InterlisProtocol.repositoryConfiguration}`,
    )({
      modelRepositories: ["https://other.example"],
    });
    await Promise.resolve();

    expect(harness.spies.replaceWorkspaceSources).toHaveBeenLastCalledWith([
      { uri: "file:///A.ili", text: "A" },
    ]);
    expect(harness.spies.putWorkspaceSource).toHaveBeenCalledWith(
      "file:///A.ili",
      "A2",
      2,
    );
    expect(harness.spies.removeWorkspaceSource).toHaveBeenCalledWith(
      "file:///A.ili",
    );
    expect(configureRepositories).toHaveBeenLastCalledWith(
      ["https://other.example"],
      expect.objectContaining({ repositoryCachePath: "/cache" }),
    );
  });

  it("serves virtual browser documents and protects read-only changes", () => {
    const harness = contractHarness();
    bindLanguageServer(harness.connection, harness.service);
    const repositorySource = harness.handler<
      (params: { uri: string }) => RepositorySourceResult | null
    >(`onRequest:${InterlisProtocol.repositorySource}`);
    harness.spies.getRepositoryDocument.mockReturnValueOnce({
      uri: "interlis-repository:/ili2_4/Units/origin.ili",
      originUri: "https://models.example/Units.ili",
      source: new TextEncoder().encode("MODEL Units"),
    });
    expect(
      repositorySource({
        uri: "interlis-repository:/ili2_4/Units/origin.ili",
      })?.text,
    ).toBe("MODEL Units");
    expect(repositorySource({ uri: "missing" })).toBeNull();

    harness.spies.isReadOnlyUri.mockReturnValueOnce(true);
    harness.handler<(params: unknown) => void>("onDidChangeTextDocument")({
      textDocument: { uri: "interlis-repository:/Units.ili", version: 2 },
      contentChanges: [{ text: "changed" }],
    });
    expect(harness.spies.changeDocument).not.toHaveBeenCalled();
  });

  it("keeps diagnostics independent per root and publishes notifications", () => {
    const harness = contractHarness();
    bindLanguageServer(harness.connection, harness.service);
    const makeEvent = (uri: string, code: string): CompilationEvent => ({
      runId: code === "first" ? 1 : 2,
      timestamp: "2026-07-20T12:00:00.000Z",
      trigger: "save",
      rootUri: uri,
      documentVersion: 1,
      compilation: {
        schemaVersion: 1,
        abiVersion: 1,
        compilerVersion: "test",
        kind: "compilation",
        success: false,
        cancelled: false,
        errorCount: 1,
        warningCount: 0,
        missingModels: [],
        models: [],
        diagnostics: [
          {
            severity: "warning",
            code,
            message: code,
            range: {
              uri,
              start: { line: 0, character: 0, byteOffset: 0 },
              end: { line: 0, character: 1, byteOffset: 1 },
            },
            relatedInformation: [],
            notes: ["note"],
            treatedAsError: true,
          },
        ],
        logs: [],
      },
      semantic: {
        value: null,
        freshness: "fresh",
        generation: 1,
        documentVersions: { [uri]: 1 },
      },
    });
    harness.fireCompilation(makeEvent("file:///A.ili", "first"));
    harness.fireCompilation(makeEvent("file:///B.ili", "second"));
    expect(harness.sendDiagnostics).toHaveBeenCalledTimes(2);
    expect(harness.sendDiagnostics).not.toHaveBeenCalledWith({
      uri: "file:///A.ili",
      diagnostics: [],
    });
    expect(harness.sendDiagnostics.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ uri: "file:///B.ili" }),
    );
    expect(
      (
        harness.sendDiagnostics.mock.calls[1]?.[0] as {
          diagnostics: Array<{ severity: number; data: unknown }>;
        }
      ).diagnostics[0],
    ).toEqual(
      expect.objectContaining({
        severity: 1,
        data: {
          treatedAsError: true,
          notes: ["note"],
          relatedInformation: [],
        },
      }),
    );
    expect(harness.sendNotification).toHaveBeenCalledWith(
      InterlisProtocol.compilationCompleted,
      expect.objectContaining({ rootUri: "file:///B.ili" }),
    );
    expect(harness.sendNotification).toHaveBeenLastCalledWith(
      InterlisProtocol.semanticSnapshotChanged,
      expect.objectContaining({
        rootUri: "file:///B.ili",
        generation: 1,
        freshness: "fresh",
        sourceUris: ["file:///B.ili"],
      }),
    );
    harness.handler<() => void>("onShutdown")();
    expect(harness.compilationDispose).toHaveBeenCalledOnce();
    expect(harness.spies.dispose).toHaveBeenCalledOnce();
  });

  it("compiles on save and manual request with one root URI", async () => {
    const harness = contractHarness();
    bindLanguageServer(harness.connection, harness.service);
    const uri = "file:///Root.ili";
    harness.handler<(params: unknown) => void>("onDidSaveTextDocument")({
      textDocument: { uri },
    });
    expect(harness.spies.markSaved).toHaveBeenCalledWith(uri);
    expect(harness.spies.compileDocument).toHaveBeenCalledWith(uri, "save");
    await harness.handler<(params: { uri: string }) => Promise<unknown>>(
      `onRequest:${InterlisProtocol.compile}`,
    )({ uri });
    expect(harness.spies.compileDocument).toHaveBeenCalledWith(uri, "manual");

    await harness.handler<
      (params: { uri: string; trigger: "startup" }) => Promise<unknown>
    >(`onRequest:${InterlisProtocol.compile}`)({
      uri,
      trigger: "startup",
    });
    expect(harness.spies.compileDocument).toHaveBeenCalledWith(uri, "startup");

    await harness.handler<
      (params: { uri: string; trigger: "diagram" }) => Promise<unknown>
    >(`onRequest:${InterlisProtocol.compile}`)({
      uri,
      trigger: "diagram",
    });
    expect(harness.spies.compileDocument).toHaveBeenCalledWith(uri, "diagram");
  });

  it("answers document symbols immediately from the live outline", () => {
    const harness = contractHarness();
    bindLanguageServer(harness.connection, harness.service);
    const uri = "file:///Root.ili";
    harness.spies.getDocument.mockReturnValue({ version: 2 });
    const symbols = [
      {
        name: "Root",
        detail: "MODEL",
        kind: "model",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 3, character: 9 },
        },
        selectionRange: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 6 },
        },
        children: [],
      },
    ];
    harness.spies.symbols.mockReturnValue(symbols);

    const result = harness.handler<
      (params: { textDocument: { uri: string } }) => unknown
    >("onDocumentSymbol")({ textDocument: { uri } });

    expect(result).toEqual([
      expect.objectContaining({ name: "Root", detail: "MODEL" }),
    ]);
    expect(harness.spies.symbols).toHaveBeenCalledWith(uri);
    expect(harness.spies.waitForDocumentSymbols).not.toHaveBeenCalled();
    expect(harness.spies.compileDocument).not.toHaveBeenCalled();
  });

  it("does not clear the live outline when a request token is cancelled", () => {
    const harness = contractHarness();
    bindLanguageServer(harness.connection, harness.service);
    const uri = "file:///Root.ili";
    harness.spies.symbols.mockReturnValue([
      {
        name: "Root",
        detail: "MODEL",
        kind: "model",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        selectionRange: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 6 },
        },
        children: [],
      },
    ]);
    const result = harness.handler<
      (
        params: { textDocument: { uri: string } },
        token: { readonly isCancellationRequested: boolean },
      ) => unknown
    >("onDocumentSymbol")(
      { textDocument: { uri } },
      { isCancellationRequested: true },
    );

    expect(result).toEqual([expect.objectContaining({ name: "Root" })]);
  });

  it("publishes semantic dependency results without replacing compiler output", () => {
    const harness = contractHarness();
    bindLanguageServer(harness.connection, harness.service);
    const uri = "file:///Root.ili";
    harness.fireCompilation({
      runId: 3,
      timestamp: "2026-07-20T12:00:00.000Z",
      trigger: "dependency",
      rootUri: uri,
      documentVersion: 2,
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
        value: null,
        freshness: "fresh",
        generation: 4,
        documentVersions: { [uri]: 2 },
      },
    });

    expect(harness.sendNotification).not.toHaveBeenCalledWith(
      InterlisProtocol.compilationCompleted,
      expect.anything(),
    );
    expect(harness.sendNotification).toHaveBeenCalledWith(
      InterlisProtocol.semanticSnapshotChanged,
      expect.objectContaining({ trigger: "dependency", rootUri: uri }),
    );
  });

  it("forwards rename edits without compiling until the document is saved", () => {
    const harness = contractHarness();
    bindLanguageServer(harness.connection, harness.service);
    const uri = "file:///Root.ili";
    harness.spies.rename.mockReturnValue({
      changes: {
        [uri]: [
          {
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 9 },
            },
            newText: "foo2",
          },
          {
            range: {
              start: { line: 3, character: 4 },
              end: { line: 3, character: 7 },
            },
            newText: "foo2",
          },
        ],
      },
    });

    harness.handler<(params: unknown) => void>("onDidChangeTextDocument")({
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: "TOPIC foo2 =\nEND foo2;" }],
    });
    const rename = harness.handler<
      (params: {
        textDocument: { uri: string };
        position: { line: number; character: number };
        newName: string;
      }) => unknown
    >("onRenameRequest")({
      textDocument: { uri },
      position: { line: 0, character: 7 },
      newName: "foo2",
    });

    expect(harness.spies.changeDocument).toHaveBeenCalledWith(
      uri,
      "TOPIC foo2 =\nEND foo2;",
      2,
    );
    expect(harness.spies.rename).toHaveBeenCalledWith(
      uri,
      { line: 0, character: 7 },
      "foo2",
    );
    expect(rename).toEqual({
      changes: {
        [uri]: [
          {
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 9 },
            },
            newText: "foo2",
          },
          {
            range: {
              start: { line: 3, character: 4 },
              end: { line: 3, character: 7 },
            },
            newText: "foo2",
          },
        ],
      },
    });
    expect(harness.spies.compileDocument).not.toHaveBeenCalled();
  });
});
