import { beforeEach, describe, expect, it, vi } from "vitest";

const configurationGet = vi.fn(
  (_key: string, defaultValue: unknown): unknown => defaultValue,
);
interface ChangedDocumentEvent {
  readonly document: {
    readonly languageId: string;
    readonly uri: { toString(): string };
  };
}
const activeEditorListeners: Array<(editor: unknown) => void> = [];
const documentChangeListeners: Array<(event: ChangedDocumentEvent) => void> =
  [];
const vscodeMock = {
  window: {
    activeTextEditor: undefined as { document: unknown } | undefined,
    visibleTextEditors: [] as { document: unknown }[],
    onDidChangeActiveTextEditor: vi.fn(
      (listener: (editor: unknown) => void) => {
        activeEditorListeners.push(listener);
        return { dispose: vi.fn() };
      },
    ),
    createWebviewPanel: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: configurationGet })),
    openTextDocument: vi.fn(),
    onDidChangeTextDocument: vi.fn(
      (listener: (event: ChangedDocumentEvent) => void) => {
        documentChangeListeners.push(listener);
        return { dispose: vi.fn() };
      },
    ),
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  },
  ViewColumn: { Beside: 2 },
};

const doMock = (
  path: string,
  factory: () => unknown,
  options: { virtual: boolean },
) =>
  (
    vi.doMock as unknown as (
      path: string,
      factory: () => unknown,
      options: { virtual: boolean },
    ) => unknown
  )(path, factory, options);

class FakeDiagramController {
  state: {
    status: "empty" | "ready" | "error";
    snapshot: unknown;
    message: string;
  } = {
    status: "empty" as const,
    snapshot: null,
    message: "",
  };

  loading(): typeof this.state {
    return this.state;
  }

  stale(message = "stale"): typeof this.state {
    this.state = { ...this.state, message };
    return this.state;
  }

  publish(snapshot: unknown): typeof this.state {
    this.state = {
      status: "ready",
      snapshot,
      message: "",
    };
    return this.state;
  }

  fail(message: string): typeof this.state {
    this.state = { ...this.state, status: "error", message };
    return this.state;
  }
}

doMock("vscode", () => vscodeMock, { virtual: true });
doMock(
  "@ilic/diagram",
  () => ({
    DiagramController: FakeDiagramController,
    captureViewport: vi.fn(),
    defaultDiagramSettings: {
      edgeRouting: "POLYLINE",
      attributeMode: "OWN",
      deemphasizeAbstractTypes: true,
      showAssociationNames: true,
      showRoleCardinalities: true,
      showLocalEnumerationValues: true,
    },
    layoutAndRenderDiagram: vi.fn(() =>
      Promise.resolve({ layout: {}, svg: '<svg id="diagram"></svg>' }),
    ),
    restoreViewport: vi.fn(),
    sourceLocationForNode: vi.fn(),
  }),
  { virtual: true },
);

const { openDiagramOnStartup, registerDiagramWorkflows } =
  await import("./diagram-view.js");

type StartupDocument = NonNullable<Parameters<typeof openDiagramOnStartup>[1]>;
type DiagramUri = StartupDocument["uri"];
type ExtensionContext = Parameters<typeof registerDiagramWorkflows>[0];
type LanguageClient = Parameters<typeof registerDiagramWorkflows>[1];

interface FakeDocument {
  readonly languageId: string;
  readonly uri: { readonly path: string; toString(): string };
  getText(): string;
}

const document = (uri: string, languageId = "interlis"): FakeDocument => ({
  languageId,
  uri: { path: uri, toString: () => uri },
  getText: () => "MODEL Example; END Example.",
});

const setActiveDocument = (value: FakeDocument | undefined): void => {
  vscodeMock.window.activeTextEditor = value ? { document: value } : undefined;
  vscodeMock.window.visibleTextEditors = value ? [{ document: value }] : [];
};

const asStartupDocument = (value: FakeDocument): StartupDocument =>
  value as unknown as StartupDocument;
const asDiagramUri = (value: FakeDocument["uri"]): DiagramUri =>
  value as unknown as DiagramUri;

