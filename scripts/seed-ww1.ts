#!/usr/bin/env bun
/** Add only the six synthetic WW1 demo events; never reset a relay or overwrite by default. */
import type { Filter, NostrEvent } from 'nostr-tools'
import { devIdentities } from '@/lib/seeder/identities'
import { SeedRelayClient } from '@/lib/seeder/relay/publish'
import {
	buildWw1StoryFixture,
	WW1_DEMO_DISCLAIMER,
	type Ww1StoryFixture,
} from './fixtures/ww1-story'

export const WW1_LOCAL_RELAY = 'ws://localhost:3334'

export interface Ww1SeedOptions {
	relay: string
	appUrl: string
	dryRun: boolean
	updateExisting: boolean
	format: 'md' | 'json'
	help: boolean
}

/** No --allow-remote escape hatch, credentials, proxy path, env key or relay-list expansion. */
export function validateWw1Relay(value: string): string {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new Error('The WW1 demo requires ws://localhost:3334.')
	}
	if (
		url.protocol !== 'ws:' ||
		!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
		url.port !== '3334' ||
		url.pathname !== '/' ||
		url.search ||
		url.hash ||
		url.username ||
		url.password
	) {
		throw new Error(
			'Refusing WW1 demo publication: only ws://localhost:3334 (or 127.0.0.1/[::1]) is allowed, with no path, credentials or query.',
		)
	}
	return url.href.replace(/\/$/, '')
}

function validateAppUrl(value: string): string {
	const url = new URL(value)
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	) {
		throw new Error('--app-url must be a loopback HTTP origin, for example http://localhost:3001.')
	}
	return url.origin
}

export function parseWw1SeedArgs(args: string[]): Ww1SeedOptions {
	const options: Ww1SeedOptions = {
		relay: WW1_LOCAL_RELAY,
		appUrl: 'http://localhost:3001',
		dryRun: false,
		updateExisting: false,
		format: 'md',
		help: false,
	}
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		if (!argument) continue
		if (argument === '--help' || argument === '-h') {
			options.help = true
			continue
		}
		if (argument === '--dry-run') {
			options.dryRun = true
			continue
		}
		if (argument === '--update-existing') {
			options.updateExisting = true
			continue
		}
		const [flag, ...equalsValue] = argument.split('=')
		if (!['--relay', '--app-url', '--format'].includes(flag ?? ''))
			throw new Error(`Unknown WW1 demo option: ${argument}`)
		const value = equalsValue.length ? equalsValue.join('=') : args[++index]
		if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
		if (flag === '--relay') options.relay = value
		if (flag === '--app-url') options.appUrl = value
		if (flag === '--format') {
			if (value !== 'md' && value !== 'json') throw new Error('--format must be md or json.')
			options.format = value
		}
	}
	options.relay = validateWw1Relay(options.relay)
	options.appUrl = validateAppUrl(options.appUrl)
	return options
}

export function ww1SeedUsage(): string {
	return [
		'Usage: bun scripts/seed-ww1.ts [options]',
		'',
		'Add five synthetic Maps and one Story to the existing loopback relay only.',
		'Existing identical events are skipped; differing demo addresses are protected.',
		'No relay reset, deletion, profile update, public relay or remote override.',
		'',
		'  --dry-run             Build/list the fixture offline; no network and no writes',
		'  --relay <url>         ws://localhost:3334, 127.0.0.1 or [::1] only',
		'  --app-url <origin>    Reader link origin (default http://localhost:3001)',
		'  --update-existing     Explicitly replace differing events at these six demo addresses',
		'  --format md|json      Human-readable Markdown or machine-readable JSON',
		'  --help                Show this help',
		'',
		'Examples:',
		'  bun scripts/seed-ww1.ts --dry-run --format=json',
		'  bun scripts/seed-ww1.ts --relay ws://localhost:3334',
	].join('\n')
}

export interface Ww1SeedClient {
	readonly url: string
	connect(): Promise<void>
	fetch(filters: Filter[]): Promise<NostrEvent[]>
	publish(event: NostrEvent, label?: string): Promise<void>
}

function addressOf(event: NostrEvent): string {
	const identifier = event.tags.find(([tag]) => tag === 'd')?.[1]
	if (!identifier) throw new Error('Every WW1 demo event must have a stable d-tag.')
	return `${event.kind}:${event.pubkey}:${identifier}`
}

function samePayload(left: NostrEvent, right: NostrEvent): boolean {
	return left.content === right.content && JSON.stringify(left.tags) === JSON.stringify(right.tags)
}

