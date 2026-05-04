/**
 * seed_canonical_data.ts
 *
 * Publishes real-world canonical datasets to the Earthly relay.
 * Signed with APP_PRIVATE_KEY from environment.
 *
 * Usage:
 *   bun scripts/seed_canonical_data.ts [relay-url]
 *   bun scripts/seed_canonical_data.ts ws://localhost:3334
 */

import NDK, {
  NDKEvent,
  NDKPrivateKeySigner,
  type NDKTag,
} from "@/lib/ndk-shim";
import { config } from "dotenv";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
} from "geojson";
import simplify from "@turf/simplify";
import { GEO_EVENT_KIND, MAP_CONTEXT_KIND } from "@/lib/ndk/kinds";
import type { MapContextContent } from "@/lib/ndk/NDKMapContextEvent";

config();

// ── Config ───────────────────────────────────────────────────────────────────

const RELAY_URL = process.argv[2] ?? "ws://localhost:3334";

const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY;
if (!APP_PRIVATE_KEY) {
  console.error("[seed_canonical] Missing APP_PRIVATE_KEY in environment");
  process.exit(1);
}
const SIGNING_KEY: string = APP_PRIVATE_KEY;

const BASE_RIPS = join(import.meta.dir, "../base-assets/base_rips");

const ndk = new NDK({
  explicitRelayUrls: [RELAY_URL],
  enableOutboxModel: false,
});

// ── Shared helpers ────────────────────────────────────────────────────────────

type BoundingBox = [number, number, number, number];

function generateGeohash(lat: number, lon: number, precision = 5): string {
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
        } else lonRange[1] = mid;
      } else {
        const mid = (latRange[0] + latRange[1]) / 2;
        if (lat >= mid) {
          ch |= 1 << (4 - bit);
          latRange[0] = mid;
        } else latRange[1] = mid;
      }
      even = !even;
    }
    geohash += base32[ch];
  }
  return geohash;
}

function bboxFromFeatures(features: Feature[]): BoundingBox {
  let west = 180,
    east = -180,
    south = 90,
    north = -90;
  for (const f of features) {
    const coords = flatCoords(f.geometry);
    for (const [lon, lat] of coords) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return [west, south, east, north];
}

// biome-ignore lint/suspicious/noExplicitAny: geometry traversal
function flatCoords(geometry: any): [number, number][] {
  if (!geometry) return [];
  const valid = (c: unknown): c is [number, number] =>
    Array.isArray(c) &&
    c.length >= 2 &&
    typeof c[0] === "number" &&
    typeof c[1] === "number";
  switch (geometry.type) {
    case "Point":
      return valid(geometry.coordinates) ? [geometry.coordinates] : [];
    case "MultiPoint":
    case "LineString":
      return (geometry.coordinates ?? []).filter(valid);
    case "MultiLineString":
    case "Polygon":
      return (geometry.coordinates ?? []).flat(1).filter(valid);
    case "MultiPolygon":
      return (geometry.coordinates ?? []).flat(2).filter(valid);
    default:
      return [];
  }
}

function bboxTag(bbox: BoundingBox): string {
  return `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`;
}

const PUBLISH_TIMEOUT_MS = 20_000; // generous for slow production relays

/**
 * Wait until at least one relay in the pool is in CONNECTED state,
 * or throw after timeoutMs.
 */
async function waitForRelay(timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const connected = [...ndk.pool.relays.values()].some((r) => r.connectivity.connectionStats.attempts > 0 || (r as any).status === 2);
    if (connected) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  // Best effort — continue anyway; publish will fail fast if truly disconnected
}

/**
 * Publish a signed NDKEvent with retry + full reconnect on failure.
 * Production relays can drop connections mid-seed or be slow to acknowledge.
 */
async function publishWithRetry(event: NDKEvent, maxAttempts = 5): Promise<void> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Pass a longer timeout than NDK's default 2500ms
      await event.publish(undefined, PUBLISH_TIMEOUT_MS);
      return;
    } catch (err) {
      const isLast = attempt === maxAttempts;
      const msg = err instanceof Error ? err.message : String(err);
      if (isLast) throw err;
      const wait = 4000 * attempt; // 4s, 8s, 12s, 16s
      console.warn(`  [retry] attempt ${attempt} failed: ${msg.slice(0, 80)}`);
      console.warn(`  [retry] reconnecting in ${wait}ms...`);
      await delay(wait);
      // Disconnect all relays and force a fresh connection
      for (const relay of ndk.pool.relays.values()) {
        try { relay.disconnect(); } catch { /* ignore */ }
      }
      await delay(1000);
      await ndk.connect();
      await waitForRelay(10_000);
    }
  }
}

function geohashFromBbox(bbox: BoundingBox): string {
  const lat = (bbox[1] + bbox[3]) / 2;
  const lon = (bbox[0] + bbox[2]) / 2;
  return generateGeohash(lat, lon, 5);
}

async function publishContext(
  signer: NDKPrivateKeySigner,
  pubkey: string,
  contextId: string,
  content: MapContextContent,
  hashtags: string[],
  bbox?: BoundingBox,
): Promise<string> {
  const event = new NDKEvent(ndk);
  event.kind = MAP_CONTEXT_KIND;
  event.content = JSON.stringify(content);

  const tags: NDKTag[] = [
    ["d", contextId],
    ["r", RELAY_URL],
  ];
  if (bbox) {
    tags.push(["bbox", bboxTag(bbox)]);
    tags.push(["g", geohashFromBbox(bbox)]);
  }
  for (const tag of hashtags) tags.push(["t", tag]);

  event.tags = tags;
  event.created_at = Math.floor(Date.now() / 1000);

  await event.sign(signer);
  await publishWithRetry(event);

  const coord = `${MAP_CONTEXT_KIND}:${pubkey}:${contextId}`;
  console.log(`  [context] ${coord}`);
  return coord;
}

async function publishDataset(
  signer: NDKPrivateKeySigner,
  datasetId: string,
  fc: FeatureCollection & Record<string, unknown>,
  hashtags: string[],
  contextCoordinate: string,
): Promise<void> {
  const bbox = bboxFromFeatures(fc.features);
  const geohash = geohashFromBbox(bbox);
  const sizeKB = Math.round(JSON.stringify(fc).length / 1024);

  const tags: NDKTag[] = [
    ["d", datasetId],
    ["bbox", bboxTag(bbox)],
    ["g", geohash],
    ["r", RELAY_URL],
    ["c", contextCoordinate],
  ];
  for (const tag of hashtags) tags.push(["t", tag]);

  const event = new NDKEvent(ndk);
  event.kind = GEO_EVENT_KIND;
  event.content = JSON.stringify(fc);
  event.tags = tags;
  event.created_at = Math.floor(Date.now() / 1000);

  await event.sign(signer);
  await publishWithRetry(event);
  console.log(
    `  [dataset] ${datasetId} — ${fc.features.length} features, ~${sizeKB}KB`,
  );
}

// ── Sea Cables ────────────────────────────────────────────────────────────────

function classifyCable(lon: number, lat: number): string {
  if (lat >= 54 && lon >= 5 && lon <= 35) return "north-europe";
  if (lat >= 65) return "north-europe";
  if (lon >= -15 && lon <= 45 && lat >= 28 && lat <= 65)
    return "europe-mediterranean";
  if (lon >= 30 && lon <= 115 && lat >= -55 && lat <= 30) return "indian-ocean";
  if (lon > 115 && lat >= -15) return "asia-pacific";
  if (lon > 115 && lat < -15) return "south-pacific";
  if (lon < -110) return "pacific";
  if (lon >= -110 && lon <= -30) return "americas";
  return "atlantic";
}

const CABLE_REGION_META: Record<string, { name: string; description: string }> =
  {
    atlantic: {
      name: "Submarine Cables — Atlantic Ocean",
      description:
        "Transatlantic submarine cables connecting North America, Europe, South America, and West Africa. " +
        "Includes major trunk routes such as TAT-14, FLAG Atlantic-1, AEConnect, and the Google/Meta-owned private cable systems.",
    },
    "europe-mediterranean": {
      name: "Submarine Cables — Europe & Mediterranean",
      description:
        "Submarine cables within and surrounding the European seas: the Mediterranean, Adriatic, Black Sea, " +
        "English Channel, and North Sea. Includes cross-Mediterranean links, intra-EU island connections, and the Middle East gateway cables.",
    },
    "north-europe": {
      name: "Submarine Cables — Northern Europe",
      description:
        "Short-range cables in the Baltic Sea, Norwegian Sea, and surrounding Nordic waters. " +
        "Connects Denmark, Sweden, Finland, Estonia, Latvia, Lithuania, and the UK across narrow straits.",
    },
    "indian-ocean": {
      name: "Submarine Cables — Indian Ocean",
      description:
        "Cables spanning the Indian Ocean, Red Sea, Persian Gulf, and Arabian Sea. " +
        "Critical routes for South Asia, East Africa, and the Middle East, including SEA-ME-WE systems and SEACOM.",
    },
    "asia-pacific": {
      name: "Submarine Cables — Asia-Pacific",
      description:
        "Cables in East and Southeast Asia — connecting China, Japan, South Korea, the Philippines, " +
        "Singapore, and broader Pacific island nations. Includes the densely cabled South China Sea region.",
    },
    "south-pacific": {
      name: "Submarine Cables — South Pacific & Oceania",
      description:
        "Cables serving Australia, New Zealand, and the Pacific island nations. " +
        "Includes the Southern Cross, Hawaiki, and NEXT systems as well as smaller inter-island links.",
    },
    pacific: {
      name: "Submarine Cables — Transpacific",
      description:
        "Long-haul transpacific cables connecting the US West Coast to Asia and Oceania. " +
        "Includes Pacific Light Cable Network, Faster, JUPITER, and other major US–Asia routes via Hawaii and Guam.",
    },
    americas: {
      name: "Submarine Cables — Americas",
      description:
        "Regional cables within the Americas: the Caribbean island network, Gulf of Mexico links, " +
        "and the South American coastal festoon cables. Includes the dense Caribbean inter-island topology.",
    },
  };

