import { AvoidLib } from "libavoid-js";
import type { Avoid } from "libavoid-js";

export interface LibavoidNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly obstacle?: boolean;
}

export interface LibavoidEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
}

export type LibavoidRouting = "ORTHOGONAL" | "POLYLINE";

let avoidPromise: Promise<Avoid> | undefined;

const loadAvoid = (): Promise<Avoid> => {
  avoidPromise ??= AvoidLib.load()
    .then(() => AvoidLib.getInstance())
    .catch((error: unknown) => {
      avoidPromise = undefined;
      throw new Error(
        `Could not initialize the Inkscape-compatible router: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  return avoidPromise;
};

const fnv1a = (value: string): number => {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const numericIds = (values: readonly string[]): ReadonlyMap<string, number> => {
  const result = new Map<string, number>();
  const used = new Set<number>();
  for (const value of [...new Set(values)].sort()) {
    let candidate = fnv1a(value) & 0x7fffffff || 1;
    while (used.has(candidate))
      candidate = candidate === 0x7fffffff ? 1 : candidate + 1;
    used.add(candidate);
    result.set(value, candidate);
  }
  return result;
};

type RoutePoint = { readonly x: number; readonly y: number };

const centerOf = (node: LibavoidNode): RoutePoint => ({
  x: node.x + node.width / 2,
  y: node.y + node.height / 2,
});

const contains = (node: LibavoidNode, point: RoutePoint): boolean =>
  point.x >= node.x - 0.001 &&
  point.x <= node.x + node.width + 0.001 &&
  point.y >= node.y - 0.001 &&
  point.y <= node.y + node.height + 0.001;

const boundaryIntersection = (
  node: LibavoidNode,
  inside: RoutePoint,
  outside: RoutePoint,
): RoutePoint => {
  const dx = outside.x - inside.x;
  const dy = outside.y - inside.y;
  const candidates = [
    dx > 0 ? (node.x + node.width - inside.x) / dx : undefined,
    dx < 0 ? (node.x - inside.x) / dx : undefined,
    dy > 0 ? (node.y + node.height - inside.y) / dy : undefined,
    dy < 0 ? (node.y - inside.y) / dy : undefined,
  ].filter(
    (value): value is number => value !== undefined && value >= 0 && value <= 1,
  );
  const factor = Math.min(...candidates);
  if (!Number.isFinite(factor)) return outside;
  return { x: inside.x + dx * factor, y: inside.y + dy * factor };
};

/**
 * Inkscape gives libavoid the visual centres of connected objects, then trims
 * the displayed path at the objects' outlines. Mirror that two-stage process
 * so opening an exported live connector does not immediately change its ends.
 */
const clipConnectedEnds = (
  values: readonly RoutePoint[],
  source: LibavoidNode,
  target: LibavoidNode,
): readonly RoutePoint[] => {
  let sourceOutsideIndex = 1;
  while (
    sourceOutsideIndex < values.length &&
    contains(source, values[sourceOutsideIndex]!)
  )
    sourceOutsideIndex++;
  if (sourceOutsideIndex >= values.length) return values;
  const sourceInside = values[sourceOutsideIndex - 1]!;
  const sourceOutside = values[sourceOutsideIndex]!;
  const sourceBoundary = boundaryIntersection(
    source,
    sourceInside,
    sourceOutside,
  );
  const sourceClipped = [sourceBoundary, ...values.slice(sourceOutsideIndex)];

  let targetOutsideIndex = sourceClipped.length - 2;
  while (
    targetOutsideIndex >= 0 &&
    contains(target, sourceClipped[targetOutsideIndex]!)
  )
    targetOutsideIndex--;
  if (targetOutsideIndex < 0) return sourceClipped;
  const targetOutside = sourceClipped[targetOutsideIndex]!;
  const targetInside = sourceClipped[targetOutsideIndex + 1]!;
  const targetBoundary = boundaryIntersection(
    target,
    targetInside,
    targetOutside,
  );
  return [...sourceClipped.slice(0, targetOutsideIndex + 1), targetBoundary];
};

const distinctPoints = (
  values: readonly { readonly x: number; readonly y: number }[],
): readonly { readonly x: number; readonly y: number }[] =>
  values.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(
        point.x - values[index - 1]!.x,
        point.y - values[index - 1]!.y,
      ) > 0.001,
  );

export async function routeWithLibavoid(
  nodes: readonly LibavoidNode[],
  edges: readonly LibavoidEdge[],
  routing: LibavoidRouting,
): Promise<ReadonlyMap<string, readonly { x: number; y: number }[]>> {
  if (edges.length === 0) return new Map();
  const Avoid = await loadAvoid();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ids = numericIds([
    ...nodes
      .filter((node) => node.obstacle !== false)
      .map((node) => `node:${node.id}`),
    ...edges.map((edge) => `edge:${edge.id}`),
  ]);
  const flags =
    Avoid.RouterFlag.PolyLineRouting.value |
    Avoid.RouterFlag.OrthogonalRouting.value;
  const router = new Avoid.Router(flags);
  const connectors = new Map<string, InstanceType<Avoid["ConnRef"]>>();
  try {
    for (const node of [...nodes].sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      if (node.obstacle === false) continue;
      const rectangle = new Avoid.Rectangle(
        new Avoid.Point(node.x, node.y),
        new Avoid.Point(node.x + node.width, node.y + node.height),
      );
      new Avoid.ShapeRef(router, rectangle, ids.get(`node:${node.id}`));
    }
    for (const edge of [...edges].sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      if (!source || !target)
        throw new Error(
          `Cannot route ${edge.id}: source or target box is missing.`,
        );
      const start = centerOf(source);
      const end = centerOf(target);
      const connector = new Avoid.ConnRef(
        router,
        new Avoid.ConnEnd(new Avoid.Point(start.x, start.y)),
        new Avoid.ConnEnd(new Avoid.Point(end.x, end.y)),
        ids.get(`edge:${edge.id}`),
      );
      connector.setRoutingType(
        routing === "ORTHOGONAL"
          ? Avoid.ConnType.ConnType_Orthogonal
          : Avoid.ConnType.ConnType_PolyLine,
      );
      connectors.set(edge.id, connector);
    }
    router.processTransaction();
    const result = new Map<
      string,
      readonly { readonly x: number; readonly y: number }[]
    >();
    for (const edge of edges) {
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      if (!source || !target)
        throw new Error(
          `Cannot read ${edge.id}: source or target box is missing.`,
        );
      const route = connectors.get(edge.id)?.displayRoute();
      if (!route)
        throw new Error(`The Inkscape-compatible router omitted ${edge.id}.`);
      const points = distinctPoints(
        Array.from({ length: route.size() }, (_, index) => {
          const point = route.at(index);
          return { x: point.x, y: point.y };
        }),
      );
      if (points.length < 2)
        throw new Error(
          `The Inkscape-compatible route for ${edge.id} is incomplete.`,
        );
      result.set(
        edge.id,
        distinctPoints(clipConnectedEnds(points, source, target)),
      );
    }
    return result;
  } finally {
    router.delete();
  }
}
