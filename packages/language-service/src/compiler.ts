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
    putSource(uri, source, version) {
      sources.set(uri, { source, version });
      session.putSource(uri, source, version);
    },
    removeSource(uri) {
      sources.delete(uri);
      return session.removeSource(uri);
    },
    parse: (uri) => session.parse(uri),
    analyze: (request) => session.analyze(request),
    compile: (request) => session.compile(request),
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
