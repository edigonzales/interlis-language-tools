import { formatCompilationOutput } from "@ilic/language-service";
import type { CompilationOutputEvent } from "@ilic/language-service";

export interface ReplaceableOutput {
  clear(): void;
  append(value: string): void;
}

export function replaceCompilationOutput(
  output: ReplaceableOutput,
  event: CompilationOutputEvent,
): void {
  const content = formatCompilationOutput(event);
  output.clear();
  output.append(content);
}
