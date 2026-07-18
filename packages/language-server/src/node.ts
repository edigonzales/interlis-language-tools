import {
  createWasmCompilerBackend,
  LanguageService,
} from "@ilic/language-service";
import { generateDocx } from "@ilic/docx";
import {
  createConnection,
  ProposedFeatures,
} from "vscode-languageserver/node.js";
import { bindLanguageServer } from "./server.js";

export async function startNodeLanguageServer(): Promise<void> {
  const connection = createConnection(ProposedFeatures.all);
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
