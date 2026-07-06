/**
 * Unified seeder CLI config — argument parsing + the structural relay guard.
 *
 * The guard is the important part (docs/RELAY_STAGES.md "Seeding"): a seed run
 * that targets anything but a loopback relay is a HARD ERROR unless the caller
 * explicitly passed `--allow-remote`. This is what makes "seed data can never
 * leak to a public relay" structural instead of convention.
 */

import { devUser1 } from '@/lib/fixtures'

export const SEED_COMMANDS = ['minimal', 'full', 'sightings', 'canonical', 'purge'] as const
export type SeedCommand = (typeof SEED_COMMANDS)[number]

export const DEFAULT_RELAY_URL = 'ws://localhost:3334'

export type SeedKeySource = 'flag' | 'SEED_KEY' | 'APP_PRIVATE_KEY' | 'devUser1'

export interface SeederConfig {
	command: SeedCommand
	/** Validated relay URL (loopback unless --allow-remote). */
	relay: string
	allowRemote: boolean
	/** Hex secret key used for owner/app-signed events. */
	keyHex: string
	keySource: SeedKeySource
	/** Build + enumerate everything, publish nothing. */
	dryRun: boolean
	verbose: boolean
	/** canonical/purge: restrict to a single named sub-seeder. */
	only?: string
	/** purge: skip the interactive confirmation prompt. */
	force: boolean
}

/** Thrown for every config/guard failure — the CLI prints `.message` and exits 1. */
export class SeederConfigError extends Error {}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

/** Whether a relay URL points at this machine (localhost / 127.0.0.1 / ::1 / 0.0.0.0). */
export function isLoopbackRelayURL(url: string): boolean {
	try {
		const parsed = new URL(url)
		const host = parsed.hostname.toLowerCase()
		return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')
	} catch {
		return false
	}
}

/**
 * Structural leak guard. Returns the URL when it is safe to use; throws a
 * `SeederConfigError` for malformed URLs, non-websocket schemes, and —
 * critically — any non-loopback relay when `allowRemote` is false.
 */
export function validateRelayURL(url: string, allowRemote: boolean): string {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new SeederConfigError(`Invalid relay URL: "${url}"`)
	}
	if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
		throw new SeederConfigError(
			`Relay URL must use ws:// or wss:// (got "${parsed.protocol}//" in ${url})`,
		)
	}
	if (!isLoopbackRelayURL(url) && !allowRemote) {
		throw new SeederConfigError(
			`Refusing to seed non-local relay ${url}.\n` +
				`Seed data must stay on the local relay (docs/RELAY_STAGES.md).\n` +
				`If you REALLY mean to publish seed events to a remote relay, re-run with --allow-remote.`,
		)
	}
	return url
}

const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/i

function resolveKey(
	flagValue: string | undefined,
	command: SeedCommand,
	env: Record<string, string | undefined>,
): { keyHex: string; keySource: SeedKeySource } {
	const candidates: Array<{ value: string | undefined; source: SeedKeySource }> = [
		{ value: flagValue, source: 'flag' },
		{ value: env.SEED_KEY, source: 'SEED_KEY' },
	]
	// Back-compat: the old canonical/purge scripts signed with APP_PRIVATE_KEY.
	// Keeping it in the chain means an existing deployment can still purge the
	// data it seeded (kind-5 deletions must come from the same key).
	if (command === 'canonical' || command === 'purge') {
		candidates.push({ value: env.APP_PRIVATE_KEY, source: 'APP_PRIVATE_KEY' })
	}
	for (const { value, source } of candidates) {
		if (!value) continue
		if (!HEX_KEY_PATTERN.test(value)) {
			throw new SeederConfigError(
				`Signing key from ${source === 'flag' ? '--key' : source} is not a 64-char hex secret key.`,
			)
		}
		return { keyHex: value.toLowerCase(), keySource: source }
	}
	return { keyHex: devUser1.sk, keySource: 'devUser1' }
}

export function seederUsage(): string {
	return [
		'Usage: bun run seed <command> [flags]',
		'',
		'Commands:',
		'  minimal     profiles + one dataset (fast smoke seed)',
		'  full        rich v1.2 entity seed: groups, datasets, beacons, stories,',
		'              comment threads with geo annotations, reactions',
		'  sightings   temporal sightings (kind 37522) in all observation states',
		'  canonical   real-world datasets from base-assets/base_rips (sea cables, …)',
		'  purge       NIP-09 delete all canonical seed data signed by the key',
		'',
		'Flags:',
		'  --relay <url>     target relay (default ws://localhost:3334)',
		'  --allow-remote    REQUIRED to target a non-loopback relay (leak guard)',
		'  --key <hex>       signing key (fallback: $SEED_KEY, then devUser1;',
		'                    canonical/purge also honour $APP_PRIVATE_KEY)',
		'  --dry-run         build and list every event without publishing',
		'  --verbose         log each published event',
		'  --only <name>     canonical/purge: run a single sub-seeder',
		'  --force           purge: skip the confirmation prompt',
	].join('\n')
}

/**
 * Parse `bun run seed <command> [flags]` argv (pass `process.argv.slice(2)`).
 * Throws `SeederConfigError` on unknown commands/flags and guard violations.
 */
export function parseSeederArgs(
	argv: string[],
	env: Record<string, string | undefined> = process.env,
): SeederConfig {
	const [commandRaw, ...rest] = argv
	if (!commandRaw || commandRaw === '--help' || commandRaw === '-h' || commandRaw === 'help') {
		throw new SeederConfigError(seederUsage())
	}
	if (!(SEED_COMMANDS as readonly string[]).includes(commandRaw)) {
		throw new SeederConfigError(`Unknown command "${commandRaw}".\n\n${seederUsage()}`)
	}
	const command = commandRaw as SeedCommand

	let relay = DEFAULT_RELAY_URL
	let allowRemote = false
	let keyFlag: string | undefined
	let dryRun = false
	let verbose = false
	let only: string | undefined
	let force = false

	const takeValue = (flag: string, value: string | undefined): string => {
		if (!value || value.startsWith('--')) {
			throw new SeederConfigError(`${flag} requires a value.\n\n${seederUsage()}`)
		}
		return value
	}

	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i]
		switch (arg) {
			case '--relay':
				relay = takeValue('--relay', rest[++i])
				break
			case '--allow-remote':
				allowRemote = true
				break
			case '--key':
				keyFlag = takeValue('--key', rest[++i])
				break
			case '--dry-run':
				dryRun = true
				break
			case '--verbose':
				verbose = true
				break
			case '--only':
				only = takeValue('--only', rest[++i])
				break
			case '--force':
				force = true
				break
			default:
				throw new SeederConfigError(`Unknown flag "${arg}".\n\n${seederUsage()}`)
		}
	}

	relay = validateRelayURL(relay, allowRemote)
	const { keyHex, keySource } = resolveKey(keyFlag, command, env)

	return { command, relay, allowRemote, keyHex, keySource, dryRun, verbose, only, force }
}
