import { describe, expect, it, vi } from "vitest";
import type { LanguageClientFacade } from "./common.js";

const mockVscode = vi.mock as unknown as (...args: unknown[]) => unknown;
mockVscode(
  "vscode",
  () => ({ window: { activeTextEditor: undefined } }),
  { virtual: true },
);

const { compileActiveDocumentOnStartup } = await import("./common.js");

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
});