async function seedSeaCables(signer: NDKPrivateKeySigner, pubkey: string) {
  const dir = join(BASE_RIPS, "sea_cables");
  console.log("\n[seed_canonical] === Sea Cables ===");

  const cablesGeo = JSON.parse(
    readFileSync(join(dir, "cables.geojson"), "utf8"),
  ) as FeatureCollection;
  const landingGeo = JSON.parse(
    readFileSync(join(dir, "landing_points.geojson"), "utf8"),
  ) as FeatureCollection;
  console.log(
    `  Loaded: ${cablesGeo.features.length} cables, ${landingGeo.features.length} landing points`,
  );

  const contextCoord = await publishContext(
    signer,
    pubkey,
    "sea-cables",
    {
      name: "Submarine Cable Map",
      descriptionFormat: "markdown",
      description: [
        "## Global Submarine Cable Network",
        "A comprehensive map of the world's submarine telecommunications cables — the physical infrastructure that carries ~99% of intercontinental internet traffic.",
        "Data sourced from [TeleGeography's Submarine Cable Map](https://www.submarinecablemap.com/), the definitive public registry of submarine cable systems worldwide.",
        "### What's included",
        "- **708 cable systems** grouped by ocean region\n- **1,907 landing stations** — the coastal points where cables come ashore\n- Cable names, colors, and geographic centroids as published by TeleGeography",
        "### How to contribute",
        "Add new cables as you discover them, correct landing point positions, or attach notes about outages and capacity upgrades. All datasets in this context are open for community additions.",
      ].join("\n\n"),
      contextUse: "taxonomy",
      validationMode: "none",
      allowForeignAttachments: true,
    },
    [
      "submarine-cables",
      "internet-infrastructure",
      "telecommunications",
      "geojson",
      "global",
    ],
    [-180, -55, 180, 79],
  );

  const buckets = new Map<string, Feature[]>();
  for (const feature of cablesGeo.features) {
    const props = feature.properties as { coordinates: [number, number] };
    const [lon, lat] = props.coordinates;
    const region = classifyCable(lon, lat);
    if (!buckets.has(region)) buckets.set(region, []);
    buckets.get(region)!.push(feature);
  }

  for (const [region, features] of buckets.entries()) {
    const meta = CABLE_REGION_META[region] ?? {
      name: `Submarine Cables — ${region}`,
      description: `Submarine cable systems in the ${region} region.`,
    };
    await publishDataset(
      signer,
      `cables-${region}`,
      {
        type: "FeatureCollection",
        name: meta.name,
        description: meta.description,
        features,
      },
      ["submarine-cables", "internet-infrastructure", region],
      contextCoord,
    );
  }

  await publishDataset(
    signer,
    "cable-landing-points",
    {
      type: "FeatureCollection",
      name: "Submarine Cable Landing Stations",
      description: [
        "The coastal landing stations where submarine cables come ashore — 1,907 points worldwide.",
        "Each point represents a cable landing station, the building or facility where the submarine cable transitions to terrestrial fiber. " +
          "Landing stations are critical internet infrastructure; damage to a single station can disrupt connectivity for entire regions.",
        "Source: [TeleGeography Submarine Cable Map](https://www.submarinecablemap.com/)",
      ].join("\n\n"),
      features: landingGeo.features,
    },
    [
      "submarine-cables",
      "landing-stations",
      "internet-infrastructure",
      "global",
    ],
    contextCoord,
  );
}

// ── Meteorite Landings ────────────────────────────────────────────────────────

interface MeteoriteRecord {
  name: string;
  id: string;
  recclass: string;
  mass_g: number | null;
  fall: string;
  year: number | null;
  lat: number;
  lon: number;
}

function parseMeteorites(csvPath: string): MeteoriteRecord[] {
  const csv = readFileSync(csvPath, "utf8");

  function parseRow(line: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === "," && !inQuotes) {
        result.push(cur);
        cur = "";
      } else cur += ch;
    }
    result.push(cur);
    return result;
  }

  const lines = csv.trim().split("\n");
  const records: MeteoriteRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const p = parseRow(line);
    const lat = parseFloat(p[7] ?? "");
    const lon = parseFloat(p[8] ?? "");

    // Skip missing or null-encoded (0,0) coordinates
    if (!p[7] || !p[8] || isNaN(lat) || isNaN(lon)) continue;
    if (lat === 0 && lon === 0) continue;

    records.push({
      name: p[0] ?? "",
      id: p[1] ?? "",
      recclass: p[3] ?? "",
      mass_g: p[4] ? parseFloat(p[4]) || null : null,
      fall: p[5] ?? "",
      year: p[6] ? parseInt(p[6]) || null : null,
      lat,
      lon,
    });
  }

  return records;
}

function meteoriteToFeature(r: MeteoriteRecord): Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [r.lon, r.lat] },
    properties: {
      name: r.name,
      id: r.id,
      recclass: r.recclass,
      ...(r.mass_g !== null ? { mass_g: r.mass_g } : {}),
      fall: r.fall,
      ...(r.year !== null ? { year: r.year } : {}),
    },
  };
}

/**
 * Classify a non-Antarctic meteorite into a world region bucket.
 * Returns null for Antarctic records (handled separately).
 */
function classifyMeteorite(lon: number, lat: number): string | null {
  if (lat < -60) return null; // Antarctic
  if (lon >= -145 && lon <= -30) return "americas";
  if (lat >= 34 && lat <= 75 && lon >= -12 && lon <= 70) return "europe";
  if (lat >= 17 && lat <= 37 && lon >= -18 && lon <= 37) return "sahara";
  if (lat >= 13 && lat <= 27 && lon >= 50 && lon <= 61) return "oman";
  if (lat >= -37 && lat <= 17 && lon >= -18 && lon <= 52) return "subsahara";
  return "asia-pacific";
}

/**
 * Classify Antarctic meteorite into collection-site bucket.
 * Uses the standard 3-letter site prefix from the meteorite name.
 */
function classifyAntarctic(name: string): string {
  const prefix =
    name
      .match(/^([A-Za-z]+)/)?.[1]
      ?.toUpperCase()
      .slice(0, 3) ?? "";
  if (prefix === "YAM") return "yamato";
  if (prefix === "QUE") return "queen-alexandra";
  if (prefix === "GRO") return "grosvenor";
  if (prefix === "ELE") return "elephant-moraine";
  if (prefix === "LEW" || prefix === "ALL") return "lewis-allan-hills";
  if (prefix === "ASU" || prefix === "MET") return "asuka-meteorite-hills";
  return "other-sites";
}

// biome-ignore lint/suspicious/noUnusedVars: used via index
const METEORITE_DATASET_META: Record<
  string,
  { name: string; description: string; hashtags: string[] }
> = {
  // Thematic
  "witnessed-falls": {
    name: "Meteorite Witnessed Falls — Global",
    description: [
      "## Meteorites That Were Seen Falling",
      "Every entry in this dataset represents a meteorite where a human witnessed the fall — heard it, saw the fireball, " +
        "or recovered a fresh stone shortly after impact. Only ~1,100 of the 45,000+ known meteorites have this status.",
      "These are the ones with stories attached: the Chelyabinsk superbolide (2013), the Allende CV3 that " +
        "showered Mexico at dawn in 1969, and the Pu'u 'Ōma'o stone that fell on a Hawaiian island in 1825.",
      "Globally distributed, spanning centuries. An ideal introduction to the dataset.",
    ].join("\n\n"),
    hashtags: ["meteorites", "witnessed-falls", "fireballs", "global"],
  },
  // World regions
  "world-sahara": {
    name: "Meteorites — Sahara Desert",
    description: [
      "## Sahara Desert Meteorite Finds",
      "The Sahara is the world's most productive non-Antarctic meteorite hunting ground. " +
        "Arid conditions, minimal vegetation, and flat stone plains make recovery easy. " +
        "Especially dense in the Moroccan reg (stone desert), Algerian Erg, and Libyan desert.",
      "Many of the world's rarest meteorite types — including Martian shergottites and lunar feldspathic breccias — " +
        "were first discovered here by Tuareg nomads and organised scientific expeditions.",
    ].join("\n\n"),
    hashtags: ["meteorites", "sahara", "africa", "desert"],
  },
  "world-oman": {
    name: "Meteorites — Oman & Arabian Peninsula",
    description: [
      "## Oman: The Arabian Meteorite Hotspot",
      "The Dhofar and Al Wusta regions of Oman rank among the world's highest-density meteorite fields. " +
        "Since the 1990s, thousands of stones have been recovered from the flat gravel plains (serir) " +
        "of the Arabian Peninsula's interior.",
      "Notable finds include several Martian meteorites and an exceptional concentration of lunar meteorites, " +
        "making Oman disproportionately important to planetary science relative to its land area.",
    ].join("\n\n"),
    hashtags: ["meteorites", "oman", "arabia", "desert"],
  },
  "world-americas": {
    name: "Meteorites — Americas",
    description: [
      "## Meteorite Finds Across the Americas",
      "From the dry playas of the Atacama Desert (Chile, Argentina) — another ultra-productive hunting ground — " +
        "to historical falls across North America, this dataset spans the full Western Hemisphere.",
      "The Atacama is South America's answer to the Sahara: hyperarid conditions preserve meteorites for " +
        "tens of thousands of years. Notable finds include the massive iron Campo del Cielo strewn field in Argentina.",
    ].join("\n\n"),
    hashtags: ["meteorites", "americas", "atacama", "global"],
  },
  "world-rest": {
    name: "Meteorites — Europe, Sub-Saharan Africa & Asia-Pacific",
    description: [
      "## The Rest of the World",
      "Historical European falls (many with eyewitness accounts dating to the 17th–19th centuries), " +
        "scattered sub-Saharan African finds, and Asia-Pacific recoveries including stones from " +
        "Australia's Nullarbor Plain — one of the driest and flattest surfaces on Earth.",
      "European meteorites often have the longest documented histories; " +
        "the Ensisheim meteorite (Alsace, 1492) is the oldest fall with a confirmed contemporaneous record.",
    ].join("\n\n"),
    hashtags: ["meteorites", "europe", "africa", "australia", "asia"],
  },
  // Antarctic sites
  "ant-yamato-i": {
    name: "Antarctica: Yamato Mountains — Collection I",
    description: [
      "## Yamato Mountains (Japan Antarctic Research Expedition)",
      "The Yamato Mountains meteorite fields were discovered by Japanese researchers in 1969 — " +
        "the founding discovery of Antarctic meteoritics. Ice flow concentrates meteorites from " +
        "across the continent against the blue-ice fields at the foot of nunataks.",
      "This dataset covers the first half of Yamato collection numbers, recovered across successive " +
        "JARE (Japanese Antarctic Research Expedition) expeditions.",
    ].join("\n\n"),
    hashtags: ["meteorites", "antarctica", "yamato", "japan"],
  },
  "ant-yamato-ii": {
    name: "Antarctica: Yamato Mountains — Collection II",
    description: [
      "## Yamato Mountains (Japan Antarctic Research Expedition — continued)",
      "The second half of meteorites recovered from the Yamato blue-ice fields. " +
        "Yamato 791197 (a eucrite) and Yamato 86032 (a lunar anorthosite) are among the " +
        "most scientifically significant finds from this series.",
    ].join("\n\n"),
    hashtags: ["meteorites", "antarctica", "yamato", "japan"],
  },
  "ant-queen-alexandra": {
    name: "Antarctica: Queen Alexandra Range (QUE)",
    description: [
      "## Queen Alexandra Range — US ANSMET Program",
      "The Queen Alexandra Range stranding zone, collected by the American ANSMET (Antarctic Search " +
        "for Meteorites) program. Located in the Transantarctic Mountains near the Ross Ice Shelf.",
      "Includes QUE 93069, a rare carbonaceous chondrite, and several unusual achondrite types " +
        "that expanded the known diversity of Solar System material available for study.",
    ].join("\n\n"),
    hashtags: ["meteorites", "antarctica", "ansmet", "queen-alexandra"],
  },
  "ant-grosvenor": {
    name: "Antarctica: Grosvenor Mountains (GRO)",
    description: [
      "## Grosvenor Mountains — US ANSMET Program",
      "Meteorites concentrated in the Grosvenor Mountains stranding zone of the " +
        "Transantarctic Mountains. The GRO series has yielded several high-interest finds " +
        "including primitive chondrites and rare achondrite types.",
    ].join("\n\n"),
    hashtags: ["meteorites", "antarctica", "ansmet", "grosvenor"],
  },
  "ant-elephant-moraine": {
    name: "Antarctica: Elephant Moraine (ELE)",
    description: [
      "## Elephant Moraine — US ANSMET Program",
      "The Elephant Moraine stranding surface in East Antarctica, near the Darwin Glacier. " +
        "One of the most extensive collection sites in the US program, yielding thousands of stones " +
        "across decades of expeditions in harsh blue-ice conditions.",
    ].join("\n\n"),
    hashtags: ["meteorites", "antarctica", "ansmet", "elephant-moraine"],
  },
  "ant-lewis-allan-hills": {
    name: "Antarctica: Lewis Cliff & Allan Hills (LEW / ALH)",
    description: [
      "## Lewis Cliff & Allan Hills — US ANSMET Program",
      "Two of the most historically significant Antarctic collection sites. Allan Hills is where " +
        "ALH 84001 was recovered in 1984 — a Martian meteorite that sparked the 1996 controversy " +
        "over possible fossil evidence of ancient Martian life.",
      "Lewis Cliff, in the central Transantarctic Mountains, is another productive stranding zone " +
        "from the ANSMET program with thousands of collected samples.",
    ].join("\n\n"),
    hashtags: ["meteorites", "antarctica", "ansmet", "allan-hills", "mars"],
  },
  "ant-asuka-meteorite-hills": {
    name: "Antarctica: Asuka & Meteorite Hills (ASU / MET)",
    description: [
      "## Asuka Mountains & Meteorite Hills — Japan & US Programs",
      "Asuka meteorites were collected by JARE expeditions in the Asuka region of Queen Maud Land, " +
        "East Antarctica. The Meteorite Hills (MET) site is a US ANSMET stranding surface " +
        "near the Beardmore Glacier in the Transantarctic Mountains.",
    ].join("\n\n"),
    hashtags: ["meteorites", "antarctica", "asuka", "meteorite-hills"],
  },
  "ant-other-sites": {
    name: "Antarctica: Frontier Mountain & Other Sites",
    description: [
      "## Frontier Mountain, Pecora Escarpment & Remaining Antarctic Sites",
      "Smaller Antarctic collection zones from the Italian PNRA program (Frontier Mountain / FRO), " +
        "the US ANSMET Pecora Escarpment site (PEC), MacAlpine Hills (MAC), and other miscellaneous " +
        "blue-ice fields across the continent.",
      "Together these sites round out the global Antarctic meteorite picture — " +
        "Antarctica has yielded over 22,000 of the ~45,000 meteorites known to science.",
    ].join("\n\n"),
    hashtags: ["meteorites", "antarctica", "frontier-mountain", "pecora"],
  },
};

