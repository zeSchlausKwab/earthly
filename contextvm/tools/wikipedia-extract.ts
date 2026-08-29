import { parseHTML } from "linkedom";
import type {
  WikipediaExtractInput,
  WikipediaExtractOutput,
  WikipediaSection,
  WikipediaTable,
  WikipediaTextPagination,
} from "../web-schemas";

const USER_AGENT = "EarthlyCity/1.0 Map MCP Server (https://earthly.city)";
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_ROW_LIMIT = 50;
const DEFAULT_TEXT_LIMIT = 12_000;
const OUTLINE_SAMPLE_ROWS = 3;

type WikipediaReference = { language: string; title: string; revisionId?: number };
type ParsedSection = WikipediaSection;
type ParsedProseBlock = {
  kind: "heading" | "paragraph" | "list-item" | "quote" | "preformatted";
  level: number | null;
  section: ParsedSection | null;
  text: string;
};
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

function decodeTitle(value: string): string {
  try {
    return decodeURIComponent(value).replace(/_/gu, " ");
  } catch {
    throw new Error("The Wikipedia URL contains an invalid article title");
  }
}

function parseRevisionId(value: string): number | undefined {
  if (!value) return undefined;
  if (!/^\d+$/u.test(value)) throw new Error("The Wikipedia URL contains an invalid revision ID");
  const revisionId = Number(value);
  if (!Number.isSafeInteger(revisionId) || revisionId <= 0) {
    throw new Error("The Wikipedia URL contains an invalid revision ID");
  }
  return revisionId;
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
      title = decodeTitle(url.pathname.slice("/wiki/".length));
    } else if (url.pathname === "/w/index.php") {
      title = decodeTitle(url.searchParams.get("title") || "");
    } else if (url.pathname === "/w/api.php") {
      title = decodeTitle(
        (url.searchParams.get("page") || url.searchParams.get("titles") || "").split("|", 1)[0] || "",
      );
    } else if (url.pathname.startsWith("/api/rest_v1/page/")) {
      const parts = url.pathname.split("/");
      title = decodeTitle(parts[5] || "");
    }
    if (!title) throw new Error("The Wikipedia URL does not identify an article");
    const rawRevisionId = url.searchParams.get("oldid") || (
      url.pathname.startsWith("/api/rest_v1/page/html/") ? url.pathname.split("/")[6] || "" : ""
    );
    const revisionId = parseRevisionId(rawRevisionId);
    return revisionId === undefined
      ? { language: normalizeLanguage(match[1]), title }
      : { language: normalizeLanguage(match[1]), title, revisionId };
  }

  const title = input.title?.trim();
  if (!title) throw new Error("Either 'url' or 'title' is required");
  return { language: normalizeLanguage(input.language), title };
}

function normalizeText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/gu, " ").trim();
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

const PROSE_EXCLUDED_ANCESTORS = [
  "table",
  "figure",
  ".infobox",
  ".sidebar",
  ".navbox",
  ".metadata",
  ".toc",
  ".mw-references-wrap",
  ".references",
  ".reflist",
  ".authority-control",
  ".hatnote",
  ".shortdescription",
].join(", ");

function headingAnchor(element: Element): string {
  return element.querySelector(".mw-headline")?.getAttribute("id") || element.getAttribute("id") || "";
}

function cleanProseText(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll("ul, ol, sup.reference, .mw-editsection, style, script, noscript").forEach((node) => node.remove());
  return normalizeText(copy.textContent);
}

function parseProseBlocks(root: Element, sections: ParsedSection[]): ParsedProseBlock[] {
  const blocks: ParsedProseBlock[] = [];
  let currentSection: ParsedSection | null = null;
  let sectionCursor = 0;

  for (const node of Array.from(root.querySelectorAll("h2, h3, h4, h5, h6, p, li, blockquote, pre"))) {
    if (node.closest(PROSE_EXCLUDED_ANCESTORS)) continue;
    const tag = node.tagName.toUpperCase();
    if (/^H[2-6]$/u.test(tag)) {
      const title = cleanElementText(node);
      const anchor = headingAnchor(node);
      const remainingSections = sections.slice(sectionCursor);
      const relativeMatch = remainingSections.findIndex(
        (section) => (anchor && section.anchor === anchor) || section.title === title,
      );
      const sectionPosition = relativeMatch >= 0 ? sectionCursor + relativeMatch : -1;
      currentSection = sectionPosition >= 0
        ? sections[sectionPosition]!
        : { index: "", level: Number(tag.slice(1)), title, anchor };
      if (sectionPosition >= 0) sectionCursor = sectionPosition + 1;
      if (title) {
        blocks.push({
          kind: "heading",
          level: Number(tag.slice(1)),
          section: currentSection,
          text: title,
        });
      }
      continue;
    }

    const text = cleanProseText(node);
    if (!text) continue;
    const kind = tag === "LI"
      ? "list-item"
      : tag === "BLOCKQUOTE"
        ? "quote"
        : tag === "PRE"
          ? "preformatted"
          : "paragraph";
    blocks.push({ kind, level: null, section: currentSection, text });
  }

  return blocks;
}

