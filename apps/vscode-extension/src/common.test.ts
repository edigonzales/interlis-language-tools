import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageClientFacade } from "./common.js";

const vscodeMock = {
  window: {
    activeTextEditor: undefined as unknown,
    showSaveDialog: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  workspace: { fs: { writeFile: vi.fn() } },
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
  docxExportProposal,
  exportDocxFromActiveDocument,
} = await import("./common.js");

beforeEach(() => {
  vscodeMock.window.activeTextEditor = undefined;
  vi.clearAllMocks();
});

describe("VS Code startup compilation", () => {
  it("compiles only the active INTERLIS document with the startup trigger", async () => {
    const sendRequest = vi.fn(() => Promise.resolve({}));
    const client = { sendRequest } as unknown as LanguageClientFacade;
    const document = {
      languageId: "interlis",
      uri: { toString: () => "file:///Root.ili" },
    };

    await compileActiveDocumentOnStartup(client, document);

    expect(sendRequest).toHaveBeenCalledOnce();
    expect(sendRequest).toHaveBeenCalledWith("interlis/compile", {
      uri: "file:///Root.ili",
      trigger: "startup",
    });
  });

  it("does not compile a non-INTERLIS or missing active document", async () => {
    const sendRequest = vi.fn(() => Promise.resolve({}));
    const client = { sendRequest } as unknown as LanguageClientFacade;

    await compileActiveDocumentOnStartup(client, {
      languageId: "plaintext",
      uri: { toString: () => "file:///notes.txt" },
    });
    await compileActiveDocumentOnStartup(client, undefined);

    expect(sendRequest).not.toHaveBeenCalled();
  });

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