async function seedMeteoriteLandings(
  signer: NDKPrivateKeySigner,
  pubkey: string,
) {
  console.log("\n[seed_canonical] === Meteorite Landings ===");

  const csvPath = join(BASE_RIPS, "meteorite_landings/Meteorite_Landings.csv");
  const records = parseMeteorites(csvPath);
  console.log(
    `  Loaded: ${records.length} valid records (after filtering null coords)`,
  );

  // ── Publish context ──────────────────────────────────────────────────────

  const contextCoord = await publishContext(
    signer,
    pubkey,
    "meteorite-landings",
    {
      name: "Meteorite Landings",
      descriptionFormat: "markdown",
      description: [
        "## Global Meteorite Landings",
        "All known meteorite falls and finds worldwide, sourced from " +
          "[The Meteoritical Society's database](https://www.meteoriticalsociety.org/), " +
          "curated by NASA and published as open data.",
        "### The dataset",
        "- **~38,000 georeferenced specimens** from every continent\n" +
          "- **22,000+ from Antarctica** — collected across decades by US, Japanese, and European expeditions\n" +
          "- **~1,100 witnessed falls** — meteorites seen entering the atmosphere and recovered\n" +
          "- Classification, mass, year of recovery, and fall type for each entry",
        "### Why Antarctica dominates",
        "The Antarctic ice sheet acts as a natural concentrator: meteorites that fall anywhere on the " +
          "continent are slowly transported by ice flow toward the Transantarctic Mountains, " +
          "where they accumulate on blue-ice surfaces called *stranding zones*. " +
          "Researchers walk these fields systematically — the dark stones are unmistakable on white ice.",
        "### How to contribute",
        "Add new confirmed finds, correct coordinates for historical specimens, or attach contextual notes " +
          "about discovery stories, impact craters, and classification updates.",
      ].join("\n\n"),
      contextUse: "taxonomy",
      validationMode: "none",
      allowForeignAttachments: true,
    },
    ["meteorites", "space", "geology", "nasa", "science", "global"],
    [-180, -90, 180, 75],
  );

  // ── Bucket records ────────────────────────────────────────────────────────

  const worldBuckets = new Map<string, MeteoriteRecord[]>([
    ["witnessed-falls", []],
    ["world-sahara", []],
    ["world-oman", []],
    ["world-americas", []],
    ["world-rest", []],
    ["ant-yamato", []],
    ["ant-queen-alexandra", []],
    ["ant-grosvenor", []],
    ["ant-elephant-moraine", []],
    ["ant-lewis-allan-hills", []],
    ["ant-asuka-meteorite-hills", []],
    ["ant-other-sites", []],
  ]);

  for (const r of records) {
    // Witnessed falls go to their own thematic dataset (independent of geography)
    if (r.fall === "Fell") {
      worldBuckets.get("witnessed-falls")!.push(r);
    }

    if (r.lat < -60) {
      // Antarctic
      const site = classifyAntarctic(r.name);
      worldBuckets.get(`ant-${site}`)?.push(r) ??
        worldBuckets.get("ant-other-sites")!.push(r);
    } else {
      // World region
      const region = classifyMeteorite(r.lon, r.lat);
      if (
        region === "europe" ||
        region === "subsahara" ||
        region === "asia-pacific"
      ) {
        worldBuckets.get("world-rest")!.push(r);
      } else if (region) {
        worldBuckets.get(`world-${region}`)!.push(r);
      }
    }
  }

  // Log group sizes
  for (const [key, recs] of worldBuckets.entries()) {
    const sizeKB = Math.round(recs.reduce((n) => n + 170, 0) / 1024);
    console.log(`  ${key.padEnd(32)} ${recs.length} records ~${sizeKB}KB`);
  }

  // ── Split Yamato in half (too large as one dataset) ──────────────────────

  const yamato = worldBuckets
    .get("ant-yamato")!
    .sort((a, b) => a.name.localeCompare(b.name));
  const midpoint = Math.ceil(yamato.length / 2);
  const yamatoI = yamato.slice(0, midpoint);
  const yamatoII = yamato.slice(midpoint);
  worldBuckets.delete("ant-yamato");

  // ── Publish all datasets ──────────────────────────────────────────────────

  // Yamato split first
  for (const [suffix, recs] of [
    ["ant-yamato-i", yamatoI],
    ["ant-yamato-ii", yamatoII],
  ] as const) {
    const meta = METEORITE_DATASET_META[suffix]!;
    await publishDataset(
      signer,
      `meteorites-${suffix}`,
      {
        type: "FeatureCollection",
        name: meta.name,
        description: meta.description,
        features: recs.map(meteoriteToFeature),
      },
      meta.hashtags,
      contextCoord,
    );
  }

  // All other buckets
  for (const [key, recs] of worldBuckets.entries()) {
    if (recs.length === 0) continue;
    const meta = METEORITE_DATASET_META[key];
    if (!meta) {
      console.warn(`  [warn] No meta for bucket: ${key}`);
      continue;
    }
    await publishDataset(
      signer,
      `meteorites-${key}`,
      {
        type: "FeatureCollection",
        name: meta.name,
        description: meta.description,
        features: recs.map(meteoriteToFeature),
      },
      meta.hashtags,
      contextCoord,
    );
  }
}

// ── Gas Pipelines ─────────────────────────────────────────────────────────────

/**
 * Normalize heterogeneous property schemas to a canonical 8-field set.
 * Handles GOIT, Canada NEB, US FERC/EIA, OSM, and Brazilian schemas.
 */
/**
 * Infer data source registry from raw properties.
 * Returns a { source, stroke } pair for use in the normalized feature.
 * Stroke follows the simplestyle-spec for MapLibre compatibility.
 */
