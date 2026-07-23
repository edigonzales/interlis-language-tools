import { startBrowserLanguageServer } from "@ilic/language-server/browser";
import type {
  CompilerWorkerPort,
  CompilerWorkerRequest,
  CompilerWorkerResponse,
} from "@ilic/language-service";

const compilerWorkerFactory = (): CompilerWorkerPort => {
  if (typeof Worker === "undefined")
    throw new Error("nested Web Workers are unavailable");
  const worker = new Worker(
    new URL("./compiler-worker-browser.js", import.meta.url),
    { type: "module" },
  );
  return {
    postMessage(message: CompilerWorkerRequest) {
      worker.postMessage(message);
    },
    onMessage(listener: (message: CompilerWorkerResponse) => void) {
      const onMessage = (event: MessageEvent<CompilerWorkerResponse>) =>
        listener(event.data);
      worker.addEventListener("message", onMessage);
      return {
        dispose: () => worker.removeEventListener("message", onMessage),
      };
    },
    onError(listener: (error: unknown) => void) {
      const onError = (event: ErrorEvent) =>
        listener(event.error ?? new Error(event.message));
      worker.addEventListener("error", onError);
      return { dispose: () => worker.removeEventListener("error", onError) };
    },
    terminate() {
      worker.terminate();
    },
  };
};

await startBrowserLanguageServer(
  self as unknown as DedicatedWorkerGlobalScope,
  {
    compilerWorkerFactory,
  },
);
