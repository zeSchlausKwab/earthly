/**
 * PMTiles extraction tool for ContextVM
 *
 * Extracts a map excerpt from a PMTiles source for a given bounding box,
 * computes its SHA-256 hash, and prepares it for Blossom upload.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

// PMTiles source - will be loaded from global basemap
const DEFAULT_BASEMAP_PMTILES = "https://build.protomaps.com/20251222.pmtiles";

// Project root (one level up from contextvm)
const PROJECT_ROOT = join(import.meta.dir, "..", "..");

/**
 * Get the path to the pmtiles binary based on platform.
 * Production sets PMTILES_CLI_PATH to its verified release binary. Local
 * development uses the pinned tool cache populated by `bun run tools:pmtiles`.
 */
function getPmtilesBinPath(): string {
	if (process.env.PMTILES_CLI_PATH) return process.env.PMTILES_CLI_PATH;
	const architecture = process.arch === "x64" ? "amd64" : process.arch;
	return join(
		PROJECT_ROOT,
		".cache",
		"tools",
		"pmtiles-v1.29.1",
		`${process.platform}-${architecture}`,
		"pmtiles",
	);
}

// Temp directory for extractions
const TEMP_DIR = join(import.meta.dir, "..", ".pmtiles-temp");

// Pending extractions storage (requestId -> extraction info)
interface PendingExtraction {
	filePath: string;
	sha256: string;
	blossomServer: string;
	createdAt: number;
}

const pendingExtractions = new Map<string, PendingExtraction>();

// Cleanup old pending extractions after 10 minutes
const EXTRACTION_TTL_MS = 10 * 60 * 1000;

function cleanupOldExtractions() {
	const now = Date.now();
	for (const [requestId, extraction] of pendingExtractions.entries()) {
		if (now - extraction.createdAt > EXTRACTION_TTL_MS) {
			rm(extraction.filePath, { force: true }).catch(() => {});
			pendingExtractions.delete(requestId);
		}
	}
}

// Run cleanup periodically
setInterval(cleanupOldExtractions, 60 * 1000);

export interface ExtractResult {
	requestId: string;
	sha256: string;
	fileSizeBytes: number;
	unsignedEvent: {
		kind: number;
		created_at: number;
		tags: string[][];
		content: string;
	};
}

export interface BBox {
	west: number;
	south: number;
	east: number;
	north: number;
}

/**
 * Calculate area of a bounding box in square kilometers
 */
export function calculateBBoxAreaSqKm(bbox: BBox): number {
	const { west, south, east, north } = bbox;

	// Convert to radians
	const lat1 = (south * Math.PI) / 180;
	const lat2 = (north * Math.PI) / 180;
	const lon1 = (west * Math.PI) / 180;
	const lon2 = (east * Math.PI) / 180;

	// Earth radius in km
	const R = 6371;

	// Approximate area using spherical geometry
	const width = R * Math.cos((lat1 + lat2) / 2) * Math.abs(lon2 - lon1);
	const height = R * Math.abs(lat2 - lat1);

	return width * height;
}

/**
 * Validate that the bounding box is within size limits
 */
export function validateBBoxSize(
	bbox: BBox,
	maxAreaSqKm: number = 3000,
): { valid: boolean; areaSqKm: number; error?: string } {
	const areaSqKm = calculateBBoxAreaSqKm(bbox);

	if (areaSqKm > maxAreaSqKm) {
		return {
			valid: false,
			areaSqKm,
			error: `Bounding box area (${areaSqKm.toFixed(2)} km²) exceeds maximum allowed (${maxAreaSqKm} km²)`,
		};
	}

	return { valid: true, areaSqKm };
}

/**
 * Extract a PMTiles excerpt for the given bounding box
 */
