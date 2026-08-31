import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeSqliteGeoCatalogSnapshot } from '../../contextvm/geocatalog/sqlite'
import type {
	GeoCatalogEntry,
	GeoCatalogKind,
	GeoCatalogSnapshotMetadata,
} from '../../contextvm/geocatalog/types'

const repositoryRoot = join(import.meta.dir, '../..')
const temporaryDirectories: string[] = []

async function writeExecutable(path: string, content: string): Promise<void> {
	await mkdir(join(path, '..'), { recursive: true })
	await writeFile(path, content)
	await chmod(path, 0o755)
}

function geoCatalogPreflightSource(activate: string): string {
	const startMarker = `echo "Checking the production GeoCatalog snapshot..."\nif ! (cd "$new_release" && bun --env-file=.env -e '\n`
	const start = activate.indexOf(startMarker)
	if (start < 0) throw new Error('Activation GeoCatalog preflight start was not found')
	const sourceStart = start + startMarker.length
	const sourceEnd = activate.indexOf("\n'); then", sourceStart)
	if (sourceEnd < 0) throw new Error('Activation GeoCatalog preflight end was not found')
	return activate.slice(sourceStart, sourceEnd)
}

function embeddedBunSource(shell: string, functionName: string): string {
	const functionStart = shell.indexOf(`${functionName}() {`)
	if (functionStart < 0) throw new Error(`${functionName} was not found`)
	const sourceMarker = "    bun -e '\n"
	const sourceMarkerStart = shell.indexOf(sourceMarker, functionStart)
	if (sourceMarkerStart < 0) throw new Error(`${functionName} Bun source start was not found`)
	const sourceStart = sourceMarkerStart + sourceMarker.length
	const sourceEnd = shell.indexOf("\n    '\n}", sourceStart)
	if (sourceEnd < 0) throw new Error(`${functionName} Bun source end was not found`)
	return shell.slice(sourceStart, sourceEnd)
}

function geoCatalogStatusSource(manager: string): string {
	const sourceMarker = `STATE_FILE="$state_file" PROGRESS_FILE="$progress_file" bun -e '\n`
	const sourceMarkerStart = manager.indexOf(sourceMarker)
	if (sourceMarkerStart < 0) throw new Error('GeoCatalog status source start was not found')
	const sourceStart = sourceMarkerStart + sourceMarker.length
	const sourceEnd = manager.indexOf("\n    '\n  else", sourceStart)
	if (sourceEnd < 0) throw new Error('GeoCatalog status source end was not found')
	return manager.slice(sourceStart, sourceEnd)
}

function geoCatalogHealthWaitSource(manager: string): string {
	const start = manager.indexOf('contextvm_health_timeout_seconds() {')
	if (start < 0) throw new Error('GeoCatalog ContextVM health wait was not found')
	const end = manager.indexOf('\nrestart_contextvm_and_wait() {', start)
	if (end < 0) throw new Error('GeoCatalog ContextVM health wait end was not found')
	return manager.slice(start, end)
}

async function runEmbeddedBun(source: string, env: Record<string, string>) {
	const child = Bun.spawn([process.execPath, '-e', source], {
		cwd: repositoryRoot,
		env: { ...process.env, ...env },
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	])
	return { exitCode, stdout, stderr }
}

async function runGeoCatalogPreflight(source: string, catalogPath: string) {
	const child = Bun.spawn([process.execPath, '-e', source], {
		cwd: repositoryRoot,
		env: {
			...process.env,
			NODE_ENV: 'production',
			GEOCATALOG_PATH: catalogPath,
		},
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	])
	return { exitCode, stdout, stderr }
}

const catalogSnapshot: GeoCatalogSnapshotMetadata = {
	id: 'activation-test-2026-08-29',
	createdAt: '2026-08-29T00:00:00.000Z',
	schemaVersion: 1,
	sources: [{ name: 'Overture Maps', release: '2026-08-20.0' }],
}

