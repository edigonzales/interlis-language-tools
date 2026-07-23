import { runCompilerWorker } from "@ilic/language-service";
import type {
  CompilerWorkerRequest,
  CompilerWorkerResponse,
} from "@ilic/language-service";

const scope = self as unknown as DedicatedWorkerGlobalScope;

await runCompilerWorker({
  postMessage(message: CompilerWorkerResponse) {
    scope.postMessage(message);
  },
  onMessage(listener: (message: CompilerWorkerRequest) => void) {
    scope.addEventListener("message", (event) =>
      listener(event.data as CompilerWorkerRequest),
    );
  },
});
