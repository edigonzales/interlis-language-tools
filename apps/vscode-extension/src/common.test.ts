import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageClientFacade } from "./common.js";

let didOpenHandler:
  | ((document: {
      languageId: string;
      uri: { scheme: string; toString(): string };
    }) => void)
  | undefined;

const vscodeMock = {
  window: {
    activeTextEditor: undefined as unknown,
    showSaveDialog: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  workspace: {
    fs: { writeFile: vi.fn() },
    onDidOpenTextDocument: vi.fn(
      (
        handler: NonNullable<typeof didOpenHandler>,
      ): { readonly dispose: () => void } => {
        didOpenHandler = handler;
        return { dispose: vi.fn() };
      },
    ),
  },
  Uri: {
    file: vi.fn((path: string) => ({
      scheme: "file",
      path,
      toString: () => `file://${path}`,
    })),
  },
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
doMock("vscode", () => vscodeMock, { virtual: true });

const {
  compileActiveDocumentOnStartup,
  compileOpenedDocument,
  docxExportProposal,
  exportDocxFromActiveDocument,
  registerDocumentOpenCompilation,
} = await import("./common.js");

beforeEach(() => {
  vscodeMock.window.activeTextEditor = undefined;
  didOpenHandler = undefined;
  vi.clearAllMocks();
});

describe("VS Code startup compilation", () => {
  it("compiles only the active INTERLIS document with the startup trigger", async () => {
    const sendRequest = vi.fn(() => Promise.resolve({}));
    const client = { sendRequest } as unknown as LanguageClientFacade;
    const document = {
      languageId: "interlis",
      uri: { scheme: "file", toString: () => "file:///Root.ili" },
    };

    await compileActiveDocumentOnStartup(client, document);

    expect(sendRequest).toHaveBeenCalledOnce();
    expect(sendRequest).toHaveBeenCalledWith("interlis/compile", {
      uri: "file:///Root.ili",
      trigger: "startup",
    });
  });

  it("does not compile an ineligible or missing active document", async () => {
    const sendRequest = vi.fn(() => Promise.resolve({}));
    const client = { sendRequest } as unknown as LanguageClientFacade;

    await compileActiveDocumentOnStartup(client, {
      languageId: "plaintext",
      uri: { scheme: "file", toString: () => "file:///notes.txt" },
    });
    await compileActiveDocumentOnStartup(client, {
      languageId: "interlis",
      uri: { scheme: "untitled", toString: () => "untitled:Untitled-1" },
    });
    await compileActiveDocumentOnStartup(client, {
      languageId: "interlis",
      uri: {
        scheme: "interlis-repository",
        toString: () => "interlis-repository:/Units.ili",
      },
    });
    await compileActiveDocumentOnStartup(client, undefined);

    expect(sendRequest).not.toHaveBeenCalled();
  });
});

describe("VS Code open compilation", () => {
  it.each([
    ["file", "file:///Root.ili"],
    ["vscode-vfs", "vscode-vfs://github/workspace/Root.ili"],
  ])(
    "compiles an opened %s document with the open trigger",
    async (scheme, uri) => {
      const sendRequest = vi.fn(() => Promise.resolve({}));
      const client = { sendRequest } as unknown as LanguageClientFacade;

      await compileOpenedDocument(client, {
        languageId: "interlis",
        uri: { scheme, toString: () => uri },
      });

      expect(sendRequest).toHaveBeenCalledOnce();
      expect(sendRequest).toHaveBeenCalledWith("interlis/compile", {
        uri,
        trigger: "open",
      });
    },
  );

  it.each([
    ["plaintext", "file", "file:///notes.txt"],
    ["interlis", "untitled", "untitled:Untitled-1"],
    ["interlis", "interlis-repository", "interlis-repository:/Units.ili"],
  ])(
    "does not compile %s documents with the %s scheme",
    async (languageId, scheme, uri) => {
      const sendRequest = vi.fn(() => Promise.resolve({}));
      const client = { sendRequest } as unknown as LanguageClientFacade;

      await compileOpenedDocument(client, {
        languageId,
        uri: { scheme, toString: () => uri },
      });

      expect(sendRequest).not.toHaveBeenCalled();
    },
  );

  it("registers once and reports request failures only to debug output", async () => {
    const sendRequest = vi.fn(() =>
      Promise.reject(new Error("transport unavailable")),
    );
    const debug = { appendLine: vi.fn() };
    const context = { subscriptions: [] };

    registerDocumentOpenCompilation(
      context as never,
      { sendRequest } as unknown as LanguageClientFacade,
      debug,
    );
    didOpenHandler?.({
      languageId: "interlis",
      uri: { scheme: "file", toString: () => "file:///Root.ili" },
    });

    await vi.waitFor(() => expect(debug.appendLine).toHaveBeenCalledOnce());
    expect(sendRequest).toHaveBeenCalledOnce();
    expect(debug.appendLine).toHaveBeenCalledWith(
      expect.stringContaining(
        "open compilation request failed: transport unavailable",
      ),
    );
    expect(context.subscriptions).toHaveLength(1);
  });
});

describe("VS Code DOCX export", () => {
  it("proposes a neighboring DOCX and preserves the source title", () => {
    expect(
      docxExportProposal({ scheme: "file", path: "/workspace/Model.ili" }),
    ).toEqual({
      fileBased: true,
      title: "Model.ili",
      defaultPath: "/workspace/Model.docx",
    });
  });

  it("uses the Model.docx fallback for virtual documents", () => {
    expect(
      docxExportProposal({ scheme: "untitled", path: "/Untitled-1" }),
    ).toEqual({
      fileBased: false,
      title: "Model.ili",
      defaultPath: "Model.docx",
    });
  });

  it("always opens the DOCX save dialog and honors cancellation", async () => {
    const sourceUri = {
      scheme: "file",
      path: "/workspace/Model.ili",
      toString: () => "file:///workspace/Model.ili",
      with: vi.fn(({ path }: { path: string }) => ({
        scheme: "file",
        path,
        toString: () => `file://${path}`,
      })),
    };
    vscodeMock.window.activeTextEditor = {
      document: {
        languageId: "interlis",
        getText: () => "MODEL Model",
        uri: sourceUri,
      },
    };
    vscodeMock.window.showSaveDialog.mockResolvedValue(undefined);
    const sendRequest = vi.fn(() => Promise.resolve([1, 2, 3]));

    await exportDocxFromActiveDocument({
      sendRequest,
    } as unknown as LanguageClientFacade);

    const dialogOptions = vscodeMock.window.showSaveDialog.mock
      .calls[0]?.[0] as
      | {
          readonly defaultUri: {
            readonly scheme: string;
            readonly path: string;
          };
          readonly filters: Record<string, readonly string[]>;
          readonly saveLabel: string;
        }
      | undefined;
    expect(dialogOptions?.defaultUri.scheme).toBe("file");
    expect(dialogOptions?.defaultUri.path).toBe("/workspace/Model.docx");
    expect(dialogOptions?.filters).toEqual({ "Word document": ["docx"] });
    expect(dialogOptions?.saveLabel).toBe("Export INTERLIS documentation");
    expect(sendRequest).not.toHaveBeenCalled();
    expect(vscodeMock.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("writes a selected DOCX path and forwards the source title", async () => {
    const sourceUri = {
      scheme: "file",
      path: "/workspace/Model.ili",
      toString: () => "file:///workspace/Model.ili",
      with: vi.fn(({ path }: { path: string }) => ({
        scheme: "file",
        path,
        toString: () => `file://${path}`,
      })),
    };
    const target = {
      toString: () => "file:///exports/Chosen.docx",
    };
    vscodeMock.window.activeTextEditor = {
      document: {
        languageId: "interlis",
        getText: () => "MODEL Model",
        uri: sourceUri,
      },
    };
    vscodeMock.window.showSaveDialog.mockResolvedValue(target);
    const sendRequest = vi.fn(() => Promise.resolve([1, 2, 3]));

    await exportDocxFromActiveDocument({
      sendRequest,
    } as unknown as LanguageClientFacade);

    expect(sendRequest).toHaveBeenCalledWith("interlis/exportDocx", {
      uri: "file:///workspace/Model.ili",
      title: "Model.ili",
    });
    expect(vscodeMock.workspace.fs.writeFile).toHaveBeenCalledWith(
      target,
      new Uint8Array([1, 2, 3]),
    );
  });
});
