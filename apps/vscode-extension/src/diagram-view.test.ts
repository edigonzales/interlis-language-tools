import { beforeEach, describe, expect, it, vi } from "vitest";

const configurationGet = vi.fn(
  (_key: string, defaultValue: unknown): unknown => defaultValue,
);
interface ChangedDocumentEvent {
  readonly document: {
    readonly languageId: string;
    readonly uri: { toString(): string };
  };
  readonly contentChanges: readonly unknown[];
}
const activeEditorListeners: Array<(editor: unknown) => void> = [];
const documentChangeListeners: Array<(event: ChangedDocumentEvent) => void> =
  [];
const configurationChangeListeners: Array<
  (event: { affectsConfiguration(section: string): boolean }) => void
> = [];
interface CustomEditorProviderMock {
  openCustomDocument(uri: unknown, context?: unknown, token?: unknown): unknown;
  saveCustomDocument(document: unknown, token?: unknown): Promise<void>;
  saveCustomDocumentAs(
    document: unknown,
    destination: unknown,
    token?: unknown,
  ): Promise<void>;
  revertCustomDocument(document: unknown, token?: unknown): Promise<void>;
  backupCustomDocument(
    document: unknown,
    context: { destination: { toString(): string } },
    token?: unknown,
  ): Promise<{ id: string; delete(): void }>;
  resolveCustomEditor(
    document: unknown,
    panel: unknown,
    token: { isCancellationRequested: boolean },
  ): Promise<void>;
}
let customEditorProvider: CustomEditorProviderMock | undefined;
const customEditorProviders: CustomEditorProviderMock[] = [];
const customEditorRegistrationOptions: unknown[] = [];
const customEditorPanels = new Map<string, unknown>();
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
    registerCustomEditorProvider: vi.fn(
      (
        _viewType: string,
        provider: CustomEditorProviderMock,
        options: unknown,
      ) => {
        customEditorProvider = provider;
        customEditorProviders.push(provider);
        customEditorRegistrationOptions.push(options);
        return { dispose: vi.fn() };
      },
    ),
    showInformationMessage: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: configurationGet })),
    openTextDocument: vi.fn((uri: FakeDocument["uri"]) =>
      Promise.resolve(
        vscodeMock.window.visibleTextEditors.find(
          (editor) =>
            (editor.document as FakeDocument).uri.toString() === uri.toString(),
        )?.document ?? document(uri.toString()),
      ),
    ),
    fs: { writeFile: vi.fn(), copy: vi.fn() },
    onDidChangeTextDocument: vi.fn(
      (listener: (event: ChangedDocumentEvent) => void) => {
        documentChangeListeners.push(listener);
        return { dispose: vi.fn() };
      },
    ),
    onDidChangeConfiguration: vi.fn(
      (
        listener: (event: {
          affectsConfiguration(section: string): boolean;
        }) => void,
      ) => {
        configurationChangeListeners.push(listener);
        return { dispose: vi.fn() };
      },
    ),
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    executeCommand: vi.fn(
      async (command: string, uri?: FakeDocument["uri"], viewType?: string) => {
        if (
          command !== "vscode.openWith" ||
          viewType !== "interlisLanguageTools.diagramEditor" ||
          !uri ||
          !customEditorProvider
        )
          return undefined;
        const key = uri.toString();
        if (customEditorPanels.has(key)) return undefined;
        const source = vscodeMock.window.visibleTextEditors.find(
          (editor) => (editor.document as FakeDocument).uri.toString() === key,
        )?.document;
        if (!source) return undefined;
        const panel = vscodeMock.window.createWebviewPanel() as unknown;
        customEditorPanels.set(key, panel);
        const customDocument = customEditorProvider.openCustomDocument(
          uri,
          { backupId: undefined, untitledDocumentData: undefined },
          { isCancellationRequested: false },
        );
        await customEditorProvider.resolveCustomEditor(customDocument, panel, {
          isCancellationRequested: false,
        });
        return undefined;
      },
    ),
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

