import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '../..')
const temporaryDirectories: string[] = []

async function writeExecutable(path: string, content: string): Promise<void> {
	await mkdir(join(path, '..'), { recursive: true })
	await writeFile(path, content)
	await chmod(path, 0o755)
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
