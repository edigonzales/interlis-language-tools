import {
  createWorkerCompilerBackend,
  createWasmCompilerBackend,
  LanguageService,
} from "@ilic/language-service";
import type {
  CompilerWorkerFactory,
  RepositorySchemaLanguage,
  ResolvedRepositoryModel,
} from "@ilic/language-service";
import { NodeFileCache } from "@ilic/tools/node";
import { RepositoryManager } from "@ilic/tools";
import { access, chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { generateDocx } from "@ilic/docx";
import {
  createConnection,
  ProposedFeatures,
} from "vscode-languageserver/node.js";
import { bindLanguageServer } from "./server.js";
import { ToolsModelRepository } from "./model-repository.js";
import type { ResolvedToolModel } from "./model-repository.js";

const safeSegment = (value: string, fallback: string): string => {
  const safe = value.replace(/[^A-Za-z0-9._-]/gu, "_");
  return safe && safe !== "." && safe !== ".." ? safe : fallback;
};

async function materializeModel(
  root: string,
  model: ResolvedToolModel,
  schemaLanguage: RepositorySchemaLanguage,
): Promise<ResolvedRepositoryModel> {
  const target = resolve(
    root,
    schemaLanguage,
    safeSegment(model.metadata.name, "model"),
    safeSegment(model.metadata.version, "unversioned"),
    safeSegment(basename(model.metadata.file), `${model.metadata.name}.ili`),
  );
  const resolvedRoot = resolve(root);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`))
    throw new Error(`Unsafe repository cache path: ${target}`);
  await mkdir(resolve(target, ".."), { recursive: true });
  let exists = true;
  try {
    await access(target);
  } catch {
    exists = false;
  }
  if (!exists) {
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, model.source, "utf8");
    try {
      await rename(temporary, target);
    } catch (error) {
      try {
        await access(target);
      } catch {
        throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
  await chmod(target, 0o444).catch(() => undefined);
  return {
    model: model.metadata.name,
    uri: pathToFileURL(target).toString(),
    originUri: model.uri,
    source: model.source,
    schemaLanguage,
    version: model.metadata.version,
    fromCache: model.fromCache,
    readOnly: true,
  };
}

export async function startNodeLanguageServer(
  options: { readonly compilerWorkerFactory?: CompilerWorkerFactory } = {},
): Promise<void> {
  const connection = createConnection(ProposedFeatures.all);
  const localCompiler = await createWasmCompilerBackend();
  const compiler = options.compilerWorkerFactory
    ? createWorkerCompilerBackend(
        localCompiler,
        options.compilerWorkerFactory,
        {
          onWarning: (message) => connection.console.warn(message),
        },
      )
    : localCompiler;
  const service = new LanguageService(compiler, {
    onError: (error) =>
      connection.console.error(
        error instanceof Error ? error.message : String(error),
      ),
  });
  bindLanguageServer(connection, service, {
    configureRepositories: async (repositories, options) => {
      const cacheRoot =
        options.repositoryCachePath ?? join(tmpdir(), "ilic-language-server");
      const manager = new RepositoryManager({
        repositories: [...repositories],
        cache: new NodeFileCache(join(cacheRoot, "repository-cache")),
        allowStaleOnError: true,
        onWarning: (warning) =>
          connection.console.warn(`${warning.uri}: ${warning.message}`),
      });
      await service.setModelRepository(
        new ToolsModelRepository(manager, (model, schema) =>
          materializeModel(join(cacheRoot, "repository-models"), model, schema),
        ),
      );
    },
    exportDocx: async (params) => {
      const result = service.getSavedSemanticSnapshot(params.uri);
      if (!result?.value)
        throw new Error(
          "No saved semantic INTERLIS snapshot is available. Save or compile the document first.",
        );
      return generateDocx(result.value);
    },
  });
  connection.listen();
}
