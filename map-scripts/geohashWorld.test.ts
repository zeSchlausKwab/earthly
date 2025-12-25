import { describe, expect, test } from "bun:test";
import { estimateWorldGeohashCount, getWorldGeohashBboxes, iterateWorldGeohashBboxes } from "./geohashWorld";

describe("world geohashes", () => {
  test("estimates counts", () => {
    expect(estimateWorldGeohashCount(1)).toBe(32n);
    expect(estimateWorldGeohashCount(2)).toBe(1024n);
  });

  test("precision=1 covers world with expected corners", () => {
    const map = getWorldGeohashBboxes(1, { maxGeohashes: 32 });
    expect(map.size).toBe(32);
    expect(map.get("0")).toEqual([-180, -90, -135, -45]);
    expect(map.get("z")).toEqual([135, 45, 180, 90]);
  });

  test("iterator order is stable (south-to-north, west-to-east)", () => {
    const it = iterateWorldGeohashBboxes(1, { maxGeohashes: 32 });
    const first = it.next().value;
    expect(first).toEqual(["0", [-180, -90, -135, -45]]);

    let last: [string, [number, number, number, number]] | undefined;
    for (const item of iterateWorldGeohashBboxes(1, { maxGeohashes: 32 })) last = item;
    expect(last).toEqual(["z", [135, 45, 180, 90]]);
  });

  test("protects against accidental huge allocations", () => {
    expect(() => getWorldGeohashBboxes(7)).toThrow();
  });
});

