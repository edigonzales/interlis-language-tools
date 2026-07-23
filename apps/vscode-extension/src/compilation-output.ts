import { formatCompilationOutput } from "@ilic/language-service";
import type { CompilationOutputEvent } from "@ilic/language-service";

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

export interface ReplaceableOutput {
  clear(): void;
  append(value: string): void;
}

export function replaceCompilationOutput(
  output: ReplaceableOutput,
  event: CompilationOutputEvent,
): void {
  const content = appendCompletionTimestamp(
    formatCompilationOutput(event),
    event.timestamp,
  );
  output.clear();
  output.append(content);
}
