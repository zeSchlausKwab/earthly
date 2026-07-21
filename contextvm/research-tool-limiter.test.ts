import { describe, expect, test } from "bun:test";
import { ResearchToolLimiter } from "./research-tool-limiter";

describe("ResearchToolLimiter", () => {
  test("limits each client independently and refills over time", async () => {
    let now = 1_000;
    const limiter = new ResearchToolLimiter({
      burst: 2,
      refillPerMinute: 1,
      maxConcurrent: 2,
      maxClients: 10,
      now: () => now,
    });
    const operation = async () => "ok";

    expect(await limiter.run("alice", operation)).toBe("ok");
    expect(await limiter.run("alice", operation)).toBe("ok");
    expect(limiter.run("alice", operation)).rejects.toThrow("rate limit");
    expect(await limiter.run("bob", operation)).toBe("ok");

    now += 60_000;
    expect(await limiter.run("alice", operation)).toBe("ok");
  });

  test("caps global concurrent work", async () => {
    const limiter = new ResearchToolLimiter({
      burst: 10,
      refillPerMinute: 10,
      maxConcurrent: 1,
      maxClients: 10,
    });
    let release: (() => void) | undefined;
    const first = limiter.run("alice", () => new Promise<void>((resolve) => {
      release = resolve;
    }));

    expect(limiter.run("bob", async () => undefined)).rejects.toThrow("busy");
    release?.();
    await first;
  });
});
