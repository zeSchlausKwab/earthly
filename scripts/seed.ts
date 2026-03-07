import NDK, {
	NDKEvent,
	NDKPrivateKeySigner,
	type NDKTag,
	type NDKUserProfile,
} from "@nostr-dev-kit/ndk";
import { config } from "dotenv";
import { devUser1, devUser2, devUser3 } from "@/lib/fixtures";
import {
	GEO_COLLECTION_KIND,
	GEO_EVENT_KIND,
	GEO_EDIT_PROPOSAL_KIND,
	MAP_CONTEXT_KIND,
} from "@/lib/ndk/kinds";
import { createUserProfileEvent } from "./gen_user";
import { generateGeoEventData } from "./gen_geo_events";
import type { Feature, FeatureCollection } from "geojson";
import { NDKGeoCommentEvent } from "@/lib/ndk/NDKGeoCommentEvent";
import { buildSeedCommentThreads } from "./seed/comments";
import type { BoundingBox, CommentTarget, SeedIdentity } from "./seed/types";

config();

const RELAY_URL = "ws://localhost:3334";

const ndk = new NDK({
	explicitRelayUrls: [RELAY_URL],
	enableOutboxModel: false,
});

interface PublishedContext {
	id: string | null;
	coordinate: string;
	contextId: string;
	name: string;
	ownerPubkey: string;
	bbox?: BoundingBox;
}

interface PublishedDataset {
	id: string | null;
	datasetId: string;
	coordinate: string;
	name: string;
	ownerPubkey: string;
	featureCollection: FeatureCollection;
	bbox?: BoundingBox;
}

interface PublishedCollection {
	id: string | null;
	collectionId: string;
	coordinate: string;
	name: string;
	ownerPubkey: string;
	bbox?: BoundingBox;
}

interface PublishDatasetOptions {
	identity: SeedIdentity;
	datasetId: string;
	geoEventData: Awaited<ReturnType<typeof generateGeoEventData>>;
	contextCoordinates?: string[];
	collectionCoordinates?: string[];
}

interface PublishCollectionOptions {
	identity: SeedIdentity;
	collectionId: string;
	name: string;
	description: string;
	datasetCoordinates: string[];
	contextCoordinates?: string[];
	hashtags?: string[];
	license?: string;
	picture?: string;
	bbox?: BoundingBox;
}

interface PublishMapContextOptions {
	identity: SeedIdentity;
	contextId: string;
	content: Record<string, unknown>;
	hashtags?: string[];
	bbox?: BoundingBox;
	parentCoordinate?: string;
	version?: string;
}

const USER_PROFILES = {
	planner: {
		name: "east-planner",
		displayName: "East Region Planning Office",
		about:
			"Publishes regional boundaries and baseline context taxonomies for local development.",
		website: "https://earthly.local/planning",
		lud16: "plebeianuser@coinos.io",
	},
	mobility: {
		name: "mobility-lab",
		displayName: "Mobility Lab Brandenburg",
		about:
			"Publishes transport corridor datasets and validation-focused map contexts.",
		website: "https://earthly.local/mobility",
		lud16: "plebeianuser@coinos.io",
	},
	heritage: {
		name: "heritage-observer",
		displayName: "Heritage Mapping Collective",
		about:
			"Publishes cultural and zoning overlays to test cross-context validation behavior.",
		website: "https://earthly.local/heritage",
		lud16: "plebeianuser@coinos.io",
	},
} satisfies Record<"planner" | "mobility" | "heritage", NDKUserProfile>;

const STATE_SEEDS = [
	{ name: "Mecklenburg-Vorpommern", slug: "mecklenburg-vorpommern" },
	{ name: "Brandenburg", slug: "brandenburg" },
	{ name: "Sachsen", slug: "sachsen" },
	{ name: "Sachsen-Anhalt", slug: "sachsen-anhalt" },
	{ name: "Thüringen", slug: "thueringen" },
] as const;

function coordinate(kind: number, pubkey: string, dTag: string): string {
	return `${kind}:${pubkey}:${dTag}`;
}

function upsertSingleTag(tags: NDKTag[], tagName: string, value: string): NDKTag[] {
	const next = tags.filter((tag) => tag[0] !== tagName).map((tag) => [...tag]);
	next.push([tagName, value]);
	return next;
}

function appendUniqueTag(tags: NDKTag[], tagName: string, value: string): void {
	if (tags.some((tag) => tag[0] === tagName && tag[1] === value)) return;
	tags.push([tagName, value]);
}

function parseBbox(tags: NDKTag[]): BoundingBox | undefined {
	const raw = tags.find((tag) => tag[0] === "bbox")?.[1];
	if (!raw) return undefined;
	const values = raw.split(",").map((v) => Number.parseFloat(v.trim()));
	if (values.length !== 4 || values.some((value) => Number.isNaN(value))) {
		return undefined;
	}
	return values as BoundingBox;
}

function bboxToTagValue(bbox: BoundingBox): string {
	return `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`;
}

function mergeBoundingBoxes(boxes: BoundingBox[]): BoundingBox | undefined {
	const first = boxes[0];
	if (!first) return undefined;
	let [west, south, east, north] = first;
	for (const [nextWest, nextSouth, nextEast, nextNorth] of boxes.slice(1)) {
		west = Math.min(west, nextWest);
		south = Math.min(south, nextSouth);
		east = Math.max(east, nextEast);
		north = Math.max(north, nextNorth);
	}
	return [west, south, east, north];
}

const FEATURE_STYLE_PALETTES = {
	amenities: {
		fill: ["#0B7285", "#0E7490", "#2563EB", "#0891B2"],
		stroke: ["#164E63", "#155E75", "#1D4ED8", "#0E7490"],
		opacity: [0.82, 0.88, 0.92],
	},
	hiking: {
		fill: ["#65A30D", "#4D7C0F", "#3F6212", "#84CC16"],
		stroke: ["#365314", "#3F6212", "#4D7C0F", "#1A2E05"],
		opacity: [0.76, 0.82, 0.9],
	},
	surf: {
		fill: ["#0EA5E9", "#0284C7", "#38BDF8", "#22D3EE"],
		stroke: ["#075985", "#0369A1", "#0C4A6E", "#155E75"],
		opacity: [0.8, 0.86, 0.9],
	},
	beaches: {
		fill: ["#F59E0B", "#F97316", "#FBBF24", "#FB923C"],
		stroke: ["#B45309", "#C2410C", "#92400E", "#9A3412"],
		opacity: [0.72, 0.8, 0.88],
	},
} as const;

function decorateFeatures(
	features: Feature[],
	paletteKey: keyof typeof FEATURE_STYLE_PALETTES,
	defaultDescriptionPrefix: string,
): Feature[] {
	const palette = FEATURE_STYLE_PALETTES[paletteKey];
	return features.map((feature, index) => {
		const fill = palette.fill[index % palette.fill.length] ?? "#64748B";
		const stroke = palette.stroke[index % palette.stroke.length] ?? "#334155";
		const opacity = palette.opacity[index % palette.opacity.length] ?? 0.85;
		const baseProperties =
			feature.properties && typeof feature.properties === "object"
				? (feature.properties as Record<string, unknown>)
				: {};
		const description =
			typeof baseProperties.description === "string" && baseProperties.description.trim().length > 0
				? baseProperties.description
				: `${defaultDescriptionPrefix} #${index + 1}`;

		return {
			...feature,
			properties: {
				...baseProperties,
				description,
				fill,
				stroke,
				color: stroke,
				opacity,
				fillOpacity: opacity,
				strokeOpacity: Math.min(1, opacity + 0.08),
				strokeWidth: feature.geometry.type === "Point" ? 2 : 3,
			},
		};
	});
}

function generateGeohash(
	lat: number,
	lon: number,
	precision: number = 5,
): string {
	const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
	let geohash = "";
	let even = true;
	const latRange: [number, number] = [-90, 90];
	const lonRange: [number, number] = [-180, 180];

	for (let i = 0; i < precision; i++) {
		let ch = 0;
		for (let bit = 0; bit < 5; bit++) {
			if (even) {
				const mid = (lonRange[0] + lonRange[1]) / 2;
				if (lon >= mid) {
					ch |= 1 << (4 - bit);
					lonRange[0] = mid;
				} else {
					lonRange[1] = mid;
				}
			} else {
				const mid = (latRange[0] + latRange[1]) / 2;
				if (lat >= mid) {
					ch |= 1 << (4 - bit);
					latRange[0] = mid;
				} else {
					latRange[1] = mid;
				}
			}
			even = !even;
		}
		geohash += base32[ch];
	}

	return geohash;
}

function geohashFromBbox(bbox: BoundingBox): string {
	const centroidLat = (bbox[1] + bbox[3]) / 2;
	const centroidLon = (bbox[0] + bbox[2]) / 2;
	return generateGeohash(centroidLat, centroidLon, 6);
}

function getCollectionName(content: string, fallback: string): string {
	try {
		const parsed = JSON.parse(content) as Record<string, unknown>;
		if (typeof parsed.name === "string" && parsed.name.length > 0) {
			return parsed.name;
		}
	} catch {
		// no-op
	}
	return fallback;
}

