import { z } from "zod";

const languageCodeSchema = z
	.string()
	.regex(/^[a-z][a-z0-9-]{0,11}$/iu, "Use a short Wikipedia/IETF language code");

// ==========================================
// Federated Web Search Schemas
// ==========================================

export const webSearchResultSchema = z.object({
	title: z.string(),
	url: z.string(),
	content: z.string().describe("Snippet/summary from the search engine"),
	engine: z.string().describe("Search engine that returned this result"),
});

export const webSearchProviderSchema = z.object({
	name: z.string(),
	status: z.enum(["ok", "error", "unavailable"]),
	count: z.number().int().min(0),
	error: z.string().optional(),
});

export const webSearchInputSchema = {
	query: z.string().describe("Search query string"),
	limit: z
		.number()
		.int()
		.min(1)
		.max(20)
		.optional()
		.describe(
			"Maximum number of results to return (default: 5, max: 20)",
		),
	categories: z
		.string()
		.optional()
		.describe(
			'SearXNG search categories, comma-separated (e.g., "general", "science", "it"). Wikipedia and Wikidata are always searched. Default: "general"',
		),
	language: languageCodeSchema
		.optional()
		.describe(
			'Language code for results (e.g., "en", "de"). Default: "en"',
		),
};

export const webSearchOutputSchema = {
	result: z.object({
		query: z.string(),
		count: z.number(),
		coverage: z
			.enum(["complete", "partial", "unavailable"])
			.describe("Whether every configured search provider answered successfully"),
		providers: z.array(webSearchProviderSchema),
		results: z.array(webSearchResultSchema),
	}),
};

export type WebSearchInput = {
	query: string;
	limit?: number;
	categories?: string;
	language?: string;
};

export type WebSearchResult = {
	title: string;
	url: string;
	content: string;
	engine: string;
};

export type WebSearchProvider = {
	name: string;
	status: "ok" | "error" | "unavailable";
	count: number;
	error?: string;
};

export type WebSearchOutput = {
	result: {
		query: string;
		count: number;
		coverage: "complete" | "partial" | "unavailable";
		providers: WebSearchProvider[];
		results: WebSearchResult[];
	};
};

// ==========================================
// Fetch URL Schemas (Readability)
// ==========================================

export const fetchUrlInputSchema = {
	url: z
		.string()
		.url()
		.describe("The URL to fetch and extract content from"),
	maxLength: z
		.number()
		.int()
		.min(100)
		.max(50000)
		.optional()
		.describe(
			"Maximum character length of extracted text content (default: 10000)",
		),
};

export const fetchUrlOutputSchema = {
	result: z.object({
		url: z.string(),
		title: z.string().nullable(),
		siteName: z.string().nullable(),
		description: z.string().nullable(),
		textContent: z
			.string()
			.describe("Extracted readable text content"),
		textLength: z
			.number()
			.describe("Length of full extracted text before truncation"),
		truncated: z.boolean(),
		fetchedAt: z.string().describe("ISO 8601 timestamp of fetch"),
	}),
};

export type FetchUrlInput = {
	url: string;
	maxLength?: number;
};

export type FetchUrlOutput = {
	result: {
		url: string;
		title: string | null;
		siteName: string | null;
		description: string | null;
		textContent: string;
		textLength: number;
		truncated: boolean;
		fetchedAt: string;
	};
};

// ==========================================
// Wikipedia Lookup Schemas
// ==========================================

export const wikipediaArticleSchema = z.object({
	title: z.string(),
	pageId: z.number(),
	url: z.string(),
	extract: z
		.string()
		.describe("Plain text extract/summary of the article"),
	coordinates: z
		.object({
			lat: z.number(),
			lon: z.number(),
		})
		.nullable()
		.describe("Geographic coordinates if available"),
	description: z
		.string()
		.nullable()
		.describe("Short Wikidata description"),
});

