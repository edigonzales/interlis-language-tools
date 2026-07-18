import { startBrowserLanguageServer } from "@ilic/language-server/browser";

await startBrowserLanguageServer(self as unknown as DedicatedWorkerGlobalScope);
