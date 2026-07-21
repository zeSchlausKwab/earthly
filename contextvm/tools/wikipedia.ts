import type { WikipediaArticle } from "../web-schemas";

const USER_AGENT = "EarthlyCity/1.0 Map MCP Server (https://earthly.city)";
const DEFAULT_LIMIT = 5;
const DEFAULT_RADIUS = 1000;
const MAX_RADIUS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_EXTRACT_CHARS = 4000;

export interface WikipediaLookupResult {
  mode: "search" | "title" | "geosearch";
  query: string;
  count: number;
  articles: WikipediaArticle[];
}

export interface WikidataSearchResult {
  title: string;
  url: string;
  content: string;
  engine: "wikidata";
}

function wikiApiBase(language: string): string {
  return `https://${language}.wikipedia.org/w/api.php`;
}

function normalizeLanguage(language: string | undefined): string {
  const normalized = language?.trim().toLowerCase() || "en";
  if (!/^[a-z][a-z0-9-]{0,11}$/u.test(normalized)) {
    throw new Error("Invalid Wikipedia language code");
  }
  return normalized;
}

function wikiArticleUrl(language: string, title: string): string {
  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

async function fetchWikiApi(
  baseUrl: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(baseUrl);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Wikipedia API error: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as Record<string, unknown>;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Wikipedia request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchByQuery(
  query: string,
  limit: number,
  language: string,
): Promise<WikipediaLookupResult> {
  const data = await fetchWikiApi(wikiApiBase(language), {
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: limit.toString(),
    gsrnamespace: "0",
    prop: "extracts|coordinates|description",
    exintro: "1",
    explaintext: "1",
    exlimit: limit.toString(),
    redirects: "1",
  });

  const wikiQuery = data.query as
    | { pages?: Record<string, Record<string, unknown>> }
    | undefined;
  const pages = Object.entries(wikiQuery?.pages || {}).sort(([, left], [, right]) => {
    const leftIndex = typeof left.index === "number" ? left.index : Number.MAX_SAFE_INTEGER;
    const rightIndex = typeof right.index === "number" ? right.index : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
  const articles: WikipediaArticle[] = [];

  for (const [pageId, page] of pages) {
    let extract = typeof page.extract === "string" ? page.extract : "";
    if (extract.length > MAX_EXTRACT_CHARS) {
      extract = `${extract.slice(0, MAX_EXTRACT_CHARS)}...`;
    }
    const coords = (
      page.coordinates as Array<{ lat: number; lon: number }> | undefined
    )?.[0];
    const title = typeof page.title === "string" ? page.title : query;

    articles.push({
      title,
      pageId: Number.parseInt(pageId),
      url: wikiArticleUrl(language, title),
      extract,
      coordinates: coords ? { lat: coords.lat, lon: coords.lon } : null,
      description: typeof page.description === "string" ? page.description : null,
    });
  }

  return {
    mode: "search",
    query,
    count: articles.length,
    articles,
  };
}

export async function searchWikidata(
  query: string,
  limit: number,
  language: string,
): Promise<WikidataSearchResult[]> {
  const normalizedLanguage = normalizeLanguage(language);
  const data = await fetchWikiApi("https://www.wikidata.org/w/api.php", {
    action: "wbsearchentities",
    search: query,
    language: normalizedLanguage,
    uselang: normalizedLanguage,
    type: "item",
    limit: limit.toString(),
  });
  const results = Array.isArray(data.search)
    ? (data.search as Array<Record<string, unknown>>)
    : [];

  return results.flatMap((item) => {
    const id = typeof item.id === "string" ? item.id : "";
    const label = typeof item.label === "string" ? item.label : id;
    if (!id || !label) return [];
    const description =
      typeof item.description === "string" ? item.description.trim() : "";
    const aliases = Array.isArray(item.aliases)
      ? item.aliases.filter((alias): alias is string => typeof alias === "string").slice(0, 4)
      : [];
    const content = [description, aliases.length > 0 ? `Also known as: ${aliases.join(", ")}` : ""]
      .filter(Boolean)
      .join(". ");
    return [{
      title: label,
      url: `https://www.wikidata.org/wiki/${encodeURIComponent(id)}`,
      content,
      engine: "wikidata" as const,
    }];
  });
}

async function lookupByTitle(
  title: string,
  language: string,
): Promise<WikipediaLookupResult> {
  const data = await fetchWikiApi(wikiApiBase(language), {
    action: "query",
    prop: "extracts|coordinates|description",
    exintro: "1",
    explaintext: "1",
    exlimit: "1",
    titles: title,
    redirects: "1",
  });

  const query = data.query as
    | { pages?: Record<string, Record<string, unknown>> }
    | undefined;
  const pages = query?.pages || {};
  const articles: WikipediaArticle[] = [];

  for (const [pageId, page] of Object.entries(pages)) {
    if (pageId === "-1" || (page as Record<string, unknown>).missing !== undefined)
      continue;

    let extract = (page.extract as string) || "";
    if (extract.length > MAX_EXTRACT_CHARS) {
      extract = `${extract.slice(0, MAX_EXTRACT_CHARS)}...`;
    }

    const coords = (
      page.coordinates as Array<{ lat: number; lon: number }> | undefined
    )?.[0];

    articles.push({
      title: page.title as string,
      pageId: Number.parseInt(pageId),
      url: wikiArticleUrl(language, page.title as string),
      extract,
      coordinates: coords ? { lat: coords.lat, lon: coords.lon } : null,
      description: (page.description as string) || null,
    });
  }

  return {
    mode: "title",
    query: title,
    count: articles.length,
    articles,
  };
}

async function lookupByCoordinates(
  lat: number,
  lon: number,
  radius: number,
  limit: number,
  language: string,
): Promise<WikipediaLookupResult> {
  // Step 1: geosearch to find nearby articles
  const geoData = await fetchWikiApi(wikiApiBase(language), {
    action: "query",
    list: "geosearch",
    gscoord: `${lat}|${lon}`,
    gsradius: radius.toString(),
    gslimit: limit.toString(),
  });

  const geoQuery = geoData.query as
    | {
        geosearch?: Array<{
          pageid: number;
          title: string;
          lat: number;
          lon: number;
        }>;
      }
    | undefined;
  const geoResults = geoQuery?.geosearch || [];

  if (geoResults.length === 0) {
    return {
      mode: "geosearch",
      query: `${lat},${lon} r=${radius}m`,
      count: 0,
      articles: [],
    };
  }

  // Step 2: fetch extracts for found pages
  const pageIds = geoResults.map((r) => r.pageid).join("|");
  const extraData = await fetchWikiApi(wikiApiBase(language), {
    action: "query",
    prop: "extracts|description",
    exintro: "1",
    explaintext: "1",
    exlimit: limit.toString(),
    pageids: pageIds,
  });

  const extraQuery = extraData.query as
    | { pages?: Record<string, Record<string, unknown>> }
    | undefined;
  const pages = extraQuery?.pages || {};
  const articles: WikipediaArticle[] = [];

  for (const geoResult of geoResults) {
    const page = pages[geoResult.pageid.toString()];
    if (!page) continue;

    let extract = (page.extract as string) || "";
    if (extract.length > MAX_EXTRACT_CHARS) {
      extract = `${extract.slice(0, MAX_EXTRACT_CHARS)}...`;
    }

    articles.push({
      title: (page.title as string) || geoResult.title,
      pageId: geoResult.pageid,
      url: wikiArticleUrl(
        language,
        (page.title as string) || geoResult.title,
      ),
      extract,
      coordinates: {
        lat: geoResult.lat,
        lon: geoResult.lon,
      },
      description: (page.description as string) || null,
    });
  }

  return {
    mode: "geosearch",
    query: `${lat},${lon} r=${radius}m`,
    count: articles.length,
    articles,
  };
}

export async function wikipediaLookup(options: {
  query?: string;
  title?: string;
  lat?: number;
  lon?: number;
  radius?: number;
  limit?: number;
  language?: string;
}): Promise<WikipediaLookupResult> {
  const lang = normalizeLanguage(options.language);
  const hasQuery =
    typeof options.query === "string" && options.query.trim().length > 0;
  const hasTitle =
    typeof options.title === "string" && options.title.trim().length > 0;
  const hasCoords =
    typeof options.lat === "number" && typeof options.lon === "number";

  if (!hasQuery && !hasTitle && !hasCoords) {
    throw new Error(
      "Either 'query', 'title', or both 'lat' and 'lon' must be provided.",
    );
  }

  if (hasQuery) {
    return searchByQuery(
      options.query!.trim(),
      Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 10),
      lang,
    );
  }

  if (hasTitle) {
    return lookupByTitle(options.title!.trim(), lang);
  }

  return lookupByCoordinates(
    options.lat!,
    options.lon!,
    Math.min(Math.max(options.radius ?? DEFAULT_RADIUS, 10), MAX_RADIUS),
    Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 10),
    lang,
  );
}
