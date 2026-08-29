import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  parseWikipediaPageHtml,
  parseWikipediaReference,
  wikipediaExtract,
} from "./wikipedia-extract";
import { wikipediaExtractOutputSchema } from "../web-schemas";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("parseWikipediaReference", () => {
  it("accepts canonical article URLs and derives language and title", () => {
    expect(parseWikipediaReference({
      url: "https://de.wikipedia.org/wiki/Liste_der_Exklaven_und_Enklaven",
    })).toEqual({ language: "de", title: "Liste der Exklaven und Enklaven" });
  });

  it("accepts MediaWiki parse and REST article URLs without treating API paths as titles", () => {
    expect(parseWikipediaReference({
      url: "https://en.wikipedia.org/w/api.php?action=parse&page=Timeline_of_an_event&prop=wikitext",
    })).toEqual({ language: "en", title: "Timeline of an event" });
    expect(parseWikipediaReference({
      url: "https://fr.wikipedia.org/api/rest_v1/page/summary/Crue_%C3%A9clair",
    })).toEqual({ language: "fr", title: "Crue éclair" });
    expect(parseWikipediaReference({
      url: "https://en.wikipedia.org/w/index.php?title=Example&oldid=12345",
    })).toEqual({ language: "en", title: "Example", revisionId: 12345 });
    expect(parseWikipediaReference({
      url: "https://en.wikipedia.org/api/rest_v1/page/html/Example/67890",
    })).toEqual({ language: "en", title: "Example", revisionId: 67890 });
  });

  it("rejects lookalike and non-Wikipedia URLs", () => {
    expect(() => parseWikipediaReference({ url: "https://wikipedia.org.evil.test/wiki/A" })).toThrow();
    expect(() => parseWikipediaReference({ url: "https://example.com/wiki/A" })).toThrow();
  });
});

describe("parseWikipediaPageHtml", () => {
  it("returns table rows with stable source rows, unique headers, and section provenance", () => {
    const parsed = parseWikipediaPageHtml(`
      <div class="mw-parser-output">
        <p>A concise [provisional] lead with a <sup class="reference">[1]</sup> citation.</p>
        <h2><span class="mw-headline" id="Current_exclaves">Current exclaves</span></h2>
        <table class="wikitable sortable">
          <caption>Territories</caption>
          <tr><th>Name</th><th>Country</th><th>Country</th></tr>
          <tr><td rowspan="2">Example</td><td>A</td><td>B</td></tr>
          <tr><td>C</td><td>D</td></tr>
        </table>
      </div>
    `, [{ index: "1", level: 2, title: "Current exclaves", anchor: "Current_exclaves" }]);

    expect(parsed.lead).toBe("A concise [provisional] lead with a citation.");
    expect(parsed.tables).toEqual([{
      index: 0,
      sectionIndex: "1",
      sectionTitle: "Current exclaves",
      caption: "Territories",
      headers: ["Name", "Country", "Country (2)"],
      rowCount: 2,
      rows: [
        { sourceRow: 1, cells: { Name: "Example", Country: "A", "Country (2)": "B" } },
        { sourceRow: 2, cells: { Name: "Example", Country: "C", "Country (2)": "D" } },
      ],
    }]);
    expect(parsed.proseBlocks.map(({ kind, section, text }) => ({
      kind,
      section: section?.index ?? null,
      text,
    }))).toEqual([
      { kind: "paragraph", section: null, text: "A concise [provisional] lead with a citation." },
      { kind: "heading", section: "1", text: "Current exclaves" },
    ]);
  });
});

