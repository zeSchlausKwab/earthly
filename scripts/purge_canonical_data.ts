/**
 * purge_canonical_data.ts
 *
 * Publishes NIP-09 deletion events (kind 5) for all canonical seed data
 * on a target relay. Safe to run multiple times — deletion events are idempotent.
 *
 * Usage:
 *   bun scripts/purge_canonical_data.ts [relay-url] [--only <seeder>] [--force]
 *
 * Examples:
 *   bun scripts/purge_canonical_data.ts                          # purge all from localhost
 *   bun scripts/purge_canonical_data.ts ws://my-relay.com        # purge all from remote
 *   bun scripts/purge_canonical_data.ts --only gas-pipelines     # purge one seeder
 *   bun scripts/purge_canonical_data.ts --force                  # skip confirmation prompt
 *
 * Seeder names: sea-cables, meteorites, gas-pipelines, liquid-pipelines,
 *               nuclear-power, airports, ports
 */

import NDK, { NDKEvent, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { config } from "dotenv";
import { GEO_EVENT_KIND, MAP_CONTEXT_KIND } from "@/lib/ndk/kinds";

config();

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// First non-flag arg that looks like a URL is the relay
const RELAY_URL =
  args.find((a) => a.startsWith("ws://") || a.startsWith("wss://")) ??
  "ws://localhost:3334";

const onlyIdx = args.indexOf("--only");
const onlyArg: string | null =
  onlyIdx !== -1 ? (args[onlyIdx + 1] ?? null) : null;
const force = args.includes("--force");

const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY;
if (!APP_PRIVATE_KEY) {
  console.error("[purge] Missing APP_PRIVATE_KEY in environment");
  process.exit(1);
}

const ndk = new NDK({
  explicitRelayUrls: [RELAY_URL],
  enableOutboxModel: false,
});

// Known d-tag prefixes for each seeder (context + datasets)
const SEEDER_PREFIXES: Record<string, string[]> = {
  "sea-cables": ["sea-cables"],
  meteorites: ["meteorites"],
  "gas-pipelines": ["gas-pipelines"],
  "liquid-pipelines": ["liquid-pipelines"],
  "nuclear-power": ["nuclear-power"],
  airports: ["airports"],
  ports: ["ports"],
};

function matchesFilter(dTag: string): boolean {
  if (!onlyArg) return true;
  const prefixes = SEEDER_PREFIXES[onlyArg];
  if (!prefixes) {
    console.error(`[purge] Unknown seeder: ${onlyArg}`);
    console.error(
      `        Known seeders: ${Object.keys(SEEDER_PREFIXES).join(", ")}`,
    );
    process.exit(1);
  }
  return prefixes.some((p) => dTag === p || dTag.startsWith(`${p}-`));
}

// ── Confirm prompt ────────────────────────────────────────────────────────────

async function confirm(message: string): Promise<boolean> {
  process.stdout.write(`${message} [y/N] `);
  const buf = Buffer.alloc(64);
  const fd = process.stdin.fd;
  try {
    const n = require("fs").readSync(fd, buf, 0, buf.length, null);
    if (n === 0) return false;
    const ch = buf.toString("utf8", 0, n).trim().toLowerCase();
    process.stdout.write("\n");
    return ch === "y" || ch === "yes";
  } catch {
    return false;
  }
}

// ── Publish deletion events ───────────────────────────────────────────────────

const PUBLISH_TIMEOUT_MS = 20_000;

async function publishWithRetry(event: NDKEvent, maxAttempts = 5): Promise<void> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await event.publish(undefined, PUBLISH_TIMEOUT_MS);
      return;
    } catch (err) {
      const isLast = attempt === maxAttempts;
      const msg = err instanceof Error ? err.message : String(err);
      if (isLast) throw err;
      const wait = 4000 * attempt;
      console.warn(`\n  [retry] attempt ${attempt} failed: ${msg.slice(0, 80)}`);
      console.warn(`  [retry] reconnecting in ${wait}ms...`);
      await delay(wait);
      for (const relay of ndk.pool.relays.values()) {
        try { relay.disconnect(); } catch { /* ignore */ }
      }
      await delay(1000);
      await ndk.connect();
      await delay(2000);
    }
  }
}

