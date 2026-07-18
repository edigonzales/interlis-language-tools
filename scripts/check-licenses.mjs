import { spawnSync } from "node:child_process";

const allowed = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "EPL-2.0",
  "(EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0)",
  "(MIT AND Zlib)",
  "(MIT OR GPL-3.0-or-later)",
]);
const result = spawnSync("pnpm", ["licenses", "list", "--prod", "--json"], {
  encoding: "utf8",
  stdio: "pipe",
});
if (result.status !== 0) throw new Error(result.stderr);
const report = JSON.parse(result.stdout);
const rejected = Object.keys(report).filter((license) => !allowed.has(license));
if (rejected.length > 0)
  throw new Error(`Unreviewed production licenses: ${rejected.join(", ")}`);
process.stdout.write(
  `Reviewed ${Object.keys(report).length} production license expressions.\n`,
);
