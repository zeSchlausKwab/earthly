#!/usr/bin/env bun
/**
 * Unified seeding CLI — the single entry point for every seed flavour.
 *
 *   bun run seed <command> [flags]
 *
 * Commands: minimal | full | sightings | canonical | purge
 * Flags:    --relay <url> --allow-remote --key <hex> --dry-run --verbose
 *           --only <name> (canonical/purge) --force (purge)
 *
 * The structural leak guard lives in the config parser: a non-loopback
 * --relay without --allow-remote is a hard error before anything runs.
 * See docs/RELAY_STAGES.md § Seeding and src/lib/seeder/ for the layers.
 */

import { parseSeederArgs, SeederConfigError, seederUsage } from '@/lib/seeder/config'
import { identityFromHex } from '@/lib/seeder/identities'
import { SeedRelayClient } from '@/lib/seeder/relay/publish'
import { runCanonical } from '@/lib/seeder/scenarios/canonical'
import { runFull } from '@/lib/seeder/scenarios/full'
import { runMinimal } from '@/lib/seeder/scenarios/minimal'
import { runPurge } from '@/lib/seeder/scenarios/purge'
import { runSightings } from '@/lib/seeder/scenarios/sightings'
import type { SeederContext, SeedScenario } from '@/lib/seeder/types'

const SCENARIOS: Record<string, SeedScenario> = {
	minimal: runMinimal,
	full: runFull,
	sightings: runSightings,
	canonical: runCanonical,
	purge: runPurge,
}

async function main(): Promise<void> {
	let config: ReturnType<typeof parseSeederArgs>
	try {
		config = parseSeederArgs(process.argv.slice(2))
	} catch (err) {
		if (err instanceof SeederConfigError) {
			console.error(err.message)
			process.exit(1)
		}
		throw err
	}

	const scenario = SCENARIOS[config.command]
	if (!scenario) {
		// unreachable — parseSeederArgs validates the command — but keeps ts honest
		console.error(seederUsage())
		process.exit(1)
	}

	const client = new SeedRelayClient(config.relay, {
		dryRun: config.dryRun,
		verbose: config.verbose,
	})
	const owner = identityFromHex(config.keyHex, 'Earthly Curator')
	const ctx: SeederContext = { config, client, owner }

	if (config.dryRun) {
		console.log(`[seed] DRY RUN — nothing will be published (target: ${config.relay})`)
	}
	if (config.allowRemote && !config.dryRun) {
		console.log(`[seed] ⚠ --allow-remote: publishing to NON-LOCAL relay ${config.relay}`)
	}

	await client.connect()
	await scenario(ctx)

	console.log(`\n[seed] ${config.dryRun ? 'Dry run complete' : 'Done'}: ${client.summary()}`)
	process.exit(0)
}

main().catch((err) => {
	console.error('[seed] Failed:', err instanceof Error ? err.message : err)
	process.exit(1)
})
