import assert from "node:assert/strict";
import * as vscode from "vscode";

const extensionId = "edigonzales.interlis-language-tools";

async function waitFor<T>(
  read: () => T | Promise<T>,
  accept: (value: T) => boolean,
  label: string,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  assert.ok(accept(value), `Timed out waiting for ${label}.`);
  return value;
}

function marked(source: string): {
  readonly text: string;
  readonly position: vscode.Position;
} {
  const offset = source.indexOf("│");
  assert.ok(offset >= 0, "Missing caret marker.");
  const before = source.slice(0, offset);
  return {
    text: `${before}${source.slice(offset + 1)}`,
    position: new vscode.Position(
      before.split("\n").length - 1,
      before.length - (before.lastIndexOf("\n") + 1),
    ),
  };
}

async function setDocument(
  editor: vscode.TextEditor,
  source: string,
): Promise<void> {
  const document = marked(source);
  const end = editor.document.positionAt(editor.document.getText().length);
  assert.ok(
    await editor.edit((builder) =>
      builder.replace(
        new vscode.Range(new vscode.Position(0, 0), end),
        document.text,
      ),
    ),
  );
  editor.selection = new vscode.Selection(document.position, document.position);
}

async function completionItems(
  editor: vscode.TextEditor,
): Promise<readonly vscode.CompletionItem[]> {
  const result = await vscode.commands.executeCommand<
    vscode.CompletionList | vscode.CompletionItem[]
  >(
    "vscode.executeCompletionItemProvider",
    editor.document.uri,
    editor.selection.active,
  );
  return Array.isArray(result) ? result : (result?.items ?? []);
}

async function completion(
  editor: vscode.TextEditor,
  label: string,
): Promise<vscode.CompletionItem> {
  const items = await waitFor(
    () => completionItems(editor),
    (values) =>
      values.some((item) => {
        const itemLabel =
          typeof item.label === "string" ? item.label : item.label.label;
        return itemLabel === label;
      }),
    `completion item ${label}`,
  );
  return items.find((item) => {
    const itemLabel =
      typeof item.label === "string" ? item.label : item.label.label;
    return itemLabel === label;
  })!;
}

function completionRange(
  item: vscode.CompletionItem,
): vscode.Range | undefined {
  if (!item.range) return undefined;
  return item.range instanceof vscode.Range ? item.range : item.range.replacing;
}

async function insertCompletionSnippet(
  editor: vscode.TextEditor,
  item: vscode.CompletionItem,
): Promise<void> {
  const insertion = item.insertText;
  const label = typeof item.label === "string" ? item.label : item.label.label;
  assert.ok(
    insertion instanceof vscode.SnippetString,
    `Expected a SnippetString for ${label}.`,
  );
  assert.equal(
    await editor.insertSnippet(insertion, completionRange(item)),
    true,
  );
}

async function type(text: string): Promise<void> {
  await vscode.commands.executeCommand("type", { text });
}

async function nextPlaceholder(): Promise<void> {
  await vscode.commands.executeCommand(
    "interlisLanguageTools.snippet.nextPlaceholder",
  );
}

async function classSnippetContract(editor: vscode.TextEditor): Promise<void> {
  await setDocument(editor, "MODEL M =\n  TOPIC T =\n    │\n  END T;\nEND M.");
  await insertCompletionSnippet(
    editor,
    await completion(editor, "CLASS Name = ... END Name;"),
  );
  await type("Gebaeude");
  await nextPlaceholder();
  await type("(ABSTRACT) EXTENDS Base ");
  await nextPlaceholder();
  await type("\n");
  assert.match(
    editor.document.getText(),
    /CLASS Gebaeude \(ABSTRACT\) EXTENDS Base =\n\s*\n\s*END Gebaeude;/u,
  );
}

async function modelSnippetContract(editor: vscode.TextEditor): Promise<void> {
  await setDocument(editor, "MO│");
  await insertCompletionSnippet(
    editor,
    await completion(
      editor,
      "MODEL Name (lang) AT ... VERSION ... = ... END Name.",
    ),
  );
  await type("Buildings");
  await nextPlaceholder();
  await type("de");
  await nextPlaceholder();
  await type("https://models.example.test");
  await nextPlaceholder();
  await type("2026-07-26");
  await nextPlaceholder();
  await type("\n");
  const text = editor.document.getText();
  assert.match(text, /MODEL Buildings \(de\)/u);
  assert.match(text, /AT "https:\/\/models\.example\.test"/u);
  assert.match(text, /VERSION "2026-07-26"/u);
  assert.match(text, /END Buildings\./u);
}

