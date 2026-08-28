import { describe, expect, test } from "bun:test";

const serverSource = await Bun.file(
  new URL("./server.ts", import.meta.url),
).text();

describe("ContextVM geography source priority", () => {
  test("advertises the local catalog before remote OSM fallbacks", () => {
    expect(serverSource).toContain("Use query_geography first");
    expect(serverSource).toContain("do not call this merely to verify a catalog match");
    expect(serverSource.match(/Remote Overpass last resort/g)).toHaveLength(2);
    expect(serverSource).toContain("Use directly for an exact user-supplied OSM id");
    expect(serverSource).toContain(
      "Use directly only for a user-supplied OSM relation id",
    );
    expect(serverSource).toContain(
      "Compatibility fallback for a country administrative boundary absent from query_geography",
    );
  });
});
