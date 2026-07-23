import { parentPort } from "node:worker_threads";
import { runCompilerWorker } from "@ilic/language-service";
import type {
  CompilerWorkerRequest,
  CompilerWorkerResponse,
} from "@ilic/language-service";

const port = parentPort;
if (!port) throw new Error("INTERLIS compiler worker has no parent port");

await runCompilerWorker({
  postMessage(message: CompilerWorkerResponse) {
    port.postMessage(message);
  },
  onMessage(listener: (message: CompilerWorkerRequest) => void) {
    port.on("message", listener);
  },
});
