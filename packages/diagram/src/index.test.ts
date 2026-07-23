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
import type { LayoutDiagram, NodePlacement } from "./index.js";
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
        id: "diagram:model-scope",
        containerId: "",
        label: "Model Scope",
        kind: "modelScope",
        abstract: false,
        range: null,
        members: [],
        enumValues: [],
      },
      {
        id: "topic:Root.Data",
        containerId: "",
        label: "Data (Root)",
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
        containerId: "diagram:model-scope",
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
        sourceCardinality: "0..*",
        targetCardinality: "1",
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
    expect(inherited).not.toContain('class="ili-edge-label"');
    const hidden = renderSvg(result.layout, {
      ...defaultDiagramSettings,
      attributeMode: "NONE",
    });
    expect(hidden).not.toContain("name : TEXT");
    expect(hidden).not.toContain("constraint1()");
  });

  it("keeps Model Scope and Topics as separate top-level containers", async () => {
    const result = await layoutAndRenderDiagram(nestedSnapshot().diagram);
    expect(result.layout.nodes).toHaveLength(4);
    const topic = result.layout.nodes.find(
      (node) => node.id === "topic:Root.Data",
    );
    const item = result.layout.nodes.find(
      (node) => node.id === "class:Root.Data.Item",
    );
    expect(topic?.parentId).toBeNull();
    expect(item?.parentId).toBe("topic:Root.Data");
    expect(item?.x).toBeGreaterThan(topic?.x ?? 0);
    expect(item?.y).toBeGreaterThan(topic?.y ?? 0);

    const modelScope = (result.sprotty.children ?? []).find(
      (child) => child.id === "diagram:model-scope",
    ) as SNode;
    expect((modelScope.children ?? []).map((child) => child.id)).toEqual([
      "domain:Root.Colors",
    ]);
    const topicModel = (result.sprotty.children ?? []).find(
      (child) => child.id === "topic:Root.Data",
    ) as SNode;
    expect((topicModel.children ?? []).map((child) => child.id)).toContain(
      "class:Root.Data.Item",
    );

    const modelStart = result.svg.indexOf(
      'data-symbol-id="diagram:model-scope"',
    );
    const topicStart = result.svg.indexOf('data-symbol-id="topic:Root.Data"');
    expect(modelStart).toBeGreaterThanOrEqual(0);
    expect(topicStart).toBeGreaterThan(modelStart);
    expect(result.svg).toContain('class="ili-node ili-container ili-topic"');
    expect(result.svg).toContain('stroke-dasharray="7 5"');
    expect(result.svg).toContain("red");
    expect(result.svg).toContain("ili-muted-abstract");
    expect(result.svg).toContain(">0..*</text>");
    expect(result.svg).toContain(">1</text>");
    expect(result.svg.indexOf('class="ili-edge ')).toBeLessThan(
      result.svg.indexOf('data-symbol-id="class:Root.Data.Item"'),
    );
  });

  it("renders parity details, inheritance arrows and viewport SVG exports", async () => {
    const value = nestedSnapshot();
    value.diagram.nodes.push({
      id: "class:Root.Base",
      containerId: "diagram:model-scope",
      label: "Base",
      kind: "structure",
      abstract: true,
      range: null,
      stereotypes: ["Abstract", "Structure"],
      members: [
        {
          name: "State",
          type: "ENUMERATION",
          cardinality: "0..1",
          declaringType: "",
          inherited: false,
          inlineEnumValues: ["open", "closed", "archived"],
        },
      ],
      enumValues: [],
      operations: ["Valid()", "constraint1()"],
    });
    value.diagram.edges.push({
      id: "item-base",
      sourceId: "class:Root.Data.Item",
      targetId: "class:Root.Base",
      kind: "inheritance",
      label: "",
      cardinality: "",
    });

    const result = await layoutAndRenderDiagram(value.diagram, {
      ...defaultDiagramSettings,
      attributeMode: "OWN_AND_INHERITED",
    });
    expect(result.svg).toContain("&lt;&lt;Abstract>>");
    expect(result.svg).toContain("&lt;&lt;Structure>>");
    expect(result.svg).toContain("State[0..1] : (open,");
    expect(result.svg).toContain(">closed,</text>");
    expect(result.svg).toContain("Valid()");
    expect(result.svg).toContain("constraint1()");
    expect(result.svg).toContain('marker-end="url(#ilic-inheritance-arrow)"');
    expect(result.svg).toContain('stroke="#6b58c9"');
    const inheritance = result.layout.edges.find(
      (edge) => edge.id === "item-base",
    );
    expect(inheritance?.points.length).toBeGreaterThan(1);
    expect(
      inheritance?.points.some((point) => point.x !== 0 || point.y !== 0),
    ).toBe(true);

    const visible = renderSvg(result.layout, defaultDiagramSettings, {
      zoom: 2,
      scrollX: 10,
      scrollY: 20,
      width: 800,
      height: 600,
    });
    expect(visible).toContain('viewBox="10 20 400 300"');
    expect(visible).toContain('width="800" height="600"');
    expect(visible).toContain('fill="#fff"');

    const detailsHidden = renderSvg(result.layout, {
      ...defaultDiagramSettings,
      attributeMode: "NONE",
    });
    expect(detailsHidden).not.toContain("constraint1()");
    expect(detailsHidden).not.toContain(">red</text>");
  });

  it("uses section spacing and renders Function and View stereotypes at title size", async () => {
    const value = nestedSnapshot();
    value.diagram.nodes.push(
      {
        id: "function:Root.Data.Calculate",
        containerId: "topic:Root.Data",
        label: "Calculate",
        kind: "function",
        abstract: false,
        range: null,
        stereotypes: ["Function"],
        members: [],
        enumValues: [],
      },
      {
        id: "view:Root.Data.Overview",
        containerId: "topic:Root.Data",
        label: "Overview",
        kind: "view",
        abstract: false,
        range: null,
        stereotypes: ["View"],
        members: [{ name: "name", type: "TEXT", inherited: false }],
        enumValues: [],
        operations: ["constraint1()", "constraint2()"],
      },
    );

    const result = await layoutAndRenderDiagram(value.diagram);
    expect(result.svg).toContain("ili-function");
    expect(result.svg).toContain("&lt;&lt;Function>>");
    expect(result.svg).toContain("ili-view");
    expect(result.svg).toContain("&lt;&lt;View>>");
    expect(result.svg).toContain(
      ".ili-title,.ili-stereotype{font:600 13px sans-serif}",
    );
    expect(result.svg).toMatch(
      /y="62" class="ili-member"[^>]*>name : TEXT<\/text>/,
    );
    expect(result.svg).toMatch(
      /y="92" class="ili-operation">constraint1\(\)<\/text>/,
    );
    expect(result.svg).toMatch(
      /y="110" class="ili-operation">constraint2\(\)<\/text>/,
    );
    const view = result.layout.nodes.find(
      (node) => node.id === "view:Root.Data.Overview",
    );
    expect(view?.height).toBe(124);
  });

  it("supports every layered node-placement strategy and ELK-managed edge labels", async () => {
    const strategies: NodePlacement[] = [
      "SIMPLE",
      "INTERACTIVE",
      "LINEAR_SEGMENTS",
      "BRANDES_KOEPF",
      "NETWORK_SIMPLEX",
    ];
    for (const nodePlacement of strategies) {
      const result = await layoutAndRenderDiagram(nestedSnapshot().diagram, {
        ...defaultDiagramSettings,
        nodePlacement,
      });
      expect(result.layout.width).toBeGreaterThan(0);
      expect(result.layout.height).toBeGreaterThan(0);
      expect(
        result.layout.nodes.find((node) => node.id === "class:Root.Data.Item")
          ?.parentId,
      ).toBe("topic:Root.Data");
      const association = result.layout.edges.find(
        (edge) => edge.id === "item-colors",
      );
      expect(association?.labels.map((label) => label.kind).sort()).toEqual([
        "association",
        "sourceCardinality",
        "targetCardinality",
      ]);
      expect(
        association?.labels.every(
          (label) =>
            Number.isFinite(label.x) &&
            Number.isFinite(label.y) &&
            label.width >= 16 &&
            label.height === 16,
        ),
      ).toBe(true);
      expect(
        association?.labels.every((label) =>
          result.layout.nodes
            .filter(
              (node) =>
                !["modelscope", "model-scope", "topic"].includes(
                  node.source.kind.toLowerCase(),
                ),
            )
            .every(
              (node) =>
                label.x + label.width <= node.x ||
                label.x >= node.x + node.width ||
                label.y + label.height <= node.y ||
                label.y >= node.y + node.height,
            ),
        ),
      ).toBe(true);
    }
  });

  it("renders orthogonal, polyline and spline routes as SVG paths", async () => {
    for (const edgeRouting of ["ORTHOGONAL", "POLYLINE", "SPLINES"] as const) {
      const result = await layoutAndRenderDiagram(snapshot().diagram, {
        ...defaultDiagramSettings,
        edgeRouting,
        edgeCrossingStyle: "PLAIN",
      });
      expect(result.svg).toContain('<path id="ilic-edge-path-');
      expect(result.svg).not.toContain("<polyline");
      expect(result.svg).toContain(
        `inkscape:connector-type="${
          edgeRouting === "ORTHOGONAL" ? "orthogonal" : "polyline"
        }"`,
      );
      if (edgeRouting === "SPLINES")
        expect(result.svg).toMatch(/d="M [^"]+ C [^"]+"/);
    }
  });

  it("adds deterministic gaps only to crossing straight segments", () => {
    const nodeSource = snapshot().diagram.nodes[0]!;
    const association = snapshot().diagram.edges[0]!;
    const edge = (
      id: string,
      sourceId: string,
      targetId: string,
      startPoint: { x: number; y: number },
      endPoint: { x: number; y: number },
    ) => ({
      id,
      sourceId,
      targetId,
      points: [startPoint, endPoint],
      sections: [{ startPoint, bendPoints: [], endPoint }],
      labels: [],
      source: { ...association, id, sourceId, targetId },
    });
    const layout: LayoutDiagram = {
      width: 120,
      height: 120,
      nodes: ["left", "right", "top", "bottom"].map((id, index) => ({
        id,
        parentId: null,
        x: index * 10,
        y: index * 10,
        width: 10,
        height: 10,
        source: { ...nodeSource, id, label: id },
      })),
      edges: [
        edge(
          "horizontal",
          "left",
          "right",
          { x: 10, y: 60 },
          { x: 110, y: 60 },
        ),
        edge("vertical", "top", "bottom", { x: 60, y: 10 }, { x: 60, y: 110 }),
      ],
    };

    const gapped = renderSvg(layout);
    expect(gapped).toContain('<circle cx="60" cy="60" r="3"');
    expect(gapped.match(/<mask id=/g)).toHaveLength(1);
    expect(gapped.match(/<path id="ilic-edge-path-/g)).toHaveLength(2);
    expect(gapped).toContain('data-source="top" data-target="bottom"');
    expect(gapped).toContain('inkscape:connector-avoid="true"');
    expect(gapped).toContain('inkscape:connection-start="#ilic-shape-');

    const plain = renderSvg(layout, {
      ...defaultDiagramSettings,
      edgeCrossingStyle: "PLAIN",
    });
    expect(plain).not.toContain("<mask id=");

    const splines = renderSvg(layout, {
      ...defaultDiagramSettings,
      edgeRouting: "SPLINES",
    });
    expect(splines).not.toContain("<mask id=");
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