describe("wikipediaExtract", () => {
  it("requests and returns the article revision required by source provenance", async () => {
    let requestedUrl = "";
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return Response.json({
        parse: {
          title: "Example",
          pageid: 42,
          revid: 987654,
          text: '<div class="mw-parser-output"><p>Lead.</p></div>',
          sections: [],
        },
      });
    }) as unknown as typeof fetch;

    const result = await wikipediaExtract({ title: "Example", mode: "outline" });

    expect(new URL(requestedUrl).searchParams.get("prop")).toContain("revid");
    expect(result.source).toMatchObject({ pageId: 42, revisionId: 987654 });
  });

  it("returns bounded article prose and a revision-pinned continuation", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return Response.json({
        parse: {
          title: "Example",
          pageid: 42,
          revid: 987654,
          text: `
            <div class="mw-parser-output">
              <p>Lead paragraph with the essential context.</p>
              <div class="mw-heading mw-heading2"><h2 id="Timeline">Timeline</h2></div>
              <p>First event happened early in the morning and affected several settlements downstream.</p>
              <p>Second event followed later in the day while monitoring stations reported rising water.</p>
              <ol class="references"><li>Reference text must not enter article prose.</li></ol>
            </div>
          `,
          sections: [{ index: "1", level: "2", line: "Timeline", anchor: "Timeline" }],
        },
      });
    }) as unknown as typeof fetch;

    const firstPage = await wikipediaExtract({
      title: "Example",
      mode: "article",
      textLimit: 100,
    });

    expect(firstPage.prose?.scope).toBe("article");
    expect(firstPage.prose?.section).toBeNull();
    expect(firstPage.prose?.text).toStartWith("Lead paragraph with the essential context.\n\n# Timeline");
    expect(firstPage.prose?.text).toHaveLength(100);
    expect(firstPage.textPagination).toMatchObject({
      status: "more",
      offset: 0,
      returnedCharacters: 100,
      hasPrevious: false,
      hasNext: true,
      nextOffset: 100,
      revisionId: 987654,
    });
    expect(firstPage.textPagination?.message).toContain("textOffset=100 and revisionId=987654");
    expect(firstPage.prose?.text).not.toContain("Reference text");
    expect(() => wikipediaExtractOutputSchema.result.parse(firstPage)).not.toThrow();

    const finalPage = await wikipediaExtract({
      title: "Example",
      mode: "article",
      revisionId: 987654,
      textOffset: 100,
      textLimit: 500,
    });
    expect(new URL(requestedUrls[1]!).searchParams.get("oldid")).toBe("987654");
    expect(new URL(requestedUrls[1]!).searchParams.has("page")).toBe(false);
    expect(finalPage.textPagination).toMatchObject({
      status: "final_page",
      offset: 100,
      hasPrevious: true,
      hasNext: false,
      nextOffset: null,
      revisionId: 987654,
    });
  });

  it("uses Unicode code-point offsets without splitting surrogate pairs", async () => {
    const prose = `${"a".repeat(99)}😀${"b".repeat(20)}`;
    globalThis.fetch = mock(async () => Response.json({
      parse: {
        title: "Unicode example",
        pageid: 43,
        revid: 987655,
        text: `<div class="mw-parser-output"><p>${prose}</p></div>`,
        sections: [],
      },
    })) as unknown as typeof fetch;

    const firstPage = await wikipediaExtract({
      title: "Unicode example",
      mode: "article",
      textLimit: 100,
    });
    expect(firstPage.prose?.text).toBe(`${"a".repeat(99)}😀`);
    expect(Array.from(firstPage.prose?.text || "")).toHaveLength(100);
    expect(firstPage.textPagination).toMatchObject({
      status: "more",
      offset: 0,
      returnedCharacters: 100,
      totalCharacters: 120,
      nextOffset: 100,
      revisionId: 987655,
    });

    const finalPage = await wikipediaExtract({
      title: "Unicode example",
      mode: "article",
      revisionId: 987655,
      textOffset: 100,
      textLimit: 100,
    });
    expect(finalPage.prose?.text).toBe("b".repeat(20));
    expect(finalPage.textPagination).toMatchObject({
      status: "final_page",
      offset: 100,
      returnedCharacters: 20,
      totalCharacters: 120,
      nextOffset: null,
      revisionId: 987655,
    });
    expect(`${firstPage.prose?.text}${finalPage.prose?.text}`).toBe(prose);
  });

  it("returns one section including its subsections, selected by stable section index", async () => {
    globalThis.fetch = mock(async () => Response.json({
      parse: {
        title: "Example",
        pageid: 42,
        revid: 987654,
        text: `
          <div class="mw-parser-output">
            <p>Lead.</p>
            <h2><span class="mw-headline" id="Impact">Impact</span></h2>
            <p>Primary impact.</p>
            <h3><span class="mw-headline" id="Villages">Villages</span></h3>
            <ul><li>Alpha</li><li>Beta</li></ul>
            <h2><span class="mw-headline" id="Response">Response</span></h2>
            <p>Response prose must not be returned.</p>
          </div>
        `,
        sections: [
          { index: "1", level: "2", line: "Impact", anchor: "Impact" },
          { index: "2", level: "3", line: "Villages", anchor: "Villages" },
          { index: "3", level: "2", line: "Response", anchor: "Response" },
        ],
      },
    })) as unknown as typeof fetch;

    const result = await wikipediaExtract({
      title: "Example",
      mode: "section",
      sectionIndex: "1",
      textLimit: 500,
    });

    expect(result.prose).toEqual({
      scope: "section",
      section: { index: "1", level: 2, title: "Impact", anchor: "Impact" },
      text: "# Impact\n\nPrimary impact.\n\n## Villages\n\n- Alpha\n\n- Beta",
    });
    expect(result.prose?.text).not.toContain("Response");
    expect(result.textPagination?.status).toBe("complete");
  });

  it("requires an unambiguous section selector", async () => {
    globalThis.fetch = mock(async () => Response.json({
      parse: {
        title: "Example",
        pageid: 42,
        revid: 987654,
        text: '<div class="mw-parser-output"><h2 id="A">Events</h2><h2 id="B">Events</h2></div>',
        sections: [
          { index: "1", level: "2", line: "Events", anchor: "A" },
          { index: "2", level: "2", line: "Events", anchor: "B" },
        ],
      },
    })) as unknown as typeof fetch;

    await expect(wikipediaExtract({
      title: "Example",
      mode: "section",
      sectionTitle: "Events",
    })).rejects.toThrow("ambiguous");
  });

  it("marks a fully returned table page as complete in model-facing pagination", async () => {
    globalThis.fetch = mock(async () => Response.json({
      parse: {
        title: "Example",
        pageid: 42,
        revid: 987654,
        text: `
          <div class="mw-parser-output">
            <table class="wikitable">
              <tr><th>Name</th><th>Coordinates</th></tr>
              <tr><td>Alpha</td><td>48.2; 16.3</td></tr>
              <tr><td>Beta</td><td>47.1; 15.4</td></tr>
            </table>
          </div>
        `,
        sections: [],
      },
    })) as unknown as typeof fetch;

    const result = await wikipediaExtract({
      title: "Example",
      mode: "table",
      tableIndex: 0,
      rowLimit: 2,
    });

    expect(result.pagination).toEqual({
      status: "complete",
      offset: 0,
      returnedRows: 2,
      totalRows: 2,
      hasPrevious: false,
      hasNext: false,
      nextOffset: null,
      message: "COMPLETE TABLE: returned all 2 rows (2/2). These are full rows, not a sample or preview.",
    });
    expect(result.tables[0]?.sampleRows).toBeUndefined();
    expect(result.table?.rows).toHaveLength(2);
  });

  it("gives the next offset when more table rows remain", async () => {
    globalThis.fetch = mock(async () => Response.json({
      parse: {
        title: "Example",
        pageid: 42,
        revid: 987654,
        text: `
          <div class="mw-parser-output">
            <table class="wikitable">
              <tr><th>Name</th></tr>
              <tr><td>Alpha</td></tr>
              <tr><td>Beta</td></tr>
            </table>
          </div>
        `,
        sections: [],
      },
    })) as unknown as typeof fetch;

    const result = await wikipediaExtract({
      title: "Example",
      mode: "table",
      tableIndex: 0,
      rowLimit: 1,
    });

    expect(result.pagination).toEqual({
      status: "more",
      offset: 0,
      returnedRows: 1,
      totalRows: 2,
      hasPrevious: false,
      hasNext: true,
      nextOffset: 1,
      message: "MORE ROWS AVAILABLE: returned rows 1-1 of 2. Continue with rowOffset=1; this is not the full table.",
    });

    const finalPage = await wikipediaExtract({
      title: "Example",
      mode: "table",
      tableIndex: 0,
      rowOffset: 1,
      rowLimit: 1,
    });
    expect(finalPage.pagination).toEqual({
      status: "final_page",
      offset: 1,
      returnedRows: 1,
      totalRows: 2,
      hasPrevious: true,
      hasNext: false,
      nextOffset: null,
      message: "FINAL PAGE ONLY: returned rows 2-2 of 2, but rows 1-1 are not in this response.",
    });
  });
});