function formatProse(blocks: ParsedProseBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "heading") {
        const depth = Math.min(Math.max((block.level || 2) - 1, 1), 5);
        return `${"#".repeat(depth)} ${block.text}`;
      }
      if (block.kind === "list-item") return `- ${block.text}`;
      if (block.kind === "quote") return `> ${block.text}`;
      return block.text;
    })
    .join("\n\n")
    .trim();
}

function resolveSection(input: WikipediaExtractInput, sections: ParsedSection[]): ParsedSection {
  if (input.sectionIndex && input.sectionTitle) {
    throw new Error("Use either sectionIndex or sectionTitle in section mode, not both");
  }
  if (input.sectionIndex) {
    const match = sections.find((section) => section.index === input.sectionIndex);
    if (match) return match;
    throw new Error(`Wikipedia section index ${input.sectionIndex} does not exist`);
  }

  const normalizeSectionLabel = (value: string | undefined) => {
    if (!value) return "";
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      // Keep the literal label. It may be a human-readable title rather than an encoded anchor.
    }
    return normalizeText(decoded.replace(/_/gu, " ")).toLocaleLowerCase();
  };
  const requestedTitle = normalizeSectionLabel(input.sectionTitle);
  if (!requestedTitle) {
    throw new Error("sectionIndex or sectionTitle is required in section mode");
  }
  const matches = sections.filter(
    (section) =>
      normalizeSectionLabel(section.title) === requestedTitle ||
      normalizeSectionLabel(section.anchor) === requestedTitle,
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(
      `Wikipedia section title '${input.sectionTitle}' is ambiguous; use one of these sectionIndex values: ${matches.map((section) => section.index).join(", ")}`,
    );
  }
  throw new Error(`Wikipedia section '${input.sectionTitle}' does not exist`);
}

function sectionBlocks(blocks: ParsedProseBlock[], section: ParsedSection): ParsedProseBlock[] {
  const start = blocks.findIndex(
    (block) => block.kind === "heading" && block.section?.index === section.index,
  );
  if (start < 0) throw new Error(`Wikipedia section ${section.index} has no readable prose`);
  let end = blocks.length;
  for (let index = start + 1; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.kind === "heading" && (block.level || Number.POSITIVE_INFINITY) <= section.level) {
      end = index;
      break;
    }
  }
  return blocks.slice(start, end);
}

function paginateProse(
  text: string,
  offset: number,
  limit: number,
  revisionId: number | null,
): { text: string; truncated: boolean; pagination: WikipediaTextPagination } {
  // Continuation offsets count Unicode code points. This keeps offsets stable
  // between pages without ever cutting a UTF-16 surrogate pair in half.
  const characters = Array.from(text);
  if (offset > characters.length) {
    throw new Error(`textOffset ${offset} exceeds the requested prose length (${characters.length} characters)`);
  }
  const pageCharacters = characters.slice(offset, offset + limit);
  const page = pageCharacters.join("");
  const returnedCharacters = pageCharacters.length;
  const totalCharacters = characters.length;
  const hasPrevious = offset > 0;
  const hasNext = offset + returnedCharacters < totalCharacters;
  const nextOffset = hasNext ? offset + returnedCharacters : null;
  const status = !hasPrevious && !hasNext ? "complete" : hasNext ? "more" : "final_page";
  const firstCharacter = returnedCharacters > 0 ? offset + 1 : offset;
  const lastCharacter = offset + returnedCharacters;
  const revisionInstruction = revisionId === null ? "" : ` and revisionId=${revisionId}`;
  const message = status === "complete"
    ? `COMPLETE PROSE: returned all ${totalCharacters} characters. This is the full requested article or section prose.`
    : status === "more"
      ? `MORE PROSE AVAILABLE: returned characters ${firstCharacter}-${lastCharacter} of ${totalCharacters}. Continue with textOffset=${nextOffset}${revisionInstruction}; this is not the full requested prose.`
      : `FINAL PAGE ONLY: returned characters ${firstCharacter}-${lastCharacter} of ${totalCharacters}, but characters 1-${offset} are not in this response.`;
  return {
    text: page,
    truncated: hasNext,
    pagination: {
      status,
      offset,
      returnedCharacters,
      totalCharacters,
      hasPrevious,
      hasNext,
      nextOffset,
      revisionId,
      message,
    },
  };
}