function parseFeatureCollection(content: string): FeatureCollection {
	try {
		const parsed = JSON.parse(content) as FeatureCollection;
		if (parsed?.type === "FeatureCollection" && Array.isArray(parsed.features)) {
			return parsed;
		}
	} catch {
		// no-op
	}
	return {
		type: "FeatureCollection",
		features: [],
	};
}

async function createIdentity(
	label: string,
	secretKey: string,
	profile: NDKUserProfile,
): Promise<SeedIdentity> {
	const signer = new NDKPrivateKeySigner(secretKey);
	await signer.blockUntilReady();
	const pubkey = (await signer.user()).pubkey;
	console.log(`- Profile: ${label} (${pubkey.slice(0, 8)})`);
	await createUserProfileEvent(signer, ndk, profile);
	return { label, signer, pubkey };
}

async function publishMapContext({
	identity,
	contextId,
	content,
	hashtags = [],
	bbox,
	parentCoordinate,
	version = "1",
}: PublishMapContextOptions): Promise<PublishedContext> {
	const event = new NDKEvent(ndk);
	event.kind = MAP_CONTEXT_KIND;
	event.content = JSON.stringify(content);

	const tags: NDKTag[] = [["d", contextId], ["v", version], ["r", RELAY_URL]];
	if (bbox) {
		tags.push(["bbox", bboxToTagValue(bbox)]);
		tags.push(["g", geohashFromBbox(bbox)]);
	}
	if (parentCoordinate) {
		tags.push(["parent", parentCoordinate]);
	}
	hashtags.forEach((tag) => tags.push(["t", tag]));

	event.tags = tags;
	event.created_at = Math.floor(Date.now() / 1000);

	await event.sign(identity.signer);
	await event.publish();

	const contextCoordinate = coordinate(MAP_CONTEXT_KIND, identity.pubkey, contextId);
	console.log(`  Context published: ${contextId}`);
	return {
		id: event.id ?? null,
		coordinate: contextCoordinate,
		contextId,
		name:
			(typeof content.name === "string" && content.name.trim().length > 0
				? content.name
				: contextId),
		ownerPubkey: identity.pubkey,
		bbox,
	};
}

async function publishDataset({
	identity,
	datasetId,
	geoEventData,
	contextCoordinates = [],
	collectionCoordinates = [],
}: PublishDatasetOptions): Promise<PublishedDataset> {
	let tags = geoEventData.tags.map((tag) => [...tag]);
	tags = upsertSingleTag(tags, "d", datasetId);
	appendUniqueTag(tags, "r", RELAY_URL);

	contextCoordinates.forEach((contextCoordinate) => {
		appendUniqueTag(tags, "c", contextCoordinate);
	});

	collectionCoordinates.forEach((collectionCoordinate) => {
		appendUniqueTag(tags, "collection", collectionCoordinate);
	});

	const event = new NDKEvent(ndk);
	event.kind = geoEventData.kind;
	event.content = geoEventData.content;
	event.tags = tags;
	event.created_at = geoEventData.created_at;

	await event.sign(identity.signer);
	await event.publish();

	const datasetCoordinate = coordinate(GEO_EVENT_KIND, identity.pubkey, datasetId);
	const datasetName = getCollectionName(geoEventData.content, datasetId);
	const featureCollection = parseFeatureCollection(geoEventData.content);

	return {
		id: event.id ?? null,
		datasetId,
		coordinate: datasetCoordinate,
		name: datasetName,
		ownerPubkey: identity.pubkey,
		featureCollection,
		bbox: parseBbox(tags),
	};
}

async function publishCollection({
	identity,
	collectionId,
	name,
	description,
	datasetCoordinates,
	contextCoordinates = [],
	hashtags = [],
	license = "CC-BY-4.0",
	picture,
	bbox,
}: PublishCollectionOptions): Promise<PublishedCollection> {
	const event = new NDKEvent(ndk);
	event.kind = GEO_COLLECTION_KIND;
	event.content = JSON.stringify({
		name,
		description,
		license,
		picture,
		ownerPk: identity.pubkey,
		tags: hashtags,
	});

	const tags: NDKTag[] = [["d", collectionId], ["r", RELAY_URL]];
	if (bbox) {
		tags.push(["bbox", bboxToTagValue(bbox)]);
		tags.push(["g", geohashFromBbox(bbox)]);
	}
	hashtags.forEach((tag) => tags.push(["t", tag]));
	datasetCoordinates.forEach((datasetCoordinate) => tags.push(["a", datasetCoordinate]));
	contextCoordinates.forEach((contextCoordinate) => tags.push(["c", contextCoordinate]));

	event.tags = tags;
	event.created_at = Math.floor(Date.now() / 1000);

	await event.sign(identity.signer);
	await event.publish();

	const collectionCoordinate = coordinate(
		GEO_COLLECTION_KIND,
		identity.pubkey,
		collectionId,
	);
	console.log(`  Collection published: ${name}`);
	return {
		id: event.id ?? null,
		collectionId,
		coordinate: collectionCoordinate,
		name,
		ownerPubkey: identity.pubkey,
		bbox,
	};
}

interface PublishProposalOptions {
	identity: SeedIdentity;
	proposalId: string;
	targetDataset: PublishedDataset;
	description: string;
	featureCollection: FeatureCollection;
	hashtags?: string[];
}

async function publishProposal({
	identity,
	proposalId,
	targetDataset,
	description,
	featureCollection,
	hashtags = [],
}: PublishProposalOptions): Promise<void> {
	const targetAddress = coordinate(
		GEO_EVENT_KIND,
		targetDataset.ownerPubkey,
		targetDataset.datasetId,
	);

	const tags: NDKTag[] = [
		["d", proposalId],
		["a", targetAddress],
		["p", targetDataset.ownerPubkey],
		["description", description],
	];
	if (targetDataset.id) {
		tags.push(["base-version", targetDataset.id]);
	}
	if (targetDataset.bbox) {
		tags.push(["bbox", bboxToTagValue(targetDataset.bbox)]);
	}
	hashtags.forEach((tag) => tags.push(["t", tag]));

	const event = new NDKEvent(ndk);
	event.kind = GEO_EDIT_PROPOSAL_KIND;
	event.content = JSON.stringify(featureCollection);
	event.tags = tags;
	event.created_at = Math.floor(Date.now() / 1000);

	await event.sign(identity.signer);
	await event.publish();

	console.log(`  Proposal published: "${description}" by ${identity.label} -> ${targetDataset.name}`);
}

async function publishSeedCommentThread(
	target: CommentTarget,
	identities: SeedIdentity[],
	seedIndex: number,
): Promise<number> {
	const rootAddress = coordinate(target.kind, target.ownerPubkey, target.dTag);
	const threadSpecs = buildSeedCommentThreads(target, seedIndex);
	const baseTimestamp = Math.floor(Date.now() / 1000) + seedIndex * 900;
	let publishedCount = 0;

	for (const [threadIndex, threadSpec] of threadSpecs.entries()) {
		const author =
			identities[(seedIndex + threadIndex) % identities.length] ?? identities[0];
		if (!author) continue;

		const comment = new NDKGeoCommentEvent(ndk);
		comment.commentContent = {
			text: threadSpec.text,
			geojson: threadSpec.geojson,
		};
		comment.setRootScope(target.kind, rootAddress, target.ownerPubkey);
		comment.created_at = baseTimestamp + threadIndex * 180;
		await comment.publishComment(author.signer);
		publishedCount += 1;

		for (const [replyIndex, replySpec] of threadSpec.replies.entries()) {
			let replyAuthor =
				identities[(seedIndex + threadIndex + replyIndex + 1) % identities.length] ??
				identities[0];
			if (!replyAuthor) continue;
			if (replyAuthor.pubkey === author.pubkey && identities.length > 1) {
				replyAuthor =
					identities[(seedIndex + threadIndex + replyIndex + 2) % identities.length] ??
					replyAuthor;
			}

			const reply = new NDKGeoCommentEvent(ndk);
			reply.commentContent = {
				text: replySpec.text,
				geojson: replySpec.geojson,
			};
			reply.setReplyScope(target.kind, rootAddress, target.ownerPubkey, comment);
			reply.created_at = (comment.created_at ?? baseTimestamp) + (replyIndex + 1) * 45;
			await reply.publishComment(replyAuthor.signer);
			publishedCount += 1;
		}
	}

	console.log(`  Comments published: ${target.name} (${publishedCount} events)`);
	return publishedCount;
}

function nudgePosition(
	position: [number, number],
	seedFactor: number,
): [number, number] {
	const [lon, lat] = position;
	const deltaLon = 0.004 + seedFactor * 0.0006;
	const deltaLat = 0.002 + seedFactor * 0.0004;
	return [lon + deltaLon, lat + deltaLat];
}

