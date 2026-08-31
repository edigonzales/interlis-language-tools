import { describe, expect, it, vi } from "vitest";
import { SourceRegistry } from "./source/source-registry.js";
import { SyntaxSnapshotStore } from "./syntax/syntax-snapshot-store.js";
import { SemanticSnapshotStore } from "./semantic/semantic-snapshot-store.js";
import { LanguageServiceEventHub } from "./events/language-service-event-hub.js";
import { WorkerLifecycleTracker } from "./workers/worker-lifecycle-tracker.js";
import { WorkerSourceMirror } from "./workers/worker-source-mirror.js";

describe("language-service architecture boundaries", () => {
  it("keeps document, workspace and repository source precedence explicit", () => {
    const registry = new SourceRegistry();
    registry.putWorkspaceSource("memory:///Model.ili", "workspace", 1);
    expect(registry.effective("memory:///Model.ili")?.text).toBe("workspace");
    registry.openDocument("memory:///Model.ili", "open", 2);
    expect(registry.effective("memory:///Model.ili")?.text).toBe("open");
    registry.closeDocument("memory:///Model.ili");
    expect(registry.effective("memory:///Model.ili")?.text).toBe("workspace");
  });

  it("invalidates versioned syntax snapshots without deciding when to parse", () => {
    const store = new SyntaxSnapshotStore();
    const value = { value: { documentVersion: 2 } as never, freshness: "fresh" as const, generation: 1, documentVersions: {} };
    store.put("memory:///Model.ili", value);
    expect(store.get("memory:///Model.ili", 2)?.freshness).toBe("fresh");
    store.invalidate("memory:///Model.ili");
    expect(store.get("memory:///Model.ili", 2)?.freshness).toBe("stale");
    expect(store.get("memory:///Model.ili", 3)).toBeNull();
  });

  it("keeps semantic current and last-good results separate", () => {
    const store = new SemanticSnapshotStore();
    const result = { value: { success: true, documentVersions: { "memory:///Model.ili": 1 } } as never, freshness: "fresh" as const, generation: 1, documentVersions: {} };
    store.accept("memory:///Model.ili", result, { saved: true, successful: true });
    expect(store.current("memory:///Model.ili")).toBe(result);
    expect(store.lastGood("memory:///Model.ili")).toBe(result);
    expect(store.saved("memory:///Model.ili")).toBe(result);
  });

  it("isolates listener mutation during event publication", () => {
    const hub = new LanguageServiceEventHub();
    const calls: string[] = [];
    const first = hub.onAnalysis(() => { calls.push("first"); first.dispose(); });
    hub.onAnalysis(() => calls.push("second"));
    hub.emitAnalysis({ result: {} as never, affectedUris: [] });
    hub.emitAnalysis({ result: {} as never, affectedUris: [] });
    expect(calls).toEqual(["first", "second", "second"]);
  });

  it("does not leave scheduler promises unresolved on disposal", async () => {
    const execute = vi.fn(() => Promise.resolve({} as never));
    const scheduler = new (await import("./compilation/compilation-scheduler.js")).CompilationScheduler(execute);
    scheduler.dispose();
    await expect(scheduler.enqueue({ rootUri: "memory:///Model.ili", trigger: "manual", requestedDocumentVersion: 1, compilationEpoch: 1 })).rejects.toThrow("disposed");
  });

  it("keeps worker replay state and lifecycle counters separate", () => {
    const mirror = new WorkerSourceMirror();
    mirror.put("file:///a.ili", "MODEL A END A.", 2);
    const lifecycle = new WorkerLifecycleTracker();
    lifecycle.replay(mirror.sourceCount(), mirror.byteCount());
    expect(mirror.entries()).toHaveLength(1);
    expect(lifecycle.snapshot()).toMatchObject({ replayBatches: 1, replayedSources: 1 });
  });
});
