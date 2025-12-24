import { z } from "zod";

export const nominatimLocationSchema = z.object({
	placeId: z.number(),
	displayName: z.string(),
	coordinates: z.object({
		lat: z.number(),
		lon: z.number(),
	}),
	boundingbox: z
		.tuple([z.number(), z.number(), z.number(), z.number()])
		.nullable()
		.describe("Bounding box in [west, south, east, north] order"),
	type: z.string(),
	class: z.string(),
	importance: z.number().optional(),
	address: z.record(z.string()).optional(),
	geojson: z.any().optional(),
});

export type NominatimLocation = z.infer<typeof nominatimLocationSchema>;

export const searchLocationInputSchema = {
	query: z.string().describe('The location query (e.g., "New York City")'),
	limit: z
		.number()
		.optional()
		.describe("Maximum number of results (default: 10, max: 50)"),
};

export const searchLocationOutputSchema = {
	result: z.object({
		query: z.string(),
		count: z.number(),
		results: z.array(nominatimLocationSchema),
	}),
};

export type SearchLocationInput = {
	query: string;
	limit?: number;
};

export type SearchLocationOutput = {
	result: {
		query: string;
		count: number;
		results: NominatimLocation[];
	};
};

export const reverseLookupInputSchema = {
	lat: z.number().min(-90).max(90).describe("Latitude coordinate in WGS84"),
	lon: z.number().min(-180).max(180).describe("Longitude coordinate in WGS84"),
	zoom: z
		.number()
		.optional()
		.describe("Level of detail required (0-18, default 18)"),
};

export const reverseLookupOutputSchema = {
	result: z.object({
		coordinates: z.object({
			lat: z.number(),
			lon: z.number(),
		}),
		zoom: z.number(),
		result: nominatimLocationSchema.nullable(),
	}),
};

export type ReverseLookupInput = {
	lat: number;
	lon: number;
	zoom?: number;
};

export type ReverseLookupOutput = {
	result: {
		coordinates: { lat: number; lon: number };
		zoom: number;
		result: NominatimLocation | null;
	};
};
