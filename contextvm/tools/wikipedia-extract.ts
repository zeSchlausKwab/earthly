import { parseHTML } from "linkedom";
import type {
  WikipediaExtractInput,
  WikipediaExtractOutput,
  WikipediaTable,
} from "../web-schemas";

const USER_AGENT = "EarthlyCity/1.0 Map MCP Server (https://earthly.city)";
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_ROW_LIMIT = 50;
const OUTLINE_SAMPLE_ROWS = 3;

type WikipediaReference = { language: string; title: string };
type ParsedSection = { index: string; level: number; title: string; anchor: string };
type ParsedTable = Omit<WikipediaTable, "sampleRows" | "rows"> & {
  rows: Array<{ sourceRow: number; cells: Record<string, string> }>;
};

type ParsedPage = {
  title: string;
  pageId: number | null;
  revisionId: number | null;
  html: string;
  sections: ParsedSection[];
};

function normalizeLanguage(language: string | undefined): string {
  const normalized = language?.trim().toLowerCase() || "en";
  if (!/^[a-z][a-z0-9-]{0,11}$/u.test(normalized)) {
    throw new Error("Invalid Wikipedia language code");
  }
  return normalized;
}

function articleUrl(language: string, title: string): string {
  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /gu, "_"))}`;
}

export function parseWikipediaReference(input: WikipediaExtractInput): WikipediaReference {
  if (input.url) {
    const url = new URL(input.url);
    const match = url.hostname.match(/^([a-z][a-z0-9-]{0,11})\.wikipedia\.org$/iu);
    if (!match) {
      throw new Error("Wikipedia extraction only accepts language.wikipedia.org article URLs");
    }

    let title = "";
    if (url.pathname.startsWith("/wiki/")) {
      title = decodeURIComponent(url.pathname.slice("/wiki/".length)).replace(/_/gu, " ");
    } else if (url.pathname === "/w/index.php") {
      title = url.searchParams.get("title")?.replace(/_/gu, " ") || "";
    }
    if (!title) throw new Error("The Wikipedia URL does not identify an article");
    return { language: normalizeLanguage(match[1]), title };
  }

  const title = input.title?.trim();
  if (!title) throw new Error("Either 'url' or 'title' is required");
  return { language: normalizeLanguage(input.language), title };
}

function normalizeText(value: string | null | undefined): string {
  return (value || "").replace(/\[[^\]]{1,12}\]/gu, "").replace(/\s+/gu, " ").trim();
}

function cleanElementText(element: Element | null): string {
  if (!element) return "";
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll("sup.reference, .mw-editsection, style, script, noscript").forEach((node) => node.remove());
  return normalizeText(copy.textContent);
}

function uniqueHeaders(rawHeaders: string[], width: number): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: width }, (_, index) => {
    const base = normalizeText(rawHeaders[index]) || `Column ${index + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function tableGrid(table: Element): { rows: string[][]; headerRowIndex: number } {
  const carries = new Map<number, { value: string; remaining: number }>();
  const rows: string[][] = [];
  let headerRowIndex = -1;

  for (const [rowIndex, row] of Array.from(table.querySelectorAll("tr")).entries()) {
    const values: string[] = [];
    let column = 0;
    const fillCarries = () => {
      while (carries.has(column)) {
        const carry = carries.get(column)!;
        values[column] = carry.value;
        carry.remaining -= 1;
        if (carry.remaining <= 0) carries.delete(column);
        column += 1;
      }
    };
    fillCarries();

    const cells = Array.from(row.children).filter((cell) => {
      const tag = cell.tagName.toLowerCase();
      return tag === "th" || tag === "td";
    });
    if (headerRowIndex < 0 && cells.some((cell) => cell.tagName.toLowerCase() === "th")) {
      headerRowIndex = rowIndex;
    }

    for (const cell of cells) {
      fillCarries();
      const value = cleanElementText(cell);
      const colSpan = Math.max(Number.parseInt(cell.getAttribute("colspan") || "1", 10) || 1, 1);
      const rowSpan = Math.max(Number.parseInt(cell.getAttribute("rowspan") || "1", 10) || 1, 1);
      for (let offset = 0; offset < colSpan; offset += 1) {
        values[column + offset] = value;
        if (rowSpan > 1) carries.set(column + offset, { value, remaining: rowSpan - 1 });
      }
      column += colSpan;
    }
    fillCarries();
    if (values.some(Boolean)) rows.push(values);
  }

  return { rows, headerRowIndex: headerRowIndex < 0 ? 0 : headerRowIndex };
}

export function parseWikipediaPageHtml(
  html: string,
  sections: ParsedSection[],
): { lead: string; tables: ParsedTable[] } {
  const { document } = parseHTML(html);
  const root = document.querySelector(".mw-parser-output") || document.body;
  const firstHeading = root.querySelector("h2, h3, h4, h5, h6");
  const leadParts: string[] = [];
  for (const child of Array.from(root.children)) {
    if (child === firstHeading || /^H[2-6]$/u.test(child.tagName)) break;
    if (child.tagName === "P") {
      const text = cleanElementText(child);
      if (text) leadParts.push(text);
    }
  }

  const tables: ParsedTable[] = [];
  let currentSection: ParsedSection | null = null;
  const nodes = root.querySelectorAll("h2, h3, h4, h5, h6, table.wikitable, table.sortable");
  const visitedTables = new Set<Element>();
  for (const node of Array.from(nodes)) {
    if (/^H[2-6]$/u.test(node.tagName)) {
      const anchor = node.querySelector(".mw-headline")?.getAttribute("id") || node.getAttribute("id") || "";
      const title = cleanElementText(node);
      currentSection = sections.find((section) => section.anchor === anchor || section.title === title) || null;
      continue;
    }
    if (visitedTables.has(node)) continue;
    visitedTables.add(node);

    const { rows, headerRowIndex } = tableGrid(node);
    if (rows.length === 0) continue;
    const width = Math.max(...rows.map((row) => row.length));
    const headers = uniqueHeaders(rows[headerRowIndex] || [], width);
    const dataRows = rows.slice(headerRowIndex + 1).map((row, index) => ({
      sourceRow: index + 1,
      cells: Object.fromEntries(headers.map((header, column) => [header, row[column] || ""])),
    }));
    tables.push({
      index: tables.length,
      sectionIndex: currentSection?.index || null,
      sectionTitle: currentSection?.title || null,
      caption: cleanElementText(node.querySelector("caption")) || null,
      headers,
      rowCount: dataRows.length,
      rows: dataRows,
    });
  }

  return { lead: leadParts.join("\n\n").slice(0, 6000), tables };
}

async function fetchParsedPage(reference: WikipediaReference): Promise<ParsedPage> {
  const url = new URL(`https://${reference.language}.wikipedia.org/w/api.php`);
  for (const [key, value] of Object.entries({
    action: "parse",
    page: reference.title,
    prop: "text|sections|displaytitle|revid",
    redirects: "1",
    format: "json",
    formatversion: "2",
    origin: "*",
  })) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
    if (!response.ok) throw new Error(`Wikipedia API error: ${response.status} ${response.statusText}`);
    const payload = await response.json() as { error?: { info?: string }; parse?: Record<string, unknown> };
    if (payload.error) throw new Error(payload.error.info || "Wikipedia parse failed");
    const parsed = payload.parse;
    if (!parsed || typeof parsed.text !== "string") throw new Error("Wikipedia did not return article HTML");
    return {
      title: typeof parsed.title === "string" ? parsed.title : reference.title,
      pageId: typeof parsed.pageid === "number" ? parsed.pageid : null,
      revisionId: typeof parsed.revid === "number" ? parsed.revid : null,
      html: parsed.text,
      sections: Array.isArray(parsed.sections)
        ? parsed.sections.flatMap((section) => {
            if (!section || typeof section !== "object") return [];
            const entry = section as Record<string, unknown>;
            return [{
              index: String(entry.index ?? ""),
              level: Number(entry.level || 0),
              title: normalizeText(String(entry.line || "")),
              anchor: String(entry.anchor || ""),
            }];
          })
        : [],
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Wikipedia request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function wikipediaExtract(input: WikipediaExtractInput): Promise<WikipediaExtractOutput["result"]> {
  const reference = parseWikipediaReference(input);
  const mode = input.mode || "outline";
  if (mode === "table" && input.tableIndex === undefined) {
    throw new Error("tableIndex is required in table mode");
  }
  const page = await fetchParsedPage(reference);
  const parsed = parseWikipediaPageHtml(page.html, page.sections);
  const source = {
    title: page.title,
    url: articleUrl(reference.language, page.title),
    pageId: page.pageId,
    revisionId: page.revisionId,
    language: reference.language,
    retrievedAt: new Date().toISOString(),
  };
  const tableSummaries = parsed.tables.map(({ rows, ...table }) => ({
    ...table,
    sampleRows: rows.slice(0, OUTLINE_SAMPLE_ROWS).map((row) => row.cells),
  }));

  if (mode === "outline") {
    return { mode, source, lead: parsed.lead, sections: page.sections, tables: tableSummaries };
  }

  const table = parsed.tables[input.tableIndex!];
  if (!table) throw new Error(`Wikipedia table ${input.tableIndex} does not exist (found ${parsed.tables.length})`);
  const offset = input.rowOffset || 0;
  const limit = input.rowLimit || DEFAULT_ROW_LIMIT;
  const rows = table.rows.slice(offset, offset + limit);
  const { rows: _allRows, ...tableInfo } = table;
  const tableShapes = tableSummaries.map(({ sampleRows: _sampleRows, ...tableShape }) => tableShape);
  const hasPrevious = offset > 0;
  const hasNext = offset + rows.length < table.rowCount;
  const nextOffset = hasNext ? offset + rows.length : null;
  const status = !hasPrevious && !hasNext
    ? "complete"
    : hasNext
      ? "more"
      : "final_page";
  const firstRow = rows.length > 0 ? offset + 1 : offset;
  const lastRow = offset + rows.length;
  const message = status === "complete"
    ? `COMPLETE TABLE: returned all ${table.rowCount} rows (${rows.length}/${table.rowCount}). These are full rows, not a sample or preview.`
    : status === "more"
      ? `MORE ROWS AVAILABLE: returned rows ${firstRow}-${lastRow} of ${table.rowCount}. Continue with rowOffset=${nextOffset}; this is not the full table.`
      : `FINAL PAGE ONLY: returned rows ${firstRow}-${lastRow} of ${table.rowCount}, but rows 1-${offset} are not in this response.`;
  return {
    mode,
    source,
    lead: parsed.lead,
    sections: page.sections,
    tables: tableShapes,
    table: { ...tableInfo, rows },
    offset,
    returnedRows: rows.length,
    totalRows: table.rowCount,
    truncated: hasNext,
    pagination: {
      status,
      offset,
      returnedRows: rows.length,
      totalRows: table.rowCount,
      hasPrevious,
      hasNext,
      nextOffset,
      message,
    },
  };
}
