import { describe, expect, it } from "vitest";
import type { SemanticSnapshot } from "@ilic/language-service";
import {
  DiagramController,
  captureViewport,
  defaultDiagramSettings,
  layoutAndRenderDiagram,
  renderSvg,
  restoreViewport,
  sourceLocationForNode,
} from "./index.js";

const uri = "memory:///Model.ili";
const snapshot = (success = true): SemanticSnapshot => ({
  schemaVersion: 1,
  abiVersion: 1,
  compilerVersion: "test",
  kind: "semantic",
  success,
  cancelled: false,
  roots: [uri],
  documentVersions: { [uri]: 1 },
  symbols: [],
  references: [],
  dependencies: [],
  diagram: {
    nodes: [
      {
        id: "Model.A",
        containerId: "Model",
        label: "A & <Building>",
        kind: "Class",
        abstract: true,
        range: {
          uri,
          start: { line: 2, character: 2, byteOffset: 20 },
          end: { line: 4, character: 8, byteOffset: 60 },
        },
        members: [
          { name: "name", type: "TEXT", inherited: false },
          { name: "id", type: "OID", inherited: true },
        ],
      },
      {
        id: "Model.B",
        containerId: "Model",
        label: "B",
        kind: "Class",
        abstract: false,
        range: null,
        members: [],
      },
    ],
    edges: [
      {
        id: "A-B",
        sourceId: "Model.A",
        targetId: "Model.B",
        kind: "Association",
        label: "contains",
        cardinality: "0..*",
      },
    ],
  },
  documentation: { title: "Model", sections: [] },
  diagnostics: [],
  logs: [],
});

describe("DiagramController", () => {
  it("keeps the last valid snapshot visible across errors", () => {
    const controller = new DiagramController();
    expect(controller.state.status).toBe("empty");
    expect(controller.loading().status).toBe("loading");
    expect(controller.publish(snapshot()).status).toBe("ready");
    expect(controller.publish(snapshot(false)).status).toBe("stale");
    expect(controller.fail("layout failed")).toMatchObject({
      status: "stale",
      message: "layout failed",
    });
    const empty = new DiagramController();
    expect(empty.publish(snapshot(false)).status).toBe("error");
    expect(empty.fail("failed").snapshot).toBeNull();
  });
});

describe("Sprotty/ELK projection", () => {
  it("layouts semantic nodes and exports complete semantic SVG", async () => {
    const result = await layoutAndRenderDiagram(snapshot().diagram);
    expect(result.layout.nodes).toHaveLength(2);
    expect(result.sprotty.children).toHaveLength(3);
    expect(result.svg).toContain('fill="#fff"');
    expect(result.svg).toContain("inkscape:connection-start");
    expect(result.svg).toContain('class="ili-members"');
    expect(result.svg).toContain("A &amp; &lt;Building>");
    expect(result.svg).not.toContain(">id : OID<");

    const inherited = renderSvg(result.layout, {
      ...defaultDiagramSettings,
      attributeMode: "OWN_AND_INHERITED",
      showAssociationNames: false,
      showRoleCardinalities: false,
    });
    expect(inherited).toContain("id : OID");
    expect(inherited).toContain('class="ili-edge-label"></text>');
    expect(
      renderSvg(result.layout, {
        ...defaultDiagramSettings,
        attributeMode: "NONE",
      }),
    ).not.toContain("name : TEXT");
  });

  it("restores viewports relative to the nearest semantic node", async () => {
    const { layout } = await layoutAndRenderDiagram(snapshot().diagram);
    const viewport = {
      zoom: 2,
      scrollX: 10,
      scrollY: 5,
      width: 800,
      height: 600,
    };
    const anchor = captureViewport(layout, viewport);
    expect(anchor.anchorId).toBeTruthy();
    const restored = restoreViewport(layout, anchor, {
      width: 1000,
      height: 700,
    });
    expect(restored.zoom).toBe(2);
    expect(restored.width).toBe(1000);
    const empty = { width: 0, height: 0, nodes: [], edges: [] };
    expect(captureViewport(empty, viewport).anchorId).toBeNull();
    expect(
      restoreViewport(
        empty,
        { ...anchor, anchorId: "missing" },
        { width: 1, height: 1 },
      ).width,
    ).toBe(1);
  });

  it("maps double-click targets back to source ranges", () => {
    expect(sourceLocationForNode(snapshot(), "Model.A")?.uri).toBe(uri);
    expect(sourceLocationForNode(snapshot(), "missing")).toBeNull();
  });
});