export function parseWikipediaPageHtml(
  html: string,
  sections: ParsedSection[],
): { lead: string; tables: ParsedTable[]; proseBlocks: ParsedProseBlock[] } {
  const { document } = parseHTML(html);
  const root = document.querySelector(".mw-parser-output") || document.body;
  const proseBlocks = parseProseBlocks(root, sections);
  const lead = formatProse(proseBlocks.filter((block) => block.kind !== "heading" && block.section === null));

  const tables: ParsedTable[] = [];
  let currentSection: ParsedSection | null = null;
  const nodes = root.querySelectorAll("h2, h3, h4, h5, h6, table.wikitable, table.sortable");
  const visitedTables = new Set<Element>();
  for (const node of Array.from(nodes)) {
    if (/^H[2-6]$/u.test(node.tagName)) {
      const anchor = headingAnchor(node);
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

  return { lead: lead.slice(0, 6000), tables, proseBlocks };
}

async function fetchParsedPage(reference: WikipediaReference, revisionId?: number): Promise<ParsedPage> {
  const url = new URL(`https://${reference.language}.wikipedia.org/w/api.php`);
  const parameters: Record<string, string> = {
    action: "parse",
    prop: "text|sections|displaytitle|revid",
    format: "json",
    formatversion: "2",
    origin: "*",
  };
  if (revisionId === undefined) {
    parameters.page = reference.title;
    parameters.redirects = "1";
  } else {
    parameters.oldid = String(revisionId);
  }
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
    if (!response.ok) throw new Error(`Wikipedia API error: ${response.status} ${response.statusText}`);
    const payload = await response.json() as { error?: { info?: string }; parse?: Record<string, unknown> };
    if (payload.error) throw new Error(payload.error.info || "Wikipedia parse failed");
    const parsed = payload.parse;
    if (!parsed || typeof parsed.text !== "string") throw new Error("Wikipedia did not return article HTML");
    const returnedRevisionId = typeof parsed.revid === "number" ? parsed.revid : null;
    if (revisionId !== undefined && returnedRevisionId !== revisionId) {
      throw new Error(`Wikipedia returned revision ${returnedRevisionId ?? "unknown"}, expected ${revisionId}`);
    }
    return {
      title: typeof parsed.title === "string" ? parsed.title : reference.title,
      pageId: typeof parsed.pageid === "number" ? parsed.pageid : null,
      revisionId: returnedRevisionId,
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
  if (mode === "section" && !input.sectionIndex && !input.sectionTitle) {
    throw new Error("sectionIndex or sectionTitle is required in section mode");
  }
  if ((input.textOffset !== undefined || input.textLimit !== undefined) && mode !== "article" && mode !== "section") {
    throw new Error("textOffset and textLimit are only valid in article or section mode");
  }
  if (input.revisionId !== undefined && mode !== "article" && mode !== "section") {
    throw new Error("revisionId is only valid for article or section continuation");
  }
  if (
    input.revisionId !== undefined &&
    reference.revisionId !== undefined &&
    input.revisionId !== reference.revisionId
  ) {
    throw new Error(
      `revisionId ${input.revisionId} conflicts with revision ${reference.revisionId} in the Wikipedia URL`,
    );
  }
  const requestedRevisionId = input.revisionId ?? reference.revisionId;
  const page = await fetchParsedPage(reference, requestedRevisionId);
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

  if (mode === "article" || mode === "section") {
    const selectedSection = mode === "section" ? resolveSection(input, page.sections) : null;
    const prose = formatProse(
      selectedSection ? sectionBlocks(parsed.proseBlocks, selectedSection) : parsed.proseBlocks,
    );
    const offset = input.textOffset ?? 0;
    const limit = input.textLimit ?? DEFAULT_TEXT_LIMIT;
    const paged = paginateProse(prose, offset, limit, page.revisionId);
    const tableShapes = tableSummaries.map(({ sampleRows: _sampleRows, ...tableShape }) => tableShape);
    return {
      mode,
      source,
      sections: page.sections,
      tables: tableShapes,
      prose: {
        scope: mode,
        section: selectedSection,
        text: paged.text,
      },
      textPagination: paged.pagination,
      truncated: paged.truncated,
    };
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
