export interface ResearchToolLimiterOptions {
  burst: number;
  refillPerMinute: number;
  maxConcurrent: number;
  maxClients: number;
  now?: () => number;
}

interface ClientBucket {
  tokens: number;
  updatedAt: number;
}

export class ResearchToolLimiter {
  private readonly buckets = new Map<string, ClientBucket>();
  private active = 0;
  private readonly now: () => number;

  constructor(private readonly options: ResearchToolLimiterOptions) {
    this.now = options.now || Date.now;
  }

  async run<T>(clientPubkey: string, operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.options.maxConcurrent) {
      throw new Error("Research tools are busy. Retry shortly.");
    }

    const now = this.now();
    const key = clientPubkey || "unknown-client";
    const existing = this.buckets.get(key);
    const replenished = existing
      ? Math.min(
        this.options.burst,
        existing.tokens +
          ((now - existing.updatedAt) * this.options.refillPerMinute) / 60_000,
      )
      : this.options.burst;
    if (replenished < 1) {
      throw new Error("Research tool rate limit exceeded. Retry later.");
    }
    this.buckets.delete(key);
    this.buckets.set(key, { tokens: replenished - 1, updatedAt: now });
    while (this.buckets.size > this.options.maxClients) {
      const oldestKey = this.buckets.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.buckets.delete(oldestKey);
    }

    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
    }
  }
}

export const researchToolLimiter = new ResearchToolLimiter({
  burst: 20,
  refillPerMinute: 30,
  maxConcurrent: 8,
  maxClients: 2_000,
});
