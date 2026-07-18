import {
  createWasmCompilerBackend,
  LanguageService,
} from "@ilic/language-service";
import { generateDocx } from "@ilic/docx";
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
  bindLanguageServer(connection, service, {
    exportDocx: async (params) => {
      let result = service.getSemanticSnapshot();
      if (!result?.value) result = await service.analyzeNow(params.uri);
      if (!result?.value)
        throw new Error("No semantic INTERLIS snapshot is available");
      return generateDocx(result.value);
    },
  });
  connection.listen();
}
