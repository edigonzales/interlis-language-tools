import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type {
  DiagramEdge,
  DiagramNode,
  SemanticSnapshot,
  SourceRange,
} from "@ilic/language-service";
import type { SEdge, SModelElement, SModelRoot, SNode } from "sprotty-protocol";

export type EdgeRouting = "ORTHOGONAL" | "POLYLINE" | "SPLINES";
export type AttributeMode = "OWN" | "NONE" | "OWN_AND_INHERITED";

export interface DiagramSettings {
  readonly edgeRouting: EdgeRouting;
  readonly attributeMode: AttributeMode;
  readonly deemphasizeAbstractTypes: boolean;
  readonly showAssociationNames: boolean;
  readonly showRoleCardinalities: boolean;
  readonly showLocalEnumerationValues: boolean;
}

export const defaultDiagramSettings: DiagramSettings = {
  edgeRouting: "POLYLINE",
  attributeMode: "OWN",
  deemphasizeAbstractTypes: true,
  showAssociationNames: true,
  showRoleCardinalities: true,
  showLocalEnumerationValues: true,
};

export interface LayoutNode {
  readonly id: string;
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
  readonly source: DiagramEdge;
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

export async function layoutDiagram(
  projection: SemanticSnapshot["diagram"],
  settings: DiagramSettings = defaultDiagramSettings,
): Promise<LayoutDiagram> {
  const elk = new ELK();
  const visibleMembers = (node: DiagramNode) =>
    settings.attributeMode === "NONE"
      ? []
      : node.members.filter(
          (member) =>
            settings.attributeMode === "OWN_AND_INHERITED" || !member.inherited,
        );
  const input: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": settings.edgeRouting,
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
    },
    children: projection.nodes.map((node) => ({
      id: node.id,
      width: 240,
      height: 50 + visibleMembers(node).length * 22,
    })),
    edges: projection.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.sourceId],
      targets: [edge.targetId],
    })),
  };
  const graph = await elk.layout(input);
  const byId = new Map(projection.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(projection.edges.map((edge) => [edge.id, edge]));
  const nodes = (graph.children ?? []).flatMap((node) => {
    const source = byId.get(node.id);
    return source
      ? [
          {
            id: node.id,
            x: node.x ?? 0,
            y: node.y ?? 0,
            width: node.width ?? 240,
            height: node.height ?? 50,
            source,
          },
        ]
      : [];
  });
  const edges = (graph.edges ?? []).flatMap((edge) => {
    const source = edgeById.get(edge.id);
    if (!source) return [];
    const section = edge.sections?.[0];
    const points = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      : [];
    return [
      {
        id: edge.id,
        sourceId: source.sourceId,
        targetId: source.targetId,
        points,
        source,
      },
    ];
  });
  return { width: graph.width ?? 0, height: graph.height ?? 0, nodes, edges };
}

export function toSprottyModel(layout: LayoutDiagram): SModelRoot {
  const children: SModelElement[] = [
    ...layout.nodes.map((node): SNode => ({
      type: "node:interlis",
      id: node.id,
      position: { x: node.x, y: node.y },
      size: { width: node.width, height: node.height },
      children: [],
    })),
    ...layout.edges.map((edge): SEdge => ({
      type: "edge:interlis",
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
    })),
  ];
  return { type: "graph", id: "interlis-diagram", children };
}

const xml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
const domId = (value: string): string =>
  `ilic-${value.replaceAll(/[^A-Za-z0-9_.:-]/g, "-")}`;

export function renderSvg(
  layout: LayoutDiagram,
  settings: DiagramSettings = defaultDiagramSettings,
  viewport?: Viewport,
): string {
  const viewBox = viewport
    ? `${viewport.scrollX} ${viewport.scrollY} ${viewport.width / viewport.zoom} ${viewport.height / viewport.zoom}`
    : `0 0 ${Math.max(1, layout.width)} ${Math.max(1, layout.height)}`;
  const edges = layout.edges
    .map((edge) => {
      const points = edge.points
        .map((point) => `${point.x},${point.y}`)
        .join(" ");
      const label = [
        settings.showAssociationNames ? edge.source.label : "",
        settings.showRoleCardinalities ? edge.source.cardinality : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<g id="${domId(edge.id)}" class="ili-edge" data-edge-id="${xml(edge.id)}"><polyline points="${points}" fill="none" stroke="#59636e" stroke-width="1.5" inkscape:connection-start="#${domId(edge.sourceId)}" inkscape:connection-end="#${domId(edge.targetId)}"/><text class="ili-edge-label">${xml(label)}</text></g>`;
    })
    .join("");
  const nodes = layout.nodes
    .map((node) => {
      const members =
        settings.attributeMode === "NONE"
          ? []
          : node.source.members.filter(
              (member) =>
                settings.attributeMode === "OWN_AND_INHERITED" ||
                !member.inherited,
            );
      const opacity =
        settings.deemphasizeAbstractTypes && node.source.abstract ? 0.62 : 1;
      return `<g id="${domId(node.id)}" class="ili-node ili-${xml(node.source.kind.toLowerCase())}" data-symbol-id="${xml(node.id)}" data-source-uri="${xml(node.source.range?.uri ?? "")}" transform="translate(${node.x} ${node.y})" opacity="${opacity}"><rect width="${node.width}" height="${node.height}" rx="4" fill="#fff" stroke="#303942"/><text x="12" y="24" class="ili-title">${xml(node.source.label)}</text><g class="ili-members">${members.map((member, index) => `<text x="12" y="${50 + index * 22}" data-inherited="${String(member.inherited)}">${xml(member.name)} : ${xml(member.type)}</text>`).join("")}</g></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="${viewBox}" width="100%" height="100%" role="img"><rect class="ili-background" x="0" y="0" width="100%" height="100%" fill="#fff"/>${edges}${nodes}</svg>`;
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