/** Keep the NIP-01 latest event, including its lowest-id same-timestamp tie-break. */
function latestByAddress(events: NostrEvent[]): Map<string, NostrEvent> {
	const latest = new Map<string, NostrEvent>()
	for (const event of events) {
		const address = addressOf(event)
		const previous = latest.get(address)
		if (
			!previous ||
			event.created_at > previous.created_at ||
			(event.created_at === previous.created_at && event.id < previous.id)
		)
			latest.set(address, event)
	}
	return latest
}

function urls(fixture: Ww1StoryFixture, appUrl: string) {
	return {
		reader: `${appUrl}${fixture.story.readerPath}`,
		story: `${appUrl}${fixture.story.path}`,
		maps: Object.fromEntries(
			Object.values(fixture.maps).map((map) => [map.key, `${appUrl}${map.path}`]),
		),
	}
}

/** Test seam uses a recording in-memory client; production never delegates target selection. */
export async function runWw1Seed(options: Ww1SeedOptions, providedClient?: Ww1SeedClient) {
	const relay = validateWw1Relay(options.relay)
	const appUrl = validateAppUrl(options.appUrl)
	if (providedClient && validateWw1Relay(providedClient.url) !== relay)
		throw new Error('The WW1 seed client target must match the validated relay.')
	const fixture = await buildWw1StoryFixture()
	const common = { relay, disclaimer: WW1_DEMO_DISCLAIMER, urls: urls(fixture, appUrl) }
	if (options.dryRun)
		return {
			...common,
			dryRun: true,
			added: 0,
			updated: 0,
			skipped: 0,
			planned: fixture.events.map((event) => ({
				kind: event.kind,
				address: addressOf(event),
				eventId: event.id,
			})),
		}
	const client =
		providedClient ??
		new SeedRelayClient(relay, {
			maxAttempts: 2,
			publishTimeoutMs: 8000,
			log: (line) => console.error(line),
		})
	await client.connect()
	const filters = fixture.events.map(
		(event): Filter => ({
			kinds: [event.kind],
			authors: [event.pubkey],
			'#d': [event.tags.find(([tag]) => tag === 'd')?.[1] ?? ''],
			limit: 10,
		}),
	)
	let timer: ReturnType<typeof setTimeout> | undefined
	let existing: Map<string, NostrEvent>
	try {
		existing = latestByAddress(
			await Promise.race([
				client.fetch(filters),
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(
						() =>
							reject(
								new Error('Timed out reading existing WW1 demo addresses; nothing was published.'),
							),
						8000,
					)
				}),
			]),
		)
	} finally {
		clearTimeout(timer)
	}
	const changes = fixture.events.filter((event) => {
		const current = existing.get(addressOf(event))
		return !current || !samePayload(current, event)
	})
	const conflicts = changes.filter((event) => existing.has(addressOf(event)))
	if (conflicts.length && !options.updateExisting) {
		throw new Error(
			`Existing demo events differ; nothing was published. Preserve them, or explicitly run --update-existing for these demo addresses only:\n${conflicts.map(addressOf).join('\n')}`,
		)
	}
	const { owner, contributors } = devIdentities()
	const signers = new Map(
		[owner, ...contributors].map((identity) => [identity.pubkey, identity.signer]),
	)
	let added = 0
	let updated = 0
	for (const built of changes) {
		const current = existing.get(addressOf(built))
		let event = built
		if (current) {
			const signer = signers.get(built.pubkey)
			if (!signer) throw new Error('Missing development signer for the WW1 demo event.')
			event = await signer.signEvent({
				kind: built.kind,
				content: built.content,
				tags: built.tags,
				created_at: Math.max(Math.floor(Date.now() / 1000), current.created_at + 1),
			})
		}
		await client.publish(event, addressOf(event))
		if (current) updated++
		else added++
	}
	return {
		...common,
		dryRun: false,
		added,
		updated,
		skipped: fixture.events.length - changes.length,
		planned: [],
	}
}

if (import.meta.main) {
	try {
		const options = parseWw1SeedArgs(process.argv.slice(2))
		if (options.help) console.log(ww1SeedUsage())
		else {
			const result = await runWw1Seed(options)
			console.log(
				options.format === 'json'
					? JSON.stringify(result, null, 2)
					: [
							'# WW1 synthetic styling demo',
							'',
							result.disclaimer,
							'',
							result.dryRun
								? `Offline dry run: ${result.planned.length} signed events built. The relay was not inspected or changed.`
								: `${result.added} added, ${result.updated} updated, ${result.skipped} unchanged.`,
							'',
							`- Reader: ${result.urls.reader}`,
							`- Story: ${result.urls.story}`,
							...Object.entries(result.urls.maps).map(([name, url]) => `- ${name}: ${url}`),
						].join('\n'),
			)
		}
		process.exit(0)
	} catch (error) {
		console.error(`WW1 demo seed failed: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	}
}
