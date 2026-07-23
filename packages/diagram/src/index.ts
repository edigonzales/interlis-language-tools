import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkLabel, ElkNode } from "elkjs/lib/elk-api.js";
import type {
  DiagramEdge,
  DiagramNode,
  SemanticSnapshot,
  SourceRange,
} from "@ilic/language-service";
import type { SEdge, SModelElement, SModelRoot, SNode } from "sprotty-protocol";

export type EdgeRouting = "ORTHOGONAL" | "POLYLINE" | "SPLINES";
export type NodePlacement =
  | "SIMPLE"
  | "INTERACTIVE"
  | "LINEAR_SEGMENTS"
  | "BRANDES_KOEPF"
  | "NETWORK_SIMPLEX";
export type EdgeCrossingStyle = "PLAIN" | "GAPS";
export type AttributeMode = "OWN" | "NONE" | "OWN_AND_INHERITED";

export interface DiagramSettings {
  readonly nodePlacement: NodePlacement;
  readonly edgeRouting: EdgeRouting;
  readonly edgeCrossingStyle: EdgeCrossingStyle;
  readonly attributeMode: AttributeMode;
  readonly deemphasizeAbstractTypes: boolean;
  readonly showAssociationNames: boolean;
  readonly showRoleCardinalities: boolean;
  readonly showLocalEnumerationValues: boolean;
}

export const defaultDiagramSettings: DiagramSettings = {
  nodePlacement: "BRANDES_KOEPF",
  edgeRouting: "ORTHOGONAL",
  edgeCrossingStyle: "GAPS",
  attributeMode: "OWN",
  deemphasizeAbstractTypes: true,
  showAssociationNames: true,
  showRoleCardinalities: true,
  showLocalEnumerationValues: true,
};

export interface LayoutNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly source: DiagramNode;
}

export interface LayoutEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly points: readonly { x: number; y: number }[];
  readonly sections: readonly LayoutEdgeSection[];
  readonly labels: readonly LayoutLabel[];
  readonly source: DiagramEdge;
}

export interface LayoutEdgeSection {
  readonly startPoint: { readonly x: number; readonly y: number };
  readonly bendPoints: readonly { readonly x: number; readonly y: number }[];
  readonly endPoint: { readonly x: number; readonly y: number };
}

export type LayoutLabelKind =
  "association" | "sourceCardinality" | "targetCardinality";

export interface LayoutLabel {
  readonly id: string;
  readonly kind: LayoutLabelKind;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutDiagram {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
}

export interface Viewport {
  readonly zoom: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly width: number;
  readonly height: number;
}

export interface AnchoredViewport {
  readonly anchorId: string | null;
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface DiagramState {
  readonly status: "empty" | "loading" | "ready" | "stale" | "error";
  readonly snapshot: SemanticSnapshot | null;
  readonly message: string;
}

export class DiagramController {
  #lastGood: SemanticSnapshot | null = null;
  #state: DiagramState = {
    status: "empty",
    snapshot: null,
    message: "Open an INTERLIS model to view its diagram.",
  };

  get state(): DiagramState {
    return this.#state;
  }

  loading(): DiagramState {
    this.#state = {
      status: "loading",
      snapshot: this.#lastGood,
      message: "Updating diagram…",
    };
    return this.#state;
  }

