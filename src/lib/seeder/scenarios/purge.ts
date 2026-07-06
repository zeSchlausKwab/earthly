/**
 * `seed purge` — publishes NIP-09 deletion events (kind 5) for all canonical
 * seed data signed by the configured key on the target relay. Safe to run
 * multiple times — deletion events are idempotent.
 *
 * Port of the retired scripts/purge_canonical_data.ts onto the shared seeder
 * layer (applesauce relay pool, no NDK). Deletions must be signed by the SAME
 * key that seeded, which is why the key resolution honours $APP_PRIVATE_KEY
 * for this command.
 *
 * Flags: `--only <seeder>` restricts to one canonical sub-seeder's d-tag
 * prefix; `--force` skips the confirmation prompt (dry runs never prompt).
 */

import { readSync } from 'node:fs'
import type { EventTemplate, NostrEvent } from 'nostr-tools'
import { GEO_EVENT_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import type { SeederContext } from '../types'

// Known d-tag prefixes for each canonical seeder (context + datasets)
const SEEDER_PREFIXES: Record<string, string[]> = {
	'sea-cables': ['sea-cables', 'cables', 'cable-landing-points'],
	meteorites: ['meteorites'],
	'gas-pipelines': ['gas-pipelines'],
	'liquid-pipelines': ['liquid-pipelines'],
	'nuclear-power': ['nuclear-power'],
	airports: ['airports'],
	ports: ['ports'],
}

function matchesFilter(dTag: string, only: string | undefined): boolean {
	if (!only) return true
	const prefixes = SEEDER_PREFIXES[only]
	if (!prefixes) {
		throw new Error(
			`Unknown seeder "${only}". Known seeders: ${Object.keys(SEEDER_PREFIXES).join(', ')}`,
		)
	}
	return prefixes.some((prefix) => dTag === prefix || dTag.startsWith(`${prefix}-`))
}

async function confirm(message: string): Promise<boolean> {
	process.stdout.write(`${message} [y/N] `)
	const buf = Buffer.alloc(64)
	try {
		const n = readSync(process.stdin.fd, buf, 0, buf.length, null)
		if (n === 0) return false
		const answer = buf.toString('utf8', 0, n).trim().toLowerCase()
		process.stdout.write('\n')
		return answer === 'y' || answer === 'yes'
	} catch {
		return false
	}
}

interface PurgeTarget {
	id: string
	kind: number
	pubkey: string
	dTag: string
	label: string
}

export async function runPurge(ctx: SeederContext): Promise<void> {
	const { client, config, owner } = ctx
	console.log(`[purge] Relay: ${client.url}`)
	if (config.only) console.log(`[purge] Filter: --only ${config.only}`)
	console.log(`[purge] Signing as ${owner.pubkey.slice(0, 16)}... (${config.keySource})`)
	if (config.keySource === 'devUser1') {
		console.warn(
			'[purge] ⚠ Using the shared devUser1 key: this matches EVERY 37515/37518 event that\n' +
				'        key ever published (fixture seeds included), not just canonical data.\n' +
				'        Pass --key/--only, or review the preview carefully before confirming.',
		)
	}

	// ── Fetch all seeded events ──
	console.log('\n[purge] Fetching events from relay...')
	const events = await client.fetch({
		kinds: [GEO_EVENT_KIND, MAP_CONTEXT_KIND],
		authors: [owner.pubkey],
	})

	if (events.length === 0) {
		console.log('[purge] No events found on relay for this key. Nothing to delete.')
		return
	}

	// ── Build target list ──
	const targets: PurgeTarget[] = []
	for (const event of events) {
		const dTag = event.tags.find((t) => t[0] === 'd')?.[1] ?? ''
		if (!matchesFilter(dTag, config.only)) continue
		targets.push({
			id: event.id,
			kind: event.kind,
			pubkey: event.pubkey,
			dTag,
			label: `${event.kind === MAP_CONTEXT_KIND ? 'context' : 'dataset'}  ${dTag}`,
		})
	}

	if (targets.length === 0) {
		console.log(
			`[purge] No matching events found${config.only ? ` for --only ${config.only}` : ''}.`,
		)
		return
	}

	// ── Preview, grouped by seeder prefix ──
	console.log(`\n[purge] Found ${targets.length} events to delete:\n`)
	const grouped: Record<string, PurgeTarget[]> = {}
	for (const target of targets) {
		const prefix =
			Object.keys(SEEDER_PREFIXES).find(
				(p) => target.dTag === p || target.dTag.startsWith(`${p}-`),
			) ?? 'other'
		const bucket = grouped[prefix] ?? []
		bucket.push(target)
		grouped[prefix] = bucket
	}
	for (const [group, items] of Object.entries(grouped).sort()) {
		console.log(`  ${group}`)
		for (const item of items.sort((a, b) => a.dTag.localeCompare(b.dTag))) {
			console.log(`    ${item.label}`)
		}
	}
	console.log()

	// ── Confirm ──
	if (config.dryRun) {
		console.log('[purge] Dry run — enumerating deletion events without publishing.')
	} else if (!config.force) {
		const ok = await confirm(`[purge] Delete ${targets.length} events from ${client.url}?`)
		if (!ok) {
			console.log('[purge] Aborted.')
			return
		}
	}

	// ── Publish kind 5 deletions, batched to keep event size reasonable ──
	console.log('\n[purge] Publishing deletion events...')
	const BATCH = 50
	let deleted = 0
	for (let i = 0; i < targets.length; i += BATCH) {
		const batch = targets.slice(i, i + BATCH)
		const template: EventTemplate = {
			kind: 5,
			content: 'Purging canonical seed data',
			created_at: Math.floor(Date.now() / 1000),
			tags: batch.flatMap(({ id, kind, pubkey, dTag }) => [
				['e', id],
				['a', `${kind}:${pubkey}:${dTag}`],
			]),
		}
		const signed = (await owner.signer.signEvent(template)) as NostrEvent
		await client.publish(signed, `kind-5 deletion batch (${batch.length} targets)`)
		deleted += batch.length
		if (!client.dryRun) {
			process.stdout.write(`  Deleted ${deleted}/${targets.length} events...\r`)
		}
	}
	process.stdout.write('\n')

	console.log(`\n[purge] Done. Sent deletion requests for ${deleted} events.`)
	console.log(
		'[purge] Note: relay compliance with NIP-09 is required for events to be removed.\n' +
			'        The Khatru relay used by Earthly honours kind 5 deletions.',
	)
}