const catalogEntry: GeoCatalogEntry = {
	id: 'admin:at',
	kind: 'admin',
	name: 'Austria',
	aliases: [],
	categories: ['country'],
	countryCode: 'AT',
	adminLevel: 0,
	bbox: [9.53, 46.37, 17.16, 49.02],
	center: { longitude: 14.13, latitude: 47.59 },
	importance: 100,
	source: { name: 'Overture Maps', release: '2026-08-20.0' },
	properties: {},
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('production deployment runtime', () => {
	test('uses one PM2 definition for the four HTTP and worker processes', async () => {
		const config = await Bun.file(join(repositoryRoot, 'ops/vps/services.config.cjs')).text()
		for (const service of [
			'earthly-web',
			'earthly-contextvm',
			'earthly-mapnolia',
			'earthly-relay',
		]) {
			expect(config).toContain(service)
		}
		expect(config).not.toContain('earthly-cordn')
		expect(config).toContain("exec_mode: 'fork'")
	})

	test('verifies and stages releases before activation', async () => {
		const deploy = await Bun.file(join(repositoryRoot, 'ops/vps/deploy.sh')).text()
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()

		expect(deploy).toContain('git ls-files --cached --others --exclude-standard')
		expect(deploy).toContain('archive_sha256')
		expect(deploy).toContain('sha256_file .env.production')
		expect(deploy).toContain('sha256_file ops/vps/activate.sh')
		expect(deploy).toContain("sha256sum -c '$remote_checksum'")
		expect(deploy).toContain("grep -qi '^bsdtar'")
		expect(activate).toContain('sha256sum -c')
		expect(activate).toContain('release_root="$app_root/releases"')
		expect(activate).toContain('restoring the previous runtime')
		expect(activate).toContain('bash "$new_release/ops/vps/runtime.sh" restart "$old_release"')
		const rollback = await Bun.file(join(repositoryRoot, 'ops/vps/rollback.sh')).text()
		expect(rollback).toContain('No retained previous release is available')
		expect(rollback).toContain('runtime_controller="$current_release/ops/vps/runtime.sh"')
	})

	test('audits Caddy without letting an application deploy replace it', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()
		const setup = await Bun.file(join(repositoryRoot, 'ops/vps/setup.sh')).text()

		expect(activate).not.toContain('/etc/caddy/Caddyfile')
		expect(setup).toContain('caddy adapt --config /etc/caddy/Caddyfile')
		expect(setup).toContain('systemctl is-active --quiet caddy')
		expect(setup).not.toContain('sudo -n')
	})

	test('pins Mapnolia and PMTiles rather than following latest', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()
		const pmtiles = await Bun.file(join(repositoryRoot, 'scripts/ensure-pmtiles.sh')).text()

		expect(activate).toContain('mapnolia_version="v0.1.3"')
		expect(activate).not.toContain('/releases/latest/')
		expect(pmtiles).toContain('PMTILES_VERSION="1.29.1"')
		expect(pmtiles).toContain('archive_sha256=')
	})

	test('bootstraps a pinned uv before GeoCatalog can use it', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()
		const deploy = await Bun.file(join(repositoryRoot, 'ops/vps/deploy.sh')).text()
		const geocatalog = await Bun.file(join(repositoryRoot, 'ops/vps/geocatalog.sh')).text()
		const setup = await Bun.file(join(repositoryRoot, 'ops/vps/setup.sh')).text()
		const uv = await Bun.file(join(repositoryRoot, 'scripts/ensure-uv.sh')).text()
		const extraction = activate.indexOf('tar -xzf "$archive_path" -C "$new_release"')
		const bootstrap = activate.indexOf('bash "$new_release/scripts/ensure-uv.sh"')
		const dependencyInstall = activate.indexOf('Installing frozen production dependencies')
		const cleanupTrap = activate.indexOf('trap cleanup_activation EXIT')
		const prerequisiteAudit = activate.indexOf('for command_name in')
		const remoteBootstrap = deploy.indexOf('bash -s --')
		const productionBuild = deploy.indexOf('Building the production browser bundle')

		expect(extraction).toBeGreaterThan(-1)
		expect(bootstrap).toBeGreaterThan(extraction)
		expect(dependencyInstall).toBeGreaterThan(bootstrap)
		expect(remoteBootstrap).toBeGreaterThan(-1)
		expect(productionBuild).toBeGreaterThan(remoteBootstrap)
		expect(cleanupTrap).toBeGreaterThan(-1)
		expect(prerequisiteAudit).toBeGreaterThan(cleanupTrap)
		expect(activate.slice(0, extraction)).not.toMatch(/\buv\b/u)
		expect(activate).toContain('export PATH="$shared_dir/bin:$PATH"')
		expect(geocatalog).toContain('export PATH="$shared_dir/bin:$PATH"')
		expect(setup).not.toContain('docker uv flock')
		expect(uv).toContain('UV_VERSION="')
		expect(uv).toContain('archive_sha256=')
		expect(uv).toContain('installed_version="$("$candidate" --version)"')
		expect(uv).not.toContain('/releases/latest/')
	})

	test('does not duplicate a legacy Mapnolia tile store during first activation', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()

		expect(activate).toContain('Referenced existing persistent Mapnolia data without copying it')
		expect(activate).not.toContain('cp -a -- "$app_root/mapnolia-data/."')
		expect(activate).toContain('Both legacy and shared Mapnolia directories contain data')
	})

	test('stages persistent migrations and replaces setup-created empty directories', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()

		expect(activate).toContain('target.migrating-$release_id')
		expect(activate).toContain('if [[ "$target_is_empty" == "true" ]]')
		expect(activate).toContain('mv "$staging_path" "$target"')
	})

	test('allows only a missing GeoCatalog during bootstrap before starting the release', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()
		const dataLink = activate.indexOf(
			'link_shared "$persistent_data_root" "$new_release/data"',
		)
		const environmentValidation = activate.indexOf('scripts/validate-production-env.ts')
		const catalogPreflight = activate.indexOf('preflightGeoCatalog({')
		const runtimeStart = activate.indexOf(
			'bash "$new_release/ops/vps/runtime.sh" restart "$new_release"',
		)

		expect(dataLink).toBeGreaterThan(-1)
		expect(environmentValidation).toBeGreaterThan(dataLink)
		expect(catalogPreflight).toBeGreaterThan(environmentValidation)
		expect(runtimeStart).toBeGreaterThan(catalogPreflight)
		expect(activate).toContain('import("./src/config/env.server.ts")')
		expect(activate).toContain('import("./contextvm/geocatalog/index.ts")')
		expect(activate).toContain(
			'openSqliteGeoCatalog({ path: serverConfig.geoCatalogPath })',
		)
		expect(activate).toContain('required: true')
		expect(activate).toContain('allowUnavailable: true')
		expect(activate).toContain(
			'GeoCatalog production preflight failed; refusing to start release',
		)
	})

	test('normalizes an accidental Valhalla endpoint before checking status', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()

		expect(activate).toContain(
			'locate|route|isochrone|sources_to_targets|optimized_route|trace_route|trace_attributes|status|height|expansion|tile',
		)
		expect(activate).toContain('.replace(/\\/+$/u, "")')
		expect(activate).toContain('curl -fsS --max-time 15 "$valhalla_url/status"')
	})

	test('the activation preflight accepts a missing snapshot but rejects invalid states', async () => {
		await mkdir(join(repositoryRoot, '.cache'), { recursive: true })
		const fixtureRoot = await mkdtemp(join(repositoryRoot, '.cache', 'activation-geocatalog-'))
		temporaryDirectories.push(fixtureRoot)
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()
		const source = geoCatalogPreflightSource(activate)
		const invalidPath = join(fixtureRoot, 'invalid.sqlite')
		const emptyPath = join(fixtureRoot, 'empty.sqlite')
		const danglingPath = join(fixtureRoot, 'dangling.sqlite')
		await writeFile(invalidPath, 'not a GeoCatalog snapshot')
		await symlink(join(fixtureRoot, 'absent-target.sqlite'), danglingPath)
		await writeSqliteGeoCatalogSnapshot({
			path: emptyPath,
			snapshot: catalogSnapshot,
			entries: [],
		})

		const missing = await runGeoCatalogPreflight(
			source,
			join(fixtureRoot, 'missing.sqlite'),
		)
		expect(missing).toEqual({
			exitCode: 0,
			stdout: 'GeoCatalog unavailable: the release will start in bootstrap mode\n',
			stderr: '',
		})

		const scenarios = [
			{ path: invalidPath, expected: 'Cannot open GeoCatalog snapshot' },
			{ path: emptyPath, expected: 'contains no queryable entries' },
			{ path: danglingPath, expected: 'dangling symbolic link' },
		]
		for (const scenario of scenarios) {
			const result = await runGeoCatalogPreflight(source, scenario.path)
			expect(result.exitCode).not.toBe(0)
			expect(result.stderr).toContain(scenario.expected)
		}
	})

	test('queues GeoCatalog after runtime health but before publishing the release', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()
		const runtimeStart = activate.indexOf(
			'bash "$new_release/ops/vps/runtime.sh" restart "$new_release"',
		)
		const currentSwitch = activate.indexOf('ln -sfn "$new_release" "$app_root/current"')
		const activationComplete = activate.indexOf('activation_complete=true')
		const catalogManager = activate.indexOf(
			'bash "$new_release/ops/vps/geocatalog.sh"',
		)

		expect(runtimeStart).toBeGreaterThan(-1)
		expect(catalogManager).toBeGreaterThan(runtimeStart)
		expect(currentSwitch).toBeGreaterThan(catalogManager)
		expect(currentSwitch).toBeGreaterThan(-1)
		expect(activationComplete).toBeGreaterThan(currentSwitch)
		expect(activate).toContain(
			'GeoCatalog worker could not be queued; restoring the previous runtime',
		)
	})

	test('runs a durable transport-free GeoCatalog worker with observable progress', async () => {
		const manager = await Bun.file(join(repositoryRoot, 'ops/vps/geocatalog.sh')).text()
		const activeValidation = manager.indexOf(
			'verify_target_snapshot "$target_snapshot" "$active_release"',
		)
		const targetPromotion = manager.indexOf(
			'replace_catalog_link "snapshots/$snapshot_id.sqlite" "promote"',
		)
		const activationStart = manager.indexOf('activate_catalog() {')
		const activationEnd = manager.indexOf('\nshow_status() {', activationStart)
		const activation = manager.slice(activationStart, activationEnd)

		expect(manager).toContain(
			'SOURCE_TYPES=(division_area division place water infrastructure)',
		)
		expect(manager).not.toContain('SOURCE_TYPES=(division_area division place segment')
		expect(manager).toContain('pm2 start "$worker/ops/vps/geocatalog.sh"')
		expect(manager).toContain('GEOCATALOG_RESERVE_FREE_GIB="$reserve_free_gib"')
		expect(manager).toContain('--no-autorestart')
			expect(manager).toContain('exec 9>"$catalog_dir/build.lock"')
			expect(manager).toContain('flock -n 9')
			expect(manager).toContain('(set -e; run_pipeline "$worker")')
			expect(manager).toContain('if [[ "$exit_status" -ne 0 ]]')
			expect(manager).toContain('exec 8>"$catalog_dir/build.lock"')
			expect(manager).toContain('wait for it to finish before rolling back')
			expect(manager).toContain('would be pruned: $catalog_path')
		expect(manager).toContain('--progress-file "$progress_file"')
		expect(manager).toContain('Reusing verified $source_type checkpoint')
		expect(manager).toContain(
			'replace_catalog_link "snapshots/$snapshot_id.sqlite" "promote"',
		)
		expect(manager).toContain('Target snapshot is already active; preserving')
		expect(manager).toContain('verify_target_snapshot "$target_snapshot" "$worker"')
		expect(manager).toContain('pm2 restart "$CONTEXTVM_NAME" --update-env')
		expect(manager).toContain('ContextVM is online and healthy')
		expect(manager).toContain('GEOCATALOG_CONTEXTVM_HEALTH_TIMEOUT_SECONDS')
		expect(manager).toContain('value < 10 || value > 900')
		expect(manager).not.toContain('for attempt in {1..20}')
		expect(manager).toContain('matches[0]?.pm2_env?.pm_cwd')
		expect(manager).toContain('require_contextvm_catalog_path "$active_release" || return 1')
		expect(manager).toContain(
			"not this job's $catalog_path; refusing GeoCatalog promotion or readiness",
		)
		expect(manager).toContain('verify_target_snapshot "$catalog_path" "$active_release"')
		expect(activeValidation).toBeGreaterThan(-1)
		expect(targetPromotion).toBeGreaterThan(activeValidation)
		expect(activation).toContain('exec 9>"$catalog_dir/build.lock"')
		expect(activation).toContain('activate_target_snapshot "$target_snapshot" "$worker"')
		expect(activation).not.toContain('verify_checkpoint')
		expect(activation).not.toContain('run_pipeline')
		expect(manager).not.toContain('pm2 restart earthly-web')
		expect(manager).toContain('GeoCatalog is ready; no background build was requested')
		expect(manager).toContain('GeoCatalog target $snapshot_id is already ready')
		expect(manager).toContain('GeoCatalog exists but is invalid; refusing to hide corruption')
		expect(manager).toContain('refusing to discard requested target $snapshot_id')
		expect(manager).toContain('worker is running without readable target state')
		expect(manager).toContain('the newly started worker was stopped')
		expect(manager).toContain('the prior snapshot was restored and ContextVM recovered')
		expect(manager).toContain('no distinct valid previous snapshot can compensate')
		expect(manager).toContain('Retained previous GeoCatalog snapshot failed production validation')
		expect(manager).toContain('the original catalog link was restored and ContextVM recovered')
		expect(manager).toContain('Build: ${state.state} / ${state.phase}')
		expect(manager).toContain('state.finishedAt ? Date.parse(state.finishedAt) : Date.now()')
		expect(manager).toContain('Elapsed: ${hours}h ${minutes}m')
		expect(manager).toContain('Failure: ${details.join("; ")')
		expect(manager).toContain('Exporting $source_type $source_index/$source_count')
		expect(manager).toContain('tail -n 100 -F')
	})

	test('accepts a slow ContextVM startup only after stable observations and times out at the configured bound', async () => {
		await mkdir(join(repositoryRoot, '.cache'), { recursive: true })
		const fixtureRoot = await mkdtemp(join(repositoryRoot, '.cache', 'geocatalog-health-'))
		temporaryDirectories.push(fixtureRoot)
		const manager = await Bun.file(join(repositoryRoot, 'ops/vps/geocatalog.sh')).text()
		const source = geoCatalogHealthWaitSource(manager)
		const activeRelease = join(fixtureRoot, 'active-release')
		const clockPath = join(fixtureRoot, 'clock')
		const countPath = join(fixtureRoot, 'count')
		const scenarioPath = join(fixtureRoot, 'scenario.sh')
		await mkdir(activeRelease, { recursive: true })

		const runScenario = async (timeout: number, observationBody: string) => {
			await writeFile(
				join(activeRelease, '.env'),
				`GEOCATALOG_CONTEXTVM_HEALTH_TIMEOUT_SECONDS=${timeout}\n`,
			)
			await writeFile(clockPath, '0\n')
			await writeFile(countPath, '0\n')
			await writeFile(
				scenarioPath,
				[
					'#!/usr/bin/env bash',
					'set -euo pipefail',
					source,
					'date() { cat "$CLOCK_PATH"; }',
					'sleep() { local now; now="$(cat "$CLOCK_PATH")"; printf "%s\\n" "$((now + 1))" > "$CLOCK_PATH"; }',
					'pm2() { return 0; }',
					'contextvm_healthy_observation() {',
					'  local count',
					'  count="$(cat "$COUNT_PATH")"',
					'  count=$((count + 1))',
					'  printf "%s\\n" "$count" > "$COUNT_PATH"',
					observationBody,
					'}',
					'CONTEXTVM_NAME=earthly-contextvm',
					'wait_for_contextvm_health 0 "$ACTIVE_RELEASE"',
					'',
				].join('\n'),
			)
			const child = Bun.spawn(['bash', scenarioPath], {
				env: {
					...process.env,
					ACTIVE_RELEASE: activeRelease,
					CLOCK_PATH: clockPath,
					COUNT_PATH: countPath,
				},
				stdout: 'pipe',
				stderr: 'pipe',
			})
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			])
			return {
				exitCode,
				stdout,
				stderr,
				observations: Number((await readFile(countPath, 'utf8')).trim()),
			}
		}

		const slow = await runScenario(
			60,
			'  if [[ "$count" -eq 25 ]]; then echo "101:7"; elif [[ "$count" -ge 26 ]]; then echo "202:8"; fi',
		)
		expect(slow.exitCode).toBe(0)
		expect(slow.stdout).toContain('ContextVM is online and healthy')
		expect(slow.stderr).toBe('')
		expect(slow.observations).toBe(28)

		const timedOut = await runScenario(10, '  return 1')
		expect(timedOut.exitCode).not.toBe(0)
		expect(timedOut.stdout).toBe('')
		expect(timedOut.stderr).toContain(
			'ContextVM did not become online and healthy within 10s after restart',
		)
		expect(timedOut.observations).toBe(11)
	})

	test('rejects an invalid ContextVM health timeout before catalog mutation or restart', async () => {
		await mkdir(join(repositoryRoot, '.cache'), { recursive: true })
		const fixtureRoot = await mkdtemp(join(repositoryRoot, '.cache', 'geocatalog-activate-'))
		temporaryDirectories.push(fixtureRoot)
		const manager = await Bun.file(join(repositoryRoot, 'ops/vps/geocatalog.sh')).text()
		const timeoutSource = geoCatalogHealthWaitSource(manager)
		const activationStart = manager.indexOf('activate_target_snapshot() {')
		const activationEnd = manager.indexOf('\nrun_pipeline() {', activationStart)
		if (activationStart < 0 || activationEnd < 0) {
			throw new Error('GeoCatalog target activation source was not found')
		}
		const activationSource = manager.slice(activationStart, activationEnd)
		const activeRelease = join(fixtureRoot, 'active-release')
		const mutationMarker = join(fixtureRoot, 'catalog-mutated')
		const restartMarker = join(fixtureRoot, 'contextvm-restarted')
		const scenarioPath = join(fixtureRoot, 'scenario.sh')
		await mkdir(activeRelease, { recursive: true })
		await writeFile(
			join(activeRelease, '.env'),
			'GEOCATALOG_CONTEXTVM_HEALTH_TIMEOUT_SECONDS=not-a-number\n',
		)
		await writeFile(
			scenarioPath,
			[
				'#!/usr/bin/env bash',
				'set -euo pipefail',
				timeoutSource,
				activationSource,
				'write_state() { return 0; }',
				'verify_target_snapshot() { return 0; }',
				'contextvm_release_dir() { printf "%s\\n" "$ACTIVE_RELEASE"; }',
				'require_safe_absolute_path() { return 0; }',
				'require_contextvm_catalog_path() { return 0; }',
				'catalog_points_to() { return 1; }',
				'replace_catalog_link() { touch "$MUTATION_MARKER"; return 0; }',
				'restart_contextvm_and_wait() { touch "$RESTART_MARKER"; return 0; }',
				'catalog_dir="$FIXTURE_ROOT/catalog"',
				'catalog_path="$catalog_dir/current.sqlite"',
				'snapshot_id=overture-test-planet-lite-v2',
				'mkdir -p "$catalog_dir"',
				'if activate_target_snapshot "$FIXTURE_ROOT/target.sqlite" "$FIXTURE_ROOT/worker"; then',
				'  echo "Activation unexpectedly accepted an invalid health timeout" >&2',
				'  exit 90',
				'fi',
				'[[ ! -e "$MUTATION_MARKER" ]]',
				'[[ ! -e "$RESTART_MARKER" ]]',
				'',
			].join('\n'),
		)
		const child = Bun.spawn(['bash', scenarioPath], {
			env: {
				...process.env,
				ACTIVE_RELEASE: activeRelease,
				FIXTURE_ROOT: fixtureRoot,
				MUTATION_MARKER: mutationMarker,
				RESTART_MARKER: restartMarker,
			},
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		])

		expect(exitCode).toBe(0)
		expect(stdout).toBe('')
		expect(stderr).toContain(
			'GEOCATALOG_CONTEXTVM_HEALTH_TIMEOUT_SECONDS must be an integer from 10 to 900',
		)
		expect(await Bun.file(mutationMarker).exists()).toBe(false)
		expect(await Bun.file(restartMarker).exists()).toBe(false)
	})

	test('accepts only complete global single-source GeoCatalog checkpoints', async () => {
		await mkdir(join(repositoryRoot, '.cache'), { recursive: true })
		const fixtureRoot = await mkdtemp(join(repositoryRoot, '.cache', 'geocatalog-checkpoint-'))
		temporaryDirectories.push(fixtureRoot)
		const manager = await Bun.file(join(repositoryRoot, 'ops/vps/geocatalog.sh')).text()
		const source = embeddedBunSource(manager, 'verify_checkpoint')
		const release = '2026-08-19.0'
		const type = 'water'
		const dataPath = join(fixtureRoot, `${type}.geojsonseq.gz`)
		const payload = new TextEncoder().encode('verified compressed checkpoint bytes')
		await writeFile(dataPath, payload)
		const sha256 = createHash('sha256').update(payload).digest('hex')
		const validReport = {
			schemaVersion: 1,
			policyId: 'earthly-overture-planet-lite-v2',
			release,
			dryRun: false,
			coverage: { scope: 'global' },
			outputDirectory: fixtureRoot,
			featureTypes: [type],
			outputFormat: 'GeoJSONSeq+gzip',
			outputBytes: payload.byteLength,
			sources: [
				{
					featureType: type,
					theme: 'base',
					type: 'water',
					uri: `s3://overturemaps-us-west-2/release/${release}/theme=base/type=water/*.parquet`,
					selectedRecords: 1,
					outputFile: `${type}.geojsonseq.gz`,
					outputBytes: payload.byteLength,
					sha256,
				},
			],
		}
		const runVerifier = (report: typeof validReport) =>
			writeFile(join(fixtureRoot, 'export-report.json'), JSON.stringify(report)).then(() =>
				runEmbeddedBun(source, {
					CHECKPOINT_TYPE: type,
					CHECKPOINT_ROOT: fixtureRoot,
					EXPECTED_RELEASE: release,
					EXPECTED_POLICY: 'earthly-overture-planet-lite-v2',
				}),
			)

		expect((await runVerifier(validReport)).exitCode).toBe(0)

		const invalidReports = [
			{ ...validReport, coverage: { scope: 'bbox' } },
			{ ...validReport, featureTypes: [type, 'place'] },
			{ ...validReport, sources: [...validReport.sources, validReport.sources[0]] },
			{
				...validReport,
				sources: [{ ...validReport.sources[0], selectedRecords: 0 }],
			},
			{
				...validReport,
				outputBytes: 0,
				sources: [{ ...validReport.sources[0], outputBytes: 0 }],
			},
			{
				...validReport,
				sources: [{ ...validReport.sources[0], sha256: '0'.repeat(64) }],
			},
		]
		for (const report of invalidReports) {
			expect((await runVerifier(report as typeof validReport)).exitCode).not.toBe(0)
		}
	})

	test('verifies a reused target snapshot identity, release, and global coverage', async () => {
		await mkdir(join(repositoryRoot, '.cache'), { recursive: true })
		const fixtureRoot = await mkdtemp(join(repositoryRoot, '.cache', 'geocatalog-target-'))
		temporaryDirectories.push(fixtureRoot)
		const manager = await Bun.file(join(repositoryRoot, 'ops/vps/geocatalog.sh')).text()
		const source = embeddedBunSource(manager, 'verify_target_snapshot')
		const release = '2026-08-19.0'
		const snapshotId = `overture-${release}-planet-lite-v2`
		const expectedKinds: GeoCatalogKind[] = [
			'admin',
			'locality',
			'place',
			'waterway',
			'infrastructure',
		]
		const runVerifier = (path: string) =>
			runEmbeddedBun(source, {
				GEOCATALOG_CHECK_PATH: path,
				GEOCATALOG_WORKER_ROOT: repositoryRoot,
				EXPECTED_SNAPSHOT_ID: snapshotId,
				EXPECTED_RELEASE: release,
			})
		const writeTarget = async (
			path: string,
			id: string,
			sourceRelease: string,
			kinds: GeoCatalogKind[] = expectedKinds,
		) => {
			await writeSqliteGeoCatalogSnapshot({
				path,
				snapshot: {
					...catalogSnapshot,
					id,
					coverage: { spatial: { scope: 'global' }, kinds },
					sources: [{ name: 'Overture Maps', release: sourceRelease }],
				},
				entries: [{ ...catalogEntry, source: { name: 'Overture Maps', release: sourceRelease } }],
			})
		}

		const validPath = join(fixtureRoot, 'valid.sqlite')
		const wrongIdentityPath = join(fixtureRoot, 'wrong-identity.sqlite')
		const wrongReleasePath = join(fixtureRoot, 'wrong-release.sqlite')
		const transportKindsPath = join(fixtureRoot, 'transport-kinds.sqlite')
		await writeTarget(validPath, snapshotId, release)
		await writeTarget(wrongIdentityPath, 'unexpected-snapshot', release)
		await writeTarget(wrongReleasePath, snapshotId, '2026-08-18.0')
		await writeTarget(transportKindsPath, snapshotId, release, [...expectedKinds, 'road'])

		expect((await runVerifier(validPath)).exitCode).toBe(0)
		for (const path of [wrongIdentityPath, wrongReleasePath, transportKindsPath]) {
			const result = await runVerifier(path)
			expect(result.exitCode).not.toBe(0)
			expect(result.stderr).toContain('GeoCatalog target identity, release, or coverage mismatch')
		}
	})

	test('reports terminal elapsed time and failure detail without misleading local source position', async () => {
		await mkdir(join(repositoryRoot, '.cache'), { recursive: true })
		const fixtureRoot = await mkdtemp(join(repositoryRoot, '.cache', 'geocatalog-status-'))
		temporaryDirectories.push(fixtureRoot)
		const manager = await Bun.file(join(repositoryRoot, 'ops/vps/geocatalog.sh')).text()
		const statePath = join(fixtureRoot, 'build-state.json')
		const progressPath = join(fixtureRoot, 'build-progress.json')
		await writeFile(
			statePath,
			JSON.stringify({
				state: 'failed',
				phase: 'serving',
				snapshotId: 'overture-2026-08-19.0-planet-lite-v2',
				startedAt: '2026-08-29T00:00:00.000Z',
				updatedAt: '2026-08-29T02:30:00.000Z',
				finishedAt: '2026-08-29T02:30:00.000Z',
				message: 'ContextVM health check failed',
			}),
		)
		await writeFile(
			progressPath,
			JSON.stringify({
				state: 'failed',
				featureType: 'water',
				sourceIndex: 2,
				sourceCount: 5,
				records: 42,
				outputBytes: 1024,
				message: 'relay startup marker was not observed',
			}),
		)

		const result = await runEmbeddedBun(geoCatalogStatusSource(manager), {
			STATE_FILE: statePath,
			PROGRESS_FILE: progressPath,
		})

		expect(result.exitCode).toBe(0)
		expect(result.stderr).toBe('')
		expect(result.stdout).toContain('Elapsed: 2h 30m')
		expect(result.stdout).toContain(
			'Failure: ContextVM health check failed; relay startup marker was not observed',
		)
		expect(result.stdout).toContain('Progress: failed water · 42 records')
		expect(result.stdout).not.toContain('water 2/5')
	})

	test('forwards the remote follow flag to the persistent GeoCatalog logs', async () => {
		await mkdir(join(repositoryRoot, '.cache'), { recursive: true })
		const fixtureRoot = await mkdtemp(join(repositoryRoot, '.cache', 'geocatalog-logs-'))
		temporaryDirectories.push(fixtureRoot)
		const sharedDir = join(fixtureRoot, 'shared')
		const fakeBin = join(fixtureRoot, 'fake-bin')
		const invocation = join(fixtureRoot, 'tail-args')
		await mkdir(fakeBin, { recursive: true })
		await writeExecutable(
			join(fakeBin, 'tail'),
			'#!/bin/bash\nprintf "%s\\n" "$*" > "$TAIL_INVOCATION"\n',
		)

		const child = Bun.spawn(
			[
				'bash',
				join(repositoryRoot, 'ops/vps/geocatalog.sh'),
				'logs',
				sharedDir,
				repositoryRoot,
				'--follow',
			],
			{
				env: {
					...process.env,
					PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
					TAIL_INVOCATION: invocation,
				},
				stdout: 'pipe',
				stderr: 'pipe',
			},
		)
		const [exitCode, stderr] = await Promise.all([
			child.exited,
			new Response(child.stderr).text(),
		])

		expect(exitCode).toBe(0)
		expect(stderr).toBe('')
		expect(await readFile(invocation, 'utf8')).toContain('-n 100 -F')
	})

	test('the activation preflight accepts and identifies a queryable snapshot', async () => {
		await mkdir(join(repositoryRoot, '.cache'), { recursive: true })
		const fixtureRoot = await mkdtemp(join(repositoryRoot, '.cache', 'activation-geocatalog-'))
		temporaryDirectories.push(fixtureRoot)
		const catalogPath = join(fixtureRoot, 'valid.sqlite')
		await writeSqliteGeoCatalogSnapshot({
			path: catalogPath,
			snapshot: catalogSnapshot,
			entries: [catalogEntry],
		})
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()

		const result = await runGeoCatalogPreflight(geoCatalogPreflightSource(activate), catalogPath)

		expect(result).toEqual({
			exitCode: 0,
			stdout: 'GeoCatalog ready: activation-test-2026-08-29 (Overture Maps@2026-08-20.0)\n',
			stderr: '',
		})
	})

	test('keeps a live legacy relay and Cordn data root in place', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()

		expect(activate).toContain('persistent_data_root="$app_root/data"')
		expect(activate).toContain('Referenced existing persistent relay and Cordn data without copying it')
		expect(activate).toContain('link_shared "$persistent_data_root" "$new_release/data"')
	})

	test('recreates stale PM2 process identities before checking the intended release', async () => {
		await mkdir(join(repositoryRoot, '.cache'), { recursive: true })
		const fixtureRoot = await mkdtemp(join(repositoryRoot, '.cache', 'runtime-switch-'))
		temporaryDirectories.push(fixtureRoot)
		const releaseDir = join(fixtureRoot, 'releases', 'new-release')
		const legacyDir = join(fixtureRoot, 'legacy-release')
		const fakeBin = join(fixtureRoot, 'fake-bin')
		const fakeHome = join(fixtureRoot, 'home')
		const statePath = join(fixtureRoot, 'pm2-release')
		const logPath = join(fixtureRoot, 'pm2.log')

		await Promise.all([
			mkdir(join(releaseDir, 'ops', 'vps'), { recursive: true }),
			mkdir(join(releaseDir, 'bin'), { recursive: true }),
			mkdir(join(releaseDir, 'contextvm', 'bin'), { recursive: true }),
			mkdir(join(releaseDir, 'dist'), { recursive: true }),
			mkdir(join(legacyDir, 'dist'), { recursive: true }),
			mkdir(fakeBin, { recursive: true }),
			mkdir(fakeHome, { recursive: true }),
		])
		await writeFile(
			join(releaseDir, 'ops', 'vps', 'runtime.sh'),
			await readFile(join(repositoryRoot, 'ops/vps/runtime.sh')),
		)
		await writeFile(join(releaseDir, 'ops', 'vps', 'services.config.cjs'), 'module.exports = {}\n')
		await writeFile(join(releaseDir, '.env'), 'NODE_ENV=production\n')
		await writeFile(join(releaseDir, 'dist', 'index.html'), '<html>new release</html>\n')
		await writeFile(join(legacyDir, 'dist', 'index.html'), '<html>legacy release</html>\n')
		await writeFile(statePath, `${legacyDir}\n`)
		await writeFile(logPath, '')
		await writeExecutable(join(releaseDir, 'bin', 'cordn-server'), '#!/bin/bash\nexit 0\n')
		await writeExecutable(join(releaseDir, 'contextvm', 'bin', 'pmtiles'), '#!/bin/bash\nexit 0\n')
		await writeExecutable(join(releaseDir, 'ops', 'vps', 'searxng.sh'), '#!/bin/bash\nexit 0\n')
		await writeExecutable(join(releaseDir, 'ops', 'vps', 'start-cordn.sh'), '#!/bin/bash\nexit 0\n')

		await writeExecutable(
			join(fakeBin, 'docker'),
			'#!/bin/bash\n[[ "$1 $2" == "compose version" ]]\n',
		)
		await writeExecutable(join(fakeBin, 'sleep'), '#!/bin/bash\nexit 0\n')
		await writeExecutable(
			join(fakeBin, 'curl'),
			[
				'#!/bin/bash',
				'set -euo pipefail',
				'url="${!#}"',
				'if [[ "$url" == "http://127.0.0.1:3000/" ]]; then',
				'  release="$(cat "$FAKE_PM2_STATE")"',
				'  cat "$release/dist/index.html"',
				'else',
				'  printf "{}"',
				'fi',
				'',
			].join('\n'),
		)
		await writeExecutable(
			join(fakeBin, 'pm2'),
			[
				'#!/bin/bash',
				'set -euo pipefail',
				'printf "%s\\n" "$*" >> "$FAKE_PM2_LOG"',
				'command_name="${1:-}"',
				'shift || true',
				'case "$command_name" in',
				'  describe)',
				'    [[ "$(cat "$FAKE_PM2_STATE")" != "deleted" ]]',
				'    ;;',
				'  delete)',
				'    printf "deleted\\n" > "$FAKE_PM2_STATE"',
				'    ;;',
				'  start)',
				'    if [[ "$(cat "$FAKE_PM2_STATE")" == "deleted" ]]; then',
				'      printf "%s\\n" "$EARTHLY_RELEASE_DIR" > "$FAKE_PM2_STATE"',
				'    fi',
				'    ;;',
				'  startOrReload)',
				'    : # PM2 retains the original cwd/script identity in the production failure mode.',
				'    ;;',
				'  pid)',
				'    printf "123\\n"',
				'    ;;',
				'  jlist)',
				'    release="$(cat "$FAKE_PM2_STATE")"',
				`    payload="$(printf '[{"name":"earthly-web","pid":123,"pm2_env":{"status":"online","pm_cwd":"%s","pm_exec_path":"%s/src/index.ts","exec_interpreter":"%s/.bun/bin/bun","exec_mode":"fork_mode"}},{"name":"earthly-contextvm","pid":123,"pm2_env":{"status":"online","pm_cwd":"%s","pm_exec_path":"%s/contextvm/server.ts","exec_interpreter":"%s/.bun/bin/bun","exec_mode":"fork_mode"}},{"name":"earthly-mapnolia","pid":123,"pm2_env":{"status":"online","pm_cwd":"%s","pm_exec_path":"%s/mapnolia-server","exec_interpreter":"none","exec_mode":"fork_mode"}},{"name":"earthly-relay","pid":123,"pm2_env":{"status":"online","pm_cwd":"%s","pm_exec_path":"%s/relay/relay","exec_interpreter":"none","exec_mode":"fork_mode"}}]' "$release" "$release" "$HOME" "$release" "$release" "$HOME" "$release" "$release" "$release" "$release")"`,
				'    printf "JLIST=%s\\n" "$payload" >> "$FAKE_PM2_LOG"',
				'    printf "%s\\n" "$payload"',
				'    ;;',
				'  save|list)',
				'    ;;',
				'  *)',
				'    exit 1',
				'    ;;',
				'esac',
				'',
			].join('\n'),
		)

		const child = Bun.spawn(['bash', join(releaseDir, 'ops', 'vps', 'runtime.sh'), 'restart', releaseDir], {
			cwd: releaseDir,
			env: {
				HOME: fakeHome,
				PATH: `${fakeBin}:${Bun.env.PATH ?? ''}`,
				FAKE_PM2_STATE: statePath,
				FAKE_PM2_LOG: logPath,
			},
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		])
		const finalState = (await readFile(statePath, 'utf8')).trim()
		const pm2Log = await readFile(logPath, 'utf8')

		expect({ exitCode, stdout, stderr, finalState, pm2Log }).toEqual({
			exitCode: 0,
			stdout: expect.stringContaining('Earthly runtime is healthy'),
			stderr: '',
			finalState: releaseDir,
			pm2Log: expect.stringContaining('delete earthly-web'),
		})
		expect(pm2Log).toContain(`start ${join(releaseDir, 'ops', 'vps', 'services.config.cjs')}`)
	})
})