function mutateFeatureCollectionForProposal(
	featureCollection: FeatureCollection,
	seedFactor: number,
): FeatureCollection {
	const cloned = JSON.parse(JSON.stringify(featureCollection)) as FeatureCollection;
	const firstFeature = cloned.features[0];
	const geometry = firstFeature?.geometry;
	if (!firstFeature || !geometry) return cloned;

	switch (geometry.type) {
		case "Point": {
			geometry.coordinates = nudgePosition(
				geometry.coordinates as [number, number],
				seedFactor,
			);
			break;
		}
		case "MultiPoint":
		case "LineString": {
			const coords = geometry.coordinates as [number, number][];
			const idx = Math.max(0, Math.floor(coords.length / 2));
			if (coords[idx]) coords[idx] = nudgePosition(coords[idx], seedFactor);
			break;
		}
		case "Polygon": {
			const ring = geometry.coordinates[0];
			if (ring && ring.length > 3 && ring[0] && ring[1]) {
				ring[1] = nudgePosition(ring[1] as [number, number], seedFactor);
				ring[ring.length - 1] = [...ring[0]] as [number, number];
			}
			break;
		}
		case "MultiLineString": {
			const line = geometry.coordinates[0];
			if (line && line.length > 0) {
				const idx = Math.max(0, Math.floor(line.length / 2));
				line[idx] = nudgePosition(line[idx] as [number, number], seedFactor);
			}
			break;
		}
		case "MultiPolygon": {
			const ring = geometry.coordinates[0]?.[0];
			if (ring && ring.length > 3 && ring[0] && ring[1]) {
				ring[1] = nudgePosition(ring[1] as [number, number], seedFactor);
				ring[ring.length - 1] = [...ring[0]] as [number, number];
			}
			break;
		}
		case "GeometryCollection": {
			const pointLike = geometry.geometries.find((item) => item.type === "Point");
			if (pointLike?.type === "Point") {
				pointLike.coordinates = nudgePosition(
					pointLike.coordinates as [number, number],
					seedFactor,
				);
			}
			break;
		}
	}

	if (firstFeature.properties && typeof firstFeature.properties === "object") {
		(firstFeature.properties as Record<string, unknown>).seed_proposal = `proposal-${seedFactor}`;
	}

	return cloned;
}

function pickProposalAuthor(
	targetDataset: PublishedDataset,
	identities: SeedIdentity[],
	seedIndex: number,
): SeedIdentity {
	const candidates = identities.filter(
		(identity) => identity.pubkey !== targetDataset.ownerPubkey,
	);
	if (candidates.length === 0) {
		return identities[0]!;
	}
	return candidates[seedIndex % candidates.length] ?? candidates[0]!;
}

function createRailCorridorFeatureCollection(): FeatureCollection & Record<string, unknown> {
	return {
		type: "FeatureCollection",
		name: "Berlin-Brandenburg Rail Corridors",
		description:
			"Operational and planned regional corridors used to test required context validation.",
		features: [
			{
				type: "Feature",
				id: "corridor-rb22",
				properties: {
					name: "RB22 West Corridor",
					corridor_code: "RB22",
					status: "active",
					surface: "rail",
					length_km: 37.5,
					operator: "ODEG",
				},
				geometry: {
					type: "LineString",
					coordinates: [
						[13.3694, 52.5251],
						[13.2365, 52.4337],
						[13.0657, 52.3998],
						[12.9874, 52.4006],
					],
				},
			},
			{
				type: "Feature",
				id: "corridor-re2",
				properties: {
					name: "RE2 Southeast Corridor",
					corridor_code: "RE2",
					status: "active",
					surface: "rail",
					length_km: 61.1,
					operator: "DB Regio",
				},
				geometry: {
					type: "LineString",
					coordinates: [
						[13.3694, 52.5251],
						[13.5146, 52.3914],
						[13.7302, 52.2888],
						[13.8748, 52.1697],
					],
				},
			},
		],
	};
}

function createBikeNetworkFeatureCollection(): FeatureCollection & Record<string, unknown> {
	return {
		type: "FeatureCollection",
		name: "Berlin Mobility Spine Lines",
		description:
			"Line datasets from another publisher to validate multi-author context attachments.",
		features: [
			{
				type: "Feature",
				id: "bike-spine-north",
				properties: {
					name: "North Mobility Spine",
					corridor_code: "BSP-N",
					status: "planned",
					surface: "paved",
					length_km: 24.8,
				},
				geometry: {
					type: "LineString",
					coordinates: [
						[13.0884, 52.4409],
						[13.2216, 52.4952],
						[13.3717, 52.5406],
						[13.5051, 52.5823],
					],
				},
			},
			{
				type: "Feature",
				id: "bike-spine-south",
				properties: {
					name: "South Mobility Spine",
					corridor_code: "BSP-S",
					status: "construction",
					surface: "gravel",
					length_km: 18.2,
				},
				geometry: {
					type: "LineString",
					coordinates: [
						[13.3041, 52.3383],
						[13.3628, 52.3719],
						[13.4512, 52.4022],
						[13.5882, 52.447],
					],
				},
			},
		],
	};
}

function createInvalidValidationFeatureCollection(): FeatureCollection & Record<string, unknown> {
	return {
		type: "FeatureCollection",
		name: "Historic Conservation Zones",
		description:
			"Polygon zoning overlays intentionally attached to a line-only required context.",
		features: [
			{
				type: "Feature",
				id: "heritage-zone-a",
				properties: {
					name: "Inner Ring Conservation Zone",
					zone_type: "conservation",
					year_established: 1995,
				},
				geometry: {
					type: "Polygon",
					coordinates: [
						[
							[13.3322, 52.4954],
							[13.3917, 52.4954],
							[13.3917, 52.5312],
							[13.3322, 52.5312],
							[13.3322, 52.4954],
						],
					],
				},
			},
			{
				type: "Feature",
				id: "heritage-zone-b",
				properties: {
					name: "Riverside Buffer Zone",
					zone_type: "buffer",
					year_established: 2001,
				},
				geometry: {
					type: "Polygon",
					coordinates: [
						[
							[13.4411, 52.4635],
							[13.5169, 52.4635],
							[13.5169, 52.5052],
							[13.4411, 52.5052],
							[13.4411, 52.4635],
						],
					],
				},
			},
		],
	};
}

function createWaterQualityStationsFeatureCollection(): FeatureCollection & Record<string, unknown> {
	return {
		type: "FeatureCollection",
		name: "Havel-Spree Water Quality Stations",
		description:
			"Monitoring stations with periodic measurements used for point-validation map contexts.",
		features: [
			{
				type: "Feature",
				id: "station-hv-001",
				properties: {
					name: "Havel North Intake",
					station_id: "HV-001",
					water_body: "Havel",
					ph: 7.4,
					nitrate_mg_l: 3.8,
					ecoli_cfu_100ml: 92,
					sampling_interval_days: 7,
				},
				geometry: { type: "Point", coordinates: [13.1915, 52.5754] },
			},
			{
				type: "Feature",
				id: "station-hv-002",
				properties: {
					name: "Wannsee Gauge",
					station_id: "HV-002",
					water_body: "Havel",
					ph: 7.2,
					nitrate_mg_l: 4.1,
					ecoli_cfu_100ml: 105,
					sampling_interval_days: 7,
				},
				geometry: { type: "Point", coordinates: [13.1781, 52.4238] },
			},
			{
				type: "Feature",
				id: "station-sp-003",
				properties: {
					name: "Mitte Canal Junction",
					station_id: "SP-003",
					water_body: "Spree",
					ph: 7.0,
					nitrate_mg_l: 5.2,
					ecoli_cfu_100ml: 148,
					sampling_interval_days: 14,
				},
				geometry: { type: "Point", coordinates: [13.3893, 52.5174] },
			},
			{
				type: "Feature",
				id: "station-sp-004",
				properties: {
					name: "Treptow Riverside",
					station_id: "SP-004",
					water_body: "Spree",
					ph: 7.5,
					nitrate_mg_l: 3.1,
					ecoli_cfu_100ml: 80,
					sampling_interval_days: 14,
				},
				geometry: { type: "Point", coordinates: [13.4696, 52.4923] },
			},
		],
	};
}

function createRiverSegmentsFeatureCollection(): FeatureCollection & Record<string, unknown> {
	return {
		type: "FeatureCollection",
		name: "Havel-Spree River Segments",
		description:
			"Line segments linked to station zones, intentionally attached to a point-constrained context.",
		features: [
			{
				type: "Feature",
				id: "segment-havel-north",
				properties: {
					name: "Havel Segment North",
					segment_id: "HV-S1",
					water_body: "Havel",
					monitoring_zone: "north",
					length_km: 18.4,
				},
				geometry: {
					type: "LineString",
					coordinates: [
						[13.1118, 52.6224],
						[13.1576, 52.5932],
						[13.2035, 52.5713],
						[13.2391, 52.5431],
					],
				},
			},
			{
				type: "Feature",
				id: "segment-spree-central",
				properties: {
					name: "Spree Segment Central",
					segment_id: "SP-S2",
					water_body: "Spree",
					monitoring_zone: "central",
					length_km: 13.7,
				},
				geometry: {
					type: "LineString",
					coordinates: [
						[13.2851, 52.5208],
						[13.3541, 52.5185],
						[13.4216, 52.5092],
						[13.5034, 52.4895],
					],
				},
			},
		],
	};
}

