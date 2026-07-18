import type { WorkspaceFileSystem } from "./workspace.js";

export interface ResolvedModel {
  readonly model: string;
  readonly uri: string;
  readonly source: Uint8Array;
  readonly cached: boolean;
}

export interface RepositoryResolver {
  resolve(
    model: string,
    directories: readonly string[],
  ): Promise<ResolvedModel | null>;
}

export class WorkspaceRepositoryResolver implements RepositoryResolver {
  readonly #decoder = new TextDecoder();

  constructor(private readonly workspace: WorkspaceFileSystem) {}

  async resolve(
    model: string,
    directories: readonly string[],
  ): Promise<ResolvedModel | null> {
    for (const directory of directories) {
      const uri = `${directory.replace(/\/$/, "")}/${model}.ili`;
      try {
        const source = await this.workspace.read(uri);
        if (this.#decoder.decode(source).trim())
          return { model, uri, source, cached: true };
      } catch {
        // Missing candidates are expected while walking repository directories.
      }
    }
    return null;
  }
}