const restoreViewportMock = vi.fn();
const captureViewportMock = vi.fn();
const renderSvgViewportMock = vi.fn(() => '<svg id="visible"></svg>');
const layoutAndRenderMock = vi.fn(
  (_projection?: unknown, _settings?: unknown) => {
    void _projection;
    void _settings;
    return Promise.resolve({
      layout: {},
      svg: '<svg id="diagram"></svg>',
    });
  },
);

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
      message: "Diagram is up to date.",
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
    captureViewport: captureViewportMock,
    defaultDiagramSettings: {
      nodePlacement: "BRANDES_KOEPF",
      edgeRouting: "ORTHOGONAL",
      renderingTarget: "STANDARD",
      edgeCrossingStyle: "GAPS",
      attributeMode: "OWN",
      deemphasizeAbstractTypes: true,
      showAssociationNames: true,
      showRoleCardinalities: true,
      showLocalEnumerationValues: true,
    },
    layoutAndRenderDiagram: layoutAndRenderMock,
    renderSvgViewport: renderSvgViewportMock,
    restoreViewport: restoreViewportMock,
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
  readonly isDirty: boolean;
  readonly uri: {
    readonly path: string;
    toString(): string;
    with(change: { path: string }): FakeDocument["uri"];
  };
  getText(): string;
}

