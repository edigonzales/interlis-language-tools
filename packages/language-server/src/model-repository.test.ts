import { describe, expect, it, vi } from "vitest";
import type { RepositoryManager } from "@ilic/tools";
import {
  browserRepositoryUrls,
  ToolsModelRepository,
  toVirtualRepositoryModel,
  virtualRepositoryUri,
} from "./model-repository.js";

const metadata = {
  name: "Units",
  file: "Units.ili",
  repository: "https://models.example",
  dependencies: [],
  schemaLanguage: "ili2_3",
  version: "2026-01",
  publishingDate: "",
  precursorVersion: "",
  md5: "",
  browseOnly: false,
};

describe("ToolsModelRepository", () => {
  it("maps catalogs and the resolved dependency closure", async () => {
    const manager = {
      listModels: vi.fn(() =>
        Promise.resolve([
          metadata,
          { ...metadata, name: "Legacy", schemaLanguage: "ili1" },
        ]),
      ),
      resolveWorkspace: vi.fn(() =>
        Promise.resolve({
          models: [
            {
              metadata,
              uri: "https://models.example/Units.ili",
              source: "INTERLIS 2.3; MODEL Units = END Units.",
              fromCache: true,
            },
          ],
        }),
      ),
    } as unknown as RepositoryManager;
    const repository = new ToolsModelRepository(
      manager,
      toVirtualRepositoryModel,
    );
    expect((await repository.listModels()).map((model) => model.name)).toEqual([
      "Units",
    ]);
    const resolved = await repository.resolveModels(["Units"], "ili2_3");
    expect(resolved[0]?.readOnly).toBe(true);
    expect(resolved[0]?.fromCache).toBe(true);
    expect(resolved[0]?.uri).toMatch(/^interlis-repository:\/ili2_3\/Units\//);
  });

  it("uses both CORS mirrors and deduplicates aliases", () => {
    expect(
      browserRepositoryUrls([
        "https://models.interlis.ch/",
        "https://models.geo.admin.ch",
      ]),
    ).toEqual([
      "https://geo.so.ch/models/mirror/interlis.ch",
      "https://geo.so.ch/models/mirror/geoadmin",
    ]);
    expect(
      virtualRepositoryUri(
        {
          metadata,
          uri: "https://models.example/Units.ili",
          source: "",
          fromCache: false,
        },
        "ili2_3",
      ),
    ).toMatch(/\.ili$/u);
  });
});
