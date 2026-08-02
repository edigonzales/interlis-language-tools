import { createCompiler } from "@ilic/compiler-wasm";
import type { CompilerBackend } from "./types.js";

/** Creates a backend backed by the ilic WASM ABI in Node.js or a browser worker. */
export async function createWasmCompilerBackend(): Promise<CompilerBackend> {
  let compiler = await createCompiler();
  let session = compiler.createSession();
  const sources = new Map<
    string,
    { source: string | Uint8Array; version: number }
  >();
  return {
    capabilities: compiler.capabilities,
    putSource(uri, source, version) {
      sources.set(uri, { source, version });
      session.putSource(uri, source, version);
    },
    removeSource(uri) {
      sources.delete(uri);
      return session.removeSource(uri);
    },
    parse: (uri) => session.parse(uri),
    editorSnapshot: (uri) => session.editorSnapshot(uri),
    analyze: (request) => session.analyze(request),
    compileAndAnalyze: (request) => session.compileAndAnalyze(request),
    compile: (request) => session.compile(request),
    incrementalStats() {
      if (!session.incrementalStats)
        throw new Error("native incremental statistics API is unavailable");
      return session.incrementalStats();
    },
    incrementalTrace() {
      if (!session.incrementalTrace)
        throw new Error("native incremental trace API is unavailable");
      return session.incrementalTrace();
    },
    incrementalCacheSnapshot() {
      if (!session.incrementalCacheSnapshot)
        throw new Error("native incremental cache snapshot API is unavailable");
      return session.incrementalCacheSnapshot();
    },
    resetIncrementalStats() {
      session.resetIncrementalStats?.();
    },
    clearIncrementalCaches() {
      if (!session.clearIncrementalCaches)
        throw new Error("native incremental cache API is unavailable");
      session.clearIncrementalCaches();
    },
    format: (uri, options) => session.format(uri, options),
    async restart() {
      session.dispose();
      compiler = await createCompiler();
      session = compiler.createSession();
      for (const [uri, value] of sources)
        session.putSource(uri, value.source, value.version);
    },
    dispose() {
      session.dispose();
      sources.clear();
    },
  };
}
