import type { CompilationEvent, CompilationTrigger } from "../types.js";

export interface ScheduledCompilation {
  readonly rootUri: string;
  readonly trigger: CompilationTrigger;
  readonly requestedDocumentVersion: number;
  readonly requestedSourceVersion?: number;
  readonly compilationEpoch: number;
}

interface Pending extends ScheduledCompilation {
  readonly runId: number;
  readonly resolve: (event: CompilationEvent) => void;
  readonly reject: (error: unknown) => void;
}

export class CompilationScheduler {
  readonly #pending: Pending[] = [];
  readonly #latest = new Map<string, number>();
  #active = false;
  #disposed = false;
  #runId = 0;

  constructor(
    private readonly execute: (request: ScheduledCompilation, runId: number) => Promise<CompilationEvent>,
    private readonly cancelled?: (request: ScheduledCompilation, runId: number) => CompilationEvent,
  ) {}

  enqueue(request: ScheduledCompilation): Promise<CompilationEvent> {
    if (this.#disposed) return Promise.reject(new Error("compilation scheduler disposed"));
    const runId = ++this.#runId;
    this.#latest.set(request.rootUri, runId);
    return new Promise<CompilationEvent>((resolve, reject) => {
      if (request.trigger !== "manual") {
        for (let index = this.#pending.length - 1; index >= 0; index--) {
          const pending = this.#pending[index]!;
          if (pending.rootUri === request.rootUri) {
            this.#pending.splice(index, 1);
            if (this.cancelled) pending.resolve(this.cancelled(pending, pending.runId));
            else pending.reject(new Error("compilation superseded"));
          }
        }
      }
      this.#pending.push({ ...request, runId, resolve, reject });
      void this.#pump();
    });
  }

  cancelRoot(rootUri: string): void {
    this.#latest.set(rootUri, ++this.#runId);
    for (let index = this.#pending.length - 1; index >= 0; index--) if (this.#pending[index]!.rootUri === rootUri) {
      const pending = this.#pending[index]!;
      if (this.cancelled) pending.resolve(this.cancelled(pending, pending.runId));
      else pending.reject(new Error("compilation cancelled"));
      this.#pending.splice(index, 1);
    }
  }

  invalidateAll(): void { for (const root of this.#latest.keys()) this.cancelRoot(root); }

  isLatest(rootUri: string, runId: number): boolean { return this.#latest.get(rootUri) === runId; }

  async #pump(): Promise<void> {
    if (this.#active || this.#disposed) return;
    this.#active = true;
    try {
      // Let same-turn requests coalesce before the first command starts. This
      // preserves save/manual ordering without starting transport work eagerly.
      await Promise.resolve();
      while (this.#pending.length && !this.#disposed) {
        const priority: Readonly<Record<CompilationTrigger, number>> = {
          manual: 0, save: 1, diagram: 2, dependency: 3, open: 4, startup: 4,
        };
        this.#pending.sort((left, right) => priority[left.trigger] - priority[right.trigger] || left.runId - right.runId);
        const pending = this.#pending.shift()!;
        if (pending.trigger !== "manual" && this.#latest.get(pending.rootUri) !== pending.runId) {
          if (this.cancelled) pending.resolve(this.cancelled(pending, pending.runId));
          else pending.reject(new Error("compilation superseded"));
          continue;
        }
        try { pending.resolve(await this.execute(pending, pending.runId)); }
        catch (error) { pending.reject(error); }
      }
    } finally { this.#active = false; }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const pending of this.#pending.splice(0)) pending.reject(new Error("compilation scheduler disposed"));
  }
}