async function valueSnippetContract(
  editor: vscode.TextEditor,
  keyword: "DOMAIN" | "UNIT",
  rhsLabel: string,
  rhsText: string,
): Promise<void> {
  await setDocument(editor, `MODEL M =\n  │\nEND M.`);
  await insertCompletionSnippet(
    editor,
    await completion(editor, `${keyword} Name = ...;`),
  );
  await type(keyword === "DOMAIN" ? "Code" : "Metre");
  await nextPlaceholder();
  await nextPlaceholder();
  const labels = (await completionItems(editor)).map((item) =>
    typeof item.label === "string" ? item.label : item.label.label,
  );
  assert.ok(labels.includes(rhsLabel));
  await type(rhsText);
  await nextPlaceholder();
  assert.match(
    editor.document.getText(),
    new RegExp(
      `${keyword} (?:Code|Metre) = ${rhsText.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")};`,
      "u",
    ),
  );
}

async function viewTopicSnippetContract(
  editor: vscode.TextEditor,
): Promise<void> {
  await setDocument(editor, "MODEL M =\n  TOPIC T =\n    │\n  END T;\nEND M.");
  await insertCompletionSnippet(
    editor,
    await completion(editor, "VIEW TOPIC Name = ... END Name;"),
  );
  await type("Derived");
  await nextPlaceholder();
  await nextPlaceholder();
  await type("BaseTopic");
  await nextPlaceholder();
  assert.match(editor.document.getText(), /DEPENDS ON BaseTopic/u);
  assert.match(editor.document.getText(), /END Derived;/u);
}

async function enterAutoCloseContract(
  editor: vscode.TextEditor,
): Promise<void> {
  await setDocument(
    editor,
    "MODEL M =\n  TOPIC T =\n    CLASS Parcel =│\n  END T;\nEND M.",
  );
  await type("\n");
  await waitFor(
    () => editor.document.getText(),
    (text) => /END Parcel;/u.test(text),
    "on-type CLASS block close",
  );
  assert.match(
    editor.document.getText(),
    /CLASS Parcel =\n\s+\n\s+END Parcel;/u,
  );
}

async function suggestWidgetContract(editor: vscode.TextEditor): Promise<void> {
  await setDocument(
    editor,
    "MODEL M =\n  TOPIC T =\n    ASSO│\n  END T;\nEND M.",
  );
  await vscode.commands.executeCommand("editor.action.triggerSuggest");
  await new Promise((resolve) => setTimeout(resolve, 150));
  await vscode.commands.executeCommand("acceptSelectedSuggestion");
  await waitFor(
    () => editor.document.getText(),
    (text) => text.includes("ASSOCIATION"),
    "visible suggestion acceptance",
  );
}

async function cursorLeavesHeaderSnippet(
  editor: vscode.TextEditor,
): Promise<void> {
  await setDocument(editor, "MODEL M =\n  TOPIC T =\n    │\n  END T;\nEND M.");
  await insertCompletionSnippet(
    editor,
    await completion(editor, "CLASS Name = ... END Name;"),
  );
  await type("C");
  await nextPlaceholder();
  const before = editor.selection.active.character;
  await vscode.commands.executeCommand(
    "interlisLanguageTools.snippet.cursorMove",
    { command: "cursorLeft" },
  );
  assert.equal(editor.selection.active.character, before - 1);
  const selectionBeforeJump = editor.selection.active;
  await vscode.commands.executeCommand("jumpToNextSnippetPlaceholder");
  assert.equal(editor.selection.active.isEqual(selectionBeforeJump), true);
}

export async function run(): Promise<void> {
  await vscode.workspace
    .getConfiguration("interlisLanguageTools")
    .update(
      "autoShowOutputOnStart",
      false,
      vscode.ConfigurationTarget.Workspace,
    );
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, `Extension ${extensionId} is not installed.`);
  await extension.activate();
  assert.equal(extension.isActive, true);

  const document = await vscode.workspace.openTextDocument({
    language: "interlis",
    content: "",
  });
  const editor = await vscode.window.showTextDocument(document);

  await classSnippetContract(editor);
  await modelSnippetContract(editor);
  await valueSnippetContract(editor, "DOMAIN", "TEXT", "TEXT");
  await valueSnippetContract(editor, "UNIT", "[BaseUnit]", "[INTERLIS.m]");
  await viewTopicSnippetContract(editor);
  await enterAutoCloseContract(editor);
  await suggestWidgetContract(editor);
  await cursorLeavesHeaderSnippet(editor);
}
