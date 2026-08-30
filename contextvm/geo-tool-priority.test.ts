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

  test("treats transport as optional coverage instead of an OSM fallback trigger", () => {
    expect(serverSource).toContain(
      "The baseline snapshot covers administrative areas, localities, places, waterways, and infrastructure",
    );
    expect(serverSource).toContain("road and rail are optional coverage packs");
    expect(serverSource).toContain(
      "An unavailable road or rail kind is an intentional capability boundary, not a remote OpenStreetMap fallback signal",
    );
    expect(serverSource).toContain(
      "The intentional absence of optional road or rail packs is not a fallback signal",
    );
  });

  test("defines the Valhalla and rail-routing capability boundary", () => {
    expect(serverSource).toContain("2 to 25 coordinate waypoints");
    expect(serverSource).toContain("not a road-name search or full-relation retrieval tool");
    expect(serverSource).toContain("does not route rail");
    expect(serverSource).toContain("route_over_network");
    expect(serverSource).toContain("otherwise report it as unsupported");
  });
});