function createHeritageHotspotsFeatureCollection(): FeatureCollection & Record<string, unknown> {
	return {
		type: "FeatureCollection",
		name: "Saxon Heritage Hotspots",
		description:
			"Important cultural assets and preservation zones curated for taxonomy and storytelling contexts.",
		features: [
			{
				type: "Feature",
				id: "heritage-dresden-center",
				properties: {
					name: "Dresden Historic Core",
					site_type: "historic_district",
					period: "baroque",
					significance: "international",
				},
				geometry: {
					type: "Polygon",
					coordinates: [
						[
							[13.723, 51.0424],
							[13.7529, 51.0424],
							[13.7529, 51.0594],
							[13.723, 51.0594],
							[13.723, 51.0424],
						],
					],
				},
			},
			{
				type: "Feature",
				id: "heritage-leipzig-passage",
				properties: {
					name: "Leipzig Trade Passage Axis",
					site_type: "urban_axis",
					period: "industrial",
					significance: "national",
				},
				geometry: {
					type: "LineString",
					coordinates: [
						[12.3621, 51.3426],
						[12.3743, 51.3404],
						[12.3878, 51.3388],
					],
				},
			},
			{
				type: "Feature",
				id: "heritage-meissen-castle",
				properties: {
					name: "Meissen Albrechtsburg",
					site_type: "castle",
					period: "medieval",
					significance: "regional",
				},
				geometry: { type: "Point", coordinates: [13.4746, 51.1616] },
			},
		],
	};
}

function createAccessibleToiletsFeatureCollection(): FeatureCollection & Record<string, unknown> {
	const features: Feature[] = [
		{
			type: "Feature",
			id: "toilet-ber-001",
			properties: {
				name: "Alexanderplatz Station Toilet",
				toilet_id: "BER-WC-001",
				wheelchair_access: true,
				opening_hours: "24/7",
				fee_eur: 0.5,
				operator: "Wall AG",
				changing_table: true,
				country: "DE",
				description: "High-frequency station toilet with step-free entrance and elevator access.",
			},
			geometry: { type: "Point", coordinates: [13.4121, 52.5219] },
		},
		{
			type: "Feature",
			id: "toilet-nyc-002",
			properties: {
				name: "Bryant Park Public Restroom",
				toilet_id: "NYC-WC-002",
				wheelchair_access: true,
				opening_hours: "07:00-22:00",
				fee_eur: 0,
				operator: "NYC Parks",
				changing_table: true,
				country: "US",
				description: "Central Manhattan facility frequently used for accessibility route planning.",
			},
			geometry: { type: "Point", coordinates: [-73.9832, 40.7536] },
		},
		{
			type: "Feature",
			id: "toilet-tyo-003",
			properties: {
				name: "Shibuya Accessible Smart Toilet",
				toilet_id: "TYO-WC-003",
				wheelchair_access: true,
				opening_hours: "24/7",
				fee_eur: 0,
				operator: "Shibuya City",
				changing_table: true,
				country: "JP",
				description: "Modern universal-design toilet with broad turning radius.",
			},
			geometry: { type: "Point", coordinates: [139.7006, 35.6595] },
		},
		{
			type: "Feature",
			id: "toilet-cpt-004",
			properties: {
				name: "V&A Waterfront Harbor Toilet",
				toilet_id: "CPT-WC-004",
				wheelchair_access: true,
				opening_hours: "06:00-23:00",
				fee_eur: 0,
				operator: "Waterfront Mgmt",
				changing_table: true,
				country: "ZA",
				description: "Tourist-heavy, step-free facility with wide cubicle access.",
			},
			geometry: { type: "Point", coordinates: [18.4167, -33.9036] },
		},
		{
			type: "Feature",
			id: "toilet-syd-005",
			properties: {
				name: "Circular Quay Transit Toilet",
				toilet_id: "SYD-WC-005",
				wheelchair_access: true,
				opening_hours: "05:30-23:30",
				fee_eur: 0,
				operator: "City of Sydney",
				changing_table: false,
				country: "AU",
				description: "Transit-adjacent restroom with ramped approach and accessible cabin.",
			},
			geometry: { type: "Point", coordinates: [151.2108, -33.8616] },
		},
		{
			type: "Feature",
			id: "toilet-sao-006",
			properties: {
				name: "Ibirapuera Park Main Toilet",
				toilet_id: "SAO-WC-006",
				wheelchair_access: true,
				opening_hours: "06:00-22:00",
				fee_eur: 0,
				operator: "São Paulo Parks",
				changing_table: true,
				country: "BR",
				description: "Park toilet with tactile paving and wheelchair-friendly layout.",
			},
			geometry: { type: "Point", coordinates: [-46.6534, -23.5873] },
		},
		{
			type: "Feature",
			id: "toilet-van-007",
			properties: {
				name: "Stanley Park Lagoon Restroom",
				toilet_id: "VAN-WC-007",
				wheelchair_access: true,
				opening_hours: "07:00-21:00",
				fee_eur: 0,
				operator: "Vancouver Parks",
				changing_table: true,
				country: "CA",
				description: "Seasonal high-capacity accessible restroom near waterfront loop.",
			},
			geometry: { type: "Point", coordinates: [-123.1472, 49.3043] },
		},
		{
			type: "Feature",
			id: "toilet-dxb-008",
			properties: {
				name: "Dubai Marina Promenade Toilet",
				toilet_id: "DXB-WC-008",
				wheelchair_access: true,
				opening_hours: "24/7",
				fee_eur: 0,
				operator: "Dubai Municipality",
				changing_table: false,
				country: "AE",
				description: "Promenade-access facility for accessible waterfront itineraries.",
			},
			geometry: { type: "Point", coordinates: [55.1413, 25.0852] },
		},
	];

	return {
		type: "FeatureCollection",
		name: "Global Accessible Public Toilets",
		description:
			"Public toilets verified for wheelchair accessibility across major global cities.",
		features: decorateFeatures(features, "amenities", "Accessible toilet"),
	};
}

function createHikingTrailsFeatureCollection(): FeatureCollection & Record<string, unknown> {
	const features: Feature[] = [
		{
			type: "Feature",
			id: "trail-it-001",
			properties: {
				name: "Dolomites Ridge Traverse",
				trail_id: "IT-TR-001",
				difficulty: "hard",
				route_type: "out-and-back",
				distance_km: 14.2,
				elevation_gain_m: 980,
				surface: "rocky",
				country: "IT",
				description: "High alpine route with exposed ridgeline and panoramic views.",
			},
			geometry: {
				type: "LineString",
				coordinates: [
					[11.82, 46.54],
					[11.86, 46.53],
					[11.91, 46.51],
					[11.95, 46.49],
				],
			},
		},
		{
			type: "Feature",
			id: "trail-pe-002",
			properties: {
				name: "Inca Highlands Segment",
				trail_id: "PE-TR-002",
				difficulty: "hard",
				route_type: "out-and-back",
				distance_km: 11.7,
				elevation_gain_m: 1230,
				surface: "stone",
				country: "PE",
				description: "Steep Andean ascent with archaeological waypoints.",
			},
			geometry: {
				type: "LineString",
				coordinates: [
					[-72.567, -13.232],
					[-72.553, -13.201],
					[-72.539, -13.18],
					[-72.525, -13.163],
				],
			},
		},
		{
			type: "Feature",
			id: "trail-cl-003",
			properties: {
				name: "Torres Base Circuit",
				trail_id: "CL-TR-003",
				difficulty: "moderate",
				route_type: "loop",
				distance_km: 17.9,
				elevation_gain_m: 720,
				surface: "mixed",
				country: "CL",
				description: "Glacial valley loop with variable wind conditions.",
			},
			geometry: {
				type: "LineString",
				coordinates: [
					[-72.996, -50.957],
					[-72.972, -50.938],
					[-72.951, -50.924],
					[-72.933, -50.909],
					[-72.948, -50.93],
				],
			},
		},
		{
			type: "Feature",
			id: "trail-np-004",
			properties: {
				name: "Everest View Trek Segment",
				trail_id: "NP-TR-004",
				difficulty: "moderate",
				route_type: "out-and-back",
				distance_km: 8.3,
				elevation_gain_m: 560,
				surface: "stone",
				country: "NP",
				description: "High-altitude route with thin-air conditions and ridge villages.",
			},
			geometry: {
				type: "LineString",
				coordinates: [
					[86.712, 27.805],
					[86.73, 27.817],
					[86.748, 27.829],
					[86.764, 27.842],
				],
			},
		},
		{
			type: "Feature",
			id: "trail-nz-005",
			properties: {
				name: "Tongariro Alpine Crossing",
				trail_id: "NZ-TR-005",
				difficulty: "hard",
				route_type: "out-and-back",
				distance_km: 19.4,
				elevation_gain_m: 910,
				surface: "volcanic",
				country: "NZ",
				description: "Volcanic terrain with rapid weather shifts and long exposure.",
			},
			geometry: {
				type: "LineString",
				coordinates: [
					[175.561, -39.132],
					[175.595, -39.118],
					[175.628, -39.109],
					[175.661, -39.098],
				],
			},
		},
		{
			type: "Feature",
			id: "trail-us-006",
			properties: {
				name: "Rocky Mountain Lakes Loop",
				trail_id: "US-TR-006",
				difficulty: "easy",
				route_type: "loop",
				distance_km: 6.8,
				elevation_gain_m: 240,
				surface: "dirt",
				country: "US",
				description: "Accessible family loop through alpine lakes and meadows.",
			},
			geometry: {
				type: "LineString",
				coordinates: [
					[-105.648, 40.279],
					[-105.633, 40.285],
					[-105.618, 40.279],
					[-105.629, 40.27],
					[-105.648, 40.279],
				],
			},
		},
		{
			type: "Feature",
			id: "trail-ma-007",
			properties: {
				name: "Atlas Cedar Route",
				trail_id: "MA-TR-007",
				difficulty: "moderate",
				route_type: "loop",
				distance_km: 9.2,
				elevation_gain_m: 430,
				surface: "gravel",
				country: "MA",
				description: "Mountain forest circuit through cedar valleys and ridge paths.",
			},
			geometry: {
				type: "LineString",
				coordinates: [
					[-7.93, 31.135],
					[-7.902, 31.146],
					[-7.881, 31.158],
					[-7.867, 31.143],
					[-7.89, 31.129],
				],
			},
		},
	];

	return {
		type: "FeatureCollection",
		name: "Global Hiking Trails Network",
		description:
			"Major international trail segments with difficulty, elevation, and route metadata.",
		features: decorateFeatures(features, "hiking", "Hiking trail segment"),
	};
}

