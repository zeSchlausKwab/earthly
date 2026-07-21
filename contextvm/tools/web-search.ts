import { serverConfig } from "../../src/config/env.server";
import type {
  WebSearchProvider,
  WebSearchResult,
} from "../web-schemas";
import { searchWikidata, wikipediaLookup } from "./wikipedia";

const USER_AGENT = "EarthlyCity/1.1 Map MCP Server (https://earthly.city)";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 8_000;

export interface WebSearchApiResult {
  query: string;
  count: number;
  coverage: "complete" | "partial" | "unavailable";
  providers: WebSearchProvider[];
  results: WebSearchResult[];
}

interface ProviderSuccess {
  name: string;
  results: WebSearchResult[];
}

export interface WebSearchDependencies {
  searxngUrl?: string;
  fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  wikipediaLookup: typeof wikipediaLookup;
  searchWikidata: typeof searchWikidata;
}

const defaultDependencies: WebSearchDependencies = {
  searxngUrl: serverConfig.searxngUrl,
  fetch: globalThis.fetch,
  wikipediaLookup,
  searchWikidata,
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizedResultUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/u, "");
    return url.toString();
  } catch {
    return value.trim();
  }
}

function mergeResults(groups: ProviderSuccess[], limit: number): WebSearchResult[] {
  const merged: WebSearchResult[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (merged.length < limit) {
    let added = false;
    for (const group of groups) {
      const result = group.results[offset];
      if (!result) continue;
      added = true;
      const key = normalizedResultUrl(result.url).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(result);
      if (merged.length >= limit) break;
    }
    if (!added) break;
    offset += 1;
  }

  return merged;
}

async function searchSearxng(
  query: string,
  limit: number,
  categories: string,
  language: string,
  dependencies: WebSearchDependencies,
): Promise<WebSearchResult[]> {
  const searxngUrl = dependencies.searxngUrl;
  if (!searxngUrl) throw new Error("SearXNG is not configured");

  const url = new URL("/search", searxngUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", categories);
  url.searchParams.set("language", language);

  const response = await dependencies.fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`SearXNG returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`SearXNG returned ${contentType || "an unknown content type"}, not JSON`);
  }

  const data = (await response.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      engine?: string;
      engines?: string[];
    }>;
  };
  return (Array.isArray(data.results) ? data.results : [])
    .flatMap((result) => {
      const url = result.url?.trim();
      const title = result.title?.trim();
      if (!url || !title) return [];
      return [{
        title,
        url,
        content: result.content?.trim() || "",
        engine: Array.isArray(result.engines)
          ? result.engines.join(", ")
          : result.engine || "searxng",
      }];
    })
    .slice(0, limit);
}

export async function webSearch(
  query: string,
  limit?: number,
  categories?: string,
  language?: string,
  dependencyOverrides: Partial<WebSearchDependencies> = {},
): Promise<WebSearchApiResult> {
  const trimmedQuery = query?.trim();
  if (!trimmedQuery) {
    throw new Error("Query parameter is required and must be non-empty");
  }
  const cappedLimit = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const resolvedLanguage = language?.trim() || "en";
  const providerLimit = Math.min(cappedLimit, 10);
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  const providers: Array<{ name: string; run: () => Promise<WebSearchResult[]> }> = [
    {
      name: "searxng",
      run: () => searchSearxng(
        trimmedQuery,
        cappedLimit,
        categories?.trim() || "general",
        resolvedLanguage,
        dependencies,
      ),
    },
    {
      name: "wikipedia",
      run: async () => {
        const result = await dependencies.wikipediaLookup({
          query: trimmedQuery,
          limit: providerLimit,
          language: resolvedLanguage,
        });
        return result.articles.map((article) => ({
          title: article.title,
          url: article.url,
          content: article.extract || article.description || "",
          engine: "wikipedia",
        }));
      },
    },
    {
      name: "wikidata",
      run: () => dependencies.searchWikidata(
        trimmedQuery,
        providerLimit,
        resolvedLanguage,
      ),
    },
  ];

  const settled = await Promise.allSettled(providers.map((provider) => provider.run()));
  const successes: ProviderSuccess[] = [];
  const providerHealth: WebSearchProvider[] = settled.map((result, index) => {
    const provider = providers[index]!;
    if (result.status === "fulfilled") {
      successes.push({ name: provider.name, results: result.value });
      return { name: provider.name, status: "ok", count: result.value.length };
    }
    const unavailable = provider.name === "searxng" && !dependencies.searxngUrl;
    return {
      name: provider.name,
      status: unavailable ? "unavailable" : "error",
      count: 0,
      error: errorMessage(result.reason),
    };
  });
  const okCount = providerHealth.filter((provider) => provider.status === "ok").length;
  const coverage = okCount === providers.length
    ? "complete"
    : okCount > 0
      ? "partial"
      : "unavailable";
  const results = mergeResults(successes, cappedLimit);

  return {
    query: trimmedQuery,
    count: results.length,
    coverage,
    providers: providerHealth,
    results,
  };
}
