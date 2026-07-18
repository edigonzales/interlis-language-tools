import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { SemanticSnapshot } from "@ilic/language-service";
import { MemoryWorkspaceFileSystem } from "@ilic/language-service";
import {
  generateDocx,
  siblingDocxUri,
  writeDocxBesideSource,
} from "./index.js";

const snapshot: SemanticSnapshot = {
  schemaVersion: 1,
  abiVersion: 1,
  compilerVersion: "test",
  kind: "semantic",
  success: true,
  cancelled: false,
  roots: ["memory:/Model.ili"],
  documentVersions: { "memory:/Model.ili": 1 },
  symbols: [
    {
      id: "model",
      name: "Model",
      qualifiedName: "Model",
      kind: "Model",
      containerId: "",
      range: null,
      abstract: false,
    },
  ],
  references: [],
  dependencies: [],
  diagram: { nodes: [], edges: [] },
  documentation: {
    title: "Model documentation",
    sections: [
      {
        id: "model",
        title: "Model",
        kind: "Model",
        text: "Description",
        level: 1,
      },
    ],
  },
  diagnostics: [
    {
      severity: "warning",
      code: "W",
      message: "Example warning",
      range: null,
      relatedInformation: [],
      notes: [],
      treatedAsError: false,
    },
  ],
  logs: [],
};

describe("DOCX generation", () => {
  it("creates a valid OOXML package with semantic documentation", async () => {
    const data = await generateDocx(snapshot, { includeDiagnostics: true });
    expect([...data.slice(0, 2)]).toEqual([0x50, 0x4b]);
    const files = unzipSync(data);
    const documentXml = strFromU8(files["word/document.xml"]!);
    expect(documentXml).toContain("Model documentation");
    expect(documentXml).toContain("Model elements");
    expect(documentXml).toContain("Example warning");
  });

  it("writes beside a source through the shared binary workspace API", async () => {
    const workspace = new MemoryWorkspaceFileSystem();
    const target = await writeDocxBesideSource(
      workspace,
      "memory:/Model.ili",
      snapshot,
    );
    expect(target).toBe("memory:/Model.docx");
    expect((await workspace.read(target))[0]).toBe(0x50);
    expect(siblingDocxUri("memory:/NoExtension")).toBe(
      "memory:/NoExtension.docx",
    );
  });
});
