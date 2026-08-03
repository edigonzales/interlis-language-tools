import type { EditorPosition, Location, RenameResult, TextEdit } from "../features.js";

export interface LanguageFeatureProvider {
  completion(uri: string, position: EditorPosition): Promise<unknown>;
  definition(uri: string, position: EditorPosition): readonly Location[];
  references(uri: string, position: EditorPosition, includeDeclaration?: boolean): readonly Location[];
  rename(uri: string, position: EditorPosition, newName: string): RenameResult | null;
  hover(uri: string, position: EditorPosition): unknown;
  formatting(uri: string, options?: unknown): readonly TextEdit[];
}

/** Shared public language-feature coordinator; protocol-specific adapters remain outside it. */
export class LanguageFeatureCoordinator {
  constructor(private readonly provider: LanguageFeatureProvider) {}
  completion(uri: string, position: EditorPosition): Promise<unknown> { return this.provider.completion(uri, position); }
  definition(uri: string, position: EditorPosition): readonly Location[] { return this.provider.definition(uri, position); }
  references(uri: string, position: EditorPosition, includeDeclaration = true): readonly Location[] { return this.provider.references(uri, position, includeDeclaration); }
  rename(uri: string, position: EditorPosition, newName: string): RenameResult | null { return this.provider.rename(uri, position, newName); }
  hover(uri: string, position: EditorPosition): unknown { return this.provider.hover(uri, position); }
  formatting(uri: string, options?: unknown): readonly TextEdit[] { return this.provider.formatting(uri, options); }
}
