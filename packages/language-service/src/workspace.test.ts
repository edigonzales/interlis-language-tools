import { describe, expect, it, vi } from "vitest";
import {
  MemoryWorkspaceFileSystem,
  WorkspaceRepositoryResolver,
} from "./index.js";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("MemoryWorkspaceFileSystem", () => {
  it("supports directories, file metadata, recursive deletion and watcher disposal", async () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    const workspace = new MemoryWorkspaceFileSystem();
    const listener = vi.fn();
    const watcher = workspace.watch("memory:/project", listener);
    await workspace.createDirectory("memory:/project/models");
    await workspace.write("memory:/project/models/A.ili", bytes("A"));
    expect(await workspace.stat("memory:/project/models/A.ili")).toEqual({
      type: "file",
      size: 1,
      ctime: 42,
      mtime: 42,
    });
    await workspace.write("memory:/project/models/A.ili", bytes("AB"), {
      create: false,
    });
    await expect(
      workspace.delete("memory:/project", { recursive: false }),
    ).rejects.toThrow("not empty");
    await workspace.delete("memory:/project", { recursive: true });
    watcher.dispose();
    await workspace.createDirectory("memory:/project");
    expect(listener).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("enforces create, overwrite, file type and rename constraints", async () => {
    const workspace = new MemoryWorkspaceFileSystem();
    await expect(
      workspace.write("memory:/missing/A.ili", bytes("A"), { create: false }),
    ).rejects.toThrow("does not exist");
    await workspace.write("memory:/A.ili", bytes("A"));
    await expect(
      workspace.write("memory:/A.ili", bytes("B"), { overwrite: false }),
    ).rejects.toThrow("already exists");
    await workspace.createDirectory("memory:/models");
    await expect(workspace.read("memory:/models")).rejects.toThrow(
      "Not a file",
    );
    await expect(workspace.read("memory:/missing.ili")).rejects.toThrow(
      "does not exist",
    );
    await workspace.write("memory:/B.ili", bytes("B"));
    await expect(
      workspace.rename("memory:/A.ili", "memory:/B.ili"),
    ).rejects.toThrow("Target exists");
    await workspace.rename("memory:/A.ili", "memory:/B.ili", {
      overwrite: true,
    });
    expect(
      new TextDecoder().decode(await workspace.read("memory:/B.ili")),
    ).toBe("A");
  });
});

describe("WorkspaceRepositoryResolver", () => {
  it("walks directories and returns non-empty cached models", async () => {
    const workspace = new MemoryWorkspaceFileSystem();
    const resolver = new WorkspaceRepositoryResolver(workspace);
    await workspace.write("memory:/second/Units.ili", bytes("INTERLIS 2.4;"));
    expect(
      await resolver.resolve("Units", ["memory:/first", "memory:/second/"]),
    ).toMatchObject({
      model: "Units",
      uri: "memory:/second/Units.ili",
      cached: true,
    });
    expect(await resolver.resolve("Missing", ["memory:/second"])).toBeNull();
    await workspace.write("memory:/second/Empty.ili", bytes("  \n"));
    expect(await resolver.resolve("Empty", ["memory:/second"])).toBeNull();
  });
});