const document = (
  uri: string,
  languageId = "interlis",
  isDirty = false,
): FakeDocument => ({
  languageId,
  isDirty,
  uri: {
    path: uri,
    toString: () => uri,
    with(change) {
      return {
        ...this,
        path: change.path,
        toString: () => change.path,
      };
    },
  },
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
const customOpenContext = {
  backupId: undefined,
  untitledDocumentData: undefined,
};
const cancellationToken = { isCancellationRequested: false };
const testPanel = (): {
  active: boolean;
  webview: {
    html: string;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
  };
  onDidDispose: ReturnType<typeof vi.fn>;
  onDidChangeViewState: ReturnType<typeof vi.fn>;
} => ({
  active: true,
  webview: {
    html: "",
    onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
  },
  onDidDispose: vi.fn(),
  onDidChangeViewState: vi.fn(),
});

const snapshotResult = (uri: string, generation = 1) => ({
  freshness: "fresh" as const,
  generation,
  snapshot: {
    success: true as const,
    documentVersions: { [uri]: generation },
    diagram: { nodes: [], edges: [] },
  },
});

describe("VS Code startup diagram", () => {
  beforeEach(() => {
    configurationGet.mockImplementation(
      (_key: string, defaultValue: unknown): unknown => defaultValue,
    );
    activeEditorListeners.length = 0;
    documentChangeListeners.length = 0;
    configurationChangeListeners.length = 0;
    customEditorProvider = undefined;
    customEditorProviders.length = 0;
    customEditorRegistrationOptions.length = 0;
    customEditorPanels.clear();
    captureViewportMock.mockReset();
    restoreViewportMock.mockReset();
    renderSvgViewportMock.mockClear();
    layoutAndRenderMock.mockClear();
    vscodeMock.window.showSaveDialog.mockReset();
    vscodeMock.workspace.fs.writeFile.mockReset();
    vscodeMock.workspace.fs.copy.mockReset();
    vscodeMock.window.createWebviewPanel.mockReset();
    vscodeMock.window.registerCustomEditorProvider.mockClear();
    vscodeMock.commands.executeCommand.mockClear();
    setActiveDocument(undefined);
  });

  it("implements the read-only CustomDocument lifecycle", async () => {
    const source = document("file:///Lifecycle.ili");
    setActiveDocument(source);
    const client = {
      onNotification: vi.fn(() => ({ dispose: vi.fn() })),
      sendRequest: vi.fn(() =>
        Promise.resolve(snapshotResult(source.uri.toString())),
      ),
    } as unknown as LanguageClient;

    registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      client,
    );

    const provider = customEditorProviders.at(-1);
    expect(provider).toBeDefined();
    expect(customEditorRegistrationOptions.at(-1)).toMatchObject({
      supportsMultipleEditorsPerDocument: true,
    });

    const customDocument = provider?.openCustomDocument(
      source.uri,
      customOpenContext,
      cancellationToken,
    ) as { uri: FakeDocument["uri"]; dispose(): void };
    expect(
      provider?.openCustomDocument(
        source.uri,
        customOpenContext,
        cancellationToken,
      ),
    ).toBe(customDocument);

    const destination = { toString: () => "file:///Lifecycle-copy.ili" };
    await provider?.saveCustomDocument(customDocument, cancellationToken);
    await provider?.revertCustomDocument(customDocument, cancellationToken);
    await provider?.saveCustomDocumentAs(
      customDocument,
      destination,
      cancellationToken,
    );
    const backup = await provider?.backupCustomDocument(customDocument, {
      destination,
    });

    expect(vscodeMock.workspace.fs.copy).toHaveBeenCalledWith(
      source.uri,
      destination,
      { overwrite: true },
    );
    expect(backup?.id).toBe("file:///Lifecycle-copy.ili");
    expect(() => backup?.delete()).not.toThrow();

    const panel = testPanel();
    await provider?.resolveCustomEditor(
      customDocument,
      panel,
      cancellationToken,
    );
    expect(panel.webview.html).toContain('id="diagram"');

    customDocument.dispose();
    expect(
      provider?.openCustomDocument(
        source.uri,
        customOpenContext,
        cancellationToken,
      ),
    ).not.toBe(customDocument);
  });

  it("rehydrates two independent window workflows and updates both on saves", async () => {
    const source = document("file:///CrossWindow.ili");
    const uri = source.uri.toString();
    setActiveDocument(source);

    const workflow = () => {
      const notifications = new Map<string, (params: unknown) => void>();
      let generation = 1;
      const sendRequest = vi.fn((method: string) =>
        Promise.resolve(
          method === "interlis/diagramSnapshot"
            ? snapshotResult(uri, generation)
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
      registerDiagramWorkflows(
        { subscriptions: [] } as unknown as ExtensionContext,
        client,
      );
      return {
        client,
        notifications,
        sendRequest,
        setGeneration(value: number): void {
          generation = value;
        },
      };
    };

    const first = workflow();
    const providerA = customEditorProviders.at(-1);
    const documentA = providerA?.openCustomDocument(
      source.uri,
      customOpenContext,
      cancellationToken,
    );
    const panelA = testPanel();
    await providerA?.resolveCustomEditor(documentA, panelA, cancellationToken);

    const second = workflow();
    const providerB = customEditorProviders.at(-1);
    const documentB = providerB?.openCustomDocument(
      source.uri,
      customOpenContext,
      cancellationToken,
    );
    const panelB = testPanel();
    await providerB?.resolveCustomEditor(documentB, panelB, cancellationToken);

    expect(documentB).not.toBe(documentA);
    expect(first.sendRequest).toHaveBeenCalledWith("interlis/diagramSnapshot", {
      uri,
    });
    expect(second.sendRequest).toHaveBeenCalledWith(
      "interlis/diagramSnapshot",
      { uri },
    );
    expect(panelA.webview.html).toContain('id="diagram"');
    expect(panelB.webview.html).toContain('id="diagram"');
    expect(panelA.onDidChangeViewState).toHaveBeenCalledOnce();
    expect(panelB.onDidChangeViewState).toHaveBeenCalledOnce();

    const saved = {
      runId: 2,
      trigger: "save",
      rootUri: uri,
      documentVersion: 2,
      generation: 2,
      success: true,
      freshness: "fresh",
      sourceUris: [uri],
    };
    first.setGeneration(2);
    second.setGeneration(2);
    first.notifications.get("interlis/semanticSnapshotChanged")?.(saved);
    second.notifications.get("interlis/semanticSnapshotChanged")?.(saved);
    await vi.waitFor(() => {
      expect(first.sendRequest).toHaveBeenCalledTimes(2);
      expect(second.sendRequest).toHaveBeenCalledTimes(2);
    });

    const invalid = { ...saved, runId: 3, generation: 3, success: false };
    first.notifications.get("interlis/semanticSnapshotChanged")?.(invalid);
    second.notifications.get("interlis/semanticSnapshotChanged")?.(invalid);
    expect(panelA.webview.html).toContain('id="diagram"');
    expect(panelB.webview.html).toContain('id="diagram"');
    expect(panelA.webview.html).toContain("current model contains errors");
    expect(panelB.webview.html).toContain("current model contains errors");
  });

  it("updates all same-URI panels while preserving each panel viewport", async () => {
    const source = document("file:///MultiplePanels.ili");
    const uri = source.uri.toString();
    setActiveDocument(source);
    const notifications = new Map<string, (params: unknown) => void>();
    let generation = 1;
    const sendRequest = vi.fn((method: string) =>
      Promise.resolve(
        method === "interlis/diagramSnapshot"
          ? snapshotResult(uri, generation)
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
    const providerContext = {
      subscriptions: [],
    } as unknown as ExtensionContext;
    registerDiagramWorkflows(providerContext, client);
    const provider = customEditorProviders.at(-1);
    const customDocument = provider?.openCustomDocument(
      source.uri,
      customOpenContext,
      cancellationToken,
    );
    const panelA = testPanel();
    const panelB = testPanel();
    await provider?.resolveCustomEditor(
      customDocument,
      panelA,
      cancellationToken,
    );
    await provider?.resolveCustomEditor(
      customDocument,
      panelB,
      cancellationToken,
    );

    captureViewportMock
      .mockReturnValueOnce({
        anchorId: "panel-a",
        zoom: 1.5,
        offsetX: 10,
        offsetY: 20,
      })
      .mockReturnValueOnce({
        anchorId: "panel-b",
        zoom: 2,
        offsetX: 30,
        offsetY: 40,
      });
    restoreViewportMock.mockImplementation(
      (
        _layout: unknown,
        saved: { zoom: number; offsetX: number; offsetY: number },
        size: { width: number; height: number },
      ) => ({
        zoom: saved.zoom,
        scrollX: saved.offsetX,
        scrollY: saved.offsetY,
        width: size.width,
        height: size.height,
      }),
    );
    const viewportA = {
      zoom: 1.5,
      scrollX: 10,
      scrollY: 20,
      width: 800,
      height: 600,
    };
    const viewportB = {
      zoom: 2,
      scrollX: 30,
      scrollY: 40,
      width: 900,
      height: 700,
    };
    const receiveA = panelA.webview.onDidReceiveMessage.mock
      .calls[0]?.[0] as (message: { type?: string; value?: unknown }) => void;
    const receiveB = panelB.webview.onDidReceiveMessage.mock
      .calls[0]?.[0] as (message: { type?: string; value?: unknown }) => void;
    receiveA({ type: "viewport", value: viewportA });
    receiveB({ type: "viewport", value: viewportB });

    expect(captureViewportMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      viewportA,
    );
    expect(captureViewportMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      viewportB,
    );

    generation = 2;
    notifications.get("interlis/semanticSnapshotChanged")?.({
      runId: 2,
      trigger: "save",
      rootUri: uri,
      documentVersion: 2,
      generation,
      success: true,
      freshness: "fresh",
      sourceUris: [uri],
    });
    await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledTimes(4));

    expect(panelA.webview.html).toContain('id="diagram"');
    expect(panelB.webview.html).toContain('id="diagram"');
    expect(panelA.webview.html).toContain("initialScrollX=10");
    expect(panelB.webview.html).toContain("initialScrollX=30");
    expect(restoreViewportMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ anchorId: "panel-a" }),
      expect.anything(),
    );
    expect(restoreViewportMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ anchorId: "panel-b" }),
      expect.anything(),
    );
    expect(panelA.onDidChangeViewState).toHaveBeenCalledOnce();
    expect(panelB.onDidChangeViewState).toHaveBeenCalledOnce();
  });

  it("ignores metadata-only document changes while isolating real edits", async () => {
    const first = document("file:///First.ili");
    const second = document("file:///Second.ili");
    vscodeMock.window.activeTextEditor = { document: first };
    vscodeMock.window.visibleTextEditors = [
      { document: first },
      { document: second },
    ];
    const panelA = testPanel();
    const panelB = testPanel();
    vscodeMock.window.createWebviewPanel
      .mockReturnValueOnce(panelA)
      .mockReturnValueOnce(panelB);
    const sendRequest = vi.fn((_method: string, params: { uri: string }) =>
      Promise.resolve(snapshotResult(params.uri)),
    );
    const workflows = registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      {
        sendRequest,
        onNotification: vi.fn(() => ({ dispose: vi.fn() })),
      } as unknown as LanguageClient,
    );

    await workflows.open(asDiagramUri(first.uri));
    await workflows.open(asDiagramUri(second.uri));
    expect(panelA.webview.html).toContain("Diagram is up to date.");
    expect(panelB.webview.html).toContain("Diagram is up to date.");

    activeEditorListeners.at(-1)?.(undefined);
    activeEditorListeners.at(-1)?.({ document: first });
    await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledTimes(3));
    documentChangeListeners.at(-1)?.({
      document: first,
      contentChanges: [],
    });

    expect(panelA.webview.html).toContain("Diagram is up to date.");
    expect(panelB.webview.html).toContain("Diagram is up to date.");

    documentChangeListeners.at(-1)?.({
      document: first,
      contentChanges: [{ text: "MODEL FirstChanged; END FirstChanged." }],
    });

    expect(panelA.webview.html).toContain(
      "Showing the last valid diagram; save to update it.",
    );
    expect(panelB.webview.html).toContain("Diagram is up to date.");
  });

  it("does not let a disposed window request overwrite a rehydrated panel", async () => {
    const source = document("file:///Moved.ili");
    const uri = source.uri.toString();
    setActiveDocument(source);
    let releaseFirst!: (value: unknown) => void;
    const pendingFirst = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const sendRequestA = vi.fn(() => pendingFirst);
    const clientA = {
      sendRequest: sendRequestA,
      onNotification: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as LanguageClient;
    registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      clientA,
    );
    const providerA = customEditorProviders.at(-1);
    const documentA = providerA?.openCustomDocument(
      source.uri,
      customOpenContext,
      cancellationToken,
    );
    const panelA = testPanel();
    const resolvingA = providerA?.resolveCustomEditor(
      documentA,
      panelA,
      cancellationToken,
    );
    await vi.waitFor(() => expect(sendRequestA).toHaveBeenCalledOnce());

    const clientB = {
      sendRequest: vi.fn(() => Promise.resolve(snapshotResult(uri, 2))),
      onNotification: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as LanguageClient;
    registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      clientB,
    );
    const providerB = customEditorProviders.at(-1);
    const documentB = providerB?.openCustomDocument(
      source.uri,
      customOpenContext,
      cancellationToken,
    );
    const panelB = testPanel();
    await providerB?.resolveCustomEditor(documentB, panelB, cancellationToken);
    expect(panelB.webview.html).toContain('id="diagram"');

    const disposeA = panelA.onDidDispose.mock.calls[0]?.[0] as () => void;
    disposeA();
    releaseFirst(snapshotResult(uri, 1));
    await resolvingA;

    expect(panelB.webview.html).toContain('id="diagram"');
    expect(panelB.webview.html).not.toContain("No semantic snapshot");
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
    expect(vscodeMock.commands.executeCommand).toHaveBeenCalledTimes(2);
    expect(vscodeMock.commands.executeCommand).toHaveBeenLastCalledWith(
      "vscode.openWith",
      active.uri,
      "interlisLanguageTools.diagramEditor",
      expect.objectContaining({
        viewColumn: 2,
        preserveFocus: true,
        preview: false,
      }),
    );
  });

  it("compiles a missing saved diagram snapshot once and retries it", async () => {
    const uri = "file:///Lazy.ili";
    const active = document(uri);
    setActiveDocument(active);
    let receiveMessage:
      ((message: { type?: string; value?: unknown }) => void) | undefined;
    const panel = {
      active: true,
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(
          (handler: (message: { type?: string; value?: unknown }) => void) => {
            receiveMessage = handler;
            return { dispose: vi.fn() };
          },
        ),
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
    };
    vscodeMock.window.createWebviewPanel.mockReturnValue(panel);
    let compiled = false;
    let finishCompile!: () => void;
    const compile = new Promise<void>((resolve) => {
      finishCompile = () => {
        compiled = true;
        resolve();
      };
    });
    const sendRequest = vi.fn((method: string) => {
      if (method === "interlis/compile")
        return compile.then(() => ({ success: true }));
      return Promise.resolve(
        compiled
          ? {
              freshness: "fresh",
              generation: 1,
              snapshot: {
                success: true,
                documentVersions: { [uri]: 1 },
                diagram: { nodes: [], edges: [] },
              },
            }
          : null,
      );
    });
    const client = {
      sendRequest,
      onNotification: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as LanguageClient;
    const workflows = registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      client,
    );

    const opening = workflows.open(asDiagramUri(active.uri));
    await vi.waitFor(() =>
      expect(sendRequest).toHaveBeenCalledWith("interlis/compile", {
        uri,
        trigger: "diagram",
      }),
    );
    receiveMessage?.({ type: "refresh" });
    await Promise.resolve();
    expect(
      sendRequest.mock.calls.filter(
        ([method]) => method === "interlis/compile",
      ),
    ).toHaveLength(1);

    finishCompile();
    await opening;
    await vi.waitFor(() => expect(panel.webview.html).toContain("diagram"));
    expect(
      sendRequest.mock.calls.filter(
        ([method]) => method === "interlis/diagramSnapshot",
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("does not compile a dirty document without a saved snapshot", async () => {
    const active = document("file:///Dirty.ili", "interlis", true);
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
    const sendRequest = vi.fn(() => Promise.resolve(null));
    const workflows = registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      {
        sendRequest,
        onNotification: vi.fn(() => ({ dispose: vi.fn() })),
      } as unknown as LanguageClient,
    );

    await workflows.open(asDiagramUri(active.uri));

    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(panel.webview.html).toContain(
      "Save the INTERLIS file to create its diagram.",
    );
  });

  it("relayouts open diagrams when diagram settings change", async () => {
    const active = document("file:///Settings.ili");
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
    const sendRequest = vi.fn(() =>
      Promise.resolve({
        freshness: "fresh",
        generation: 1,
        snapshot: {
          success: true,
          documentVersions: { "file:///Settings.ili": 1 },
          diagram: { nodes: [], edges: [] },
        },
      }),
    );
    const workflows = registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      {
        sendRequest,
        onNotification: vi.fn(() => ({ dispose: vi.fn() })),
      } as unknown as LanguageClient,
    );
    await workflows.open(asDiagramUri(active.uri));

    configurationGet.mockImplementation((key: string, defaultValue: unknown) =>
      key === "diagram.rendering.target" ? "INKSCAPE" : defaultValue,
    );
    configurationChangeListeners.at(-1)?.({
      affectsConfiguration: (section) =>
        section === "interlisLanguageTools.diagram",
    });

    await vi.waitFor(() =>
      expect(layoutAndRenderMock).toHaveBeenCalledTimes(2),
    );
    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(layoutAndRenderMock.mock.calls.at(-1)?.[1]).toMatchObject({
      renderingTarget: "INKSCAPE",
    });
  });

  it("restores the saved zoom and position when the diagram is refreshed", async () => {
    const active = document("file:///Zoom.ili");
    setActiveDocument(active);
    let receiveMessage:
      ((message: { type?: string; value?: unknown }) => void) | undefined;
    let semanticChanged: ((params: unknown) => void) | undefined;
    const panel = {
      active: true,
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(
          (handler: (message: { type?: string; value?: unknown }) => void) => {
            receiveMessage = handler;
            return { dispose: vi.fn() };
          },
        ),
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
          documentVersions: { "file:///Zoom.ili": 1 },
          diagram: { nodes: [], edges: [] },
        },
      }),
    );
    const client = {
      sendRequest,
      onNotification: vi.fn(
        (_method: string, handler: (params: unknown) => void) => {
          semanticChanged = handler;
          return { dispose: vi.fn() };
        },
      ),
    } as unknown as LanguageClient;
    const workflows = registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      client,
    );

    restoreViewportMock.mockReturnValue({
      zoom: 2,
      scrollX: 10,
      scrollY: 20,
      width: 900,
      height: 700,
    });
    captureViewportMock.mockReturnValue({
      anchorId: null,
      zoom: 2,
      offsetX: 0,
      offsetY: 0,
    });
    await workflows.open(asDiagramUri(active.uri));
    receiveMessage?.({
      type: "viewport",
      value: {
        zoom: 2,
        scrollX: 10,
        scrollY: 20,
        width: 900,
        height: 700,
      },
    });
    semanticChanged?.({
      runId: 2,
      trigger: "save",
      rootUri: "file:///Zoom.ili",
      documentVersion: 2,
      generation: 2,
      success: true,
      freshness: "fresh",
      sourceUris: ["file:///Zoom.ili"],
    });

    await vi.waitFor(() => {
      expect(panel.webview.html).toContain("initialScrollX=10");
      expect(panel.webview.html).toContain("initialScrollY=20");
      expect(panel.webview.html).toContain("Math.max(MIN_ZOOM,2)");
    });
  });

  it("exports the complete diagram and the current visible viewport as SVG", async () => {
    const active = document("file:///Export.ili");
    setActiveDocument(active);
    let receiveMessage:
      ((message: { type?: string; value?: unknown }) => void) | undefined;
    const panel = {
      active: true,
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(
          (handler: (message: { type?: string; value?: unknown }) => void) => {
            receiveMessage = handler;
            return { dispose: vi.fn() };
          },
        ),
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
    };
    vscodeMock.window.createWebviewPanel.mockReturnValue(panel);
    const target = { toString: () => "file:///export.svg" };
    vscodeMock.window.showSaveDialog.mockResolvedValue(target);
    const client = {
      onNotification: vi.fn(() => ({ dispose: vi.fn() })),
      sendRequest: vi.fn(() =>
        Promise.resolve({
          freshness: "fresh",
          generation: 1,
          snapshot: {
            success: true,
            documentVersions: { "file:///Export.ili": 1 },
            diagram: { nodes: [], edges: [] },
          },
        }),
      ),
    } as unknown as LanguageClient;
    const workflows = registerDiagramWorkflows(
      { subscriptions: [] } as unknown as ExtensionContext,
      client,
    );
    await workflows.open(asDiagramUri(active.uri));

    receiveMessage?.({ type: "exportFull" });
    await vi.waitFor(() =>
      expect(vscodeMock.workspace.fs.writeFile).toHaveBeenCalledTimes(1),
    );
    expect(renderSvgViewportMock).not.toHaveBeenCalled();
    expect(
      new TextDecoder().decode(
        vscodeMock.workspace.fs.writeFile.mock.calls[0]?.[1] as Uint8Array,
      ),
    ).toBe('<svg id="diagram"></svg>');

    const viewport = {
      zoom: 2,
      scrollX: 10,
      scrollY: 20,
      width: 800,
      height: 600,
    };
    receiveMessage?.({ type: "exportVisible", value: viewport });
    await vi.waitFor(() =>
      expect(vscodeMock.workspace.fs.writeFile).toHaveBeenCalledTimes(2),
    );
    expect(renderSvgViewportMock).toHaveBeenLastCalledWith(
      '<svg id="diagram"></svg>',
      viewport,
    );
    expect(
      new TextDecoder().decode(
        vscodeMock.workspace.fs.writeFile.mock.calls[1]?.[1] as Uint8Array,
      ),
    ).toBe('<svg id="visible"></svg>');
    expect(panel.webview.html).toContain("export-visible");
    expect(panel.webview.html).toContain(
      "Math.min((viewport.clientWidth-padding)/baseWidth",
    );
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
    expect(rendered).toContain("MIN_ZOOM=0.25");
    expect(rendered).toContain("event.button!==1");
    expect(rendered).toContain(
      "scrollX:(viewport.scrollLeft-diagramOffsetX)/zoom",
    );
    expect(rendered).toContain("diagram.style.left=diagramOffsetX+'px'");
    expect(rendered).toContain(
      "viewport.scrollLeft=0;viewport.scrollTop=0;sendViewport()",
    );
    expect(rendered).toContain("event.preventDefault()");
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
