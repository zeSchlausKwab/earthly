const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export type WorldGeohashOptions = {
  maxGeohashes?: number | bigint;
};

export function estimateWorldGeohashCount(precision: number): bigint {
  if (!Number.isInteger(precision) || precision <= 0) {
    throw new Error(`precision must be a positive integer; got ${precision}`);
  }

  return 32n ** BigInt(precision);
}

export function getWorldGeohashes(precision: number, options: WorldGeohashOptions = {}): string[] {
  const geohashes: string[] = [];
  for (const geohash of iterateWorldGeohashes(precision, options)) geohashes.push(geohash);
  return geohashes;
}

export function getWorldGeohashBboxes(
  precision: number,
  options: WorldGeohashOptions = {},
): Map<string, BBox> {
  const map = new Map<string, BBox>();
  for (const [geohash, bbox] of iterateWorldGeohashBboxes(precision, options)) map.set(geohash, bbox);
  return map;
}

export function* iterateWorldGeohashes(
  precision: number,
  options: WorldGeohashOptions = {},
): Generator<string, void, void> {
  for (const [geohash] of iterateWorldGeohashBboxes(precision, options)) yield geohash;
}

export function* iterateWorldGeohashBboxes(
  precision: number,
  options: WorldGeohashOptions = {},
): Generator<[geohash: string, bbox: BBox], void, void> {
  if (!Number.isInteger(precision) || precision <= 0) {
    throw new Error(`precision must be a positive integer; got ${precision}`);
  }

  const maxGeohashes = options.maxGeohashes ?? 1_000_000;
  const estimated = estimateWorldGeohashCount(precision);
  const maxAsBigInt = typeof maxGeohashes === "bigint" ? maxGeohashes : BigInt(maxGeohashes);
  if (estimated > maxAsBigInt) {
    throw new Error(
      `precision ${precision} implies ${estimated.toString()} geohashes; ` +
        `raise options.maxGeohashes or use a smaller precision`,
    );
  }

  const totalBits = precision * 5;
  const lonBits = Math.ceil(totalBits / 2);
  const latBits = Math.floor(totalBits / 2);

  const lonCells = 2 ** lonBits;
  const latCells = 2 ** latBits;

  const lonStep = 360 / lonCells;
  const latStep = 180 / latCells;

  for (let latIndex = 0; latIndex < latCells; latIndex++) {
    const minLat = -90 + latIndex * latStep;
    const maxLat = minLat + latStep;

    for (let lonIndex = 0; lonIndex < lonCells; lonIndex++) {
      const minLon = -180 + lonIndex * lonStep;
      const maxLon = minLon + lonStep;

      const geohash = encodeGeohashFromIndices({ precision, totalBits, lonBits, latBits, lonIndex, latIndex });
      yield [geohash, [minLon, minLat, maxLon, maxLat]];
    }
  }
}

function encodeGeohashFromIndices(args: {
  precision: number;
  totalBits: number;
  lonBits: number;
  latBits: number;
  lonIndex: number;
  latIndex: number;
}): string {
  const { precision, totalBits, lonBits, latBits, lonIndex, latIndex } = args;

  let lonPos = 0;
  let latPos = 0;

  let currentCharValue = 0;
  let bitsInCurrentChar = 0;

  let out = "";

  for (let bitIndex = 0; bitIndex < totalBits; bitIndex++) {
    const isLonBit = bitIndex % 2 === 0;

    let bit = 0;
    if (isLonBit) {
      const shift = lonBits - 1 - lonPos;
      bit = (lonIndex >> shift) & 1;
      lonPos++;
    } else {
      const shift = latBits - 1 - latPos;
      bit = (latIndex >> shift) & 1;
      latPos++;
    }

    currentCharValue = (currentCharValue << 1) | bit;
    bitsInCurrentChar++;

    if (bitsInCurrentChar === 5) {
      out += BASE32[currentCharValue]!;
      currentCharValue = 0;
      bitsInCurrentChar = 0;
    }
  }

  if (out.length !== precision) {
    throw new Error(`internal error: expected geohash length ${precision}, got ${out.length}`);
  }

  return out;
}