// biome-ignore lint/suspicious/noExplicitAny: raw geojson props
function inferPipelineSource(raw: Record<string, any> | null): {
  source: string;
  stroke: string;
} {
  if (!raw || Object.keys(raw).length === 0)
    return { source: "unknown", stroke: "#9ca3af" };
  if (raw.ProjectID || raw.Product || raw.PrjType || raw.Res || raw.Capacity)
    return { source: "GOIT", stroke: "#3b82f6" }; // blue — Global Energy Monitor GOIT
  if (raw.COMP_NAME || raw.LICENCE_NO || raw.SEG_LENGTH || raw.PIPE_GRADE)
    return { source: "Canada-NEB", stroke: "#14b8a6" }; // teal — Canada NEB
  if (
    raw.PIPE_NAME ||
    raw.FEATUREID ||
    raw.ACTUALINTE ||
    raw.ACTUALINTERNALDIAMETER
  )
    return { source: "UK-NTS", stroke: "#8b5cf6" }; // violet — UK National Transmission System
  if (raw.OPERATOR || raw.Shape__Length || raw.COUNTY || raw.TYPEPIPE)
    return { source: "US-FERC-EIA", stroke: "#22c55e" }; // green — US FERC/EIA
  if (raw.Gasoducto || raw.CAPAC_M3_H || raw.codigo_trecho_simp)
    return { source: "LatAm", stroke: "#ec4899" }; // pink — Latin American registries
  if (raw.osm_id || raw.man_made)
    return { source: "OpenStreetMap", stroke: "#f97316" }; // orange — OSM
  if (raw.nombre || raw.geo_point_2d)
    return { source: "Brazil-ANP", stroke: "#a855f7" }; // purple — Brazilian ANP
  return { source: "unknown", stroke: "#9ca3af" }; // gray
}

// biome-ignore lint/suspicious/noExplicitAny: raw geojson props
function normalizePipelineProps(
  raw: Record<string, any> | null,
): Record<string, unknown> {
  if (!raw) return { stroke: "#9ca3af", source: "unknown" };
  const p: Record<string, unknown> = {};

  // source registry + color (LayerManager uses ['get', 'color'] for line-color)
  const { source, stroke } = inferPipelineSource(raw);
  p.source = source;
  p.color = stroke; // primary: LayerManager coalesces strokeColor → color
  p.strokeColor = stroke; // fallback

  // source_id
  const srcId =
    raw.id ??
    raw.ProjectID ??
    raw.LICENCE_NO ??
    raw.osm_id ??
    raw.geo_point_2d ??
    null;
  if (srcId != null) p.source_id = String(srcId);

  // name
  const name =
    raw.name ??
    raw.NAME ??
    raw.PIPE_NAME ??
    raw.nombre ??
    raw.COMP_NAME ??
    raw.Gasoducto ??
    null;
  if (name && typeof name === "string" && name.trim()) p.name = name.trim();

  // operator
  const op =
    raw.operator ??
    raw.OPERATOR ??
    raw.OWNER ??
    raw.COMP_NAME ??
    raw.Operator ??
    null;
  if (op && typeof op === "string" && op.trim()) p.operator = op.trim();

  // status
  const status =
    raw.STATUS ?? raw.SEG_STATUS ?? raw.State ?? raw.status ?? null;
  if (status != null) p.status = String(status).trim();

  // substance
  const sub = raw.substance ?? raw.Product ?? raw.man_made ?? null;
  if (sub && typeof sub === "string" && sub.trim()) p.substance = sub.trim();

  // length_km — various units
  let lengthKm: number | null = null;
  if (typeof raw.Length === "number" && raw.Units) {
    const units = String(raw.Units).toLowerCase();
    if (units === "km") lengthKm = raw.Length;
    else if (units === "miles" || units === "mi")
      lengthKm = raw.Length * 1.60934;
    else if (units === "m") lengthKm = raw.Length / 1000;
    else lengthKm = raw.Length; // assume km
  } else if (typeof raw.SEG_LENGTH === "number") {
    // Canada NEB is in metres
    lengthKm = raw.SEG_LENGTH / 1000;
  } else if (typeof raw.Shape__Length === "number") {
    // US FERC/EIA is in degrees (approx), skip — not reliable
  }
  if (lengthKm !== null && lengthKm > 0)
    p.length_km = Math.round(lengthKm * 10) / 10;

  // diameter_mm — various units
  let diamMm: number | null = null;
  if (typeof raw.Diameter === "number") {
    const units = String(raw.Units ?? "").toLowerCase();
    // GOIT: sometimes inches, sometimes mm — check magnitude
    if (raw.Diameter < 100)
      diamMm = raw.Diameter * 25.4; // assume inches
    else diamMm = raw.Diameter; // assume mm
  } else if (typeof raw.OUT_DIAMET === "number") {
    // Canada NEB: mm
    diamMm = raw.OUT_DIAMET;
  }
  if (diamMm !== null && diamMm > 0) p.diameter_mm = Math.round(diamMm);

  // country / admin
  const country = raw.country ?? raw.STATE ?? raw.COUNTY ?? null;
  if (country && typeof country === "string" && country.trim())
    p.country = country.trim();

  return p;
}

/**
 * Return true if the pipeline is significant enough to include.
 * OSM data captures local distribution in fine detail (especially France, UK) — apply stricter
 * thresholds there. GOIT/NEB/FERC are curated transmission datasets; keep them with looser rules.
 */
function isPipelineSignificant(
  props: Record<string, unknown>,
  n: number,
): boolean {
  if (n < 3) return false;

  if (props.source === "OpenStreetMap") {
    // OSM captures both transmission and local distribution in great detail.
    // Only keep named pipes that are reasonably long, or very long anonymous corridors.
    if (props.name) return n >= 15;
    return n >= 50;
  }

  if (props.source === "UK-NTS") {
    // UK National Grid has thousands of fine-grained named segments — keep only non-trivial ones.
    return n >= 12;
  }

  // All other curated sources: named/operated pipelines still need some minimum length
  if (props.name || props.operator) return n >= 5;
  if (typeof props.length_km === "number" && props.length_km >= 10) return true;
  // Unnamed/unattributed: must be a substantial corridor
  return n >= 35;
}

/**
 * Simplify a pipeline feature's geometry.
 * Uses adaptive tolerance based on coordinate count — more coordinates = more aggressive simplification.
 * Always simplifies (even small features) to remove redundant collinear vertices.
 */
function simplifyPipeline(feature: Feature): Feature {
  const geom = feature.geometry as LineString | MultiLineString | null;
  if (!geom) return feature;
  if (geom.type !== "LineString" && geom.type !== "MultiLineString")
    return feature;

  // Count coordinates
  let coordCount = 0;
  if (geom.type === "LineString") coordCount = geom.coordinates.length;
  else coordCount = geom.coordinates.reduce((n, line) => n + line.length, 0);

  // Adaptive tolerance: higher tolerance for denser features
  // tolerance is in degrees; 0.0001° ≈ 11m, 0.001° ≈ 111m, 0.01° ≈ 1.1km
  let tolerance: number;
  if (coordCount > 50000) tolerance = 0.01;
  else if (coordCount > 10000) tolerance = 0.005;
  else if (coordCount > 1000) tolerance = 0.001;
  else if (coordCount > 100) tolerance = 0.0005;
  else tolerance = 0.0001; // minimal simplification for small pipelines

  try {
    return simplify(feature as Feature<LineString | MultiLineString>, {
      tolerance,
      highQuality: false,
    }) as Feature;
  } catch {
    return feature;
  }
}

/**
 * Classify a pipeline by its first coordinate into a regional bucket.
 */
function classifyPipelineRegion(lon: number, lat: number): string {
  if (lon >= -170 && lon <= -30 && lat >= -60 && lat <= 75) return "americas";
  if (lon >= -15 && lon <= 40 && lat >= 35 && lat <= 72) return "europe";
  if (lon >= 40 && lon <= 180 && lat >= 45 && lat <= 80)
    return "russia-central-asia";
  if (lon >= -20 && lon <= 60 && lat >= -40 && lat <= 45)
    return "middle-east-africa";
  if (lon >= 60 && lon <= 180 && lat >= -50 && lat <= 45) return "asia-pacific";
  // Fallback: use longitude quadrant
  if (lon < 0) return "americas";
  if (lon < 60) return "middle-east-africa";
  return "asia-pacific";
}

const GAS_PIPELINE_REGION_META: Record<
  string,
  { name: string; description: string }
> = {
  americas: {
    name: "Gas Pipelines — Americas",
    description: [
      "## Natural Gas Pipeline Network — Americas",
      "Gas transmission pipelines across North and South America, including the dense US interstate network, " +
        "Canadian mainline systems, Mexican trunk lines, and emerging South American cross-border routes.",
      "Data sourced from the [Global Energy Monitor](https://globalenergymonitor.org/) GOIT/GGIT pipeline routes dataset — " +
        "the most comprehensive open registry of global fossil fuel infrastructure.",
    ].join("\n\n"),
  },
  europe: {
    name: "Gas Pipelines — Europe",
    description: [
      "## Natural Gas Pipeline Network — Europe",
      "The European gas transmission grid, including the North Sea gathering systems, pan-European trunk lines " +
        "(TENP, TAG, OPAL, Baltic Pipe), LNG import terminal connections, and intra-national distribution networks.",
      "Also includes major import corridors from Russia (Nord Stream, Yamal-Europe), Central Asia (TAP/TANAP), " +
        "and North Africa (Transmed, Medgaz).",
    ].join("\n\n"),
  },
  "russia-central-asia": {
    name: "Gas Pipelines — Russia & Central Asia",
    description: [
      "## Natural Gas Pipeline Network — Russia & Central Asia",
      "Russia's Unified Gas Supply System (UGSS) — the world's largest gas pipeline network, stretching from " +
        "Siberian production fields to European borders — together with pipeline infrastructure across Kazakhstan, " +
        "Turkmenistan, Uzbekistan, and Azerbaijan.",
      "Includes the Power of Siberia pipeline to China and the major Caspian basin export corridors.",
    ].join("\n\n"),
  },
  "middle-east-africa": {
    name: "Gas Pipelines — Middle East & Africa",
    description: [
      "## Natural Gas Pipeline Network — Middle East & Africa",
      "Gas infrastructure across the Arabian Peninsula, the Levant, North Africa, and Sub-Saharan Africa. " +
        "Includes the Arab Gas Pipeline, Iran–Turkey line, Egyptian and Algerian export networks, " +
        "and emerging East African gas corridor projects.",
    ].join("\n\n"),
  },
  "asia-pacific": {
    name: "Gas Pipelines — Asia-Pacific",
    description: [
      "## Natural Gas Pipeline Network — Asia-Pacific",
      "Pipeline infrastructure across South, Southeast, and East Asia, as well as Australia and Oceania. " +
        "Includes China's West–East Pipeline system, India's HVJ corridor, Australian Queensland coal-seam gas networks, " +
        "and the growing ASEAN cross-border pipeline interconnections.",
    ].join("\n\n"),
  },
};

/**
 * Chunk an array of features into sub-datasets that stay under maxSizeKB.
 * Returns an array of feature arrays.
 */