function createSurfSpotsFeatureCollection(): FeatureCollection & Record<string, unknown> {
	const features: Feature[] = [
		{
			type: "Feature",
			id: "surf-pt-001",
			properties: {
				name: "Nazaré Big Wave Point",
				spot_id: "SURF-PT-001",
				break_type: "reef_break",
				skill_level: "advanced",
				best_wind_direction: "E",
				best_swell_direction: "NW",
				season: "winter",
				country: "PT",
				description: "Heavy-wave location known for extreme swells.",
			},
			geometry: { type: "Point", coordinates: [-9.071, 39.602] },
		},
		{
			type: "Feature",
			id: "surf-us-002",
			properties: {
				name: "Banzai Pipeline",
				spot_id: "SURF-US-002",
				break_type: "reef_break",
				skill_level: "advanced",
				best_wind_direction: "SE",
				best_swell_direction: "N",
				season: "winter",
				country: "US",
				description: "World-class reef break requiring expert-level positioning.",
			},
			geometry: { type: "Point", coordinates: [-158.053, 21.664] },
		},
		{
			type: "Feature",
			id: "surf-id-003",
			properties: {
				name: "Uluwatu Main Peak",
				spot_id: "SURF-ID-003",
				break_type: "reef_break",
				skill_level: "intermediate",
				best_wind_direction: "E",
				best_swell_direction: "SW",
				season: "dry",
				country: "ID",
				description: "Consistent reef waves with multiple take-off zones.",
			},
			geometry: { type: "Point", coordinates: [115.086, -8.829] },
		},
		{
			type: "Feature",
			id: "surf-za-004",
			properties: {
				name: "Jeffreys Bay Supertubes",
				spot_id: "SURF-ZA-004",
				break_type: "reef_break",
				skill_level: "advanced",
				best_wind_direction: "W",
				best_swell_direction: "SE",
				season: "winter",
				country: "ZA",
				description: "Fast right-hand point break with long ride potential.",
			},
			geometry: { type: "Point", coordinates: [24.929, -34.05] },
		},
		{
			type: "Feature",
			id: "surf-au-005",
			properties: {
				name: "Bondi South End",
				spot_id: "SURF-AU-005",
				break_type: "beach_break",
				skill_level: "beginner",
				best_wind_direction: "W",
				best_swell_direction: "E",
				season: "summer",
				country: "AU",
				description: "Accessible beach break with beginner-friendly sections.",
			},
			geometry: { type: "Point", coordinates: [151.274, -33.891] },
		},
		{
			type: "Feature",
			id: "surf-us-006",
			properties: {
				name: "Steamer Lane",
				spot_id: "SURF-US-006",
				break_type: "reef_break",
				skill_level: "intermediate",
				best_wind_direction: "N",
				best_swell_direction: "W",
				season: "autumn",
				country: "US",
				description: "Iconic point setup with multiple breaks by skill level.",
			},
			geometry: { type: "Point", coordinates: [-122.03, 36.958] },
		},
		{
			type: "Feature",
			id: "surf-pe-007",
			properties: {
				name: "Chicama Left",
				spot_id: "SURF-PE-007",
				break_type: "sandbar",
				skill_level: "intermediate",
				best_wind_direction: "SE",
				best_swell_direction: "SW",
				season: "spring",
				country: "PE",
				description: "Long left-hand rides with favorable sandbar structure.",
			},
			geometry: { type: "Point", coordinates: [-79.423, -7.71] },
		},
		{
			type: "Feature",
			id: "surf-fr-008",
			properties: {
				name: "Hossegor La Gravière",
				spot_id: "SURF-FR-008",
				break_type: "beach_break",
				skill_level: "advanced",
				best_wind_direction: "E",
				best_swell_direction: "NW",
				season: "autumn",
				country: "FR",
				description: "Powerful hollow waves; benchmark spot for advanced surfers.",
			},
			geometry: { type: "Point", coordinates: [-1.438, 43.664] },
		},
	];

	return {
		type: "FeatureCollection",
		name: "Global Surf Spots (Community Picks)",
		description:
			"Community-vetted surf spots across major coasts with wind and swell hints.",
		features: decorateFeatures(features, "surf", "Surf spot"),
	};
}

function createBestBeachesFeatureCollection(): FeatureCollection & Record<string, unknown> {
	const features: Feature[] = [
		{
			type: "Feature",
			id: "beach-br-001",
			properties: {
				name: "Copacabana Central",
				beach_id: "BEACH-BR-001",
				rating_10: 9.3,
				water_quality_class: "good",
				lifeguard: true,
				dog_friendly: false,
				wheelchair_boardwalk: true,
				country: "BR",
				description: "Urban mega-beach with extensive services and high visitation.",
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[-43.196, -22.985],
						[-43.168, -22.985],
						[-43.168, -22.969],
						[-43.196, -22.969],
						[-43.196, -22.985],
					],
				],
			},
		},
		{
			type: "Feature",
			id: "beach-gr-002",
			properties: {
				name: "Navagio Cove",
				beach_id: "BEACH-GR-002",
				rating_10: 9.4,
				water_quality_class: "excellent",
				lifeguard: false,
				dog_friendly: false,
				wheelchair_boardwalk: false,
				country: "GR",
				description: "Iconic cove beach with steep cliffs and clear water.",
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[20.609, 37.865],
						[20.626, 37.865],
						[20.626, 37.854],
						[20.609, 37.854],
						[20.609, 37.865],
					],
				],
			},
		},
		{
			type: "Feature",
			id: "beach-au-003",
			properties: {
				name: "Whitehaven Main Strip",
				beach_id: "BEACH-AU-003",
				rating_10: 9.6,
				water_quality_class: "excellent",
				lifeguard: false,
				dog_friendly: false,
				wheelchair_boardwalk: false,
				country: "AU",
				description: "High-silica sand shoreline with vivid tidal gradients.",
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[148.935, -20.304],
						[148.966, -20.304],
						[148.966, -20.283],
						[148.935, -20.283],
						[148.935, -20.304],
					],
				],
			},
		},
		{
			type: "Feature",
			id: "beach-mx-004",
			properties: {
				name: "Tulum South Beach",
				beach_id: "BEACH-MX-004",
				rating_10: 8.9,
				water_quality_class: "good",
				lifeguard: true,
				dog_friendly: true,
				wheelchair_boardwalk: false,
				country: "MX",
				description: "Long Caribbean beachfront popular for recreation and tourism.",
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[-87.455, 20.225],
						[-87.426, 20.225],
						[-87.426, 20.202],
						[-87.455, 20.202],
						[-87.455, 20.225],
					],
				],
			},
		},
		{
			type: "Feature",
			id: "beach-us-005",
			properties: {
				name: "Waikiki Beach Zone",
				beach_id: "BEACH-US-005",
				rating_10: 8.7,
				water_quality_class: "excellent",
				lifeguard: true,
				dog_friendly: false,
				wheelchair_boardwalk: true,
				country: "US",
				description: "Accessible urban beach with broad amenities and gentle waves.",
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[-157.853, 21.286],
						[-157.821, 21.286],
						[-157.821, 21.268],
						[-157.853, 21.268],
						[-157.853, 21.286],
					],
				],
			},
		},
		{
			type: "Feature",
			id: "beach-th-006",
			properties: {
				name: "Kata Beach",
				beach_id: "BEACH-TH-006",
				rating_10: 8.6,
				water_quality_class: "good",
				lifeguard: true,
				dog_friendly: false,
				wheelchair_boardwalk: false,
				country: "TH",
				description: "Family-friendly bay with seasonal surf and clear water.",
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[98.285, 7.84],
						[98.314, 7.84],
						[98.314, 7.813],
						[98.285, 7.813],
						[98.285, 7.84],
					],
				],
			},
		},
	];

	return {
		type: "FeatureCollection",
		name: "Best Beaches Guide (Global)",
		description:
			"Curated beach polygons across continents with quality and accessibility metadata.",
		features: decorateFeatures(features, "beaches", "Beach area"),
	};
}

