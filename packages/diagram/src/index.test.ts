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
import type { SNode } from "sprotty-protocol";

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
        enumValues: [],
      },
      {
        id: "Model.B",
        containerId: "Model",
        label: "B",
        kind: "Class",
        abstract: false,
        range: null,
        members: [],
        enumValues: [],
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

const nestedSnapshot = (): SemanticSnapshot => ({
  ...snapshot(),
  diagram: {
    nodes: [
      {
        id: "model:Root",
        containerId: "",
        label: "Root",
        kind: "model",
        abstract: false,
        range: null,
        members: [],
        enumValues: [],
      },
      {
        id: "topic:Root.Data",
        containerId: "model:Root",
        label: "Data",
        kind: "topic",
        abstract: true,
        range: null,
        members: [],
        enumValues: [],
      },
      {
        id: "class:Root.Data.Item",
        containerId: "topic:Root.Data",
        label: "Item",
        kind: "class",
        abstract: true,
        range: null,
        members: [{ name: "name", type: "TEXT", inherited: false }],
        enumValues: [],
      },
      {
        id: "domain:Root.Colors",
        containerId: "model:Root",
        label: "Colors",
        kind: "enumeration",
        abstract: false,
        range: null,
        members: [],
        enumValues: ["red", "blue"],
      },
    ],
    edges: [
      {
        id: "item-colors",
        sourceId: "class:Root.Data.Item",
        targetId: "domain:Root.Colors",
        kind: "association",
        label: "uses",
        cardinality: "1",
      },
    ],
  },
});

describe("DiagramController", () => {
  it("keeps the last valid snapshot visible across errors", () => {
    const controller = new DiagramController();
    expect(controller.state.status).toBe("empty");
    expect(controller.loading().status).toBe("loading");
    expect(controller.publish(snapshot()).status).toBe("ready");
    expect(controller.stale().status).toBe("stale");
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

  it("keeps model/topic containment in the layout, Sprotty model and SVG", async () => {
    const result = await layoutAndRenderDiagram(nestedSnapshot().diagram);
    expect(result.layout.nodes).toHaveLength(4);
    const topic = result.layout.nodes.find((node) => node.id === "topic:Root.Data");
    const item = result.layout.nodes.find(
      (node) => node.id === "class:Root.Data.Item",
    );
    expect(topic?.parentId).toBe("model:Root");
    expect(item?.parentId).toBe("topic:Root.Data");
    expect(item?.x).toBeGreaterThan(topic?.x ?? 0);
    expect(item?.y).toBeGreaterThan(topic?.y ?? 0);

    const model = (result.sprotty.children ?? []).find(
      (child) => child.id === "model:Root",
    ) as SNode;
    expect((model.children ?? []).map((child) => child.id)).toEqual(
      expect.arrayContaining(["topic:Root.Data", "domain:Root.Colors"]),
    );
    const topicModel = (model.children ?? []).find(
      (child) => child.id === "topic:Root.Data",
    ) as SNode;
    expect((topicModel.children ?? []).map((child) => child.id)).toContain(
      "class:Root.Data.Item",
    );

    const modelStart = result.svg.indexOf('id="ilic-model:Root"');
    const topicStart = result.svg.indexOf('id="ilic-topic:Root.Data"');
    expect(modelStart).toBeGreaterThanOrEqual(0);
    expect(topicStart).toBeGreaterThan(modelStart);
    expect(result.svg).toContain('class="ili-node ili-container ili-topic"');
    expect(result.svg).toContain("red");
    expect(result.svg).toContain('opacity="0.62"');
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
