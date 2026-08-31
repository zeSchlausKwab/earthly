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

const wikipediaInputStart = normalizedClient.indexOf("export interface WikipediaExtractInput");
const wikipediaOutputStart = normalizedClient.indexOf("export interface WikipediaExtractOutput");
const earthlyServerStart = normalizedClient.indexOf("export type EarthlyGeoServer", wikipediaOutputStart);
const wikipediaMethodStart = normalizedClient.indexOf("async WikipediaExtract(");
const wikipediaInput = wikipediaInputStart >= 0 && wikipediaOutputStart > wikipediaInputStart
  ? normalizedClient.slice(wikipediaInputStart, wikipediaOutputStart)
  : "";
const wikipediaOutput = wikipediaOutputStart >= 0 && earthlyServerStart > wikipediaOutputStart
  ? normalizedClient.slice(wikipediaOutputStart, earthlyServerStart)
  : "";
const wikipediaMethod = wikipediaMethodStart >= 0 ? normalizedClient.slice(wikipediaMethodStart) : "";

const requiredWikipediaInputFragments = [
  'mode?: "outline" | "article" | "section" | "table"',
  "revisionId?: number",
  "sectionIndex?: string",
  "sectionTitle?: string",
  "textOffset?: number",
  "textLimit?: number",
  "tableIndex?: number",
  "rowOffset?: number",
  "rowLimit?: number",
];
for (const fragment of requiredWikipediaInputFragments) {
  if (!wikipediaInput.includes(fragment)) {
    errors.push(`Generated Wikipedia input contract is missing: ${fragment}`);
  }
}

const requiredWikipediaOutputFragments = [
  'mode: "outline" | "article" | "section" | "table"',
  "revisionId: number | null",
  'scope: "article" | "section"',
  "textPagination?:",
  "returnedCharacters: number",
  "totalCharacters: number",
  "nextOffset: number | null",
  "pagination?:",
  "returnedRows: number",
  "totalRows: number",
];
for (const fragment of requiredWikipediaOutputFragments) {
  if (!wikipediaOutput.includes(fragment)) {
    errors.push(`Generated Wikipedia output contract is missing: ${fragment}`);
  }
}

const requiredWikipediaMethodFragments = [
  "revisionId?: number",
  "sectionIndex?: string",
  "sectionTitle?: string",
  "textOffset?: number",
  "textLimit?: number",
  "revisionId,",
  "sectionIndex,",
  "sectionTitle,",
  "textOffset,",
  "textLimit,",
];
for (const fragment of requiredWikipediaMethodFragments) {
  if (!wikipediaMethod.includes(fragment)) {
    errors.push(`Generated Wikipedia client method is missing: ${fragment}`);
  }
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
if (!serverVersion) errors.push("ContextVM server identity/version is missing");
if (!clientVersion) errors.push("ContextVM client identity/version is missing");

if (errors.length > 0) {
  console.error("ContextVM generated-client verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  console.error(
    "Run bun run ctxcn:update against the local server, then restore Earthly's marked runtime-policy block.",
  );
  process.exit(1);
}

console.log(
  `ContextVM server ${serverVersion}; client ${clientVersion}. The generated search contract and Earthly runtime safeguards are present.`,
);