function chunkBySize(features: Feature[], maxSizeKB: number): Feature[][] {
  const chunks: Feature[][] = [];
  let current: Feature[] = [];
  let currentSize = 0;
  const overhead = 50; // ~50B per feature for JSON encoding overhead

  for (const f of features) {
    const size = JSON.stringify(f).length + overhead;
    if (current.length > 0 && currentSize + size > maxSizeKB * 1024) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(f);
    currentSize += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function seedGasPipelines(signer: NDKPrivateKeySigner, pubkey: string) {
  const dir = join(BASE_RIPS, "gas-pipelines");
  console.log("\n[seed_canonical] === Gas Pipelines ===");

  const allFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".geojson") && !f.includes("compressor"))
    .sort();

  console.log(`  Loading ${allFiles.length} files...`);

  const contextCoord = await publishContext(
    signer,
    pubkey,
    "gas-pipelines",
    {
      name: "Gas Pipelines — Geopolitical Infrastructure",
      descriptionFormat: "markdown",
      description: [
        "## Natural Gas: The Infrastructure of Energy Politics",
        "Gas pipelines are not just pipes — they are leverage. " +
          "This map shows the transmission-level natural gas network that underpins the geopolitical relationships " +
          "between producer nations, transit states, and consumer markets.",
        "### Why this matters",
        "- **2022 and beyond**: Russia's invasion of Ukraine severed decades of energy dependency. " +
          "The Nord Stream pipelines — sabotaged in September 2022 — are visible on this map as ghost corridors. " +
          "Europe scrambled to replace 150 billion m³/year of Russian supply through LNG terminals, " +
          "the Baltic Pipe, and reversal of East–West flows.\n" +
          "- **The LNG pivot**: The US became the world's largest LNG exporter in 2023, " +
          "its shale gas now flowing through pipelines to Gulf Coast terminals and across the Atlantic. " +
          "The Americas dataset shows the dense interstate network that makes this possible.\n" +
          "- **China's play**: The Power of Siberia pipeline carries Siberian gas east rather than west, " +
          "representing Russia's strategic pivot toward Asia after Western sanctions.\n" +
          "- **MENA corridors**: The Arab Gas Pipeline, Trans-Anatolian (TANAP), and TAP corridor " +
          "connect Caspian and Middle Eastern fields to Europe — the EU's preferred diversification route.",
        "### The data",
        "Transmission-level pipelines from the [Global Energy Monitor GOIT/GGIT dataset](https://globalenergymonitor.org/), " +
          "US FERC/EIA, Canada NEB, OpenStreetMap, and national registries. " +
          "Lines are colored by data source. Local distribution networks are excluded — " +
          "this map shows the strategic trunk lines that move gas across borders and continents.",
        "### How to contribute",
        "Know of a pipeline that's missing, under construction, or recently decommissioned? " +
          "Add it here. Attach links to news articles about outages, sanctioned operators, " +
          "or contested transit agreements.",
      ].join("\n\n"),
      contextUse: "taxonomy",
      validationMode: "none",
      allowForeignAttachments: true,
    },
    [
      "gas-pipelines",
      "energy-security",
      "geopolitics",
      "russia",
      "lng",
      "fossil-fuels",
      "climate",
    ],
    [-180, -60, 180, 80],
  );

  // ── Load, simplify, normalize, classify ─────────────────────────────────

  const buckets = new Map<string, Feature[]>([
    ["americas", []],
    ["europe", []],
    ["russia-central-asia", []],
    ["middle-east-africa", []],
    ["asia-pacific", []],
  ]);

  let loadedFiles = 0;
  let skippedFiles = 0;
  let totalFeatures = 0;

  for (const filename of allFiles) {
    const filepath = join(dir, filename);
    let text: string;
    try {
      text = readFileSync(filepath, "utf8");
    } catch {
      skippedFiles++;
      continue;
    }

    // Skip QGIS XML files
    if (text.startsWith("<") || text.startsWith("<!")) {
      skippedFiles++;
      continue;
    }

    let geo: FeatureCollection;
    try {
      geo = JSON.parse(text) as FeatureCollection;
    } catch {
      skippedFiles++;
      continue;
    }

    if (!geo.features || geo.features.length === 0) {
      skippedFiles++;
      continue;
    }

    // Find first valid geometry to classify the file
    let regionKey: string | null = null;
    for (const feat of geo.features) {
      if (!feat.geometry) continue;
      let coords = (feat.geometry as LineString | MultiLineString).coordinates;
      // Drill down to first [lon, lat]
      // biome-ignore lint/suspicious/noExplicitAny: drilling
      let c: any = coords;
      while (Array.isArray(c[0])) c = c[0];
      const [lon, lat] = c as [number, number];
      if (typeof lon === "number" && typeof lat === "number") {
        regionKey = classifyPipelineRegion(lon, lat);
        break;
      }
    }

    if (!regionKey) {
      skippedFiles++;
      continue;
    }

    // Simplify + normalize + filter all features in the file
    for (const feat of geo.features) {
      if (!feat.geometry) continue;
      // Skip point features — pipelines are lines only
      if (feat.geometry.type === "Point" || feat.geometry.type === "MultiPoint") continue;
      const simplified = simplifyPipeline(feat);
      const normalizedProps = normalizePipelineProps(
        feat.properties as Record<string, unknown> | null,
      );

      // Count coords in simplified geometry for significance check
      const geom = simplified.geometry as LineString | MultiLineString | null;
      let coordCount = 0;
      if (geom?.type === "LineString") coordCount = geom.coordinates.length;
      else if (geom?.type === "MultiLineString")
        coordCount = geom.coordinates.reduce((n, line) => n + line.length, 0);

      if (!isPipelineSignificant(normalizedProps, coordCount)) continue;

      simplified.properties = normalizedProps;
      buckets.get(regionKey)!.push(simplified);
      totalFeatures++;
    }

    loadedFiles++;
    if (loadedFiles % 500 === 0) {
      console.log(`  ... processed ${loadedFiles} files`);
    }
  }

  console.log(
    `  Loaded: ${loadedFiles} files, ${totalFeatures} features (skipped: ${skippedFiles})`,
  );

  // Log bucket sizes
  for (const [region, features] of buckets.entries()) {
    const rawKB = Math.round(JSON.stringify(features).length / 1024);
    console.log(
      `  ${region.padEnd(28)} ${features.length} features ~${rawKB}KB`,
    );
  }

  // ── Publish each region (chunked if needed) ──────────────────────────────

  const MAX_DATASET_KB = 700;

  for (const [region, features] of buckets.entries()) {
    if (features.length === 0) continue;
    const meta = GAS_PIPELINE_REGION_META[region]!;
    const chunks = chunkBySize(features, MAX_DATASET_KB);

    if (chunks.length === 1) {
      await publishDataset(
        signer,
        `gas-pipelines-${region}`,
        {
          type: "FeatureCollection",
          name: meta.name,
          description: meta.description,
          features: chunks[0]!,
        },
        ["gas-pipelines", "energy-infrastructure", region],
        contextCoord,
      );
    } else {
      console.log(`  ${region}: splitting into ${chunks.length} chunks`);
      for (let i = 0; i < chunks.length; i++) {
        const part = i + 1;
        await publishDataset(
          signer,
          `gas-pipelines-${region}-${part}`,
          {
            type: "FeatureCollection",
            name: `${meta.name} (Part ${part}/${chunks.length})`,
            description: meta.description,
            features: chunks[i]!,
          },
          ["gas-pipelines", "energy-infrastructure", region],
          contextCoord,
        );
      }
    }
  }
}

// ── Liquid Pipelines ──────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: raw geojson props
function inferLiquidSource(raw: Record<string, any> | null): {
  source: string;
  color: string;
} {
  if (!raw || Object.keys(raw).length === 0)
    return { source: "unknown", color: "#9ca3af" };
  if (
    raw.NPMS_SYS_I ||
    raw.CMDTY_DESC ||
    raw.OPER_NM ||
    raw.SYSTYPE ||
    raw.STATUS_CD
  )
    return { source: "US-NPMS", color: "#22c55e" }; // green — US NPMS/FERC federal registry
  if (raw.CompanyCode || raw.BusinessUnitCL)
    return { source: "US-NGL", color: "#3b82f6" }; // blue — US/Canada NGL corporate GIS
  if ((raw.FID != null || raw.OWNER != null) && (raw.SUBSYS_NM || raw.SYS_NM))
    return { source: "US-NGL", color: "#3b82f6" };
  if (raw.DUCTO || raw.EMPRESA || raw.TIPO_DUCTO)
    return { source: "LatAm", color: "#ec4899" }; // pink — South American
  if (raw.PIPE_NAME && (raw.REGION || raw.CONTENT || raw.LGTH_KM))
    return { source: "SE-Asia", color: "#14b8a6" }; // teal — SE Asia / Malaysia
  if (raw.Pipel_Name || raw.Approval_C || raw.Pipe_Seg)
    return { source: "Shell", color: "#a855f7" }; // purple — Shell/international upstream
  if (raw.ProjectID || raw.Product || raw.PrjType)
    return { source: "GOIT", color: "#f97316" }; // orange — Global Energy Monitor
  if (raw.osm_id || raw.man_made || raw.pipeline != null)
    return { source: "OpenStreetMap", color: "#f59e0b" }; // amber — OSM
  return { source: "unknown", color: "#9ca3af" };
}

