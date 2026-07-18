import {
  createWasmCompilerBackend,
  LanguageService,
} from "@ilic/language-service";
import {
  createConnection,
  ProposedFeatures,
} from "vscode-languageserver/node.js";
import { bindLanguageServer } from "./server.js";

export async function startNodeLanguageServer(): Promise<void> {
  const connection = createConnection(ProposedFeatures.all);
  const service = new LanguageService(await createWasmCompilerBackend());
  bindLanguageServer(connection, service);
  connection.listen();
}