async function seedData() {
	console.log(`[Seed] Connecting to relay ${RELAY_URL}...`);
	await ndk.connect();
	console.log("[Seed] Connected.");

	console.log("[Seed] Creating deterministic user identities...");
	const planner = await createIdentity("planner", devUser1.sk, USER_PROFILES.planner);
	const mobility = await createIdentity("mobility", devUser2.sk, USER_PROFILES.mobility);
	const heritage = await createIdentity("heritage", devUser3.sk, USER_PROFILES.heritage);

	const ROOT_CONTEXT_ID = "seed-east-germany-root";
	const ADMIN_CONTEXT_ID = "seed-east-germany-admin";
	const RAIL_CONTEXT_ID = "seed-rail-quality-required";
	const RIVER_CONTEXT_ID = "seed-river-health-optional";
	const HERITAGE_CONTEXT_ID = "seed-heritage-hotspots";
	const TOILETS_CONTEXT_ID = "seed-accessible-toilets-required";
	const HIKING_CONTEXT_ID = "seed-hiking-trails-required";
	const SURF_CONTEXT_ID = "seed-surf-spots-optional";
	const BEACH_CONTEXT_ID = "seed-best-beaches-guide";
	const ADMIN_COLLECTION_ID = "seed-east-germany-boundaries";
	const MOBILITY_COLLECTION_ID = "seed-berlin-mobility";
	const RIVER_COLLECTION_ID = "seed-river-health-pack";
	const HERITAGE_COLLECTION_ID = "seed-heritage-atlas";
	const AMENITIES_COLLECTION_ID = "seed-accessible-amenities";
	const OUTDOOR_COLLECTION_ID = "seed-outdoor-adventures";

	const rootContextCoordinate = coordinate(
		MAP_CONTEXT_KIND,
		planner.pubkey,
		ROOT_CONTEXT_ID,
	);
	const adminContextCoordinate = coordinate(
		MAP_CONTEXT_KIND,
		planner.pubkey,
		ADMIN_CONTEXT_ID,
	);
	const railContextCoordinate = coordinate(
		MAP_CONTEXT_KIND,
		mobility.pubkey,
		RAIL_CONTEXT_ID,
	);
	const riverContextCoordinate = coordinate(
		MAP_CONTEXT_KIND,
		mobility.pubkey,
		RIVER_CONTEXT_ID,
	);
	const heritageContextCoordinate = coordinate(
		MAP_CONTEXT_KIND,
		heritage.pubkey,
		HERITAGE_CONTEXT_ID,
	);
	const toiletsContextCoordinate = coordinate(
		MAP_CONTEXT_KIND,
		planner.pubkey,
		TOILETS_CONTEXT_ID,
	);
	const hikingContextCoordinate = coordinate(
		MAP_CONTEXT_KIND,
		heritage.pubkey,
		HIKING_CONTEXT_ID,
	);
	const surfContextCoordinate = coordinate(
		MAP_CONTEXT_KIND,
		mobility.pubkey,
		SURF_CONTEXT_ID,
	);
	const beachContextCoordinate = coordinate(
		MAP_CONTEXT_KIND,
		heritage.pubkey,
		BEACH_CONTEXT_ID,
	);
	const adminCollectionCoordinate = coordinate(
		GEO_COLLECTION_KIND,
		planner.pubkey,
		ADMIN_COLLECTION_ID,
	);
	const mobilityCollectionCoordinate = coordinate(
		GEO_COLLECTION_KIND,
		mobility.pubkey,
		MOBILITY_COLLECTION_ID,
	);
	const riverCollectionCoordinate = coordinate(
		GEO_COLLECTION_KIND,
		mobility.pubkey,
		RIVER_COLLECTION_ID,
	);
	const heritageCollectionCoordinate = coordinate(
		GEO_COLLECTION_KIND,
		heritage.pubkey,
		HERITAGE_COLLECTION_ID,
	);
	const amenitiesCollectionCoordinate = coordinate(
		GEO_COLLECTION_KIND,
		planner.pubkey,
		AMENITIES_COLLECTION_ID,
	);
	const outdoorCollectionCoordinate = coordinate(
		GEO_COLLECTION_KIND,
		mobility.pubkey,
		OUTDOOR_COLLECTION_ID,
	);

	console.log("[Seed] Publishing map contexts...");
	const rootContext = await publishMapContext({
		identity: planner,
		contextId: ROOT_CONTEXT_ID,
		bbox: [10.3, 50.0, 15.3, 54.9],
		hashtags: ["taxonomy", "east-germany", "baseline"],
		content: {
			version: 1,
			name: "East Germany Atlas",
			description:
				"Shared taxonomy context for regional datasets used during local development.",
			contextUse: "taxonomy",
			validationMode: "none",
		},
	});

	const adminContext = await publishMapContext({
		identity: planner,
		contextId: ADMIN_CONTEXT_ID,
		parentCoordinate: rootContextCoordinate,
		bbox: [10.3, 50.0, 15.3, 54.9],
		hashtags: ["administrative", "boundaries"],
		content: {
			version: 1,
			name: "East German Administrative Boundaries",
			description:
				"Taxonomy context grouping Bundesländer boundaries and related administrative layers.",
			contextUse: "taxonomy",
			validationMode: "none",
		},
	});

	const railContext = await publishMapContext({
		identity: mobility,
		contextId: RAIL_CONTEXT_ID,
		parentCoordinate: rootContextCoordinate,
		bbox: [12.5, 51.9, 14.2, 53.1],
		hashtags: ["validation", "mobility", "line-geometry"],
		content: {
			version: 1,
			name: "Rail Corridor Quality",
			description:
				"Required validation context for line-based mobility corridors in Berlin-Brandenburg.",
			contextUse: "hybrid",
			validationMode: "required",
			geometryConstraints: {
				allowedTypes: ["LineString", "MultiLineString"],
			},
			schemaDialect: "https://json-schema.org/draft/2020-12/schema",
			schema: {
				type: "object",
				required: ["name", "corridor_code", "status", "surface", "length_km"],
				properties: {
					name: { type: "string", minLength: 3 },
					corridor_code: { type: "string", minLength: 2 },
					status: {
						type: "string",
						enum: ["active", "planned", "construction"],
					},
					surface: {
						type: "string",
						enum: ["rail", "paved", "gravel"],
					},
					length_km: { type: "number", minimum: 0.1, maximum: 300 },
				},
				additionalProperties: true,
			},
		},
	});

	const riverContext = await publishMapContext({
		identity: mobility,
		contextId: RIVER_CONTEXT_ID,
		parentCoordinate: rootContextCoordinate,
		bbox: [13.05, 52.35, 13.58, 52.63],
		hashtags: ["water", "monitoring", "optional-validation"],
		content: {
			version: 1,
			name: "River Health Monitoring",
			description:
				"Optional validation context for water monitoring stations in the Havel-Spree system.",
			contextUse: "hybrid",
			validationMode: "optional",
			geometryConstraints: {
				allowedTypes: ["Point"],
			},
			schemaDialect: "https://json-schema.org/draft/2020-12/schema",
			schema: {
				type: "object",
				required: ["station_id", "water_body", "ph", "nitrate_mg_l"],
				properties: {
					station_id: { type: "string", minLength: 4 },
					water_body: { type: "string", enum: ["Havel", "Spree"] },
					ph: { type: "number", minimum: 0, maximum: 14 },
					nitrate_mg_l: { type: "number", minimum: 0, maximum: 50 },
					ecoli_cfu_100ml: { type: "number", minimum: 0 },
					sampling_interval_days: { type: "integer", minimum: 1, maximum: 365 },
				},
				additionalProperties: true,
			},
		},
	});

	const heritageContext = await publishMapContext({
		identity: heritage,
		contextId: HERITAGE_CONTEXT_ID,
		parentCoordinate: rootContextCoordinate,
		bbox: [11.8, 50.9, 14.2, 51.7],
		hashtags: ["culture", "history", "taxonomy"],
		content: {
			version: 1,
			name: "Cultural Heritage Hotspots",
			description:
				"Taxonomy context for curated heritage zones, landmarks, and narrative map overlays.",
			contextUse: "taxonomy",
			validationMode: "none",
		},
	});

	const toiletsContext = await publishMapContext({
		identity: planner,
		contextId: TOILETS_CONTEXT_ID,
		parentCoordinate: rootContextCoordinate,
		bbox: [-124.0, -34.5, 152.0, 53.0],
		hashtags: ["accessibility", "toilets", "wheelchair", "global"],
		content: {
			version: 1,
			name: "Accessible Public Toilets (Global)",
			description:
				"Required accessibility context for global public toilets with wheelchair-ready access metadata.",
			contextUse: "hybrid",
			validationMode: "required",
			geometryConstraints: {
				allowedTypes: ["Point"],
			},
			schemaDialect: "https://json-schema.org/draft/2020-12/schema",
			schema: {
				type: "object",
				required: ["toilet_id", "wheelchair_access", "opening_hours"],
				properties: {
					toilet_id: { type: "string", minLength: 5 },
					wheelchair_access: { type: "boolean", const: true },
					opening_hours: { type: "string", minLength: 3 },
					fee_eur: { type: "number", minimum: 0, maximum: 10 },
					changing_table: { type: "boolean" },
				},
				additionalProperties: true,
			},
		},
	});

	const hikingContext = await publishMapContext({
		identity: heritage,
		contextId: HIKING_CONTEXT_ID,
		parentCoordinate: rootContextCoordinate,
		bbox: [-106.0, -51.5, 176.0, 47.0],
		hashtags: ["hiking", "trails", "outdoor", "global"],
		content: {
			version: 1,
			name: "Hiking Trails Network (Global)",
			description:
				"Required validation context for mapped global hiking trails and route metadata.",
			contextUse: "hybrid",
			validationMode: "required",
			geometryConstraints: {
				allowedTypes: ["LineString", "MultiLineString"],
			},
			schemaDialect: "https://json-schema.org/draft/2020-12/schema",
			schema: {
				type: "object",
				required: ["trail_id", "difficulty", "distance_km", "elevation_gain_m"],
				properties: {
					trail_id: { type: "string", minLength: 5 },
					difficulty: { type: "string", enum: ["easy", "moderate", "hard"] },
					route_type: { type: "string", enum: ["loop", "out-and-back"] },
					distance_km: { type: "number", minimum: 0.2, maximum: 100 },
					elevation_gain_m: { type: "number", minimum: 0, maximum: 4000 },
					surface: { type: "string" },
				},
				additionalProperties: true,
			},
		},
	});

	const surfContext = await publishMapContext({
		identity: mobility,
		contextId: SURF_CONTEXT_ID,
		parentCoordinate: rootContextCoordinate,
		bbox: [-159.0, -35.0, 116.0, 44.0],
		hashtags: ["surfing", "spots", "community", "global"],
		content: {
			version: 1,
			name: "Cool Surfing Spots (Global)",
			description:
				"Community curation context for global surf breaks with optional data quality checks.",
			contextUse: "hybrid",
			validationMode: "optional",
			geometryConstraints: {
				allowedTypes: ["Point"],
			},
			schemaDialect: "https://json-schema.org/draft/2020-12/schema",
			schema: {
				type: "object",
				required: ["spot_id", "break_type", "skill_level"],
				properties: {
					spot_id: { type: "string", minLength: 5 },
					break_type: {
						type: "string",
						enum: ["beach_break", "reef_break", "sandbar"],
					},
					skill_level: {
						type: "string",
						enum: ["beginner", "intermediate", "advanced"],
					},
					best_wind_direction: { type: "string", minLength: 1 },
					best_swell_direction: { type: "string", minLength: 1 },
					season: { type: "string" },
				},
				additionalProperties: true,
			},
		},
	});

	const beachContext = await publishMapContext({
		identity: heritage,
		contextId: BEACH_CONTEXT_ID,
		parentCoordinate: rootContextCoordinate,
		bbox: [-158.0, -24.0, 149.0, 39.0],
		hashtags: ["beaches", "recreation", "travel", "global"],
		content: {
			version: 1,
			name: "Best Beaches (Global)",
			description:
				"Global beach guide context for comparing facilities, water quality, and accessibility.",
			contextUse: "hybrid",
			validationMode: "optional",
			geometryConstraints: {
				allowedTypes: ["Polygon", "MultiPolygon"],
			},
			schemaDialect: "https://json-schema.org/draft/2020-12/schema",
			schema: {
				type: "object",
				required: ["beach_id", "rating_10", "water_quality_class"],
				properties: {
					beach_id: { type: "string", minLength: 5 },
					rating_10: { type: "number", minimum: 1, maximum: 10 },
					water_quality_class: { type: "string", enum: ["excellent", "good", "fair"] },
					lifeguard: { type: "boolean" },
					dog_friendly: { type: "boolean" },
					wheelchair_boardwalk: { type: "boolean" },
				},
				additionalProperties: true,
			},
		},
	});

	console.log("[Seed] Publishing state boundary datasets...");
	const stateDatasets: PublishedDataset[] = [];
	for (const state of STATE_SEEDS) {
		const geoEventData = await generateGeoEventData(undefined, {
			useRealData: true,
			stateName: state.name,
			hashtags: ["east-germany", "administrative", "state-boundary", state.slug],
		});

		const published = await publishDataset({
			identity: planner,
			datasetId: `seed-state-${state.slug}`,
			geoEventData,
			contextCoordinates: [rootContextCoordinate, adminContextCoordinate],
			collectionCoordinates: [adminCollectionCoordinate],
		});
		stateDatasets.push(published);
		console.log(`  Dataset published: ${published.name}`);
	}

	console.log("[Seed] Publishing mobility/validation datasets...");
	const railDataset = await publishDataset({
		identity: mobility,
		datasetId: "seed-rail-corridors-berlin-brandenburg",
		geoEventData: await generateGeoEventData(undefined, {
			featureCollection: createRailCorridorFeatureCollection(),
			hashtags: ["mobility", "rail", "line-dataset"],
		}),
		contextCoordinates: [rootContextCoordinate, railContextCoordinate],
		collectionCoordinates: [mobilityCollectionCoordinate],
	});
	console.log(`  Dataset published: ${railDataset.name}`);

	const bikeDataset = await publishDataset({
		identity: heritage,
		datasetId: "seed-berlin-mobility-spines",
		geoEventData: await generateGeoEventData(undefined, {
			featureCollection: createBikeNetworkFeatureCollection(),
			hashtags: ["mobility", "bike", "line-dataset"],
		}),
		contextCoordinates: [rootContextCoordinate, railContextCoordinate],
		collectionCoordinates: [mobilityCollectionCoordinate],
	});
	console.log(`  Dataset published: ${bikeDataset.name}`);

	const invalidRailContextDataset = await publishDataset({
		identity: heritage,
		datasetId: "seed-invalid-rail-context-polygons",
		geoEventData: await generateGeoEventData(undefined, {
			featureCollection: createInvalidValidationFeatureCollection(),
			hashtags: ["heritage", "zoning", "invalid-demo"],
		}),
		contextCoordinates: [rootContextCoordinate, railContextCoordinate],
		collectionCoordinates: [mobilityCollectionCoordinate],
	});
	console.log(`  Dataset published: ${invalidRailContextDataset.name}`);

	console.log("[Seed] Publishing river health datasets...");
	const waterQualityDataset = await publishDataset({
		identity: mobility,
		datasetId: "seed-water-quality-stations",
		geoEventData: await generateGeoEventData(undefined, {
			featureCollection: createWaterQualityStationsFeatureCollection(),
			hashtags: ["water", "monitoring", "stations"],
		}),
		contextCoordinates: [rootContextCoordinate, riverContextCoordinate],
		collectionCoordinates: [riverCollectionCoordinate],
	});
	console.log(`  Dataset published: ${waterQualityDataset.name}`);

	const riverSegmentsDataset = await publishDataset({
		identity: heritage,
		datasetId: "seed-river-segments-reference",
		geoEventData: await generateGeoEventData(undefined, {
			featureCollection: createRiverSegmentsFeatureCollection(),
			hashtags: ["water", "segments", "line-dataset"],
		}),
		contextCoordinates: [rootContextCoordinate, riverContextCoordinate],
		collectionCoordinates: [riverCollectionCoordinate],
	});
	console.log(`  Dataset published: ${riverSegmentsDataset.name}`);

	console.log("[Seed] Publishing heritage context datasets...");
	const heritageHotspotsDataset = await publishDataset({
		identity: heritage,
		datasetId: "seed-heritage-hotspots",
		geoEventData: await generateGeoEventData(undefined, {
			featureCollection: createHeritageHotspotsFeatureCollection(),
			hashtags: ["heritage", "culture", "landmarks"],
		}),
		contextCoordinates: [rootContextCoordinate, heritageContextCoordinate],
		collectionCoordinates: [heritageCollectionCoordinate],
	});
	console.log(`  Dataset published: ${heritageHotspotsDataset.name}`);

	console.log("[Seed] Publishing accessibility and outdoor datasets...");
	const accessibleToiletsDataset = await publishDataset({
		identity: planner,
		datasetId: "seed-accessible-public-toilets",
		geoEventData: await generateGeoEventData(undefined, {
			featureCollection: createAccessibleToiletsFeatureCollection(),
			hashtags: ["toilets", "wheelchair", "accessibility", "global"],
		}),
		contextCoordinates: [rootContextCoordinate, toiletsContextCoordinate],
		collectionCoordinates: [amenitiesCollectionCoordinate],
	});
	console.log(`  Dataset published: ${accessibleToiletsDataset.name}`);

	const hikingTrailsDataset = await publishDataset({
		identity: heritage,
		datasetId: "seed-global-hiking-trails",
		geoEventData: await generateGeoEventData(undefined, {
			featureCollection: createHikingTrailsFeatureCollection(),
			hashtags: ["hiking", "trails", "outdoor", "global"],
		}),
		contextCoordinates: [rootContextCoordinate, hikingContextCoordinate],
		collectionCoordinates: [outdoorCollectionCoordinate],
	});
	console.log(`  Dataset published: ${hikingTrailsDataset.name}`);

	const surfSpotsDataset = await publishDataset({
		identity: mobility,
		datasetId: "seed-global-surf-spots",
		geoEventData: await generateGeoEventData(undefined, {
			featureCollection: createSurfSpotsFeatureCollection(),
			hashtags: ["surfing", "spots", "sea", "global"],
		}),
		contextCoordinates: [rootContextCoordinate, surfContextCoordinate],
		collectionCoordinates: [outdoorCollectionCoordinate],
	});
	console.log(`  Dataset published: ${surfSpotsDataset.name}`);

	const bestBeachesDataset = await publishDataset({
		identity: heritage,
		datasetId: "seed-global-best-beaches-guide",
		geoEventData: await generateGeoEventData(undefined, {
			featureCollection: createBestBeachesFeatureCollection(),
			hashtags: ["beaches", "travel", "recreation", "global"],
		}),
		contextCoordinates: [rootContextCoordinate, beachContextCoordinate, surfContextCoordinate],
		collectionCoordinates: [outdoorCollectionCoordinate],
	});
	console.log(`  Dataset published: ${bestBeachesDataset.name}`);

	console.log("[Seed] Publishing collections...");
	const adminCollection = await publishCollection({
		identity: planner,
		collectionId: ADMIN_COLLECTION_ID,
		name: "East Germany Bundesländer Basemap",
		description:
			"Canonical administrative boundaries for Mecklenburg-Vorpommern, Brandenburg, Sachsen, Sachsen-Anhalt, and Thüringen.",
		datasetCoordinates: stateDatasets.map((dataset) => dataset.coordinate),
		contextCoordinates: [rootContextCoordinate, adminContextCoordinate],
		hashtags: ["administrative", "basemap", "east-germany"],
		bbox: mergeBoundingBoxes(
			stateDatasets
				.map((dataset) => dataset.bbox)
				.filter((bbox): bbox is BoundingBox => Boolean(bbox)),
		),
	});

	const mobilityCollection = await publishCollection({
		identity: mobility,
		collectionId: MOBILITY_COLLECTION_ID,
		name: "Berlin-Brandenburg Mobility Validation Kit",
		description:
			"Mixed-quality line and polygon datasets intentionally linked to a required validation context for local testing.",
		datasetCoordinates: [
			railDataset.coordinate,
			bikeDataset.coordinate,
			invalidRailContextDataset.coordinate,
		],
		contextCoordinates: [rootContextCoordinate, railContextCoordinate],
		hashtags: ["mobility", "validation", "context-testing"],
		bbox: mergeBoundingBoxes(
			[railDataset, bikeDataset, invalidRailContextDataset]
				.map((dataset) => dataset.bbox)
				.filter((bbox): bbox is BoundingBox => Boolean(bbox)),
		),
	});

	const riverCollection = await publishCollection({
		identity: mobility,
		collectionId: RIVER_COLLECTION_ID,
		name: "Havel-Spree Monitoring Pack",
		description:
			"Water-quality station points plus river segment references attached to the river-health context.",
		datasetCoordinates: [waterQualityDataset.coordinate, riverSegmentsDataset.coordinate],
		contextCoordinates: [rootContextCoordinate, riverContextCoordinate],
		hashtags: ["water", "monitoring", "qa"],
		bbox: mergeBoundingBoxes(
			[waterQualityDataset, riverSegmentsDataset]
				.map((dataset) => dataset.bbox)
				.filter((bbox): bbox is BoundingBox => Boolean(bbox)),
		),
	});

	const heritageCollection = await publishCollection({
		identity: heritage,
		collectionId: HERITAGE_COLLECTION_ID,
		name: "Saxon Heritage Atlas",
		description:
			"Curated historic hotspots and protection zones for taxonomy-driven exploration.",
		datasetCoordinates: [
			heritageHotspotsDataset.coordinate,
			invalidRailContextDataset.coordinate,
		],
		contextCoordinates: [rootContextCoordinate, heritageContextCoordinate],
		hashtags: ["heritage", "taxonomy", "atlas"],
		bbox: mergeBoundingBoxes(
			[heritageHotspotsDataset, invalidRailContextDataset]
				.map((dataset) => dataset.bbox)
				.filter((bbox): bbox is BoundingBox => Boolean(bbox)),
		),
	});

	const amenitiesCollection = await publishCollection({
		identity: planner,
		collectionId: AMENITIES_COLLECTION_ID,
		name: "Accessible Amenities Starter Pack (Global)",
		description:
			"High-confidence global accessible public toilet data for mobility and planning workflows.",
		datasetCoordinates: [accessibleToiletsDataset.coordinate],
		contextCoordinates: [rootContextCoordinate, toiletsContextCoordinate],
		hashtags: ["accessibility", "amenities", "city-services"],
		bbox: mergeBoundingBoxes(
			[accessibleToiletsDataset]
				.map((dataset) => dataset.bbox)
				.filter((bbox): bbox is BoundingBox => Boolean(bbox)),
		),
	});

	const outdoorCollection = await publishCollection({
		identity: mobility,
		collectionId: OUTDOOR_COLLECTION_ID,
		name: "Global Outdoor Adventures Pack",
		description:
			"Hiking trails, surfing spots, and top beaches across continents for route planning and discovery.",
		datasetCoordinates: [
			hikingTrailsDataset.coordinate,
			surfSpotsDataset.coordinate,
			bestBeachesDataset.coordinate,
		],
		contextCoordinates: [
			rootContextCoordinate,
			hikingContextCoordinate,
			surfContextCoordinate,
			beachContextCoordinate,
		],
		hashtags: ["hiking", "surfing", "beaches", "outdoor"],
		bbox: mergeBoundingBoxes(
			[hikingTrailsDataset, surfSpotsDataset, bestBeachesDataset]
				.map((dataset) => dataset.bbox)
				.filter((bbox): bbox is BoundingBox => Boolean(bbox)),
		),
	});

	const allPublishedDatasets: PublishedDataset[] = [
		...stateDatasets,
		railDataset,
		bikeDataset,
		invalidRailContextDataset,
		waterQualityDataset,
		riverSegmentsDataset,
		heritageHotspotsDataset,
		accessibleToiletsDataset,
		hikingTrailsDataset,
		surfSpotsDataset,
		bestBeachesDataset,
	];
	const allPublishedCollections: PublishedCollection[] = [
		adminCollection,
		mobilityCollection,
		riverCollection,
		heritageCollection,
		amenitiesCollection,
		outdoorCollection,
	];
	const allPublishedContexts: PublishedContext[] = [
		rootContext,
		adminContext,
		railContext,
		riverContext,
		heritageContext,
		toiletsContext,
		hikingContext,
		surfContext,
		beachContext,
	];

	console.log("[Seed] Publishing seeded comments...");
	const commentAuthors = [planner, mobility, heritage];
	const commentTargets: CommentTarget[] = [
		...allPublishedContexts.map((context) => ({
			id: context.id,
			kind: MAP_CONTEXT_KIND,
			dTag: context.contextId,
			name: context.name,
			ownerPubkey: context.ownerPubkey,
			bbox: context.bbox,
		})),
		...allPublishedCollections.map((collection) => ({
			id: collection.id,
			kind: GEO_COLLECTION_KIND,
			dTag: collection.collectionId,
			name: collection.name,
			ownerPubkey: collection.ownerPubkey,
			bbox: collection.bbox,
		})),
		...allPublishedDatasets.map((dataset) => ({
			id: dataset.id,
			kind: GEO_EVENT_KIND,
			dTag: dataset.datasetId,
			name: dataset.name,
			ownerPubkey: dataset.ownerPubkey,
			bbox: dataset.bbox,
		})),
	];

	let seededCommentCount = 0;
	for (const [index, target] of commentTargets.entries()) {
		seededCommentCount += await publishSeedCommentThread(target, commentAuthors, index);
	}

	// ── Edit Proposals ──────────────────────────────────────────────────
	console.log("[Seed] Publishing edit proposals...");
	const proposalIdentities = [planner, mobility, heritage];
	let proposalCount = 0;
	for (const [index, dataset] of allPublishedDatasets.entries()) {
		const proposalAuthor = pickProposalAuthor(dataset, proposalIdentities, index);
		const proposalFeatureCollection = mutateFeatureCollectionForProposal(
			dataset.featureCollection,
			index + 1,
		);
		await publishProposal({
			identity: proposalAuthor,
			proposalId: `seed-proposal-${dataset.datasetId}`,
			targetDataset: dataset,
			description: `Seeded proposal refining "${dataset.name}"`,
			featureCollection: proposalFeatureCollection,
			hashtags: ["seed", "proposal", "autogen"],
		});
		proposalCount += 1;
	}

	const totalDatasets = allPublishedDatasets.length;
	const totalCollections = allPublishedCollections.length;
	const totalContexts = allPublishedContexts.length;
	console.log("[Seed] Complete.");
	console.log(
		`[Seed] Published 3 users, ${totalContexts} contexts, ${totalDatasets} datasets, ${totalCollections} collections, ${seededCommentCount} comment events, and ${proposalCount} proposals.`,
	);
	process.exit(0);
}

seedData().catch((error) => {
	console.error("[Seed] Failed:", error);
	process.exit(1);
});
