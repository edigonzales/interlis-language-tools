import { describe, expect, it, vi } from "vitest";
import type { LanguageService } from "@ilic/language-service";
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
  const sendDiagnostics = vi.fn(() => Promise.resolve());
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

  let analysisListener:
    | ((event: { affectedUris: readonly string[]; result: unknown }) => void)
    | undefined;
  const analysisDispose = vi.fn();
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
    diagnostics: vi.fn(() => []),
    getRepositoryDocument: vi.fn(),
  };
  const service = {
    ...spies,
    onAnalysis: vi.fn((listener: typeof analysisListener) => {
      analysisListener = listener;
      return { dispose: analysisDispose };
    }),
    completion: vi.fn(() => Promise.resolve([])),
    definition: vi.fn(() => []),
    references: vi.fn(() => []),
    prepareRename: vi.fn(() => null),
    rename: vi.fn(() => null),
    symbols: vi.fn(() => []),
    hover: vi.fn(() => null),
    formatting: vi.fn(() => []),
    onTypeEdit: vi.fn(() => null),
    compile: vi.fn(() => Promise.resolve({})),
    getSemanticSnapshot: vi.fn(() => null),
    analyzeNow: vi.fn(() => Promise.resolve({ value: null })),
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
    service,
    spies,
    analysisDispose,
    fireAnalysis: (affectedUris: readonly string[]) =>
      analysisListener?.({ affectedUris, result: null }),
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

  it("publishes post-resolution diagnostics and disposes on shutdown", () => {
    const harness = contractHarness();
    bindLanguageServer(harness.connection, harness.service);
    harness.fireAnalysis(["file:///A.ili", "file:///B.ili"]);
    expect(harness.sendDiagnostics).toHaveBeenCalledTimes(2);
    harness.handler<() => void>("onShutdown")();
    expect(harness.analysisDispose).toHaveBeenCalledOnce();
    expect(harness.spies.dispose).toHaveBeenCalledOnce();
  });
});