export const wikipediaLookupInputSchema = {
	query: z
		.string()
		.optional()
		.describe(
			'Full-text Wikipedia search query (e.g., "Roman ruins Carinthia"). Query takes precedence over title and coordinates.',
		),
	title: z
		.string()
		.optional()
		.describe(
			'Exact Wikipedia article title (e.g., "Mount Everest"). Either query, title, or lat+lon is required.',
		),
	lat: z
		.number()
		.min(-90)
		.max(90)
		.optional()
		.describe(
			"Latitude for geographic article search. Must be paired with lon.",
		),
	lon: z
		.number()
		.min(-180)
		.max(180)
		.optional()
		.describe(
			"Longitude for geographic article search. Must be paired with lat.",
		),
	radius: z
		.number()
		.int()
		.min(10)
		.max(10000)
		.optional()
		.describe(
			"Search radius in meters for geo lookup (default: 1000, max: 10000)",
		),
	limit: z
		.number()
		.int()
		.min(1)
		.max(10)
		.optional()
		.describe(
			"Max articles to return for geo search (default: 5, max: 10)",
		),
	language: languageCodeSchema
		.optional()
		.describe(
			'Wikipedia language code (default: "en"). Examples: "en", "de", "fr", "ja"',
		),
};

export const wikipediaLookupOutputSchema = {
	result: z.object({
		mode: z.enum(["search", "title", "geosearch"]),
		query: z.string().describe("The title or coordinate query used"),
		count: z.number(),
		articles: z.array(wikipediaArticleSchema),
	}),
};

export type WikipediaLookupInput = {
	query?: string;
	title?: string;
	lat?: number;
	lon?: number;
	radius?: number;
	limit?: number;
	language?: string;
};

export type WikipediaArticle = {
	title: string;
	pageId: number;
	url: string;
	extract: string;
	coordinates: { lat: number; lon: number } | null;
	description: string | null;
};

export type WikipediaLookupOutput = {
	result: {
		mode: "search" | "title" | "geosearch";
		query: string;
		count: number;
		articles: WikipediaArticle[];
	};
};

// ==========================================
// Structured Wikipedia Extraction Schemas
// ==========================================

export const wikipediaSourceSchema = z.object({
	title: z.string(),
	url: z.string().url(),
	pageId: z.number().int().nullable(),
	revisionId: z.number().int().nullable(),
	language: languageCodeSchema,
	retrievedAt: z.string().describe("ISO 8601 retrieval timestamp"),
});

export const wikipediaSectionSchema = z.object({
	index: z.string(),
	level: z.number().int(),
	title: z.string(),
	anchor: z.string(),
});

export const wikipediaTableSchema = z.object({
	index: z.number().int().min(0),
	sectionIndex: z.string().nullable(),
	sectionTitle: z.string().nullable(),
	caption: z.string().nullable(),
	headers: z.array(z.string()),
	rowCount: z.number().int().min(0),
	sampleRows: z.array(z.record(z.string(), z.string())).optional(),
	rows: z
		.array(
			z.object({
				sourceRow: z.number().int().min(1),
				cells: z.record(z.string(), z.string()),
			}),
		)
		.optional(),
});

export const wikipediaTablePaginationSchema = z.object({
	status: z
		.enum(["complete", "more", "final_page"])
		.describe(
			'"complete" is the only status where this response contains the full table; "more" has a next page; "final_page" still omits earlier rows.',
		),
	offset: z.number().int().min(0),
	returnedRows: z.number().int().min(0),
	totalRows: z.number().int().min(0),
	hasPrevious: z.boolean(),
	hasNext: z.boolean(),
	nextOffset: z.number().int().min(0).nullable(),
	message: z.string().describe("Explicit model-facing statement of table coverage and next action"),
});

export const wikipediaTextPaginationSchema = z.object({
	status: z
		.enum(["complete", "more", "final_page"])
		.describe(
			'"complete" is the only status where this response contains all requested prose; "more" has a next page; "final_page" still omits earlier text.',
		),
	offset: z.number().int().min(0),
	returnedCharacters: z.number().int().min(0),
	totalCharacters: z.number().int().min(0),
	hasPrevious: z.boolean(),
	hasNext: z.boolean(),
	nextOffset: z.number().int().min(0).nullable(),
	revisionId: z
		.number()
		.int()
		.nullable()
		.describe("Revision to pass back on every continuation so character offsets remain stable"),
	message: z.string().describe("Explicit model-facing statement of prose coverage and next action"),
});

