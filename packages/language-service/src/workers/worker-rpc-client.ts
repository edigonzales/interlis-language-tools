import type {
  CompilerWorkerCommand,
  CompilerWorkerFactory,
  CompilerWorkerPort,
  CompilerWorkerResponse,
} from "./worker-protocol.js";

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

/** Small request/response transport with deterministic pending-request cleanup. */
export class WorkerRpcClient {
  readonly #pending = new Map<number, Pending>();
  readonly #factory: CompilerWorkerFactory;
  readonly #onAttach?: (port: CompilerWorkerPort) => void;
  readonly #onFailure?: (error: unknown) => void;
  readonly #failurePrefix: string;
  #nextId = 0;
  #port: CompilerWorkerPort | null = null;
  #subscription: { dispose(): void } | null = null;
  #errorSubscription: { dispose(): void } | null = null;
  #failures = 0;
  #unavailable = false;
  #disposed = false;

  constructor(factory: CompilerWorkerFactory, options: {
    readonly onAttach?: (port: CompilerWorkerPort) => void;
    readonly onFailure?: (error: unknown) => void;
    readonly failurePrefix?: string;
  } = {}) {
    this.#factory = factory;
    this.#onAttach = options.onAttach;
    this.#onFailure = options.onFailure;
    this.#failurePrefix = options.failurePrefix ?? "worker RPC failed";
    this.#attach();
  }

  request<T>(command: CompilerWorkerCommand): Promise<T> {
    if (this.#disposed) return Promise.reject(new Error("worker RPC client disposed"));
    if (!this.#port && !this.#attach()) return Promise.reject(new Error("worker unavailable"));
    const id = ++this.#nextId;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.#port!.postMessage({ id, ...command });
    });
  }

  notify(command: CompilerWorkerCommand): boolean {
    if (this.#disposed) return false;
    if (!this.#port && !this.#attach()) return false;
    this.#port!.postMessage({ id: ++this.#nextId, ...command });
    return true;
  }

  get attached(): boolean { return this.#port !== null; }

  restart(): boolean {
    if (this.#disposed) return false;
    this.#rejectPending("worker RPC client restarted");
    this.#detach();
    this.#failures = 0;
    this.#unavailable = false;
    return this.#attach();
  }

  pendingCount(): number { return this.#pending.size; }

  dispose(reason = "worker RPC client disposed"): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#rejectPending(reason);
    this.#detach();
  }

  #attach(): boolean {
    if (this.#disposed || this.#unavailable || this.#port) return this.#port !== null;
    try {
      const port = this.#factory();
      this.#port = port;
      this.#subscription = port.onMessage((message) => this.#settle(message));
      this.#errorSubscription = port.onError((error) => {
        this.#failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.#rejectPending(`${this.#failurePrefix}: ${message}`);
        this.#detach();
        this.#onFailure?.(error);
        if (!this.#disposed && this.#failures > 1) this.#unavailable = true;
        else if (!this.#disposed) this.#attach();
      });
      this.#onAttach?.(port);
      return true;
    } catch (error) {
      this.#unavailable = true;
      this.#onFailure?.(error);
      return false;
    }
  }

  #detach(): void {
    this.#subscription?.dispose();
    this.#errorSubscription?.dispose();
    this.#subscription = null;
    this.#errorSubscription = null;
    const port = this.#port;
    this.#port = null;
    if (port) void port.terminate();
  }

  #rejectPending(reason: string): void {
    for (const pending of this.#pending.values()) pending.reject(new Error(reason));
    this.#pending.clear();
  }

  #settle(message: CompilerWorkerResponse): void {
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(new Error(message.error));
  }
}
