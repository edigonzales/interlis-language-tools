import {
  createWasmCompilerBackend,
  LanguageService,
} from "@ilic/language-service";
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from "vscode-languageserver/browser.js";
import { bindLanguageServer } from "./server.js";

export async function startBrowserLanguageServer(
  scope: DedicatedWorkerGlobalScope,
): Promise<void> {
  const connection = createConnection(
    new BrowserMessageReader(scope),
    new BrowserMessageWriter(scope),
  );
  const service = new LanguageService(await createWasmCompilerBackend());
  bindLanguageServer(connection, service);
  connection.listen();
}