/**
 * NIP-09: publish kind 5 deletion events.
 * Batches into groups of 50 addressable tags to keep event size reasonable.
 */
async function publishDeletions(
  signer: NDKPrivateKeySigner,
  targets: Array<{ id: string; kind: number; pubkey: string; dTag: string }>,
): Promise<number> {
  const BATCH = 50;
  let deleted = 0;

  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);

    const event = new NDKEvent(ndk);
    event.kind = 5;
    event.content = "Purging canonical seed data";
    event.created_at = Math.floor(Date.now() / 1000);
    event.tags = batch.flatMap(({ id, kind, pubkey, dTag }) => [
      ["e", id],
      ["a", `${kind}:${pubkey}:${dTag}`],
    ]);

    await event.sign(signer);
    await publishWithRetry(event);
    deleted += batch.length;
    process.stdout.write(`  Deleted ${deleted}/${targets.length} events...\r`);
  }

  process.stdout.write("\n");
  return deleted;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[purge] Relay: ${RELAY_URL}`);
  if (onlyArg) console.log(`[purge] Filter: --only ${onlyArg}`);

  await ndk.connect();
  await new Promise((r) => setTimeout(r, 800));

  const signer = new NDKPrivateKeySigner(APP_PRIVATE_KEY!);
  await signer.blockUntilReady();
  const pubkey = (await signer.user()).pubkey;
  console.log(`[purge] Signing as ${pubkey.slice(0, 16)}...`);

  // ── Fetch all seeded events ──
  console.log("\n[purge] Fetching events from relay...");

  const events = await ndk.fetchEvents({
    kinds: [GEO_EVENT_KIND, MAP_CONTEXT_KIND],
    authors: [pubkey],
  });

  if (events.size === 0) {
    console.log(
      "[purge] No events found on relay for this key. Nothing to delete.",
    );
    process.exit(0);
  }

  // ── Build target list ──
  const targets: Array<{
    id: string;
    kind: number;
    pubkey: string;
    dTag: string;
    label: string;
  }> = [];

  for (const ev of events) {
    const dTag = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
    if (!matchesFilter(dTag)) continue;
    targets.push({
      id: ev.id!,
      kind: ev.kind!,
      pubkey: ev.pubkey,
      dTag,
      label: `${ev.kind === MAP_CONTEXT_KIND ? "context" : "dataset"}  ${dTag}`,
    });
  }

  if (targets.length === 0) {
    console.log(
      `[purge] No matching events found${onlyArg ? ` for --only ${onlyArg}` : ""}.`,
    );
    process.exit(0);
  }

  // ── Preview ──
  console.log(`\n[purge] Found ${targets.length} events to delete:\n`);

  // Group by seeder prefix for a clean summary
  const grouped: Record<string, typeof targets> = {};
  for (const t of targets) {
    const prefix =
      Object.keys(SEEDER_PREFIXES).find(
        (p) => t.dTag === p || t.dTag.startsWith(`${p}-`),
      ) ?? "other";
    (grouped[prefix] ??= []).push(t);
  }

  for (const [group, items] of Object.entries(grouped).sort()) {
    console.log(`  ${group}`);
    for (const item of items.sort((a, b) => a.dTag.localeCompare(b.dTag))) {
      console.log(`    ${item.label}`);
    }
  }

  console.log();

  // ── Confirm ──
  if (!force) {
    const ok = await confirm(
      `[purge] Delete ${targets.length} events from ${RELAY_URL}?`,
    );
    if (!ok) {
      console.log("[purge] Aborted.");
      process.exit(0);
    }
  }

  // ── Publish kind 5 deletions ──
  console.log("\n[purge] Publishing deletion events...");
  const deleted = await publishDeletions(signer, targets);

  console.log(`\n[purge] Done. Sent deletion requests for ${deleted} events.`);
  console.log(
    "[purge] Note: relay compliance with NIP-09 is required for events to be removed.\n" +
      "        The Khatru relay used by Earthly honours kind 5 deletions.",
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("[purge] Failed:", err);
  process.exit(1);
});