// biome-ignore lint/suspicious/noExplicitAny: raw geojson props
function normalizeLiquidProps(
  raw: Record<string, any> | null,
): Record<string, unknown> {
  if (!raw)
    return { color: "#9ca3af", strokeColor: "#9ca3af", source: "unknown" };
  const p: Record<string, unknown> = {};

  const { source, color } = inferLiquidSource(raw);
  p.source = source;
  p.color = color;
  p.strokeColor = color;

  // name
  const name =
    raw.name ??
    raw.PIPE_NAME ??
    raw.Pipel_Name ??
    raw.DUCTO ??
    raw.SYS_NM ??
    raw.SUBSYS_NM ??
    null;
  if (name && typeof name === "string" && name.trim()) p.name = name.trim();

  // operator
  const op =
    raw.operator ??
    raw.CompanyCode ??
    raw.OPER_NM ??
    raw.EMPRESA ??
    raw.OWNER ??
    raw.OPERATOR ??
    null;
  if (op && typeof op === "string" && op.trim()) p.operator = op.trim();

  // substance / product
  const sub =
    raw.substance ??
    raw.CMDTY_DESC ??
    raw.COMMODITY1 ??
    raw.CONTENT ??
    raw.TIPO_DUCTO ??
    null;
  if (sub && typeof sub === "string" && sub.trim()) p.substance = sub.trim();

  // status
  const status =
    raw.STATUS_CD ?? raw.STATUS ?? raw.ESTADO ?? raw.status ?? null;
  if (status != null) p.status = String(status).trim();

  // length_km
  let lengthKm: number | null = null;
  if (typeof raw.LENGTH_km === "number") lengthKm = raw.LENGTH_km;
  else if (typeof raw.LGTH_KM === "number") lengthKm = raw.LGTH_KM;
  else if (typeof raw.LENGTH === "number") lengthKm = raw.LENGTH;
  if (lengthKm !== null && lengthKm > 0)
    p.length_km = Math.round(lengthKm * 10) / 10;

  // diameter
  const rawDiam = raw.OUTER_DIA_INCH ?? raw.Diameter ?? raw.diameter ?? null;
  if (rawDiam != null) {
    const d =
      typeof rawDiam === "number" ? rawDiam : parseFloat(String(rawDiam));
    if (!isNaN(d) && d > 0) {
      // Convert inches to mm if < 100 (heuristic: inches), else assume mm
      p.diameter_mm = d < 100 ? Math.round(d * 25.4) : Math.round(d);
    }
  }

  return p;
}

function isLiquidPipelineSignificant(
  props: Record<string, unknown>,
  n: number,
): boolean {
  if (n < 3) return false;
  // With only ~8K features total, be lenient — keep anything with a name, operator, or substance
  if (props.name || props.operator || props.substance) return true;
  if (typeof props.length_km === "number" && props.length_km >= 5) return true;
  // Anonymous: need to be a real corridor
  return n >= 15;
}

const LIQUID_PIPELINE_REGION_META: Record<
  string,
  { name: string; description: string }
> = {
  americas: {
    name: "Liquid Pipelines — Americas",
    description: [
      "## Liquid Pipeline Network — Americas",
      "Crude oil, refined petroleum, natural gas liquids (NGL), ethane, and LPG pipelines across North and South America. " +
        "The US Gulf Coast is the world's largest NGL processing hub — this dataset shows the dense network of " +
        "gathering, fractionation, and export pipelines built to move Permian Basin, Bakken, and Marcellus shale output.",
      "Notable systems: the Colonial Pipeline (the largest refined-products pipeline in the US, target of the 2021 ransomware attack), " +
        "Trans-Alaska Pipeline (800 miles of arctic engineering), and the contested Keystone system " +
        "(KXL cancelled by Biden in 2021, its route still visible on this map).",
    ].join("\n\n"),
  },
  europe: {
    name: "Liquid Pipelines — Europe",
    description: [
      "## Liquid Pipeline Network — Europe",
      "Crude and refined product pipelines across Western and Central Europe. " +
        "Includes the Druzhba (Friendship) pipeline — the world's longest oil pipeline, carrying Russian crude " +
        "to refineries in Poland, Germany, Hungary, Slovakia, and the Czech Republic.",
      "Post-2022, the EU has been rapidly shifting away from Russian crude, with significant " +
        "infrastructure upgrades to receive seaborne imports at Baltic and Adriatic terminals.",
    ].join("\n\n"),
  },
  "russia-central-asia": {
    name: "Liquid Pipelines — Russia & Central Asia",
    description: [
      "## Liquid Pipeline Network — Russia & Central Asia",
      "Transneft's trunk crude pipeline system — the world's largest oil pipeline network — together with " +
        "Caspian export infrastructure from Kazakhstan, Azerbaijan, and Turkmenistan.",
      "Key routes: the BTC (Baku–Tbilisi–Ceyhan), CPC (Caspian Pipeline Consortium) through Kazakhstan to Novorossiysk, " +
        "and the ESPO pipeline carrying Russian crude east to China and Pacific export terminals.",
    ].join("\n\n"),
  },
  "middle-east-africa": {
    name: "Liquid Pipelines — Middle East & Africa",
    description: [
      "## Liquid Pipeline Network — Middle East & Africa",
      "Saudi Aramco's gathering and export systems, Iraqi and UAE crude lines, and Sub-Saharan African trunk pipelines. " +
        "The region contains the world's largest proven crude reserves — these pipelines are the arteries of global oil supply.",
      "Includes the Abqaiq–Yanbu East–West Pipeline (Saudi Arabia's Red Sea export route), " +
        "East African crude lines, and North African Mediterranean export pipelines.",
    ].join("\n\n"),
  },
  "asia-pacific": {
    name: "Liquid Pipelines — Asia-Pacific",
    description: [
      "## Liquid Pipeline Network — Asia-Pacific",
      "Offshore and onshore crude export lines across Southeast Asia, Australia, and East Asia. " +
        "Includes Malaysian and Indonesian offshore export pipelines (PETRONAS, PCSB), " +
        "Chinese crude import lines from ESPO and Myanmar, and Australian condensate gathering systems.",
    ].join("\n\n"),
  },
};

async function seedLiquidPipelines(
  signer: NDKPrivateKeySigner,
  pubkey: string,
) {
  const dir = join(BASE_RIPS, "liquid-pipelines");
  console.log("\n[seed_canonical] === Liquid Pipelines ===");

  const allFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".geojson"))
    .sort();
  console.log(`  Loading ${allFiles.length} files...`);

  const contextCoord = await publishContext(
    signer,
    pubkey,
    "liquid-pipelines",
    {
      name: "Liquid Pipelines — Oil & NGL Infrastructure",
      descriptionFormat: "markdown",
      description: [
        "## Oil Is Power: Liquid Pipeline Infrastructure",
        "Before natural gas, before renewables — oil built the modern world. " +
          "This map shows the pipelines that move crude oil, refined petroleum products, " +
          "natural gas liquids (NGL), ethane, LPG, and other liquid hydrocarbons across continents.",
        "### The geopolitics of liquid fuel",
        "- **OPEC and Saudi leverage**: The Middle East's Abqaiq facility — the world's largest oil processing plant — " +
          "was attacked by drones in 2019, briefly disrupting 5% of global supply. Its export pipelines are on this map.\n" +
          "- **The NGL boom**: The US shale revolution produced massive volumes of ethane and NGL as byproducts. " +
          "A dense web of NGL gathering pipelines now crisscrosses the Permian Basin, Bakken, and Marcellus plays.\n" +
          "- **Druzhba — 'Friendship'**: The world's longest oil pipeline carries Russian crude from western Siberia " +
          "to European refineries. Sanctions since 2022 have forced Europe to find alternative supply — " +
          "the infrastructure scramble is visible in new Baltic port upgrades.\n" +
          "- **Keystone and the climate wars**: The Keystone XL pipeline — cancelled, then cancelled again — " +
          "became the defining symbol of the pipeline approval debate. Its proposed route still appears in this dataset.",
        "### The data",
        "Pipeline routes from the [Global Energy Monitor GOIT/GGIT dataset](https://globalenergymonitor.org/), " +
          "US NPMS/FERC/EIA registries, US/Canadian NGL corporate GIS, OpenStreetMap, " +
          "and national registries from South America and Southeast Asia.",
        "### How to contribute",
        "Add newly approved pipelines, update status on decommissioned routes, " +
          "or attach news links documenting spills, sanctions, or regulatory decisions.",
      ].join("\n\n"),
      contextUse: "taxonomy",
      validationMode: "none",
      allowForeignAttachments: true,
    },
    [
      "liquid-pipelines",
      "oil",
      "ngl",
      "energy-security",
      "geopolitics",
      "fossil-fuels",
      "climate",
    ],
    [-180, -60, 180, 80],
  );

  const buckets = new Map<string, Feature[]>([
    ["americas", []],
    ["europe", []],
    ["russia-central-asia", []],
    ["middle-east-africa", []],
    ["asia-pacific", []],
  ]);

  let loadedFiles = 0;
  let skippedFiles = 0;
  let totalFeatures = 0;

  for (const filename of allFiles) {
    const filepath = join(dir, filename);
    let text: string;
    try {
      text = readFileSync(filepath, "utf8");
    } catch {
      skippedFiles++;
      continue;
    }
    if (text.startsWith("<")) {
      skippedFiles++;
      continue;
    }

    let geo: FeatureCollection;
    try {
      geo = JSON.parse(text) as FeatureCollection;
    } catch {
      skippedFiles++;
      continue;
    }
    if (!geo.features || geo.features.length === 0) {
      skippedFiles++;
      continue;
    }

    // Classify file by first valid coordinate
    let regionKey: string | null = null;
    for (const feat of geo.features) {
      if (!feat.geometry) continue;
      // biome-ignore lint/suspicious/noExplicitAny: drilling
      let c: any = (feat.geometry as any).coordinates;
      while (Array.isArray(c[0])) c = c[0];
      const [lon, lat] = c as [number, number];
      if (typeof lon === "number" && typeof lat === "number") {
        regionKey = classifyPipelineRegion(lon, lat);
        break;
      }
    }
    if (!regionKey) {
      skippedFiles++;
      continue;
    }

    for (const feat of geo.features) {
      if (!feat.geometry) continue;
      const simplified = simplifyPipeline(feat);
      const normalizedProps = normalizeLiquidProps(
        feat.properties as Record<string, unknown> | null,
      );

      const geom = simplified.geometry as LineString | MultiLineString | null;
      let coordCount = 0;
      if (geom?.type === "LineString") coordCount = geom.coordinates.length;
      else if (geom?.type === "MultiLineString")
        coordCount = geom.coordinates.reduce((n, line) => n + line.length, 0);

      if (!isLiquidPipelineSignificant(normalizedProps, coordCount)) continue;

      simplified.properties = normalizedProps;
      buckets.get(regionKey)!.push(simplified);
      totalFeatures++;
    }

    loadedFiles++;
    if (loadedFiles % 500 === 0)
      console.log(`  ... processed ${loadedFiles} files`);
  }

  console.log(
    `  Loaded: ${loadedFiles} files, ${totalFeatures} features (skipped: ${skippedFiles})`,
  );

  for (const [region, features] of buckets.entries()) {
    const rawKB = Math.round(JSON.stringify(features).length / 1024);
    console.log(
      `  ${region.padEnd(28)} ${features.length} features ~${rawKB}KB`,
    );
  }

  const MAX_DATASET_KB = 700;

  for (const [region, features] of buckets.entries()) {
    if (features.length === 0) continue;
    const meta = LIQUID_PIPELINE_REGION_META[region]!;
    const chunks = chunkBySize(features, MAX_DATASET_KB);

    if (chunks.length === 1) {
      await publishDataset(
        signer,
        `liquid-pipelines-${region}`,
        {
          type: "FeatureCollection",
          name: meta.name,
          description: meta.description,
          features: chunks[0]!,
        },
        ["liquid-pipelines", "oil", "ngl", region],
        contextCoord,
      );
    } else {
      console.log(`  ${region}: splitting into ${chunks.length} chunks`);
      for (let i = 0; i < chunks.length; i++) {
        const part = i + 1;
        await publishDataset(
          signer,
          `liquid-pipelines-${region}-${part}`,
          {
            type: "FeatureCollection",
            name: `${meta.name} (Part ${part}/${chunks.length})`,
            description: meta.description,
            features: chunks[i]!,
          },
          ["liquid-pipelines", "oil", "ngl", region],
          contextCoord,
        );
      }
    }
  }
}

