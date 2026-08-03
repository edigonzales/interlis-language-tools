import type { EditorSnapshot } from "@ilic/compiler-wasm";
import type { EditorAnalysisBackend, LiveAnalysisStatus, VersionedResult } from "../types.js";
import { EditorSnapshotStore } from "./editor-snapshot-store.js";

export class EditorAnalysisController {
  readonly #store = new EditorSnapshotStore();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #requests = new Map<string, number>();
  readonly #statuses = new Map<string, LiveAnalysisStatus>();
  #disposed = false;

  constructor(
    private readonly backend: EditorAnalysisBackend,
    private readonly delayMs = 250,
    private readonly timeoutMs = 1_500,
  ) {}

  schedule(uri: string, text: string, version: number): void {
    this.cancel(uri);
    this.#statuses.set(uri, "scheduled");
    const timer = setTimeout(() => { this.#timers.delete(uri); void this.analyzeNow(uri, text, version); }, this.delayMs);
    this.#timers.set(uri, timer);
  }

  async analyzeNow(uri: string, text: string, version: number): Promise<EditorSnapshot | null> {
    if (this.#disposed) return null;
    const request = (this.#requests.get(uri) ?? 0) + 1;
    this.#requests.set(uri, request);
    this.#statuses.set(uri, "running");
    try {
      this.backend.putSource(uri, text, version);
      const result = await Promise.race([
        this.backend.analyze(uri),
        new Promise<EditorSnapshot>((_, reject) => setTimeout(() => reject(new Error("editor analysis timeout")), this.timeoutMs)),
      ]);
      if (this.#requests.get(uri) !== request) return null;
      this.#store.put(uri, { value: result, freshness: "fresh", generation: 0, documentVersions: { [uri]: version } });
      this.#statuses.set(uri, "ready");
      return result;
    } catch {
      if (this.#requests.get(uri) === request) this.#statuses.set(uri, "unavailable");
      return null;
    }
  }

  snapshot(uri: string, version: number): VersionedResult<EditorSnapshot> | null { return this.#store.get(uri, version); }
  status(uri: string): LiveAnalysisStatus { return this.#statuses.get(uri) ?? "scheduled"; }
  cancel(uri: string): void {
    const timer = this.#timers.get(uri);
    if (timer) clearTimeout(timer);
    this.#timers.delete(uri);
    this.#requests.set(uri, (this.#requests.get(uri) ?? 0) + 1);
  }
  remove(uri: string): void { this.cancel(uri); this.#statuses.delete(uri); this.#store.invalidate(uri); this.backend.removeSource(uri); }
  configure(mode: "off" | "conservative"): void { if (mode === "off") for (const uri of this.#timers.keys()) this.cancel(uri); }
  dispose(): void { if (this.#disposed) return; this.#disposed = true; for (const uri of this.#timers.keys()) this.cancel(uri); this.#store.clear(); this.backend.dispose(); }
}
