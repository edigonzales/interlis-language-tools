import type {
  CompilationResult,
  Diagnostic,
  SyntaxSnapshot,
} from "@ilic/compiler-wasm";
import { contextAt } from "./features.js";
import type { EditorPosition } from "./features.js";
import type { CompilationOutputEvent } from "./types.js";

export const DEFAULT_TEMPLATE_URL =
  "https://geo.so.ch/models/AGI/SO_AGI_Modellvorlage_20260324.ili";
export const DEFAULT_TEMPLATE_TIMEOUT_MS = 3_000;
export const OFFLINE_TEMPLATE = `INTERLIS 2.4;
MODEL NewModel AT "https://example.invalid/models" VERSION "1" =

END NewModel.
`;

export type SuggestionReason =
  | "none"
  | "container-body"
  | "header"
  | "extends"
  | "type-expression"
  | "metaattribute";

export interface SuggestionActivation {
  readonly open: boolean;
  readonly reason: SuggestionReason;
  readonly suppress: boolean;
}

const declarationTokens = new Set([
  "MODEL",
  "TOPIC",
  "CLASS",
  "STRUCTURE",
  "ASSOCIATION",
  "VIEW",
  "GRAPHIC",
  "DOMAIN",
  "UNIT",
]);
const modifierTokens = new Set([
  "ABSTRACT",
  "EXTENDED",
  "FINAL",
  "GENERIC",
  "LPAREN",
  "RPAREN",
]);
const typeTailTokens = new Set([
  "TEXT",
  "MTEXT",
  "NUMERIC",
  "STAR",
  "DOTDOT",
  "POSNUMBER",
  "DEC",
]);

function tokensBefore(snapshot: SyntaxSnapshot, position: EditorPosition) {
  return snapshot.tokens.filter((token) => {
    const start = token.range.start;
    return (
      start.line < position.line ||
      (start.line === position.line && start.character < position.character)
    );
  });
}

/** Parser/token based replacement for the legacy client's regular-expression triggers. */
export function suggestionActivation(
  snapshot: SyntaxSnapshot,
  position: EditorPosition,
): SuggestionActivation {
  const tokens = tokensBefore(snapshot, position);
  const last = tokens.at(-1);
  const previous = tokens.at(-2);
  if (!last) return { open: false, reason: "none", suppress: false };

  if (last.text.startsWith("!!@"))
    return { open: true, reason: "metaattribute", suppress: false };

  if (last.kind === "EQUAL") {
    const declaration = [...tokens]
      .reverse()
      .find((token) => declarationTokens.has(token.kind));
    if (declaration)
      return { open: true, reason: "container-body", suppress: false };
  }

  if (last.kind === "EXTENDS")
    return { open: true, reason: "extends", suppress: false };

  if (modifierTokens.has(last.kind))
    return { open: true, reason: "header", suppress: false };

  if (
    last.kind === "NAME" &&
    previous &&
    declarationTokens.has(previous.kind)
  ) {
    const suppress = previous.kind === "MODEL";
    return { open: !suppress, reason: "header", suppress };
  }

  const context = contextAt(snapshot, position)?.kind ?? "";
  if (
    typeTailTokens.has(last.kind) ||
    [
      "textType",
      "numericType",
      "domainDef",
      "unitDef",
      "metaAttribute",
    ].includes(context)
  )
    return { open: true, reason: "type-expression", suppress: false };

  return { open: false, reason: "none", suppress: false };
}

export type SnippetPlaceholder =
  "none" | "model-header" | "block-header" | "body";
export type SnippetKey =
  | "Enter"
  | "Tab"
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "PageUp"
  | "PageDown"
  | "Home"
  | "End";
export type SnippetAction =
  "default" | "next-placeholder" | "leave-and-move" | "suppress-suggestions";

export function snippetKeyAction(
  active: boolean,
  placeholder: SnippetPlaceholder,
  key: SnippetKey,
): SnippetAction {
  if (!active) return "default";
  if (placeholder === "model-header") {
    if (key === "Enter" || key === "Tab") return "next-placeholder";
    return "suppress-suggestions";
  }
  if (key === "Enter" || key === "Tab") return "next-placeholder";
  if (placeholder === "block-header") return "leave-and-move";
  return "default";
}

export function isBlankInterlisDocument(text: string | undefined): boolean {
  return text !== undefined && text.trim().length === 0;
}

export function resolveTemplateUrl(configured?: string): string {
  const candidate = configured?.trim() || DEFAULT_TEMPLATE_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(
      "Invalid INTERLIS template URL: expected an absolute http or https URL.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(
      "Invalid INTERLIS template URL: expected an absolute http or https URL.",
    );
  return url.toString();
}