// ── Nuclear Power ─────────────────────────────────────────────────────────────

function nuclearStatusColor(status: string): string {
  switch (status) {
    case "operating":
      return "#22c55e"; // green
    case "construction":
      return "#eab308"; // yellow
    case "pre-construction":
      return "#f97316"; // orange
    case "announced":
      return "#60a5fa"; // blue
    case "retired":
      return "#6b7280"; // gray
    case "cancelled":
      return "#ef4444"; // red
    case "mothballed":
      return "#94a3b8"; // slate
    case "shelved":
      return "#a8a29e"; // warm gray
    default:
      return "#9ca3af";
  }
}

function normalizeNuclearProps(
  p: Record<string, unknown>,
): Record<string, unknown> {
  const status = String(p.status ?? "unknown");
  return {
    name: p.name,
    unit: p["unit-name"],
    status,
    reactorType: p["reactor-type"],
    capacity: p.capacity != null ? Number(p.capacity) : undefined,
    startYear: p["start-year"],
    operator: p.operator,
    owner: p.owner,
    country:
      typeof p.areas === "string" ? p.areas.replace(/;$/, "") : undefined,
    subnat: p.subnat,
    region: p.region,
    url: p.url,
    color: nuclearStatusColor(status),
    strokeColor: nuclearStatusColor(status),
  };
}

const NUCLEAR_REGION_META: Record<
  string,
  { name: string; description: string }
> = {
  Americas: {
    name: "Nuclear Power — Americas",
    description:
      "The United States operates 93 commercial reactors — more than any country on Earth — yet its fleet is aging " +
      "and no new plant has been completed since the 1990s. Three Mile Island's 1979 partial meltdown defined a " +
      "generation of policy paralysis. Meanwhile the 'nuclear renaissance' of the 2000s collapsed under cost overruns " +
      "(Vogtle Units 3&4 came in $17 billion over budget). Brazil's Angra complex and Argentina's CANDU program " +
      "represent Latin America's small but durable nuclear ambitions. Small modular reactors (SMRs) are the new bet — " +
      "dozens announced across the hemisphere, none yet operating.",
  },
  Asia: {
    name: "Nuclear Power — Asia",
    description:
      "Asia is the center of gravity for nuclear expansion. China is building faster than any country in history — " +
      "over 20 reactors under construction, with plans for 150 by 2035. Japan shut down nearly its entire fleet after " +
      "Fukushima Daiichi's 2011 meltdown; restarts remain politically contested. South Korea reversed a phase-out policy " +
      "after a change of government. India pursues a unique thorium fuel cycle and refuses to sign the NPT. Pakistan's " +
      "growing fleet — all Chinese-built — mirrors its nuclear weapons program. North Korea's parallel civilian and " +
      "military programs remain opaque to international inspectors.",
  },
  Europe: {
    name: "Nuclear Power — Europe",
    description:
      "Europe is fracturing over nuclear. France generates 70% of its electricity from nuclear — the highest share in " +
      "the world — but its aging fleet required emergency repairs in 2022, contributing to an energy crisis. Germany " +
      "permanently shut its last three reactors in 2023, a decision driven by ideology as much as economics. Ukraine's " +
      "Zaporizhzhia plant — Europe's largest — was seized by Russian forces in March 2022 and remains under military " +
      "occupation, an unprecedented nuclear safety crisis. Russia's state company ROSATOM is building or operating " +
      "reactors in 30+ countries, using nuclear contracts as geopolitical leverage. The UK is building Hinkley Point C " +
      "at record cost, after decades of inaction.",
  },
  Africa: {
    name: "Nuclear Power — Africa",
    description:
      "Africa has one operating nuclear power plant: South Africa's Koeberg, commissioned 1984. But the continent " +
      "contains much of the world's uranium — Niger, Namibia, and South Africa are major producers. France's nuclear " +
      "sector historically sourced much of its uranium from Niger; the 2023 coup by the junta has upended that supply " +
      "chain. Egypt, Ghana, Kenya, and Morocco have all signed agreements with ROSATOM or the IAEA to build their " +
      "first reactors. Africa's electricity deficit — 600 million without grid power — is the argument for nuclear " +
      "advocates; the capital costs and waste risks are the argument against.",
  },
};

async function seedNuclearPower(signer: NDKPrivateKeySigner, pubkey: string) {
  const filepath = join(BASE_RIPS, "nuclear_power/nuclear-power.geojson");
  console.log("\n[seed_canonical] === Nuclear Power Plants ===");

  let raw: Feature[];
  try {
    raw = JSON.parse(readFileSync(filepath, "utf8")) as Feature[];
  } catch (err) {
    console.error("  Failed to load nuclear-power.geojson:", err);
    return;
  }

  const contextCoord = await publishContext(
    signer,
    pubkey,
    "nuclear-power",
    {
      name: "Nuclear Power Plants — Global Infrastructure",
      descriptionFormat: "markdown",
      description: [
        "## Atoms and Power: The Global Nuclear Fleet",
        "There are ~440 operating nuclear reactors worldwide, producing about 10% of global electricity. " +
          "No energy source is more politically charged: it is simultaneously a climate solution, a proliferation risk, " +
          "a cold war legacy, and a geopolitical tool.",
        "### Status legend",
        "- 🟢 **Operating** — currently generating power\n" +
          "- 🟡 **Construction** — under active construction\n" +
          "- 🟠 **Pre-construction** — approved, site prep or engineering underway\n" +
          "- 🔵 **Announced** — publicly committed but not yet approved\n" +
          "- ⚫ **Retired** — permanently shut down\n" +
          "- 🔴 **Cancelled** — project abandoned\n" +
          "- 🩶 **Mothballed / Shelved** — suspended indefinitely",
        "### The geopolitics",
        "ROSATOM (Russia) is the world's largest exporter of nuclear technology, building plants in Hungary, Turkey, " +
          "Egypt, India, Bangladesh, and more. Nuclear contracts create 60-year dependencies — fuel, maintenance, waste — " +
          "that are as binding as any pipeline. Ukraine's Zaporizhzhia plant, occupied by Russian forces since March 2022, " +
          "is the first nuclear facility in history to become a war zone.",
        "### Data source",
        "Global Nuclear Power Tracker (GNPT) by [Global Energy Monitor](https://globalenergymonitor.org/projects/global-nuclear-power-tracker/). " +
          "CC-BY 4.0.",
      ].join("\n\n"),
      contextUse: "taxonomy",
      validationMode: "none",
      allowForeignAttachments: true,
    },
    [
      "nuclear",
      "energy",
      "power-plants",
      "geopolitics",
      "climate",
      "nonproliferation",
    ],
    [-180, -60, 180, 80],
  );

  const buckets = new Map<string, Feature[]>([
    ["Americas", []],
    ["Asia", []],
    ["Europe", []],
    ["Africa", []],
  ]);

  let total = 0;
  for (const feat of raw) {
    const props = feat.properties as Record<string, unknown> | null;
    const region = String(props?.region ?? "");
    const bucket = buckets.get(region);
    if (!bucket) continue; // skip unknown regions

    const normalized: Feature = {
      type: "Feature",
      geometry: feat.geometry,
      properties: normalizeNuclearProps(props ?? {}),
    };
    bucket.push(normalized);
    total++;
  }

  console.log(`  Total: ${total} features`);
  for (const [region, features] of buckets.entries()) {
    console.log(`  ${region.padEnd(20)} ${features.length} features`);
  }

  const MAX_DATASET_KB = 700;

  for (const [region, features] of buckets.entries()) {
    if (features.length === 0) continue;
    const meta = NUCLEAR_REGION_META[region]!;
    const chunks = chunkBySize(features, MAX_DATASET_KB);

    if (chunks.length === 1) {
      await publishDataset(
        signer,
        `nuclear-power-${region.toLowerCase()}`,
        {
          type: "FeatureCollection",
          name: meta.name,
          description: meta.description,
          features: chunks[0]!,
        },
        ["nuclear", "energy", "power-plants", region.toLowerCase()],
        contextCoord,
      );
    } else {
      console.log(`  ${region}: splitting into ${chunks.length} chunks`);
      for (let i = 0; i < chunks.length; i++) {
        const part = i + 1;
        await publishDataset(
          signer,
          `nuclear-power-${region.toLowerCase()}-${part}`,
          {
            type: "FeatureCollection",
            name: `${meta.name} (Part ${part}/${chunks.length})`,
            description: meta.description,
            features: chunks[i]!,
          },
          ["nuclear", "energy", "power-plants", region.toLowerCase()],
          contextCoord,
        );
      }
    }
  }
}

// ── Airports & Ports ──────────────────────────────────────────────────────────

function airportCategory(
  type: string,
): "civil-major" | "civil-regional" | "military" | "spaceport" {
  if (type === "spaceport") return "spaceport";
  if (type.includes("military")) return "military";
  if (type === "major") return "civil-major";
  return "civil-regional";
}

function airportColor(cat: string): string {
  switch (cat) {
    case "civil-major":
      return "#3b82f6";
    case "civil-regional":
      return "#38bdf8";
    case "military":
      return "#ef4444";
    case "spaceport":
      return "#8b5cf6";
    default:
      return "#9ca3af";
  }
}

function portTier(scalerank: number): "major" | "regional" | "local" {
  if (scalerank <= 4) return "major";
  if (scalerank <= 6) return "regional";
  return "local";
}

function portColor(tier: string): string {
  switch (tier) {
    case "major":
      return "#1d4ed8";
    case "regional":
      return "#0d9488";
    case "local":
      return "#6b7280";
    default:
      return "#9ca3af";
  }
}

