#!/usr/bin/env node

const mirrors = [
  "https://geo.so.ch/models/mirror/interlis.ch/ilimodels.xml",
  "https://geo.so.ch/models/mirror/geoadmin/ilimodels.xml",
];

for (const uri of mirrors) {
  const response = await globalThis.fetch(uri, { method: "HEAD" });
  if (!response.ok)
    throw new Error(
      `${uri} returned ${response.status} ${response.statusText}`,
    );
  if (response.headers.get("access-control-allow-origin") !== "*")
    throw new Error(`${uri} does not expose Access-Control-Allow-Origin: *`);
  process.stdout.write(`CORS repository available: ${uri}\n`);
}
