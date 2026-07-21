import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const USER_AGENT = "EarthlyCity/1.1 Map MCP Server (https://earthly.city)";
const DEFAULT_MAX_LENGTH = 10_000;
const MAX_MAX_LENGTH = 50_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// Keep address families in separate lists. Bun's Node compatibility layer can
// otherwise match public IPv4 addresses against an IPv6 rule.
const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export interface FetchUrlResult {
  url: string;
  title: string | null;
  siteName: string | null;
  description: string | null;
  textContent: string;
  textLength: number;
  truncated: boolean;
  fetchedAt: string;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal");
}

export function isBlockedFetchAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedIpv4Addresses.check(address, "ipv4");
  if (family === 6) return blockedIpv6Addresses.check(address, "ipv6");
  return true;
}

async function assertPublicHttpUrl(url: URL): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(
      `Unsupported protocol: ${url.protocol}. Only http and https are supported.`,
    );
  }
  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not supported.");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error("Fetching local or private network hosts is not allowed.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedFetchAddress(address))) {
    throw new Error("Fetching local, private, or reserved network addresses is not allowed.");
  }
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(
      `Response too large: ${declaredLength} bytes (max ${MAX_RESPONSE_BYTES})`,
    );
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel("response exceeded byte limit");
      throw new Error(`Response too large (max ${MAX_RESPONSE_BYTES} bytes)`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchWithValidatedRedirects(
  initialUrl: URL,
  signal: AbortSignal,
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicHttpUrl(currentUrl);
    const response = await fetch(currentUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1",
      },
      signal,
      redirect: "manual",
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: currentUrl };
    }
    const location = response.headers.get("location");
    if (!location) throw new Error(`Redirect ${response.status} did not include a location`);
    if (redirectCount === MAX_REDIRECTS) {
      throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
    }
    currentUrl = new URL(location, currentUrl);
  }
  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}

export async function fetchUrl(
  url: string,
  maxLength?: number,
): Promise<FetchUrlResult> {
  const trimmedUrl = url?.trim();
  if (!trimmedUrl) {
    throw new Error("URL parameter is required and must be non-empty");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error(`Invalid URL: ${trimmedUrl}`);
  }
  const cappedMaxLength = Math.min(
    Math.max(maxLength ?? DEFAULT_MAX_LENGTH, 100),
    MAX_MAX_LENGTH,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const { response, finalUrl } = await fetchWithValidatedRedirects(
      parsedUrl,
      controller.signal,
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    const isHtml = contentType.includes("text/html") ||
      contentType.includes("application/xhtml");
    const isReadableText = isHtml ||
      contentType.startsWith("text/") ||
      contentType.includes("json") ||
      contentType.includes("xml");
    if (!isReadableText) {
      throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
    }
    const body = await readLimitedBody(response);

    if (!isHtml) {
      const truncated = body.length > cappedMaxLength;
      return {
        url: finalUrl.toString(),
        title: null,
        siteName: null,
        description: null,
        textContent: body.slice(0, cappedMaxLength),
        textLength: body.length,
        truncated,
        fetchedAt: new Date().toISOString(),
      };
    }

    const { document } = parseHTML(body);
    // biome-ignore lint/suspicious/noExplicitAny: linkedom Document is compatible but types differ
    const reader = new Readability(document as any);
    const article = reader.parse();
    const metaDescription = document
      .querySelector('meta[name="description"]')
      ?.getAttribute("content") || null;
    const ogDescription = document
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content") || null;
    const ogSiteName = document
      .querySelector('meta[property="og:site_name"]')
      ?.getAttribute("content") || null;
    const fullText = article?.textContent || document.body?.textContent || "";
    const cleanText = fullText.replace(/\s+/gu, " ").trim();
    const truncated = cleanText.length > cappedMaxLength;

    return {
      url: finalUrl.toString(),
      title: article?.title || document.title || null,
      siteName: article?.siteName || ogSiteName || null,
      description: metaDescription || ogDescription || null,
      textContent: cleanText.slice(0, cappedMaxLength),
      textLength: cleanText.length,
      truncated,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
