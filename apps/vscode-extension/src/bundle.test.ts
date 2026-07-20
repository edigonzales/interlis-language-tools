import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dist = resolve(import.meta.dirname, "../dist");

const readBundle = (name: string): Promise<string> =>
  readFile(resolve(dist, name), "utf8");

const lspMessage = (message: unknown): string => {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
};

describe("VS Code extension bundles", () => {
  it("provides CommonJS globals only to the Node bundles", async () => {
    const [extensionNode, serverNode, extensionBrowser, serverBrowser] =
      await Promise.all([
        readBundle("extension-node.js"),
        readBundle("server-node.js"),
        readBundle("extension-browser.js"),
        readBundle("server-browser.js"),
      ]);

    for (const bundle of [extensionNode, serverNode]) {
      expect(bundle).toContain(
        'import { createRequire as __ilicCreateRequire } from "node:module";',
      );
      expect(bundle).toContain(
        "const require = __ilicCreateRequire(import.meta.url);",
      );
      expect(bundle).toContain(
        "const __filename = __ilicFileURLToPath(import.meta.url);",
      );
      expect(bundle).toContain("const __dirname = __ilicDirname(__filename);");
    }

    for (const bundle of [extensionBrowser, serverBrowser]) {
      expect(bundle).not.toContain("__ilicCreateRequire");
      expect(bundle).not.toContain('"child_process"');
    }
  });

  it("packages the executable language-client termination helper", async () => {
    const helper = await stat(resolve(dist, "terminateProcess.sh"));
    expect(helper.isFile()).toBe(true);
    expect(helper.mode & 0o111).not.toBe(0);
  });

  it("starts the bundled Node server with the real WASM compiler", async () => {
    const child = spawn(
      process.execPath,
      [resolve(dist, "server-node.js"), "--stdio"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";

    try {
      await new Promise<void>((resolveStarted, rejectStarted) => {
        const timeout = setTimeout(() => {
          cleanup();
          rejectStarted(
            new Error(`Language server startup timed out\n${stderr}`),
          );
        }, 10_000);
        const cleanup = (): void => {
          clearTimeout(timeout);
          child.stdout.off("data", onStdout);
          child.off("error", onError);
          child.off("exit", onExit);
        };
        const onStdout = (chunk: Buffer): void => {
          stdout += chunk.toString();
          if (stdout.includes('"id":1')) {
            cleanup();
            resolveStarted();
          }
        };
        const onError = (error: Error): void => {
          cleanup();
          rejectStarted(error);
        };
        const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
          cleanup();
          rejectStarted(
            new Error(
              `Language server exited during startup (${code ?? signal})\n${stderr}`,
            ),
          );
        };

        child.stdout.on("data", onStdout);
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once("error", onError);
        child.once("exit", onExit);
        child.stdin.write(
          lspMessage({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              processId: null,
              rootUri: null,
              capabilities: {},
              initializationOptions: { modelRepositories: [] },
            },
          }),
        );
      });

      expect(stdout).toContain('"name":"@ilic/language-server"');
      expect(stderr).not.toContain("Dynamic require");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await new Promise<void>((resolveExit) => {
          child.once("exit", () => resolveExit());
        });
      }
    }
  }, 15_000);
});
