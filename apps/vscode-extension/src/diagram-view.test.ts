import { beforeEach, describe, expect, it, vi } from "vitest";

const configurationGet = vi.fn(
  (_key: string, defaultValue: unknown): unknown => defaultValue,
);
const activeEditorListeners: Array<(editor: unknown) => void> = [];
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
      Promise.resolve({ layout: {}, svg: "" }),
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
});
