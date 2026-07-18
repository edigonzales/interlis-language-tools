export type FileType = "file" | "directory";

export interface FileStat {
  readonly type: FileType;
  readonly size: number;
  readonly ctime: number;
  readonly mtime: number;
}

export interface FileChange {
  readonly type: "created" | "changed" | "deleted";
  readonly uri: string;
}

export interface Disposable {
  dispose(): void;
}

export interface WorkspaceFileSystem {
  stat(uri: string): Promise<FileStat>;
  read(uri: string): Promise<Uint8Array>;
  write(
    uri: string,
    content: Uint8Array,
    options?: { create?: boolean; overwrite?: boolean },
  ): Promise<void>;
  readDirectory(
    uri: string,
  ): Promise<readonly [name: string, type: FileType][]>;
  createDirectory(uri: string): Promise<void>;
  delete(uri: string, options?: { recursive?: boolean }): Promise<void>;
  rename(
    from: string,
    to: string,
    options?: { overwrite?: boolean },
  ): Promise<void>;
  watch(
    uri: string,
    listener: (changes: readonly FileChange[]) => void,
  ): Disposable;
}

interface MemoryEntry {
  type: FileType;
  content: Uint8Array;
  ctime: number;
  mtime: number;
}

function normalize(uri: string): string {
  return uri.replace(/\/+$/, "") || "/";
}

function parent(uri: string): string {
  const value = normalize(uri);
  const index = value.lastIndexOf("/");
  return index <= value.indexOf(":") + 1
    ? value.slice(0, index + 1)
    : value.slice(0, index);
}

/** Deterministic in-memory implementation used by adapters, tests and ephemeral workspaces. */
export class MemoryWorkspaceFileSystem implements WorkspaceFileSystem {
  readonly #entries = new Map<string, MemoryEntry>();
  readonly #watchers = new Map<
    number,
    { uri: string; listener: (changes: readonly FileChange[]) => void }
  >();
  #watcherId = 0;

  constructor() {
    this.#entries.set("memory:", {
      type: "directory",
      content: new Uint8Array(),
      ctime: Date.now(),
      mtime: Date.now(),
    });
  }

  stat(uri: string): Promise<FileStat> {
    try {
      const entry = this.#required(uri);
      return Promise.resolve({
        type: entry.type,
        size: entry.content.byteLength,
        ctime: entry.ctime,
        mtime: entry.mtime,
      });
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  read(uri: string): Promise<Uint8Array> {
    try {
      const entry = this.#required(uri);
      if (entry.type !== "file")
        return Promise.reject(new Error(`Not a file: ${uri}`));
      return Promise.resolve(entry.content.slice());
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  async write(
    uri: string,
    content: Uint8Array,
    options: { create?: boolean; overwrite?: boolean } = {},
  ): Promise<void> {
    const key = normalize(uri);
    const existing = this.#entries.get(key);
    if (!existing && options.create === false)
      throw new Error(`File does not exist: ${uri}`);
    if (existing && options.overwrite === false)
      throw new Error(`File already exists: ${uri}`);
    await this.#ensureParents(key);
    const now = Date.now();
    this.#entries.set(key, {
      type: "file",
      content: content.slice(),
      ctime: existing?.ctime ?? now,
      mtime: now,
    });
    this.#emit(key, existing ? "changed" : "created");
  }

  readDirectory(
    uri: string,
  ): Promise<readonly [name: string, type: FileType][]> {
    const directory = normalize(uri);
    const result = new Map<string, FileType>();
    for (const [key, entry] of this.#entries) {
      if (key === directory || parent(key) !== directory) continue;
      result.set(key.slice(directory.length).replace(/^\//, ""), entry.type);
    }
    return Promise.resolve(
      [...result].sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  async createDirectory(uri: string): Promise<void> {
    const key = normalize(uri);
    if (this.#entries.has(key)) return;
    await this.#ensureParents(key);
    const now = Date.now();
    this.#entries.set(key, {
      type: "directory",
      content: new Uint8Array(),
      ctime: now,
      mtime: now,
    });
    this.#emit(key, "created");
  }

  delete(uri: string, options: { recursive?: boolean } = {}): Promise<void> {
    const key = normalize(uri);
    const descendants = [...this.#entries.keys()].filter(
      (candidate) =>
        parent(candidate) === key || candidate.startsWith(`${key}/`),
    );
    if (descendants.length > 0 && !options.recursive)
      return Promise.reject(new Error(`Directory is not empty: ${uri}`));
    for (const candidate of [key, ...descendants])
      this.#entries.delete(candidate);
    this.#emit(key, "deleted");
    return Promise.resolve();
  }

  async rename(
    from: string,
    to: string,
    options: { overwrite?: boolean } = {},
  ): Promise<void> {
    const source = normalize(from);
    const target = normalize(to);
    const entry = this.#required(source);
    if (this.#entries.has(target) && !options.overwrite)
      throw new Error(`Target exists: ${to}`);
    await this.#ensureParents(target);
    const moving = [...this.#entries].filter(
      ([key]) => key === source || key.startsWith(`${source}/`),
    );
    for (const [key] of moving) this.#entries.delete(key);
    for (const [key, value] of moving)
      this.#entries.set(`${target}${key.slice(source.length)}`, value);
    this.#emit(source, "deleted");
    this.#emit(target, entry ? "created" : "changed");
  }

  watch(
    uri: string,
    listener: (changes: readonly FileChange[]) => void,
  ): Disposable {
    const id = ++this.#watcherId;
    this.#watchers.set(id, { uri: normalize(uri), listener });
    return { dispose: () => this.#watchers.delete(id) };
  }

  #required(uri: string): MemoryEntry {
    const entry = this.#entries.get(normalize(uri));
    if (!entry) throw new Error(`File does not exist: ${uri}`);
    return entry;
  }

  async #ensureParents(uri: string): Promise<void> {
    const directory = parent(uri);
    if (!directory || directory === uri || this.#entries.has(directory)) return;
    await this.#ensureParents(directory);
    const now = Date.now();
    this.#entries.set(directory, {
      type: "directory",
      content: new Uint8Array(),
      ctime: now,
      mtime: now,
    });
  }

  #emit(uri: string, type: FileChange["type"]): void {
    const change = [{ uri, type }] as const;
    for (const watcher of this.#watchers.values()) {
      if (uri === watcher.uri || uri.startsWith(`${watcher.uri}/`))
        watcher.listener(change);
    }
  }
}
