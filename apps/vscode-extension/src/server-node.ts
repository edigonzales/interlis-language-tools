import { startNodeLanguageServer } from "@ilic/language-server/node";
import type {
  CompilerWorkerPort,
  CompilerWorkerRequest,
  CompilerWorkerResponse,
} from "@ilic/language-service";
import { Worker } from "node:worker_threads";

const compilerWorkerFactory = (): CompilerWorkerPort => {
  const worker = new Worker(
    new URL("./compiler-worker-node.js", import.meta.url),
  );
  return {
    postMessage(message: CompilerWorkerRequest) {
      worker.postMessage(message);
    },
    onMessage(listener: (message: CompilerWorkerResponse) => void) {
      worker.on("message", listener);
      return { dispose: () => worker.off("message", listener) };
    },
    onError(listener: (error: unknown) => void) {
      const onError = (error: Error) => listener(error);
      const onExit = (code: number) => {
        if (code !== 0)
          listener(new Error(`INTERLIS compiler worker exited with ${code}`));
      };
      worker.on("error", onError);
      worker.on("exit", onExit);
      return {
        dispose: () => {
          worker.off("error", onError);
          worker.off("exit", onExit);
        },
      };
    },
    terminate: () => worker.terminate(),
  };
};

await startNodeLanguageServer({ compilerWorkerFactory });