export async function fetchTemplate(
  configuredUrl: string | undefined,
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  } = {},
): Promise<string> {
  const url = resolveTemplateUrl(configuredUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher)
    throw new Error("Template download is unavailable in this runtime.");
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TEMPLATE_TIMEOUT_MS;
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok)
      throw new Error(
        `Failed to load INTERLIS template from ${url}: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
      );
    const content = await response.text();
    if (!content.trim())
      throw new Error(
        `Failed to load INTERLIS template from ${url}: received an empty response body.`,
      );
    return content;
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason === "timeout")
      throw new Error(
        `Failed to load INTERLIS template from ${url}: request timed out after ${timeoutMs} ms.`,
      );
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

export interface OutputEntry {
  readonly timestamp: string;
  readonly channel: "compiler" | "debug";
  readonly level: "trace" | "debug" | "information" | "warning" | "error";
  readonly message: string;
}

export class OutputBuffer {
  readonly #entries: OutputEntry[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}
  append(
    channel: OutputEntry["channel"],
    level: OutputEntry["level"],
    message: string,
  ): OutputEntry {
    const entry = {
      timestamp: this.now().toISOString(),
      channel,
      level,
      message,
    };
    this.#entries.push(entry);
    return entry;
  }
  get entries(): readonly OutputEntry[] {
    return this.#entries;
  }
  clear(): void {
    this.#entries.length = 0;
  }
}

function diagnosticTranscriptLine(diagnostic: Diagnostic): string {
  const error = diagnostic.treatedAsError || diagnostic.severity === "error";
  const prefix = error
    ? "err:"
    : diagnostic.severity === "warning"
      ? "wrn:"
      : "inf:";
  const location = diagnostic.range
    ? `${diagnostic.range.uri}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}: `
    : "";
  return `${prefix}${error || diagnostic.severity === "warning" ? "    " : " "}${location}${diagnostic.message}`;
}

function completionTranscriptLine(result: CompilationResult): string {
  const errors =
    result.errorCount === 0
      ? "no errors"
      : `${result.errorCount} error${result.errorCount === 1 ? "" : "s"}`;
  const warnings =
    result.warningCount === 0
      ? "no warnings"
      : `${result.warningCount} warning${result.warningCount === 1 ? "" : "s"}`;
  return `inf: ilic completed with ${errors}, ${warnings}.`;
}

const COMPLETION_LINE_PREFIX = "inf: ilic completed with ";

function padTimestampPart(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalTimestamp(timestamp: string): string | undefined {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getFullYear()}-${padTimestampPart(date.getMonth() + 1)}-${padTimestampPart(date.getDate())} ${padTimestampPart(date.getHours())}:${padTimestampPart(date.getMinutes())}:${padTimestampPart(date.getSeconds())}`;
}

function appendCompletionTimestamp(content: string, timestamp: string): string {
  const formattedTimestamp = formatLocalTimestamp(timestamp);
  if (!formattedTimestamp) return content;

  const hasTrailingNewline = content.endsWith("\n");
  const body = hasTrailingNewline ? content.slice(0, -1) : content;
  const lines = body.split("\n");
  const lastLine = lines.at(-1);
  if (!lastLine?.startsWith(COMPLETION_LINE_PREFIX)) return content;
  lines[lines.length - 1] = `${lastLine} ${formattedTimestamp}`;
  return `${lines.join("\n")}${hasTrailingNewline ? "\n" : ""}`;
}

/** Returns the compiler-owned CLI transcript from the authoritative result. */
export function formatCompilationOutput(event: CompilationOutputEvent): string {
  const result = event.compilation;
  const lines =
    result.transcript && result.transcript.length > 0
      ? [...result.transcript]
      : [`inf: ilic ${result.compilerVersion}`, "inf:"];
  let completionIndex = lines.findIndex((line) =>
    line.startsWith(COMPLETION_LINE_PREFIX),
  );
  if (completionIndex < 0) {
    if (result.diagnostics.length > 0)
      lines.push(...result.diagnostics.map(diagnosticTranscriptLine));
    lines.push("inf:");
    completionIndex = lines.length;
    lines.push(completionTranscriptLine(result));
  } else {
    const missingDiagnostics = result.diagnostics.filter(
      (diagnostic) => !lines.some((line) => line.includes(diagnostic.message)),
    );
    lines.splice(
      completionIndex,
      0,
      ...missingDiagnostics.map(diagnosticTranscriptLine),
    );
    completionIndex += missingDiagnostics.length;
    lines[completionIndex] = completionTranscriptLine(result);
  }
  return `${lines.join("\n")}\n`;
}

/** Returns the compiler transcript formatted for user-facing output panels. */
export function formatCompilationOutputForDisplay(
  event: CompilationOutputEvent,
): string {
  return appendCompletionTimestamp(
    formatCompilationOutput(event),
    event.timestamp,
  );
}
