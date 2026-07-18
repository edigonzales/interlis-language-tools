import type {
  CompletionItem as CoreCompletionItem,
  Diagnostic as CoreDiagnostic,
  DocumentSymbol as CoreDocumentSymbol,
  Location as CoreLocation,
  RenameResult as CoreRenameResult,
  TextEdit as CoreTextEdit,
} from "@ilic/language-service";
import type { WorkspaceEdit } from "vscode-languageserver";
import {
  CompletionItemKind,
  DiagnosticSeverity,
  DocumentSymbol,
  InsertTextFormat,
  Location,
  Position,
  Range,
  SymbolKind,
  TextEdit,
} from "vscode-languageserver";

export const toPosition = (value: {
  line: number;
  character: number;
}): Position => Position.create(value.line, value.character);
export const toRange = (value: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}): Range => Range.create(toPosition(value.start), toPosition(value.end));
export const toLocation = (value: CoreLocation): Location =>
  Location.create(value.uri, toRange(value.range));
export const toTextEdit = (value: CoreTextEdit): TextEdit =>
  TextEdit.replace(toRange(value.range), value.newText);

const severity = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  information: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
} as const;

export function toDiagnostic(value: CoreDiagnostic) {
  return {
    range: value.range ? toRange(value.range) : Range.create(0, 0, 0, 1),
    severity: severity[value.severity],
    code: value.code,
    source: "ilic",
    message: value.message,
    relatedInformation: value.relatedInformation.flatMap((information) =>
      information.range
        ? [
            {
              location: Location.create(
                information.range.uri,
                toRange(information.range),
              ),
              message: information.message,
            },
          ]
        : [],
    ),
  };
}

const completionKind = {
  keyword: CompletionItemKind.Keyword,
  class: CompletionItemKind.Class,
  property: CompletionItemKind.Property,
  module: CompletionItemKind.Module,
  snippet: CompletionItemKind.Snippet,
  value: CompletionItemKind.Value,
} as const;

export function toCompletion(value: CoreCompletionItem) {
  return {
    label: value.label,
    kind: completionKind[value.kind],
    detail: value.detail,
    insertText: value.insertText,
    insertTextFormat:
      value.insertTextFormat === "snippet"
        ? InsertTextFormat.Snippet
        : InsertTextFormat.PlainText,
  };
}

const symbolKind: Readonly<Record<string, SymbolKind>> = {
  Model: SymbolKind.Module,
  Topic: SymbolKind.Namespace,
  Class: SymbolKind.Class,
  Structure: SymbolKind.Struct,
  Association: SymbolKind.Interface,
  Attribute: SymbolKind.Field,
  Domain: SymbolKind.TypeParameter,
  Unit: SymbolKind.Number,
};

export function toDocumentSymbol(value: CoreDocumentSymbol): DocumentSymbol {
  return DocumentSymbol.create(
    value.name,
    value.detail,
    symbolKind[value.kind] ?? SymbolKind.Object,
    toRange(value.range),
    toRange(value.selectionRange),
    value.children.map(toDocumentSymbol),
  );
}

export function toWorkspaceEdit(value: CoreRenameResult): WorkspaceEdit {
  return {
    changes: Object.fromEntries(
      Object.entries(value.changes).map(([uri, edits]) => [
        uri,
        edits.map(toTextEdit),
      ]),
    ),
  };
}
