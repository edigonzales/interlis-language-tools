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
    commands: Array<{ command: string; title: string }>;
    keybindings: Array<{
      command: string;
      key: string;
      when: string;
      args?: { command?: string };
    }>;
  };
}

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
) as Manifest;

describe("VS Code extension manifest", () => {
  it("keeps the permanent identity and universal entry points", () => {
    expect(manifest.publisher).toBe("edigonzales");
    expect(manifest.main).toBe("./dist/extension-node.cjs");
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
    expect(
      manifest.contributes.configuration.properties[
        "interlisLanguageTools.diagram.rendering.target"
      ],
    ).toMatchObject({ default: "STANDARD" });
  });

  it("keeps snippet helpers internal and gives the suggest widget precedence", () => {
    const commandIds = manifest.contributes.commands.map(
      (command) => command.command,
    );
    expect(commandIds).not.toContain(
      "interlisLanguageTools.snippet.nextPlaceholder",
    );
    expect(commandIds).not.toContain(
      "interlisLanguageTools.snippet.cursorMove",
    );
    const placeholderKeys = manifest.contributes.keybindings.filter(
      (binding) =>
        binding.command === "interlisLanguageTools.snippet.nextPlaceholder",
    );
    expect(placeholderKeys.map((binding) => binding.key).sort()).toEqual([
      "enter",
      "tab",
    ]);
    for (const binding of placeholderKeys) {
      expect(binding.when).toContain("hasNextTabstop");
      expect(binding.when).toContain("!suggestWidgetVisible");
    }
    const cursorKeys = manifest.contributes.keybindings
      .filter(
        (binding) =>
          binding.command === "interlisLanguageTools.snippet.cursorMove",
      )
      .map((binding) => binding.key)
      .sort();
    expect(cursorKeys).toEqual([
      "down",
      "end",
      "home",
      "left",
      "pagedown",
      "pageup",
      "right",
      "up",
    ]);
  });
});
