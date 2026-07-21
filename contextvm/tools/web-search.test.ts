import { describe, expect, test } from "bun:test";
import type { WikipediaLookupResult } from "./wikipedia";
import { webSearch } from "./web-search";

const wikipediaResult: WikipediaLookupResult = {
  mode: "search",
  query: "roman ruins",
  count: 2,
  articles: [
    {
      title: "Roman ruins",
      pageId: 1,
      url: "https://en.wikipedia.org/wiki/Roman_ruins",
      extract: "Archaeological remains from the Roman period.",
      coordinates: null,
      description: null,
    },
    {
      title: "Roman archaeology",
      pageId: 2,
      url: "https://en.wikipedia.org/wiki/Roman_archaeology",
      extract: "The archaeology of ancient Rome.",
      coordinates: null,
      description: null,
    },
  ],
};

describe("federated web search", () => {
  test("returns wiki results and provider health when SearXNG is unavailable", async () => {
    const result = await webSearch("roman ruins", 5, undefined, "en", {
      searxngUrl: undefined,
      wikipediaLookup: async () => wikipediaResult,
      searchWikidata: async () => [{
        title: "Roman ruins",
        url: "https://www.wikidata.org/wiki/Q123",
        content: "archaeological site type",
        engine: "wikidata",
      }],
      fetch: async () => {
        throw new Error("SearXNG fetch should not run without a URL");
      },
    });

    expect(result.coverage).toBe("partial");
    expect(result.count).toBe(3);
    expect(result.results.map((item) => item.engine)).toEqual([
      "wikipedia",
      "wikidata",
      "wikipedia",
    ]);
    expect(result.providers).toEqual([
      {
        name: "searxng",
        status: "unavailable",
        count: 0,
        error: "SearXNG is not configured",
      },
      { name: "wikipedia", status: "ok", count: 2 },
      { name: "wikidata", status: "ok", count: 1 },
    ]);
  });

  test("keeps useful results when SearXNG returns an HTML challenge", async () => {
    const result = await webSearch("roman ruins", 3, undefined, "en", {
      searxngUrl: "https://search.example",
      wikipediaLookup: async () => wikipediaResult,
      searchWikidata: async () => [],
      fetch: async () => new Response("<html>challenge</html>", {
        headers: { "content-type": "text/html" },
      }),
    });

    expect(result.coverage).toBe("partial");
    expect(result.results).toHaveLength(2);
    expect(result.providers.find((provider) => provider.name === "searxng")).toEqual({
      name: "searxng",
      status: "error",
      count: 0,
      error: "SearXNG returned text/html, not JSON",
    });
  });

  test("interleaves providers and removes duplicate URLs", async () => {
    const result = await webSearch("roman ruins", 5, undefined, "en", {
      searxngUrl: "https://search.example",
      wikipediaLookup: async () => wikipediaResult,
      searchWikidata: async () => [],
      fetch: async () => Response.json({
        results: [
          {
            title: "Duplicate Wikipedia result",
            url: "https://en.wikipedia.org/wiki/Roman_ruins#History",
            content: "duplicate",
            engine: "duckduckgo",
          },
          {
            title: "Independent result",
            url: "https://example.org/roman-ruins/",
            content: "independent",
            engine: "duckduckgo",
          },
        ],
      }),
    });

    expect(result.coverage).toBe("complete");
    expect(result.results.map((item) => item.url)).toEqual([
      "https://en.wikipedia.org/wiki/Roman_ruins#History",
      "https://example.org/roman-ruins/",
      "https://en.wikipedia.org/wiki/Roman_archaeology",
    ]);
  });
});
