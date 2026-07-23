import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Manifest {
  publisher: string;
  main: string;
  browser: string;
  icon: string;
  contributes: {
    configurationDefaults: Record<string, Record<string, unknown>>;
    configuration: { properties: Record<string, unknown> };
    languages: Array<{ id: string; extensions: string[] }>;
  };
}

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
) as Manifest;

describe("VS Code extension manifest", () => {
  it("keeps the permanent identity and universal entry points", () => {
    expect(manifest.publisher).toBe("edigonzales");
    expect(manifest.main).toContain("extension-node");
    expect(manifest.browser).toContain("extension-browser");
    expect(manifest.icon).toBe("images/ililogo.png");
    expect(manifest.contributes.languages[0]).toMatchObject({
      id: "interlis",
      extensions: [".ili"],
    });
  });

  it("scopes editor defaults to INTERLIS and implements the output setting", () => {
    expect(
      manifest.contributes.configurationDefaults["[interlis]"],
    ).toMatchObject({
      "editor.formatOnType": true,
      "editor.fontLigatures": true,
    });
    expect(manifest.contributes.configurationDefaults["[Log]"]).toMatchObject({
      "editor.wordWrap": "off",
    });
    expect(
      manifest.contributes.configuration.properties[
        "interlisLanguageTools.autoShowOutputOnStart"
      ],
    ).toBeDefined();
  });
});
