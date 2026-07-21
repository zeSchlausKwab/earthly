import { afterEach, describe, expect, mock, test } from "bun:test";
import { searchWikidata, wikipediaLookup } from "./wikipedia";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Wikipedia tools", () => {
  test("supports ranked full-text article search", async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      seenUrls.push(String(input));
      return Response.json({
        query: {
          pages: {
            "11": {
              pageid: 11,
              title: "Second result",
              index: 2,
              extract: "Second summary",
            },
            "10": {
              pageid: 10,
              title: "First result",
              index: 1,
              extract: "First summary",
              coordinates: [{ lat: 46.6, lon: 14.3 }],
            },
          },
        },
      });
    }) as unknown as typeof fetch;

    const result = await wikipediaLookup({
      query: "Roman ruins Carinthia",
      limit: 2,
      language: "en",
    });

    expect(result.mode).toBe("search");
    expect(result.articles.map((article) => article.title)).toEqual([
      "First result",
      "Second result",
    ]);
    const requestUrl = new URL(seenUrls[0]!);
    expect(requestUrl.searchParams.get("generator")).toBe("search");
    expect(requestUrl.searchParams.get("gsrsearch")).toBe("Roman ruins Carinthia");
  });

  test("maps Wikidata entities to web-search results", async () => {
    globalThis.fetch = mock(async () => Response.json({
      search: [{
        id: "Q42",
        label: "Douglas Adams",
        description: "English writer and humorist",
        aliases: ["Douglas Noël Adams", "DNA"],
      }],
    })) as unknown as typeof fetch;

    const result = await searchWikidata("Douglas Adams", 5, "en");

    expect(result).toEqual([{
      title: "Douglas Adams",
      url: "https://www.wikidata.org/wiki/Q42",
      content: "English writer and humorist. Also known as: Douglas Noël Adams, DNA",
      engine: "wikidata",
    }]);
  });
});
