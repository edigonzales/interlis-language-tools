import type { CompilationAnalysisResult } from "@ilic/compiler-wasm";

export interface CompilationRunHooks {
  readonly compile: () => Promise<CompilationAnalysisResult>;
  readonly resolveMissingModels?: (analysis: CompilationAnalysisResult) => Promise<CompilationAnalysisResult>;
  readonly isCurrent?: () => boolean;
}

/** Owns the compile → model resolution → same-session recompile workflow. */
export class CompilationRunCoordinator {
  async run(hooks: CompilationRunHooks): Promise<CompilationAnalysisResult> {
    const result = await hooks.compile();
    if (hooks.isCurrent?.() === false || result.compilation.missingModels.length === 0 || !hooks.resolveMissingModels)
      return result;
    return hooks.resolveMissingModels(result);
  }
}
