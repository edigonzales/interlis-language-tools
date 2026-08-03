import type {
  AnalysisEvent,
  CompilationEvent,
  DiagnosticsChangedEvent,
} from "../types.js";

export interface Disposable {
  dispose(): void;
}

type Listener<T> = (event: T) => void;

export class LanguageServiceEventHub {
  readonly #analysis = new Set<Listener<AnalysisEvent>>();
  readonly #compilation = new Set<Listener<CompilationEvent>>();
  readonly #diagnostics = new Set<Listener<DiagnosticsChangedEvent>>();

  onAnalysis(listener: Listener<AnalysisEvent>): Disposable {
    this.#analysis.add(listener);
    return { dispose: () => this.#analysis.delete(listener) };
  }

  onCompilation(listener: Listener<CompilationEvent>): Disposable {
    this.#compilation.add(listener);
    return { dispose: () => this.#compilation.delete(listener) };
  }

  onDiagnostics(listener: Listener<DiagnosticsChangedEvent>): Disposable {
    this.#diagnostics.add(listener);
    return { dispose: () => this.#diagnostics.delete(listener) };
  }

  emitAnalysis(event: AnalysisEvent): void {
    for (const listener of [...this.#analysis]) listener(event);
  }

  emitCompilation(event: CompilationEvent): void {
    for (const listener of [...this.#compilation]) listener(event);
  }

  emitDiagnostics(event: DiagnosticsChangedEvent): void {
    for (const listener of [...this.#diagnostics]) listener(event);
  }

  clear(): void {
    this.#analysis.clear();
    this.#compilation.clear();
    this.#diagnostics.clear();
  }
}
