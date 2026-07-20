import type {
  ModelCatalogEntry,
  ModelRepository,
  RepositorySchemaLanguage,
  ResolvedRepositoryModel,
} from "@ilic/language-service";
import type { ModelMetadata, RepositoryManager } from "@ilic/tools";

export interface ResolvedToolModel {
  readonly metadata: ModelMetadata;
  readonly uri: string;
  readonly source: string;
  readonly fromCache: boolean;
}

export type RepositoryModelMapper = (
  model: ResolvedToolModel,
  schemaLanguage: RepositorySchemaLanguage,
) => Promise<ResolvedRepositoryModel> | ResolvedRepositoryModel;

export class ToolsModelRepository implements ModelRepository {
  #catalog: readonly ModelMetadata[] | null = null;

  constructor(
    private readonly manager: RepositoryManager,
    private readonly mapModel: RepositoryModelMapper,
  ) {}

  async listModels(): Promise<readonly ModelCatalogEntry[]> {
    const catalog = (this.#catalog ??= await this.manager.listModels());
    return catalog
      .filter(
        (model) =>
          model.schemaLanguage === "ili2_3" ||
          model.schemaLanguage === "ili2_4",
      )
      .map((model) => ({
        name: model.name,
        schemaLanguage: model.schemaLanguage as RepositorySchemaLanguage,
        version: model.version,
        repository: model.repository,
        browseOnly: model.browseOnly,
      }));
  }

  async resolveModels(
    models: readonly string[],
    schemaLanguage: RepositorySchemaLanguage,
  ): Promise<readonly ResolvedRepositoryModel[]> {
    const workspace = await this.manager.resolveWorkspace(
      [...models],
      schemaLanguage,
    );
    const result: ResolvedRepositoryModel[] = [];
    for (const model of workspace.models)
      result.push(await this.mapModel(model, schemaLanguage));
    return result;
  }
}

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

export function virtualRepositoryUri(
  model: ResolvedToolModel,
  schemaLanguage: RepositorySchemaLanguage,
): string {
  const name = encodeURIComponent(model.metadata.name || "model");
  const encoded = bytesToBase64Url(new TextEncoder().encode(model.uri));
  return `interlis-repository:/${schemaLanguage}/${name}/${encoded}.ili`;
}

export const toVirtualRepositoryModel: RepositoryModelMapper = (
  model,
  schemaLanguage,
) => ({
  model: model.metadata.name,
  uri: virtualRepositoryUri(model, schemaLanguage),
  originUri: model.uri,
  source: model.source,
  schemaLanguage,
  version: model.metadata.version,
  fromCache: model.fromCache,
  readOnly: true,
});

export const DEFAULT_MODEL_REPOSITORIES = ["https://models.interlis.ch"];

export function browserRepositoryUrls(
  repositories: readonly string[],
): string[] {
  const result: string[] = [];
  const add = (value: string): void => {
    const normalized = value.replace(/\/$/u, "");
    if (!result.includes(normalized)) result.push(normalized);
  };
  for (const repository of repositories) {
    const normalized = repository.replace(/\/$/u, "");
    if (/^https?:\/\/models\.interlis\.ch$/iu.test(normalized)) {
      add("https://geo.so.ch/models/mirror/interlis.ch");
      add("https://geo.so.ch/models/mirror/geoadmin");
    } else if (/^https?:\/\/models\.geo\.admin\.ch$/iu.test(normalized)) {
      add("https://geo.so.ch/models/mirror/geoadmin");
    } else add(normalized);
  }
  return result;
}
