import { describe, expect, it } from "vitest";
import { routeWithLibavoid } from "./libavoid-router.js";

const nodes = [
  { id: "source", x: 0, y: 20, width: 80, height: 60 },
  { id: "obstacle", x: 140, y: 0, width: 80, height: 140 },
  { id: "target", x: 300, y: 60, width: 80, height: 60 },
];

const edges = [
  {
    id: "source-target",
    sourceId: "source",
    targetId: "target",
  },
];

describe("libavoid adapter", () => {
  it("routes all edges in deterministic orthogonal and polyline transactions", async () => {
    for (const routing of ["ORTHOGONAL", "POLYLINE"] as const) {
      const first = await routeWithLibavoid(nodes, edges, routing);
      const second = await routeWithLibavoid(nodes, edges, routing);
      const route = first.get("source-target");
      expect(route).toEqual(second.get("source-target"));
      expect(route?.length).toBeGreaterThanOrEqual(2);
      expect(route?.every((point) => Number.isFinite(point.x))).toBe(true);
      expect(route?.every((point) => Number.isFinite(point.y))).toBe(true);
      expect(route?.[0]).toSatisfy(
        (point: { x: number; y: number }) =>
          point.x === 80 || point.y === 20 || point.y === 80,
      );
      expect(route?.at(-1)).toSatisfy(
        (point: { x: number; y: number }) =>
          point.x === 300 || point.y === 60 || point.y === 120,
      );
      if (routing === "ORTHOGONAL")
        for (let index = 1; index < (route?.length ?? 0); index++) {
          const previous = route![index - 1]!;
          const current = route![index]!;
          expect(previous.x === current.x || previous.y === current.y).toBe(
            true,
          );
        }
    }
  });

  it("can be reused repeatedly after native router cleanup", async () => {
    for (let iteration = 0; iteration < 20; iteration++)
      expect(
        (await routeWithLibavoid(nodes, edges, "ORTHOGONAL")).get(
          "source-target",
        ),
      ).toBeDefined();
  });

  it("can connect through containers without treating them as obstacles", async () => {
    const aligned = [
      { id: "source", x: 0, y: 20, width: 80, height: 60 },
      {
        id: "container",
        x: 140,
        y: 0,
        width: 80,
        height: 140,
        obstacle: false,
      },
      { id: "target", x: 300, y: 20, width: 80, height: 60 },
    ];
    const route = (await routeWithLibavoid(aligned, edges, "ORTHOGONAL")).get(
      "source-target",
    );
    expect(route).toEqual([
      { x: 80, y: 50 },
      { x: 300, y: 50 },
    ]);
  });
});
