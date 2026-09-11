import { describe, expect, test } from 'bun:test'
import type { Filter, NostrEvent } from 'nostr-tools'
import { devIdentities } from '@/lib/seeder/identities'
import { buildWw1StoryFixture } from './fixtures/ww1-story'
import { parseWw1SeedArgs, runWw1Seed, validateWw1Relay, type Ww1SeedClient } from './seed-ww1'

class RecordingClient implements Ww1SeedClient {
	readonly url = 'ws://localhost:3334'
	connects = 0
	filters: Filter[] = []
	writes: NostrEvent[] = []
	constructor(public events: NostrEvent[] = []) {}
	async connect() {
		this.connects++
	}
	async fetch(filters: Filter[]) {
		this.filters = filters
		return this.events
	}
	async publish(event: NostrEvent) {
		this.writes.push(event)
		this.events.push(event)
	}
}

describe('local-only additive WW1 seeder', () => {
	test('accepts only the exact loopback relay port and rejects every remote escape hatch', () => {
		for (const relay of ['ws://localhost:3334', 'ws://127.0.0.1:3334', 'ws://[::1]:3334/'])
			expect(validateWw1Relay(relay)).toBe(relay.replace(/\/$/, ''))
		for (const relay of [
			'wss://relay.example.com',
			'ws://localhost:3000',
			'ws://localhost:3001',
			'ws://0.0.0.0:3334',
			'wss://localhost:3334',
			'ws://127.0.0.1:3334/proxy',
			'ws://localhost:3334?relay=remote',
			'ws://user:secret@localhost:3334',
			'ws://localhost.example.com:3334',
		])
			expect(() => validateWw1Relay(relay)).toThrow()
		for (const args of [
			['--allow-remote'],
			['--key', 'do-not-accept-keys'],
			['--relay'],
			['--format=xml'],
			['--app-url=https://earthly.city'],
		])
			expect(() => parseWw1SeedArgs(args)).toThrow()
		expect(
			parseWw1SeedArgs([
				'--dry-run',
				'--relay=ws://localhost:3334',
				'--format',
				'json',
				'--app-url=http://localhost:3001',
			]),
		).toMatchObject({
			dryRun: true,
			relay: 'ws://localhost:3334',
			format: 'json',
			updateExisting: false,
		})
	})

	test('dry run is truly offline even if an injected client would record network calls', async () => {
		const client = new RecordingClient()
		const result = await runWw1Seed(parseWw1SeedArgs(['--dry-run']), client)
		expect(result.planned).toHaveLength(6)
		expect(result.added).toBe(0)
		expect(client.connects).toBe(0)
		expect(client.filters).toEqual([])
		expect(client.writes).toEqual([])
		expect(result.urls.reader).toStartWith('http://localhost:3001/read/naddr1')
	})

	test('adds exactly six fixture events once and publishes nothing on an unchanged rerun', async () => {
		const client = new RecordingClient()
		const options = parseWw1SeedArgs([])
		expect(await runWw1Seed(options, client)).toMatchObject({ added: 6, updated: 0, skipped: 0 })
		expect(client.writes.map((event) => event.kind)).toEqual([
			37515, 37515, 37515, 37515, 37515, 37520,
		])
		expect(client.filters).toHaveLength(6)
		for (const filter of client.filters) {
			expect(filter.authors).toHaveLength(1)
			expect(filter.kinds).toHaveLength(1)
			expect(filter['#d']?.[0]).toStartWith('ww1-demo-')
		}
		expect(await runWw1Seed(options, client)).toMatchObject({ added: 0, updated: 0, skipped: 6 })
		expect(client.writes).toHaveLength(6)
	})

	test('protects differing existing demo data before ANY publication; explicit update is strictly newer', async () => {
		const fixture = await buildWw1StoryFixture()
		const { owner } = devIdentities()
		const source = fixture.story.event
		const edited = await owner.signer.signEvent({
			kind: source.kind,
			tags: source.tags,
			content: JSON.stringify({ ...JSON.parse(source.content), title: 'My edited local demo' }),
			created_at: Math.floor(Date.now() / 1000) + 1,
		})
		const client = new RecordingClient([edited])
		await expect(runWw1Seed(parseWw1SeedArgs([]), client)).rejects.toThrow('nothing was published')
		expect(client.writes).toEqual([])
		const result = await runWw1Seed(parseWw1SeedArgs(['--update-existing']), client)
		expect(result).toMatchObject({ added: 5, updated: 1, skipped: 0 })
		const replacement = client.writes.find((event) => event.kind === source.kind)
		expect(replacement?.created_at).toBeGreaterThan(edited.created_at)
		expect(replacement?.content).toBe(source.content)
		expect(replacement?.tags).toEqual(source.tags)
		expect(await runWw1Seed(parseWw1SeedArgs([]), client)).toMatchObject({
			added: 0,
			updated: 0,
			skipped: 6,
		})
	})
})
