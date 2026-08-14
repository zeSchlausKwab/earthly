import { describe, expect, test } from "bun:test";

const serverSource = await Bun.file(
  new URL("./server.ts", import.meta.url),
).text();

describe("ContextVM oversized tool responses", () => {
  test("leaves complete results for CEP-22 instead of truncating them in handlers", () => {
    expect(serverSource).not.toContain("TRANSPORT_RESPONSE_BUDGET_BYTES");
    expect(serverSource).not.toContain("fitQueryByIdForTransport");
    expect(serverSource).not.toContain("fitQueryFeaturesForTransport");
    expect(serverSource).not.toContain("response truncated for transport");
  });

  test("keeps CEP-22 explicitly enabled on the server transport", () => {
    const transportOptions = serverSource.match(
      /new NostrServerTransport\(\{([\s\S]*?)\n  \}\);/,
    )?.[1];

    expect(transportOptions).toBeDefined();
    expect(transportOptions).toContain("oversizedTransfer: { enabled: true }");
  });
});