async function seedAirports(signer: NDKPrivateKeySigner, pubkey: string) {
  const filepath = join(BASE_RIPS, "airports/airports.geojson");
  console.log("\n[seed_canonical] === Airports ===");

  const fc = JSON.parse(readFileSync(filepath, "utf8")) as FeatureCollection;

  const contextCoord = await publishContext(
    signer,
    pubkey,
    "airports",
    {
      name: "Airports — Global Air Infrastructure",
      descriptionFormat: "markdown",
      description: [
        "## Runways of Power: Global Airport Infrastructure",
        "There are roughly 41,000 airports on Earth. This map covers ~900 of the most significant — " +
          "from megahubs like Dubai DXB and Atlanta ATL that process 90 million passengers a year, " +
          "to remote military airstrips and the handful of facilities launching humans to space.",
        "### Types",
        "- ✈️ **Major civil** — international hubs and high-traffic airports\n" +
          "- 🛩️ **Regional civil** — mid-size and smaller civilian airports\n" +
          "- 🪖 **Military** — dedicated military airfields and dual-use civil/military facilities\n" +
          "- 🚀 **Spaceports** — licensed launch facilities (Kennedy, Baikonur, Guiana Space Centre)",
        "### The geopolitics",
        "Airports are forward operating bases, sanctions checkpoints, and power projection tools. " +
          "US military bases with runways encircle potential adversaries in a strategy of forward presence. " +
          "China's Belt and Road has funded airport construction from Pakistan to Kenya, generating debate " +
          "about 'debt trap' infrastructure. The race to build hub airports in the Gulf — Dubai, Doha, Abu Dhabi — " +
          "is as much about national prestige and regional influence as it is about aviation.",
        "### Data source",
        "Natural Earth 10m airports dataset. Public domain.",
      ].join("\n\n"),
      contextUse: "taxonomy",
      validationMode: "none",
      allowForeignAttachments: true,
    },
    ["airports", "aviation", "infrastructure", "military", "transport"],
    [-180, -80, 180, 80],
  );

  const AIRPORT_META: Record<string, { name: string; description: string }> = {
    "civil-major": {
      name: "Airports — Major International Hubs",
      description:
        "The world's major international airports: the Heathrows, Changi's, O'Hares, and Dubai DXBs. " +
        "These hubs are chokepoints for global mobility — their closures during COVID (2020) revealed " +
        "how few nodes carry the bulk of world aviation. Many also serve as cargo hubs for the global supply chain.",
    },
    "civil-regional": {
      name: "Airports — Regional & Domestic",
      description:
        "Mid-size and regional airports providing domestic and short-haul connectivity. " +
        "In large countries like the US, Brazil, Russia, and Australia, regional airports are critical " +
        "for economic access to remote communities — often the only alternative to multi-day road travel.",
    },
    military: {
      name: "Airports — Military & Dual-Use",
      description:
        "Military airfields and dual-use civil/military airports. US overseas bases — Ramstein, Yokota, " +
        "Al Udeid, Diego Garcia — define the geography of American power projection. " +
        "Russia's bases in Syria (Hmeimim) and its expanding presence in Africa reflect Moscow's own " +
        "global ambitions. Many 'civilian' airports in China are built to military specifications, " +
        "capable of rapid conversion to military use.",
    },
    spaceport: {
      name: "Airports — Spaceports",
      description:
        "Licensed launch facilities for crewed and uncrewed spaceflight: Kennedy Space Center/Cape Canaveral (US), " +
        "Baikonur Cosmodrome (Kazakhstan — leased by Russia), and Guiana Space Centre (France). " +
        "The new commercial spaceport era is expanding this list — Vandenberg, Mahia (New Zealand), and others.",
    },
  };

  const buckets = new Map<string, Feature[]>([
    ["civil-major", []],
    ["civil-regional", []],
    ["military", []],
    ["spaceport", []],
  ]);

  for (const feat of fc.features) {
    const p = (feat.properties as Record<string, unknown> | null) ?? {};
    const rawType = String(p.type ?? "");
    const cat = airportCategory(rawType);
    const color = airportColor(cat);

    buckets.get(cat)!.push({
      type: "Feature",
      geometry: feat.geometry,
      properties: {
        name: p.name,
        iata: p.iata_code,
        icao: p.gps_code,
        type: rawType,
        category: cat,
        scalerank: p.scalerank,
        wikipedia: p.wikipedia,
        color,
        strokeColor: color,
      },
    });
  }

  for (const [cat, features] of buckets.entries()) {
    if (features.length === 0) continue;
    const meta = AIRPORT_META[cat]!;
    console.log(`  ${cat.padEnd(20)} ${features.length} features`);
    await publishDataset(
      signer,
      `airports-${cat}`,
      {
        type: "FeatureCollection",
        name: meta.name,
        description: meta.description,
        features,
      },
      ["airports", "aviation", cat],
      contextCoord,
    );
  }
}

async function seedPorts(signer: NDKPrivateKeySigner, pubkey: string) {
  const filepath = join(BASE_RIPS, "ports/ports.geojson");
  console.log("\n[seed_canonical] === Ports ===");

  const fc = JSON.parse(readFileSync(filepath, "utf8")) as FeatureCollection;

  const contextCoord = await publishContext(
    signer,
    pubkey,
    "ports",
    {
      name: "Seaports — Global Maritime Infrastructure",
      descriptionFormat: "markdown",
      description: [
        "## The Arteries of World Trade: Global Seaports",
        "Roughly 90% of world trade by volume moves by sea. The ~1,000 ports on this map range from " +
          "megalith container terminals handling 50 million TEU per year to small regional harbors " +
          "that are the lifeline of island nations.",
        "### Size tiers",
        "- 🔵 **Major** — world's largest container/bulk/energy terminals (Rotterdam, Shanghai, Singapore, Houston)\n" +
          "- 🩵 **Regional** — significant national and regional ports handling substantial cargo volumes\n" +
          "- ⚫ **Local** — smaller ports serving coastal and island communities",
        "### Chokepoints and leverage",
        "The world's maritime trade routes converge on a handful of narrow straits and canals: " +
          "Strait of Hormuz (20% of global oil), Strait of Malacca (1/3 of world trade), " +
          "Suez Canal, Bosphorus, Panama Canal, Bab el-Mandab. " +
          "Control of or access to these straits — and the ports that anchor them — " +
          "is a recurring theme in great-power rivalry.",
        "### China's port strategy",
        "Through the Maritime Silk Road component of Belt and Road, China has invested in or built " +
          "port infrastructure in Gwadar (Pakistan), Hambantota (Sri Lanka), Djibouti, Piraeus (Greece), " +
          "and dozens of other locations. Critics call this 'port as leverage'; China calls it commerce.",
        "### Data source",
        "Natural Earth 10m ports dataset. Public domain.",
      ].join("\n\n"),
      contextUse: "taxonomy",
      validationMode: "none",
      allowForeignAttachments: true,
    },
    ["ports", "maritime", "shipping", "trade", "infrastructure", "geopolitics"],
    [-180, -80, 180, 80],
  );

  const PORT_META: Record<string, { name: string; description: string }> = {
    major: {
      name: "Seaports — Major Global Terminals",
      description:
        "The world's largest and busiest seaports — container giants like Shanghai Yangshan, Singapore, " +
        "Rotterdam, and Long Beach, plus major bulk and energy terminals. These facilities are the nodes " +
        "where supply chains begin and end. The COVID-era congestion at Los Angeles/Long Beach (2021–22) " +
        "demonstrated how a single bottlenecked port can reverberate across global manufacturing.",
    },
    regional: {
      name: "Seaports — Regional Hubs",
      description:
        "Significant national and regional ports that anchor sub-continental trade flows. " +
        "These facilities handle commodity exports (grain, coal, iron ore), energy imports (LNG, crude), " +
        "and provide the secondary distribution layer that feeds major hubs.",
    },
    local: {
      name: "Seaports — Local & Coastal Ports",
      description:
        "Smaller ports serving coastal communities, islands, and regional markets. " +
        "For many island nations and remote coastal communities, these facilities are the only link " +
        "to external supply chains — making them disproportionately important during disasters and blockades.",
    },
  };

  const buckets = new Map<string, Feature[]>([
    ["major", []],
    ["regional", []],
    ["local", []],
  ]);

  for (const feat of fc.features) {
    const p = (feat.properties as Record<string, unknown> | null) ?? {};
    const scalerank = Number(p.scalerank ?? 8);
    const tier = portTier(scalerank);
    const color = portColor(tier);

    buckets.get(tier)!.push({
      type: "Feature",
      geometry: feat.geometry,
      properties: {
        name: p.name,
        website: p.website,
        scalerank,
        tier,
        color,
        strokeColor: color,
      },
    });
  }

  for (const [tier, features] of buckets.entries()) {
    if (features.length === 0) continue;
    const meta = PORT_META[tier]!;
    console.log(`  ${tier.padEnd(20)} ${features.length} features`);
    await publishDataset(
      signer,
      `ports-${tier}`,
      {
        type: "FeatureCollection",
        name: meta.name,
        description: meta.description,
        features,
      },
      ["ports", "maritime", "shipping", tier],
      contextCoord,
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[seed_canonical] Relay: ${RELAY_URL}`);

  await ndk.connect();
  await new Promise((r) => setTimeout(r, 800));

  const signer = new NDKPrivateKeySigner(SIGNING_KEY);
  await signer.blockUntilReady();
  const pubkey = (await signer.user()).pubkey;
  console.log(`[seed_canonical] Signing as ${pubkey.slice(0, 16)}...`);

  // Optional: --only <name> to run a single seeder (e.g. --only gas-pipelines)
  const onlyArg = (() => {
    const idx = process.argv.indexOf("--only");
    return idx !== -1 ? process.argv[idx + 1] : null;
  })();

  if (!onlyArg || onlyArg === "sea-cables") await seedSeaCables(signer, pubkey);
  if (!onlyArg || onlyArg === "meteorites")
    await seedMeteoriteLandings(signer, pubkey);
  if (!onlyArg || onlyArg === "gas-pipelines")
    await seedGasPipelines(signer, pubkey);
  if (!onlyArg || onlyArg === "liquid-pipelines")
    await seedLiquidPipelines(signer, pubkey);
  if (!onlyArg || onlyArg === "nuclear-power")
    await seedNuclearPower(signer, pubkey);
  if (!onlyArg || onlyArg === "airports") await seedAirports(signer, pubkey);
  if (!onlyArg || onlyArg === "ports") await seedPorts(signer, pubkey);

  console.log("\n[seed_canonical] All done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed_canonical] Failed:", err);
  process.exit(1);
});
