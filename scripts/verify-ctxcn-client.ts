#!/usr/bin/env bun

const clientPath = "src/ctxcn/EarthlyGeoServerClient.ts";
const serverPath = "contextvm/server.ts";
const client = await Bun.file(clientPath).text();
const server = await Bun.file(serverPath).text();
const normalizedClient = client.replaceAll("'", '"');
const normalizedServer = server.replaceAll("'", '"');
const errors: string[] = [];

const requiredClientFragments = [
  'coverage: "complete" | "partial" | "unavailable"',
  'mode: "search" | "title" | "geosearch"',
  "export interface WikipediaExtractInput",
  'mode: "outline" | "table"',
  'status: "complete" | "more" | "final_page"',
  "nextOffset: number | null",
  "async WikipediaExtract(",
  "getContextVmSessionPrivateKey()",
  'readRelaysFor("discovery")',
  "private connectionPromise: Promise<void>",
  "await this.connectionPromise",
  "async listTools()",
  "async callRemoteTool<T = unknown>",
  "if (result.isError)",
  "oversizedTransfer: { enabled: true }",
];
for (const fragment of requiredClientFragments) {
  if (!normalizedClient.includes(fragment)) errors.push(`Generated client is missing: ${fragment}`);
}
if (client.includes('const resolvedPrivateKey = options.privateKey ||\n      ""')) {
  errors.push("Generated client reverted to an empty shared private key");
}
if (client.includes('static readonly DEFAULT_RELAYS = ["ws://localhost:3334"')) {
  errors.push("Generated standalone defaults must not send production traffic to localhost");
}

const serverVersion = normalizedServer.match(
  /name:\s*"earthly-geo-server",\s*\n\s*version:\s*"([^"]+)"/u,
)?.[1];
const clientVersion = normalizedClient.match(
  /name:\s*"EarthlyGeoServerClient",\s*\n\s*version:\s*"([^"]+)"/u,
)?.[1];
if (!serverVersion || !clientVersion || serverVersion !== clientVersion) {
  errors.push(`ContextVM version mismatch: server=${serverVersion || "?"}, client=${clientVersion || "?"}`);
}

if (errors.length > 0) {
  console.error("ContextVM generated-client verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  console.error(
    "Run bun run ctxcn:update against the local server, then restore Earthly's marked runtime-policy block.",
  );
  process.exit(1);
}

console.log(
  `ContextVM client ${clientVersion} contains the generated search contract and Earthly runtime safeguards.`,
);
