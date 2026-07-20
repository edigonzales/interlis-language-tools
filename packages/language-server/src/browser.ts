import {
  createWasmCompilerBackend,
  LanguageService,
} from "@ilic/language-service";
import { BrowserCache } from "@ilic/tools/browser";
import { RepositoryManager } from "@ilic/tools";
import { generateDocx } from "@ilic/docx";
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from "vscode-languageserver/browser.js";
import { bindLanguageServer } from "./server.js";
import {
  browserRepositoryUrls,
  ToolsModelRepository,
  toVirtualRepositoryModel,
} from "./model-repository.js";

export async function startBrowserLanguageServer(
  scope: DedicatedWorkerGlobalScope,
): Promise<void> {
  const connection = createConnection(
    new BrowserMessageReader(scope),
    new BrowserMessageWriter(scope),
  );
  const service = new LanguageService(await createWasmCompilerBackend(), {
    onError: (error) =>
      connection.console.error(
        error instanceof Error ? error.message : String(error),
      ),
  });
  bindLanguageServer(connection, service, {
    configureRepositories: async (repositories) => {
      const manager = new RepositoryManager({
        repositories: browserRepositoryUrls(repositories),
        cache: new BrowserCache("interlis-language-tools-repositories-v1"),
        allowStaleOnError: true,
        followSiteLinks: false,
        onWarning: (warning) =>
          connection.console.warn(`${warning.uri}: ${warning.message}`),
      });
      await service.setModelRepository(
        new ToolsModelRepository(manager, toVirtualRepositoryModel),
      );
    },
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
