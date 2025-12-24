import { faker } from "@faker-js/faker";
import NDK, {
	NDKEvent,
	type NDKPrivateKeySigner,
	type NDKTag,
} from "@nostr-dev-kit/ndk";

// Helper to generate a geohash (simplified version - same as in gen_geo_events.ts)
function generateGeohash(
	lat: number,
	lon: number,
	precision: number = 5,
): string {
	const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
	let geohash = "";
	let even = true;
	const latRange = [-90, 90];
	const lonRange = [-180, 180];

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

export interface CollectionMetadata {
	name: string;
	description: string;
	picture?: string;
	license?: string;
	tags?: string[];
}

export function generateCollectionData(geoEventRefs: string[] = []): {
	kind: 30406;
	content: string;
	tags: NDKTag[];
	created_at: number;
} {
	const themes = [
		"Urban Planning",
		"Recreation",
		"Transportation",
		"Environmental",
		"Cultural Heritage",
	];
	const theme = faker.helpers.arrayElement(themes);
	const city = faker.location.city();
	const year = faker.date.recent({ days: 365 }).getFullYear();

	const collectionId = faker.string.uuid();

	const metadata: CollectionMetadata = {
		name: `${city} ${theme} Dataset ${year}`,
		description: faker.lorem.paragraph(3),
		picture: faker.image.url({ width: 400, height: 300 }),
		license: faker.helpers.arrayElement([
			"CC-BY-4.0",
			"CC-BY-SA-4.0",
			"CC0-1.0",
			"MIT",
		]),
		tags: [
			theme.toLowerCase().replace(" ", "_"),
			city.toLowerCase().replace(" ", "_"),
			faker.helpers.arrayElement(["municipal", "community", "research"]),
		],
	};

	// Generate a representative bounding box (simplified - could be calculated from referenced geo-events)
	const cities = [
		{ name: "Vienna", lat: 48.2082, lon: 16.3738 },
		{ name: "Berlin", lat: 52.52, lon: 13.405 },
		{ name: "Paris", lat: 48.8566, lon: 2.3522 },
		{ name: "London", lat: 51.5074, lon: -0.1278 },
		{ name: "Barcelona", lat: 41.3851, lon: 2.1734 },
	];

	const baseCity = faker.helpers.arrayElement(cities);
	const spread = 0.2;
	const bbox = [
		baseCity.lon - spread,
		baseCity.lat - spread,
		baseCity.lon + spread,
		baseCity.lat + spread,
	];

	const centroidLat = (bbox[1] + bbox[3]) / 2;
	const centroidLon = (bbox[0] + bbox[2]) / 2;
	const geohash = generateGeohash(centroidLat, centroidLon);

	const tags: NDKTag[] = [
		["d", collectionId],
		["bbox", `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`],
		["g", geohash],
		["t", theme.toLowerCase().replace(" ", "_")],
		["t", "public"],
	];

	// Add references to geo-events
	geoEventRefs.forEach((ref) => {
		tags.push(["a", ref]);
	});

	// Add theme-specific tags
	if (metadata.tags) {
		metadata.tags.forEach((tag) => {
			tags.push(["t", tag]);
		});
	}

	return {
		kind: 30406,
		content: JSON.stringify(metadata),
		tags,
		created_at: Math.floor(Date.now() / 1000),
	};
}

export async function createGeoCollectionEvent(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	collectionData: ReturnType<typeof generateCollectionData>,
) {
	const event = new NDKEvent(ndk);
	event.kind = collectionData.kind;
	event.content = collectionData.content;
	event.tags = collectionData.tags;
	event.created_at = collectionData.created_at;

	try {
		await event.sign(signer);
		await event.publish();

		const metadata = JSON.parse(collectionData.content);
		console.log(`Published geo-collection: ${metadata.name}`);

		// Return collection reference in the format used for linking
		const pubkey = (await signer.user()).pubkey;
		const dTag = collectionData.tags.find((tag) => tag[0] === "d")?.[1];
		return `${collectionData.kind}:${pubkey}:${dTag}`;
	} catch (error) {
		console.error(`Failed to publish geo-collection`, error);
		return null;
	}
}
