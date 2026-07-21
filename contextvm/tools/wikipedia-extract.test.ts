import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  parseWikipediaPageHtml,
  parseWikipediaReference,
  wikipediaExtract,
} from "./wikipedia-extract";

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

  it("rejects lookalike and non-Wikipedia URLs", () => {
    expect(() => parseWikipediaReference({ url: "https://wikipedia.org.evil.test/wiki/A" })).toThrow();
    expect(() => parseWikipediaReference({ url: "https://example.com/wiki/A" })).toThrow();
  });
});

describe("parseWikipediaPageHtml", () => {
  it("returns table rows with stable source rows, unique headers, and section provenance", () => {
    const parsed = parseWikipediaPageHtml(`
      <div class="mw-parser-output">
        <p>A concise lead with a <sup class="reference">[1]</sup> citation.</p>
        <h2><span class="mw-headline" id="Current_exclaves">Current exclaves</span></h2>
        <table class="wikitable sortable">
          <caption>Territories</caption>
          <tr><th>Name</th><th>Country</th><th>Country</th></tr>
          <tr><td rowspan="2">Example</td><td>A</td><td>B</td></tr>
          <tr><td>C</td><td>D</td></tr>
        </table>
      </div>
    `, [{ index: "1", level: 2, title: "Current exclaves", anchor: "Current_exclaves" }]);

    expect(parsed.lead).toBe("A concise lead with a citation.");
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
