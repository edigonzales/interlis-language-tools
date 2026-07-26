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
      selectionRange: null,
      endRange: null,
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
    models: [
      {
        name: "Model",
        uri: "memory:/Model.ili",
        title: "Model title",
        shortDescription: "Description",
        viewables: [
          {
            name: "Thing",
            kind: "class",
            isAbstract: false,
            documentation: "A thing",
            rows: [
              {
                name: "Name",
                cardinality: "1",
                type: "Text",
                description: "A name",
              },
            ],
          },
        ],
        enumerations: [
          {
            name: "State",
            entries: [{ value: "open", documentation: "Open state" }],
          },
        ],
        topics: [
          {
            name: "Data",
            documentation: "Topic documentation",
            viewables: [],
            enumerations: [],
          },
        ],
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
    const stylesXml = strFromU8(files["word/styles.xml"]!);
    const numberingXml = strFromU8(files["word/numbering.xml"]!);
    expect(documentXml).toContain("Model.ili");
    expect(documentXml).toContain("Data (Topic)");
    expect(documentXml).toContain("Attributname");
    expect(documentXml).toContain("Wert");
    expect(documentXml).not.toContain("Model elements");
    expect(documentXml).not.toContain("Example warning");
    expect(stylesXml).toContain("Arial");
    expect(stylesXml).not.toContain("2E74B5");
    expect(numberingXml).toContain("%1.%2");
    expect(documentXml).toContain('w:w="9000"');
    expect(documentXml).toContain('w:w="2250"');
    expect(documentXml).toContain('w:w="1500"');
    expect(documentXml).toContain('w:w="3000"');
    expect(documentXml).toContain('w:type="fixed"');
    expect(documentXml).not.toContain('w:type="pct"');
    expect(documentXml).toContain('w:pgSz w:w="11906" w:h="16838"');
  });

  it("rejects snapshots without the structured documentation projection", async () => {
    const legacySnapshot = {
      ...snapshot,
      documentation: { ...snapshot.documentation },
    };
    delete legacySnapshot.documentation.models;
    await expect(generateDocx(legacySnapshot)).rejects.toThrow(
      "Structured INTERLIS documentation is unavailable",
    );
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