export async function extractPmtiles(
	bbox: BBox,
	maxZoom: number,
	blossomServer: string,
	maxAreaSqKm: number = 3000,
): Promise<ExtractResult> {
	// Validate size first
	const validation = validateBBoxSize(bbox, maxAreaSqKm);
	if (!validation.valid) {
		throw new Error(validation.error);
	}

	// Ensure temp directory exists
	await mkdir(TEMP_DIR, { recursive: true });

	// Generate unique request ID
	const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const outputPath = join(TEMP_DIR, `${requestId}.pmtiles`);

	// Build extract command
	const bboxStr = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;

	console.log(
		`🗺️ Extracting PMTiles: bbox=${bboxStr}, maxZoom=${maxZoom}, area=${validation.areaSqKm.toFixed(2)}km²`,
	);

	// Run pmtiles extract
	await runPmtilesExtract({
		input: DEFAULT_BASEMAP_PMTILES,
		output: outputPath,
		bbox: bboxStr,
		maxZoom,
	});

	// Compute SHA-256
	const sha256 = await computeSha256(outputPath);

	// Get file size
	const fileStat = await stat(outputPath);
	const fileSizeBytes = fileStat.size;

	console.log(
		`✅ Extraction complete: ${sha256.slice(0, 16)}... (${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB)`,
	);

	// Create unsigned Blossom auth event (kind 24242)
	const now = Math.floor(Date.now() / 1000);
	const expiration = now + 300; // 5 minutes

	const unsignedEvent = {
		kind: 24242,
		created_at: now,
		tags: [
			["t", "upload"],
			["x", sha256],
			["expiration", String(expiration)],
		],
		content: `Upload PMTiles map excerpt (${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB)`,
	};

	// Store pending extraction
	pendingExtractions.set(requestId, {
		filePath: outputPath,
		sha256,
		blossomServer,
		createdAt: Date.now(),
	});

	return {
		requestId,
		sha256,
		fileSizeBytes,
		unsignedEvent,
	};
}

/**
 * Get a pending extraction by request ID
 */
export function getPendingExtraction(
	requestId: string,
): PendingExtraction | undefined {
	return pendingExtractions.get(requestId);
}

/**
 * Remove a pending extraction after upload
 */
export async function removePendingExtraction(
	requestId: string,
): Promise<void> {
	const extraction = pendingExtractions.get(requestId);
	if (extraction) {
		await rm(extraction.filePath, { force: true });
		pendingExtractions.delete(requestId);
	}
}

/**
 * Run the pmtiles extract command
 */
async function runPmtilesExtract(args: {
	input: string;
	output: string;
	bbox: string;
	maxZoom: number;
}): Promise<void> {
	const { input, output, bbox, maxZoom } = args;

	const childArgs = [
		"extract",
		input,
		output,
		`--bbox=${bbox}`,
		"--minzoom",
		"0",
		"--maxzoom",
		String(maxZoom),
	];

	const pmtilesBin = getPmtilesBinPath();
	try {
		await access(pmtilesBin);
	} catch {
		throw new Error(
			`PMTiles CLI is not installed at ${pmtilesBin}. Run \`bun run tools:pmtiles\` before using map extraction.`,
		);
	}
	const proc = spawn(pmtilesBin, childArgs, {
		stdio: ["ignore", "pipe", "pipe"],
	});

	let stderr = "";
	proc.stderr?.on("data", (chunk) => {
		stderr += chunk.toString();
	});

	const exitCode = await new Promise<number>((resolve, reject) => {
		proc.once("error", reject);
		proc.once("close", (code) => resolve(code ?? 1));
	});

	if (exitCode !== 0) {
		throw new Error(
			`pmtiles extract failed (exit ${exitCode}): ${stderr.slice(-500)}`,
		);
	}
}

/**
 * Compute SHA-256 hash of a file
 */
async function computeSha256(filePath: string): Promise<string> {
	const hasher = createHash("sha256");

	await new Promise<void>((resolve, reject) => {
		const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
		stream.on("data", (chunk) => hasher.update(chunk));
		stream.once("error", reject);
		stream.once("end", resolve);
	});

	return hasher.digest("hex");
}