export const wikipediaExtractInputSchema = {
	url: z
		.string()
		.url()
		.optional()
		.describe("A wikipedia.org article URL. Either url or title is required."),
	title: z
		.string()
		.optional()
		.describe("Exact Wikipedia article title. Either title or url is required."),
	language: languageCodeSchema
		.optional()
		.describe('Wikipedia language code when title is used (default: "en").'),
	mode: z
		.enum(["outline", "article", "section", "table"])
		.optional()
		.describe(
			'"article" reads bounded article prose; "section" reads one bounded section; "outline" lists sections and table shapes; "table" returns rows from tableIndex. Default: "outline".',
		),
	revisionId: z
		.number()
		.int()
		.positive()
		.optional()
		.describe(
			"Revision ID returned by a previous prose page. Pass it on continuations so textOffset addresses the same article revision.",
		),
	sectionIndex: z
		.string()
		.min(1)
		.optional()
		.describe('MediaWiki section index from outline mode (for example "2" or "2.1").'),
	sectionTitle: z
		.string()
		.min(1)
		.optional()
		.describe("Exact section title when sectionIndex is unavailable. Must identify one section."),
	textOffset: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe("Zero-based character offset in article or section mode (default: 0)."),
	textLimit: z
		.number()
		.int()
		.min(100)
		.max(30000)
		.optional()
		.describe("Maximum characters returned in article or section mode (default: 12000, max: 30000)."),
	tableIndex: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe("Zero-based table index. Required in table mode."),
	rowOffset: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe("Zero-based data-row offset in table mode (default: 0)."),
	rowLimit: z
		.number()
		.int()
		.min(1)
		.max(200)
		.optional()
		.describe("Maximum rows returned in table mode (default: 50, max: 200)."),
};

export const wikipediaExtractOutputSchema = {
	result: z.object({
		mode: z.enum(["outline", "article", "section", "table"]),
		source: wikipediaSourceSchema,
		lead: z.string().optional(),
		sections: z.array(wikipediaSectionSchema),
		tables: z.array(wikipediaTableSchema),
		prose: z
			.object({
				scope: z.enum(["article", "section"]),
				section: wikipediaSectionSchema.nullable(),
				text: z.string(),
			})
			.optional(),
		textPagination: wikipediaTextPaginationSchema.optional(),
		table: wikipediaTableSchema.optional(),
		offset: z.number().int().min(0).optional(),
		returnedRows: z.number().int().min(0).optional(),
		totalRows: z.number().int().min(0).optional(),
		truncated: z.boolean().optional(),
		pagination: wikipediaTablePaginationSchema.optional(),
	}),
};

export type WikipediaExtractInput = {
	url?: string;
	title?: string;
	language?: string;
	mode?: "outline" | "article" | "section" | "table";
	revisionId?: number;
	sectionIndex?: string;
	sectionTitle?: string;
	textOffset?: number;
	textLimit?: number;
	tableIndex?: number;
	rowOffset?: number;
	rowLimit?: number;
};

export type WikipediaSource = {
	title: string;
	url: string;
	pageId: number | null;
	revisionId: number | null;
	language: string;
	retrievedAt: string;
};

export type WikipediaTable = {
	index: number;
	sectionIndex: string | null;
	sectionTitle: string | null;
	caption: string | null;
	headers: string[];
	rowCount: number;
	sampleRows?: Array<Record<string, string>>;
	rows?: Array<{ sourceRow: number; cells: Record<string, string> }>;
};

export type WikipediaTablePagination = {
	status: "complete" | "more" | "final_page";
	offset: number;
	returnedRows: number;
	totalRows: number;
	hasPrevious: boolean;
	hasNext: boolean;
	nextOffset: number | null;
	message: string;
};

export type WikipediaSection = {
	index: string;
	level: number;
	title: string;
	anchor: string;
};

export type WikipediaTextPagination = {
	status: "complete" | "more" | "final_page";
	offset: number;
	returnedCharacters: number;
	totalCharacters: number;
	hasPrevious: boolean;
	hasNext: boolean;
	nextOffset: number | null;
	revisionId: number | null;
	message: string;
};

export type WikipediaExtractOutput = {
	result: {
		mode: "outline" | "article" | "section" | "table";
		source: WikipediaSource;
		lead?: string;
		sections: WikipediaSection[];
		tables: WikipediaTable[];
		prose?: {
			scope: "article" | "section";
			section: WikipediaSection | null;
			text: string;
		};
		textPagination?: WikipediaTextPagination;
		table?: WikipediaTable;
		offset?: number;
		returnedRows?: number;
		totalRows?: number;
		truncated?: boolean;
		pagination?: WikipediaTablePagination;
	};
};
