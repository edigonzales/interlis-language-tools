export interface WorkerLifecycleStats {
  restarts: number;
  replayBatches: number;
  replayedSources: number;
  replayedBytes: number;
  fallbackExecutions: number;
  queueSize: number;
}

/** Keeps transport health counters independent from worker RPC implementation. */
export class WorkerLifecycleTracker {
  readonly #stats: WorkerLifecycleStats = {
    restarts: 0,
    replayBatches: 0,
    replayedSources: 0,
    replayedBytes: 0,
    fallbackExecutions: 0,
    queueSize: 0,
  };

  restart(): void { this.#stats.restarts += 1; }
  replay(sourceCount: number, bytes: number): void {
    this.#stats.replayBatches += 1;
    this.#stats.replayedSources += sourceCount;
    this.#stats.replayedBytes += bytes;
  }
  fallback(): void { this.#stats.fallbackExecutions += 1; }
  queue(size: number): void { this.#stats.queueSize = size; }
  snapshot(): WorkerLifecycleStats { return { ...this.#stats }; }
}
