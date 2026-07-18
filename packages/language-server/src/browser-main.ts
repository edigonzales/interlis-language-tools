import { startBrowserLanguageServer } from "./browser.js";

await startBrowserLanguageServer(self as unknown as DedicatedWorkerGlobalScope);