  stale(
    message = "Showing the last valid diagram; the model has changed.",
  ): DiagramState {
    this.#state = this.#lastGood
      ? { status: "stale", snapshot: this.#lastGood, message }
      : { status: "empty", snapshot: null, message };
    return this.#state;
  }

  publish(
    snapshot: SemanticSnapshot,
    freshness: "fresh" | "stale" = "fresh",
  ): DiagramState {
    if (snapshot.success) this.#lastGood = snapshot;
    const visible = snapshot.success ? snapshot : this.#lastGood;
    this.#state = visible
      ? {
          status: snapshot.success && freshness === "fresh" ? "ready" : "stale",
          snapshot: visible,
          message:
            snapshot.success && freshness === "fresh"
              ? "Diagram is up to date."
              : "Showing the last valid diagram; the current model contains errors.",
        }
      : {
          status: "error",
          snapshot: null,
          message: "The model could not be analyzed.",
        };
    return this.#state;
  }

  fail(message: string): DiagramState {
    this.#state = this.#lastGood
      ? { status: "stale", snapshot: this.#lastGood, message }
      : { status: "error", snapshot: null, message };
    return this.#state;
  }
}

const EDGE_LABEL_HEIGHT = 16;
const edgeLabelSize = (text: string): { width: number; height: number } => ({
  width: Math.max(16, Array.from(text).length * 7 + 10),
  height: EDGE_LABEL_HEIGHT,
});

interface EdgeLabelSpec {
  readonly id: string;
  readonly kind: LayoutLabelKind;
  readonly text: string;
  readonly placement: "CENTER" | "TAIL" | "HEAD";
}

const visibleEdgeLabelSpecs = (
  edge: DiagramEdge,
  settings: DiagramSettings,
): EdgeLabelSpec[] => {
  if (edge.kind.toLowerCase() !== "association") return [];
  const result: EdgeLabelSpec[] = [];
  if (settings.showAssociationNames && edge.label)
    result.push({
      id: `${edge.id}:association`,
      kind: "association",
      text: edge.label,
      placement: "CENTER",
    });
  if (settings.showRoleCardinalities && edge.sourceCardinality)
    result.push({
      id: `${edge.id}:source-cardinality`,
      kind: "sourceCardinality",
      text: edge.sourceCardinality,
      placement: "TAIL",
    });
  if (settings.showRoleCardinalities && edge.targetCardinality)
    result.push({
      id: `${edge.id}:target-cardinality`,
      kind: "targetCardinality",
      text: edge.targetCardinality,
      placement: "HEAD",
    });
  return result;
};

export async function layoutDiagram(
  projection: SemanticSnapshot["diagram"],
  settings: DiagramSettings = defaultDiagramSettings,
): Promise<LayoutDiagram> {
  const elk = new ELK();
  const byId = new Map(projection.nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, DiagramNode[]>();
  for (const node of projection.nodes) {
    if (!byId.has(node.containerId)) continue;
    const children = childrenByParent.get(node.containerId) ?? [];
    children.push(node);
    childrenByParent.set(node.containerId, children);
  }
  const nodeSize = (node: DiagramNode) => {
    if (isContainerNode(node)) return { width: 300, height: 100 };
    const content = nodeContentLayout(node, settings);
    const longest = [
      node.label,
      ...content.lines.map((line) => line.text),
    ].reduce((length, value) => Math.max(length, value.length), 0);
    return {
      width: Math.max(220, Math.min(520, 28 + longest * 7)),
      height: content.height,
    };
  };
  const elkById = new Map<string, ElkNode>();
  const makeElkNode = (node: DiagramNode): ElkNode => {
    const size = nodeSize(node);
    const children = (childrenByParent.get(node.id) ?? []).map(makeElkNode);
    const result: ElkNode = {
      id: node.id,
      width: size.width,
      height: size.height,
      ...(children.length > 0 ? { children } : {}),
      ...(children.length > 0
        ? {
            layoutOptions: {
              "elk.padding": "[top=40,left=20,bottom=20,right=20]",
              "elk.nodeSize.constraints": "MINIMUM_SIZE",
            },
          }
        : {}),
    };
    elkById.set(node.id, result);
    return result;
  };
  const input: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": settings.edgeRouting,
      "elk.layered.nodePlacement.strategy": settings.nodePlacement,
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.spacing.edgeNode": "30",
      "elk.layered.spacing.edgeNodeBetweenLayers": "40",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "25",
      "elk.spacing.edgeLabel": "10",
      "elk.spacing.labelLabel": "6",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.mergeEdges": "true",
    },
    children: projection.nodes
      .filter((node) => !byId.has(node.containerId))
      .map(makeElkNode),
    edges: [],
  };
  const parentOf = (id: string): string | null => {
    const parent = byId.get(id)?.containerId;
    return parent && byId.has(parent) ? parent : null;
  };
  const containerPath = (id: string): string[] => {
    const result: string[] = [];
    for (let current = parentOf(id); current; current = parentOf(current))
      result.unshift(current);
    return result;
  };
  const commonOwner = (sourceId: string, targetId: string): string | null => {
    const sourcePath = containerPath(sourceId);
    const targetPath = containerPath(targetId);
    let owner: string | null = null;
    for (
      let index = 0;
      index < Math.min(sourcePath.length, targetPath.length) &&
      sourcePath[index] === targetPath[index];
      index++
    )
      owner = sourcePath[index]!;
    return owner;
  };
  for (const edge of projection.edges) {
    if (!byId.has(edge.sourceId) || !byId.has(edge.targetId)) continue;
    const labelSpecs = visibleEdgeLabelSpecs(edge, settings);
    const elkEdge: ElkExtendedEdge = {
      id: edge.id,
      sources: [edge.sourceId],
      targets: [edge.targetId],
      labels: labelSpecs.map((label): ElkLabel => {
        const size = edgeLabelSize(label.text);
        return {
          id: label.id,
          text: label.text,
          width: size.width,
          height: size.height,
          layoutOptions: {
            "org.eclipse.elk.edgeLabels.placement": label.placement,
          },
        };
      }),
    };
    const owner = commonOwner(edge.sourceId, edge.targetId);
    const graph = owner ? elkById.get(owner) : input;
    if (!graph) continue;
    graph.edges = [...(graph.edges ?? []), elkEdge];
  }
  const graph = await elk.layout(input);
  const edgeById = new Map(projection.edges.map((edge) => [edge.id, edge]));
  const edgeLabelSpecById = new Map(
    projection.edges.flatMap((edge) =>
      visibleEdgeLabelSpecs(edge, settings).map(
        (label) => [label.id, label] as const,
      ),
    ),
  );
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const flatten = (
    owner: ElkNode,
    parentId: string | null,
    parentX: number,
    parentY: number,
  ): void => {
    for (const edge of owner.edges ?? []) {
      const source = edgeById.get(edge.id);
      if (!source) continue;
      const sections = (edge.sections ?? []).map(
        (section): LayoutEdgeSection => ({
          startPoint: {
            x: parentX + section.startPoint.x,
            y: parentY + section.startPoint.y,
          },
          bendPoints: (section.bendPoints ?? []).map((point) => ({
            x: parentX + point.x,
            y: parentY + point.y,
          })),
          endPoint: {
            x: parentX + section.endPoint.x,
            y: parentY + section.endPoint.y,
          },
        }),
      );
      const points = sections.flatMap((section, sectionIndex) =>
        [section.startPoint, ...section.bendPoints, section.endPoint].filter(
          (_, pointIndex) => sectionIndex === 0 || pointIndex > 0,
        ),
      );
      const labels = (edge.labels ?? []).flatMap((label): LayoutLabel[] => {
        if (!label.id) return [];
        const spec = edgeLabelSpecById.get(label.id);
        if (!spec || label.x === undefined || label.y === undefined) return [];
        const size = edgeLabelSize(spec.text);
        return [
          {
            id: label.id,
            kind: spec.kind,
            text: spec.text,
            x: parentX + label.x,
            y: parentY + label.y,
            width: label.width ?? size.width,
            height: label.height ?? size.height,
          },
        ];
      });
      edges.push({
        id: edge.id,
        sourceId: source.sourceId,
        targetId: source.targetId,
        points,
        sections,
        labels,
        source,
      });
    }
    for (const node of owner.children ?? []) {
      const source = byId.get(node.id);
      if (!source) continue;
      const x = parentX + (node.x ?? 0);
      const y = parentY + (node.y ?? 0);
      nodes.push({
        id: node.id,
        parentId,
        x,
        y,
        width: node.width ?? nodeSize(source).width,
        height: node.height ?? nodeSize(source).height,
        source,
      });
      flatten(node, node.id, x, y);
    }
  };
  flatten(graph, null, 0, 0);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const completedEdges = edges.map((edge) => {
    if (edge.points.length > 1) return edge;
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    return source && target
      ? {
          ...edge,
          sections: [
            {
              startPoint: {
                x: source.x + source.width / 2,
                y: source.y + source.height / 2,
              },
              bendPoints: [],
              endPoint: {
                x: target.x + target.width / 2,
                y: target.y + target.height / 2,
              },
            },
          ],
          points: [
            {
              x: source.x + source.width / 2,
              y: source.y + source.height / 2,
            },
            {
              x: target.x + target.width / 2,
              y: target.y + target.height / 2,
            },
          ],
        }
      : edge;
  });
  return {
    width: Math.max(1, graph.width ?? 0),
    height: Math.max(1, graph.height ?? 0),
    nodes,
    edges: completedEdges,
  };
}

export function toSprottyModel(layout: LayoutDiagram): SModelRoot {
  const childrenByParent = new Map<string | null, LayoutNode[]>();
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  for (const node of layout.nodes) {
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }
  const parentPath = (id: string): string[] => {
    const result: string[] = [];
    for (
      let parent = nodeById.get(id)?.parentId ?? null;
      parent;
      parent = nodeById.get(parent)?.parentId ?? null
    )
      result.unshift(parent);
    return result;
  };
  const edgeModel = (edge: LayoutEdge): SEdge => ({
    type: `edge:${edge.source.kind}`,
    id: edge.id,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
  });
  const edgesByParent = new Map<string | null, LayoutEdge[]>();
  for (const edge of layout.edges) {
    const sourcePath = parentPath(edge.sourceId);
    const targetPath = parentPath(edge.targetId);
    let owner: string | null = null;
    for (
      let index = 0;
      index < Math.min(sourcePath.length, targetPath.length) &&
      sourcePath[index] === targetPath[index];
      index++
    )
      owner = sourcePath[index]!;
    const values = edgesByParent.get(owner) ?? [];
    values.push(edge);
    edgesByParent.set(owner, values);
  }
  const nodeModel = (
    node: LayoutNode,
    parentX: number,
    parentY: number,
  ): SNode => ({
    type: "node:interlis",
    id: node.id,
    position: { x: node.x - parentX, y: node.y - parentY },
    size: { width: node.width, height: node.height },
    children: [
      ...(childrenByParent.get(node.id) ?? []).map((child) =>
        nodeModel(child, node.x, node.y),
      ),
      ...(edgesByParent.get(node.id) ?? []).map(edgeModel),
    ],
  });
  const children: SModelElement[] = [
    ...(childrenByParent.get(null) ?? []).map((node) => nodeModel(node, 0, 0)),
    ...(edgesByParent.get(null) ?? []).map(edgeModel),
  ];
  return { type: "graph", id: "interlis-diagram", children };
}

const xml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
const encodedId = (value: string): string =>
  Array.from(value)
    .map((character) => character.codePointAt(0)!.toString(16))
    .join("_") || "empty";
const domId = (kind: string, value: string): string =>
  `ilic-${kind}-${encodedId(value)}`;
const nodeDomId = (value: string): string => domId("node", value);
const nodeShapeDomId = (value: string): string => domId("shape", value);
const edgeDomId = (value: string): string => domId("edge", value);
const edgePathDomId = (value: string): string => domId("edge-path", value);
const edgeMaskDomId = (value: string): string => domId("edge-mask", value);

const containerKinds = new Set(["model", "modelscope", "model-scope", "topic"]);
const isContainerNode = (node: DiagramNode): boolean =>
  containerKinds.has(node.kind.toLowerCase());

interface ContentLine {
  readonly text: string;
  readonly kind: "stereotype" | "member" | "enumeration" | "operation";
  readonly y: number;
  readonly continuation?: boolean;
  readonly inherited?: boolean;
}

const visibleNodeMembers = (
  node: DiagramNode,
  settings: DiagramSettings,
): DiagramNode["members"] =>
  settings.attributeMode === "NONE"
    ? []
    : node.members.filter(
        (member) =>
          settings.attributeMode === "OWN_AND_INHERITED" || !member.inherited,
      );

const memberText = (member: DiagramNode["members"][number]): string => {
  const owner =
    member.inherited && member.declaringType ? `${member.declaringType}.` : "";
  const cardinality = member.cardinality ? `[${member.cardinality}]` : "";
  const values = member.inlineEnumValues ?? [];
  const type =
    values.length === 0
      ? member.type
      : `(${values[0]}${values
          .slice(1)
          .map((value) => `,\n  ${value}`)
          .join("")})`;
  return `${owner}${member.name}${cardinality} : ${type}`;
};

const contentLines = (
  node: DiagramNode,
  settings: DiagramSettings,
): Omit<ContentLine, "y">[] => {
  const result: Omit<ContentLine, "y">[] = (node.stereotypes ?? []).map(
    (stereotype) => ({
      text: `<<${stereotype}>>`,
      kind: "stereotype",
    }),
  );
  for (const member of visibleNodeMembers(node, settings)) {
    memberText(member)
      .split("\n")
      .forEach((text, index) =>
        result.push({
          text: index === 0 ? text : text.trimStart(),
          kind: "member",
          continuation: index > 0,
          inherited: member.inherited,
        }),
      );
  }
  if (settings.attributeMode !== "NONE" && settings.showLocalEnumerationValues)
    for (const value of node.enumValues)
      result.push({ text: value, kind: "enumeration" });
  if (settings.attributeMode !== "NONE")
    for (const operation of node.operations ?? [])
      result.push({ text: operation, kind: "operation" });
  return result;
};

const nodeContentLayout = (
  node: DiagramNode,
  settings: DiagramSettings,
): { readonly lines: readonly ContentLine[]; readonly height: number } => {
  const source = contentLines(node, settings);
  const hasAttributes = source.some(
    (line) => line.kind === "member" || line.kind === "enumeration",
  );
  let y = 44;
  let operationSectionStarted = false;
  const lines = source.map((line): ContentLine => {
    if (
      line.kind === "operation" &&
      hasAttributes &&
      !operationSectionStarted
    ) {
      y += 12;
      operationSectionStarted = true;
    }
    const positioned = { ...line, y };
    y += 18;
    return positioned;
  });
  return {
    lines,
    height: Math.max(62, (lines.at(-1)?.y ?? 48) + 14),
  };
};

const pointOnPolyline = (
  points: readonly { x: number; y: number }[],
  fraction: number,
): { x: number; y: number; nx: number; ny: number } => {
  if (points.length === 0) return { x: 0, y: 0, nx: 0, ny: -1 };
  if (points.length === 1)
    return { x: points[0]!.x, y: points[0]!.y, nx: 0, ny: -1 };
  const segments = points.slice(1).map((point, index) => {
    const start = points[index]!;
    return {
      start,
      point,
      length: Math.hypot(point.x - start.x, point.y - start.y),
    };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = total * fraction;
  for (const segment of segments) {
    if (remaining <= segment.length || segment === segments.at(-1)) {
      const ratio = segment.length === 0 ? 0 : remaining / segment.length;
      const dx = segment.point.x - segment.start.x;
      const dy = segment.point.y - segment.start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      return {
        x: segment.start.x + dx * ratio,
        y: segment.start.y + dy * ratio,
        nx: -dy / length,
        ny: dx / length,
      };
    }
    remaining -= segment.length;
  }
  const point = points.at(-1)!;
  return { x: point.x, y: point.y, nx: 0, ny: -1 };
};

const effectiveSections = (edge: LayoutEdge): readonly LayoutEdgeSection[] => {
  if (edge.sections.length > 0) return edge.sections;
  if (edge.points.length < 2) return [];
  return [
    {
      startPoint: edge.points[0]!,
      bendPoints: edge.points.slice(1, -1),
      endPoint: edge.points.at(-1)!,
    },
  ];
};

const straightPathData = (edge: LayoutEdge): string =>
  effectiveSections(edge)
    .map(
      (section) =>
        `M ${section.startPoint.x},${section.startPoint.y} ${[
          ...section.bendPoints,
          section.endPoint,
        ]
          .map((point) => `L ${point.x},${point.y}`)
          .join(" ")}`,
    )
    .join(" ");

const splineSectionData = (section: LayoutEdgeSection): string => {
  const bends = [...section.bendPoints];
  let result = `M ${section.startPoint.x},${section.startPoint.y}`;
  let index = 0;
  while (bends.length - index > 2) {
    const first = bends[index]!;
    const second = bends[index + 1]!;
    const end = bends[index + 2]!;
    result += ` C ${first.x},${first.y} ${second.x},${second.y} ${end.x},${end.y}`;
    index += 3;
  }
  if (bends.length - index === 2) {
    const first = bends[index]!;
    const second = bends[index + 1]!;
    result += ` C ${first.x},${first.y} ${second.x},${second.y} ${section.endPoint.x},${section.endPoint.y}`;
  } else if (bends.length - index === 1) {
    const control = bends[index]!;
    result += ` Q ${control.x},${control.y} ${section.endPoint.x},${section.endPoint.y}`;
  } else {
    result += ` L ${section.endPoint.x},${section.endPoint.y}`;
  }
  return result;
};

const edgePathData = (edge: LayoutEdge, routing: EdgeRouting): string =>
  routing === "SPLINES"
    ? effectiveSections(edge).map(splineSectionData).join(" ")
    : straightPathData(edge);

interface StraightSegment {
  readonly edgeId: string;
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  readonly slopeMagnitude: number;
}

const straightSegments = (edge: LayoutEdge): StraightSegment[] =>
  effectiveSections(edge).flatMap((section) => {
    const points = [
      section.startPoint,
      ...section.bendPoints,
      section.endPoint,
    ];
    return points.slice(1).flatMap((end, index): StraightSegment[] => {
      const start = points[index]!;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      if (Math.hypot(dx, dy) < 0.001) return [];
      return [
        {
          edgeId: edge.id,
          start,
          end,
          slopeMagnitude: Math.abs(dx) < 0.001 ? Infinity : Math.abs(dy / dx),
        },
      ];
    });
  });

const properIntersection = (
  first: StraightSegment,
  second: StraightSegment,
): { x: number; y: number } | null => {
  const firstDx = first.end.x - first.start.x;
  const firstDy = first.end.y - first.start.y;
  const secondDx = second.end.x - second.start.x;
  const secondDy = second.end.y - second.start.y;
  const denominator = firstDx * secondDy - firstDy * secondDx;
  if (Math.abs(denominator) < 0.001) return null;
  const deltaX = second.start.x - first.start.x;
  const deltaY = second.start.y - first.start.y;
  const firstRatio = (deltaX * secondDy - deltaY * secondDx) / denominator;
  const secondRatio = (deltaX * firstDy - deltaY * firstDx) / denominator;
  const firstLength = Math.hypot(firstDx, firstDy);
  const secondLength = Math.hypot(secondDx, secondDy);
  const gapClearance = 3.5;
  if (
    firstRatio * firstLength <= gapClearance ||
    (1 - firstRatio) * firstLength <= gapClearance ||
    secondRatio * secondLength <= gapClearance ||
    (1 - secondRatio) * secondLength <= gapClearance
  )
    return null;
  return {
    x: first.start.x + firstDx * firstRatio,
    y: first.start.y + firstDy * firstRatio,
  };
};

const edgeGaps = (
  layout: LayoutDiagram,
  settings: DiagramSettings,
): ReadonlyMap<string, readonly { x: number; y: number }[]> => {
  if (
    settings.edgeCrossingStyle !== "GAPS" ||
    settings.edgeRouting === "SPLINES"
  )
    return new Map();
  const segmentsByEdge = new Map(
    layout.edges.map((edge) => [edge.id, straightSegments(edge)]),
  );
  const gaps = new Map<string, { x: number; y: number }[]>();
  for (let firstIndex = 0; firstIndex < layout.edges.length; firstIndex++) {
    const firstEdge = layout.edges[firstIndex]!;
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < layout.edges.length;
      secondIndex++
    ) {
      const secondEdge = layout.edges[secondIndex]!;
      for (const first of segmentsByEdge.get(firstEdge.id) ?? [])
        for (const second of segmentsByEdge.get(secondEdge.id) ?? []) {
          const intersection = properIntersection(first, second);
          if (!intersection) continue;
          const slopeDifference =
            first.slopeMagnitude === second.slopeMagnitude
              ? 0
              : first.slopeMagnitude - second.slopeMagnitude;
          const gapped =
            slopeDifference > 0
              ? firstEdge
              : slopeDifference < 0
                ? secondEdge
                : firstEdge.id.localeCompare(secondEdge.id) >= 0
                  ? firstEdge
                  : secondEdge;
          const values = gaps.get(gapped.id) ?? [];
          if (
            !values.some(
              (value) =>
                Math.hypot(value.x - intersection.x, value.y - intersection.y) <
                6,
            )
          )
            values.push(intersection);
          gaps.set(gapped.id, values);
        }
    }
  }
  return gaps;
};

const resolvedEdgeLabels = (
  edge: LayoutEdge,
  settings: DiagramSettings,
): readonly LayoutLabel[] =>
  visibleEdgeLabelSpecs(edge.source, settings).map((spec) => {
    const positioned = edge.labels.find((label) => label.kind === spec.kind);
    if (positioned) return positioned;
    const fraction =
      spec.kind === "association"
        ? 0.5
        : spec.kind === "sourceCardinality"
          ? 0.12
          : 0.88;
    const point = pointOnPolyline(edge.points, fraction);
    const offset = spec.kind === "association" ? 10 : 12;
    const size = edgeLabelSize(spec.text);
    return {
      id: spec.id,
      kind: spec.kind,
      text: spec.text,
      x: point.x + point.nx * offset - size.width / 2,
      y: point.y + point.ny * offset - size.height / 2,
      width: size.width,
      height: size.height,
    };
  });

export function renderSvg(
  layout: LayoutDiagram,
  settings: DiagramSettings = defaultDiagramSettings,
  viewport?: Viewport,
): string {
  const viewBox = viewport
    ? `${viewport.scrollX} ${viewport.scrollY} ${viewport.width / viewport.zoom} ${viewport.height / viewport.zoom}`
    : `0 0 ${Math.max(1, layout.width)} ${Math.max(1, layout.height)}`;
  const gaps = edgeGaps(layout, settings);
  const gapMasks = [...gaps]
    .filter(([, values]) => values.length > 0)
    .map(
      ([edgeId, values]) =>
        `<mask id="${edgeMaskDomId(edgeId)}" maskUnits="userSpaceOnUse" x="0" y="0" width="${Math.max(1, layout.width)}" height="${Math.max(1, layout.height)}"><rect x="0" y="0" width="${Math.max(1, layout.width)}" height="${Math.max(1, layout.height)}" fill="#fff"/>${values.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3" fill="#000"/>`).join("")}</mask>`,
    )
    .join("");
  const edgePaths = layout.edges
    .map((edge) => {
      const inheritance = edge.source.kind.toLowerCase() === "inheritance";
      const mask = gaps.get(edge.id)?.length
        ? ` mask="url(#${edgeMaskDomId(edge.id)})"`
        : "";
      const connectorType =
        settings.edgeRouting === "ORTHOGONAL" ? "orthogonal" : "polyline";
      return `<g id="${edgeDomId(edge.id)}" class="ili-edge ili-edge-${xml(edge.source.kind.toLowerCase())}" data-edge-id="${xml(edge.id)}"><path id="${edgePathDomId(edge.id)}" d="${edgePathData(edge, settings.edgeRouting)}" fill="none" stroke="${inheritance ? "#6b58c9" : "#2c7f6d"}" stroke-width="1.6"${inheritance ? ' marker-end="url(#ilic-inheritance-arrow)"' : ""}${mask} data-edge-id="${xml(edge.id)}" data-source="${xml(edge.sourceId)}" data-target="${xml(edge.targetId)}" inkscape:connector-type="${connectorType}" inkscape:connector-curvature="0" inkscape:connection-start="#${nodeShapeDomId(edge.sourceId)}" inkscape:connection-end="#${nodeShapeDomId(edge.targetId)}"/></g>`;
    })
    .join("");
  const containers = layout.nodes
    .filter((node) => isContainerNode(node.source))
    .map((node) => {
      const modelScope = ["modelscope", "model-scope"].includes(
        node.source.kind.toLowerCase(),
      );
      const stereotypes = (node.source.stereotypes ?? [])
        .map(
          (value, index) =>
            `<text x="12" y="${44 + index * 18}" class="ili-stereotype">&lt;&lt;${xml(value)}&gt;&gt;</text>`,
        )
        .join("");
      return `<g id="${nodeDomId(node.id)}" class="ili-node ili-container ili-${xml(node.source.kind.toLowerCase())}" data-symbol-id="${xml(node.id)}" transform="translate(${node.x} ${node.y})"><rect id="${nodeShapeDomId(node.id)}" width="${node.width}" height="${node.height}" rx="4" fill="${modelScope ? "#f7f9fc" : "#eef3f7"}" stroke="#526274"${modelScope ? ' stroke-dasharray="7 5"' : ""} inkscape:connector-avoid="true"/><text x="12" y="24" class="ili-title">${xml(node.source.label)}</text>${stereotypes}</g>`;
    })
    .join("");
  const nodes = layout.nodes
    .filter((node) => !isContainerNode(node.source))
    .map((node) => {
      const content = nodeContentLayout(node.source, settings);
      const muted =
        settings.deemphasizeAbstractTypes &&
        node.source.abstract &&
        ["class", "structure"].includes(node.source.kind.toLowerCase());
      const lineMarkup = content.lines
        .map(
          (line) =>
            `<text x="${line.continuation ? 20 : 12}" y="${line.y}" class="ili-${line.kind}"${line.inherited === undefined ? "" : ` data-inherited="${String(line.inherited)}"`}>${xml(line.text)}</text>`,
        )
        .join("");
      return `<g id="${nodeDomId(node.id)}" class="ili-node ili-${xml(node.source.kind.toLowerCase())}${muted ? " ili-muted-abstract" : ""}" data-symbol-id="${xml(node.id)}" data-container-id="${xml(node.source.containerId)}" data-source-uri="${xml(node.source.range?.uri ?? "")}" transform="translate(${node.x} ${node.y})"><rect id="${nodeShapeDomId(node.id)}" width="${node.width}" height="${node.height}" rx="4" fill="${muted ? "#f3f3f3" : "#fff"}" stroke="${muted ? "#d6d6d6" : "#596b80"}" inkscape:connector-avoid="true"/><text x="12" y="24" class="ili-title">${xml(node.source.label)}</text><g class="ili-members">${lineMarkup}</g></g>`;
    })
    .join("");
  const edgeLabels = layout.edges
    .map((edge) => {
      const labels = resolvedEdgeLabels(edge, settings);
      if (labels.length === 0) return "";
      return `<g class="ili-edge-labels" data-edge-id="${xml(edge.id)}">${labels
        .map(
          (label) =>
            `<text x="${label.x + label.width / 2}" y="${label.y + 12}" class="${label.kind === "association" ? "ili-edge-label" : "ili-edge-cardinality"}" data-label-kind="${label.kind}" text-anchor="middle">${xml(label.text)}</text>`,
        )
        .join("")}</g>`;
    })
    .join("");
  const width = viewport ? viewport.width : Math.max(1, layout.width);
  const height = viewport ? viewport.height : Math.max(1, layout.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="${viewBox}" width="${width}" height="${height}" role="img"><defs><marker id="ilic-inheritance-arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto"><path d="M 1 1 L 11 6 L 1 11 Z" fill="#fff" stroke="#6b58c9" stroke-width="1.2"/></marker>${gapMasks}<style>.ili-title,.ili-stereotype{font:600 13px sans-serif}.ili-title{fill:#182234}.ili-stereotype{fill:#3c5b89}.ili-member,.ili-enumeration,.ili-operation{font:12px sans-serif;fill:#2a3a50}.ili-edge-label,.ili-edge-cardinality{font:600 11px sans-serif;fill:#33465f}.ili-muted-abstract text{fill:#a6a6a6}</style></defs><rect class="ili-background" x="${viewport?.scrollX ?? 0}" y="${viewport?.scrollY ?? 0}" width="${viewport ? viewport.width / viewport.zoom : Math.max(1, layout.width)}" height="${viewport ? viewport.height / viewport.zoom : Math.max(1, layout.height)}" fill="#fff"/>${containers}${edgePaths}${nodes}${edgeLabels}</svg>`;
}

export async function layoutAndRenderDiagram(
  projection: SemanticSnapshot["diagram"],
  settings: DiagramSettings = defaultDiagramSettings,
  viewport?: Viewport,
): Promise<{ layout: LayoutDiagram; svg: string; sprotty: SModelRoot }> {
  const layout = await layoutDiagram(projection, settings);
  return {
    layout,
    svg: renderSvg(layout, settings, viewport),
    sprotty: toSprottyModel(layout),
  };
}

export function captureViewport(
  layout: LayoutDiagram,
  viewport: Viewport,
): AnchoredViewport {
  const center = {
    x: viewport.scrollX + viewport.width / viewport.zoom / 2,
    y: viewport.scrollY + viewport.height / viewport.zoom / 2,
  };
  const anchor = [...layout.nodes].sort((left, right) => {
    const distance = (node: LayoutNode) =>
      Math.hypot(
        node.x + node.width / 2 - center.x,
        node.y + node.height / 2 - center.y,
      );
    return distance(left) - distance(right);
  })[0];
  return {
    anchorId: anchor?.id ?? null,
    zoom: viewport.zoom,
    offsetX: anchor ? center.x - (anchor.x + anchor.width / 2) : center.x,
    offsetY: anchor ? center.y - (anchor.y + anchor.height / 2) : center.y,
  };
}

export function restoreViewport(
  layout: LayoutDiagram,
  saved: AnchoredViewport,
  size: { width: number; height: number },
): Viewport {
  const anchor = saved.anchorId
    ? layout.nodes.find((node) => node.id === saved.anchorId)
    : undefined;
  const centerX = anchor
    ? anchor.x + anchor.width / 2 + saved.offsetX
    : saved.offsetX;
  const centerY = anchor
    ? anchor.y + anchor.height / 2 + saved.offsetY
    : saved.offsetY;
  return {
    zoom: saved.zoom,
    width: size.width,
    height: size.height,
    scrollX: centerX - size.width / saved.zoom / 2,
    scrollY: centerY - size.height / saved.zoom / 2,
  };
}

export function sourceLocationForNode(
  snapshot: SemanticSnapshot,
  nodeId: string,
): SourceRange | null {
  const node = snapshot.diagram.nodes.find(
    (candidate) => candidate.id === nodeId,
  );
  return node?.range ?? null;
}