describe("VS Code startup diagram", () => {
  beforeEach(() => {
    configurationGet.mockImplementation(
      (_key: string, defaultValue: unknown): unknown => defaultValue,
    );
    activeEditorListeners.length = 0;
    documentChangeListeners.length = 0;
    vscodeMock.window.createWebviewPanel.mockReset();
    setActiveDocument(undefined);
  });

  it("opens the captured active INTERLIS document after startup is ready", async () => {
    const active = document("file:///Root.ili");
    setActiveDocument(active);
    const open = vi.fn(() => Promise.resolve());

    await openDiagramOnStartup(
      { open },
      asStartupDocument(active),
      Promise.resolve(),
    );

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(active.uri);
  });

  it("does not auto-open when disabled, when the editor changed, or for another language", async () => {
    const active = document("file:///Root.ili");
    const open = vi.fn(() => Promise.resolve());

    setActiveDocument(active);
    configurationGet.mockImplementation((key: string, defaultValue: unknown) =>
      key === "diagram.autoOpenBeside" ? false : defaultValue,
    );
    await openDiagramOnStartup(
      { open },
      asStartupDocument(active),
      Promise.resolve(),
    );

    configurationGet.mockImplementation(
      (_key: string, defaultValue: unknown): unknown => defaultValue,
    );
    setActiveDocument(document("file:///Other.ili"));
    await openDiagramOnStartup(
      { open },
      asStartupDocument(active),
      Promise.resolve(),
    );
    await openDiagramOnStartup(
      { open },
      asStartupDocument(document("file:///Notes.txt", "plaintext")),
      Promise.resolve(),
    );

    expect(open).not.toHaveBeenCalled();
  });

  it("waits for startup compilation and still opens after a handled compile failure", async () => {
    const active = document("file:///Root.ili");
    setActiveDocument(active);
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const open = vi.fn(() => Promise.resolve());

    const pending = openDiagramOnStartup(
      { open },
      asStartupDocument(active),
      ready,
    );
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();

    resolveReady();
    await pending;
    expect(open).toHaveBeenCalledOnce();

    open.mockClear();
    const handledFailure = Promise.reject(new Error("compile failed")).catch(
      () => undefined,
    );
    await openDiagramOnStartup(
      { open },
      asStartupDocument(active),
      handledFailure,
    );
    expect(open).toHaveBeenCalledOnce();
  });

  it("defers automatic editor-change opening until startup is ready", async () => {
    const active = document("file:///Delayed.ili");
    setActiveDocument(active);
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const panel = {
      active: true,
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
    };
    vscodeMock.window.createWebviewPanel.mockReturnValue(panel);
    const context = {
      subscriptions: [],
    } as unknown as ExtensionContext;
    const client = {
      onNotification: vi.fn(() => ({ dispose: vi.fn() })),
      sendRequest: vi.fn(() =>
        Promise.resolve({
          freshness: "fresh",
          snapshot: { success: true, diagram: { nodes: [], edges: [] } },
        }),
      ),
    } as unknown as LanguageClient;

    registerDiagramWorkflows(context, client, { startupReady: ready });
    activeEditorListeners.at(-1)?.({ document: active });
    await Promise.resolve();
    expect(vscodeMock.window.createWebviewPanel).not.toHaveBeenCalled();

    resolveReady();
    await vi.waitFor(() =>
      expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalledOnce(),
    );
  });

  it("reuses one panel when the same diagram is opened twice", async () => {
    const active = document("file:///Duplicate.ili");
    setActiveDocument(active);
    const panel = {
      active: true,
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
    };
    vscodeMock.window.createWebviewPanel.mockReturnValue(panel);
    const context = {
      subscriptions: [],
    } as unknown as ExtensionContext;
    const client = {
      onNotification: vi.fn(() => ({ dispose: vi.fn() })),
      sendRequest: vi.fn(() =>
        Promise.resolve({
          freshness: "fresh",
          snapshot: { success: true, diagram: { nodes: [], edges: [] } },
        }),
      ),
    } as unknown as LanguageClient;
    const workflows = registerDiagramWorkflows(context, client);

    await workflows.open(asDiagramUri(active.uri));
    await workflows.open(asDiagramUri(active.uri));

    expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(panel.reveal).toHaveBeenCalledWith(2, true);
  });

  it("refreshes an open diagram after a fresh semantic notification", async () => {
    const active = document("file:///Auto.ili");
    setActiveDocument(active);
    const notifications = new Map<string, (params: unknown) => void>();
    const panel = {
      active: true,
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
    };
    vscodeMock.window.createWebviewPanel.mockReturnValue(panel);
    let generation = 1;
    const sendRequest = vi.fn(() =>
      Promise.resolve({
        freshness: "fresh",
        generation,
        snapshot: {
          success: true,
          documentVersions: { "file:///Auto.ili": generation },
          diagram: { nodes: [], edges: [] },
        },
      }),
    );
    const client = {
      sendRequest,
      onNotification: vi.fn(
        (method: string, handler: (params: unknown) => void) => {
          notifications.set(method, handler);
          return { dispose: vi.fn() };
        },
      ),
    } as unknown as LanguageClient;
    const workflows = registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      client,
    );
    await workflows.open(asDiagramUri(active.uri));
    expect(sendRequest).toHaveBeenCalledTimes(1);

    generation = 2;
    notifications.get("interlis/semanticSnapshotChanged")?.({
      runId: 2,
      trigger: "save",
      rootUri: "file:///Auto.ili",
      documentVersion: 2,
      generation,
      success: true,
      freshness: "fresh",
      sourceUris: ["file:///Auto.ili"],
    });

    await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledTimes(2));
  });

  it("recompiles an open diagram when one of its saved dependencies changes", async () => {
    const active = document("file:///Dependent.ili");
    setActiveDocument(active);
    const notifications = new Map<string, (params: unknown) => void>();
    const panel = {
      active: true,
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
    };
    vscodeMock.window.createWebviewPanel.mockReturnValue(panel);
    const sendRequest = vi.fn((method: string) =>
      Promise.resolve(
        method === "interlis/diagramSnapshot"
          ? {
              freshness: "fresh",
              generation: 1,
              snapshot: {
                success: true,
                documentVersions: {
                  "file:///Dependent.ili": 1,
                  "file:///Dependency.ili": 1,
                },
                diagram: { nodes: [], edges: [] },
              },
            }
          : { success: true },
      ),
    );
    const client = {
      sendRequest,
      onNotification: vi.fn(
        (method: string, handler: (params: unknown) => void) => {
          notifications.set(method, handler);
          return { dispose: vi.fn() };
        },
      ),
    } as unknown as LanguageClient;
    const workflows = registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      client,
    );
    await workflows.open(asDiagramUri(active.uri));

    notifications.get("interlis/semanticSnapshotChanged")?.({
      runId: 2,
      trigger: "save",
      rootUri: "file:///Dependency.ili",
      documentVersion: 2,
      generation: 2,
      success: true,
      freshness: "fresh",
      sourceUris: ["file:///Dependency.ili"],
    });

    await vi.waitFor(() =>
      expect(sendRequest).toHaveBeenCalledWith("interlis/compile", {
        uri: "file:///Dependent.ili",
        trigger: "dependency",
      }),
    );
  });

  it("keeps the last rendered diagram on an invalid save", async () => {
    const active = document("file:///Invalid.ili");
    setActiveDocument(active);
    const notifications = new Map<string, (params: unknown) => void>();
    const panel = {
      active: true,
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
    };
    vscodeMock.window.createWebviewPanel.mockReturnValue(panel);
    const sendRequest = vi.fn(() =>
      Promise.resolve({
        freshness: "fresh",
        generation: 1,
        snapshot: {
          success: true,
          documentVersions: { "file:///Invalid.ili": 1 },
          diagram: { nodes: [], edges: [] },
        },
      }),
    );
    const client = {
      sendRequest,
      onNotification: vi.fn(
        (method: string, handler: (params: unknown) => void) => {
          notifications.set(method, handler);
          return { dispose: vi.fn() };
        },
      ),
    } as unknown as LanguageClient;
    const workflows = registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      client,
    );
    await workflows.open(asDiagramUri(active.uri));
    const rendered = panel.webview.html;

    notifications.get("interlis/semanticSnapshotChanged")?.({
      runId: 2,
      trigger: "save",
      rootUri: "file:///Invalid.ili",
      documentVersion: 2,
      generation: 2,
      success: false,
      freshness: "fresh",
      sourceUris: ["file:///Invalid.ili"],
    });

    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(panel.webview.html).toContain("current model contains errors");
    expect(panel.webview.html).toContain('id="diagram"');
    expect(rendered).not.toBe("");
  });

  it("deduplicates dependency compiles and stops updating a closed panel", async () => {
    const rootUri = "file:///OpenRoot.ili";
    const dependencyUri = "file:///Shared.ili";
    const active = document(rootUri);
    setActiveDocument(active);
    const notifications = new Map<string, (params: unknown) => void>();
    let disposePanel!: () => void;
    const panel = {
      active: true,
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
      onDidDispose: vi.fn((listener: () => void) => {
        disposePanel = listener;
      }),
      reveal: vi.fn(),
    };
    vscodeMock.window.createWebviewPanel.mockReturnValue(panel);
    let finishCompile!: () => void;
    const pendingCompile = new Promise((resolve) => {
      finishCompile = () => resolve({ success: true });
    });
    const sendRequest = vi.fn((method: string) =>
      method === "interlis/diagramSnapshot"
        ? Promise.resolve({
            freshness: "fresh",
            generation: 1,
            snapshot: {
              success: true,
              documentVersions: { [rootUri]: 1, [dependencyUri]: 1 },
              diagram: { nodes: [], edges: [] },
            },
          })
        : pendingCompile,
    );
    const client = {
      sendRequest,
      onNotification: vi.fn(
        (method: string, handler: (params: unknown) => void) => {
          notifications.set(method, handler);
          return { dispose: vi.fn() };
        },
      ),
    } as unknown as LanguageClient;
    const workflows = registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      client,
    );
    await workflows.open(asDiagramUri(active.uri));
    const event = {
      runId: 2,
      trigger: "save",
      rootUri: dependencyUri,
      documentVersion: 2,
      generation: 2,
      success: true,
      freshness: "fresh",
      sourceUris: [dependencyUri],
    };

    notifications.get("interlis/semanticSnapshotChanged")?.(event);
    notifications.get("interlis/semanticSnapshotChanged")?.(event);
    expect(
      sendRequest.mock.calls.filter(
        ([method]) => method === "interlis/compile",
      ),
    ).toHaveLength(1);

    disposePanel();
    notifications.get("interlis/semanticSnapshotChanged")?.({
      ...event,
      runId: 3,
      generation: 3,
    });
    expect(
      sendRequest.mock.calls.filter(
        ([method]) => method === "interlis/compile",
      ),
    ).toHaveLength(1);
    finishCompile();
    await pendingCompile;
  });

  it("does not let an older refresh overwrite a later invalidation", async () => {
    const uri = "file:///Race.ili";
    const active = document(uri);
    setActiveDocument(active);
    const notifications = new Map<string, (params: unknown) => void>();
    const panel = {
      active: true,
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
    };
    vscodeMock.window.createWebviewPanel.mockReturnValue(panel);
    let release!: (value: unknown) => void;
    const delayed = new Promise((resolve) => {
      release = resolve;
    });
    const initial = {
      freshness: "fresh",
      generation: 1,
      snapshot: {
        success: true,
        documentVersions: { [uri]: 1 },
        diagram: { nodes: [], edges: [] },
      },
    };
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(delayed);
    const client = {
      sendRequest,
      onNotification: vi.fn(
        (method: string, handler: (params: unknown) => void) => {
          notifications.set(method, handler);
          return { dispose: vi.fn() };
        },
      ),
    } as unknown as LanguageClient;
    const workflows = registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      client,
    );
    await workflows.open(asDiagramUri(active.uri));

    notifications.get("interlis/semanticSnapshotChanged")?.({
      runId: 2,
      trigger: "save",
      rootUri: uri,
      documentVersion: 2,
      generation: 2,
      success: true,
      freshness: "fresh",
      sourceUris: [uri],
    });
    notifications.get("interlis/semanticSnapshotChanged")?.({
      runId: 3,
      trigger: "save",
      rootUri: uri,
      documentVersion: 3,
      generation: 3,
      success: false,
      freshness: "fresh",
      sourceUris: [uri],
    });
    release({ ...initial, generation: 2 });
    await Promise.resolve();

    expect(panel.webview.html).toContain("current model contains errors");
  });
});
