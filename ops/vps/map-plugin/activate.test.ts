import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const repo = join(import.meta.dir, '../../..')
const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function fixture(initial = false) {
	await mkdir(join(repo, '.cache'), { recursive: true })
	const directory = await mkdtemp(join(repo, '.cache/map-deploy-'))
	temporary.push(directory)
	const root = join(directory, 'map-plugin'), files = join(directory, 'files'), bin = join(directory, 'bin')
	const oldRelease = join(root, 'releases/old'), newRelease = join(root, 'releases/new'), incoming = join(root, 'incoming/new')
	for (const path of [oldRelease, incoming, bin, join(root, 'shared/relay'), join(files, 'ops/vps/map-plugin'), join(files, 'src/map-plugin'), join(files, 'relay')]) await mkdir(path, { recursive: true })
	if (!initial) await symlink(oldRelease, join(root, 'current'))
	await writeFile(join(oldRelease, 'ecosystem.config.cjs'), 'module.exports = {}')
	await writeFile(join(root, 'shared/relay/retained-event'), 'keep me')
	await writeFile(join(files, 'src/map-plugin/index.ts'), 'export {}')
	await writeFile(join(files, 'ops/vps/map-plugin/config.ts'), await Bun.file(join(import.meta.dir, 'config.ts')).text())
	await symlink(join(repo, 'node_modules'), join(root, 'node_modules'))
	await writeFile(join(incoming, 'settings.json'), JSON.stringify({ publicUrl: 'https://maps.example.com', httpPort: 3337, relays: ['wss://relay.example.com'] }))
	const archive = Bun.spawn(['tar', '-czf', join(incoming, 'release.tar.gz'), '-C', files, '.'], { stdout: 'pipe', stderr: 'pipe' })
	if (await archive.exited) throw new Error(await new Response(archive.stderr).text())
	await writeFile(join(incoming, 'activate.sh'), await Bun.file(join(import.meta.dir, 'activate.sh')).text())
	const sums = await Promise.all(['release.tar.gz', 'settings.json', 'activate.sh'].map(async (name) => `${createHash('sha256').update(await readFile(join(incoming, name))).digest('hex')}  ${name}`))
	await writeFile(join(incoming, 'SHA256SUMS'), sums.join('\n') + '\n')
	const scripts: Record<string, string> = {
		bun: `#!/bin/bash\nif [[ "$1" == install ]]; then exit 0; fi\nif [[ "$1" == --no-env-file ]]; then exit "\${FAIL_BUILD:-0}"; fi\nexec "$REAL_BUN" "$@"\n`,
		flock: '#!/bin/bash\nexit 0\n',
		pm2: '#!/bin/bash\nif [[ "$1" == jlist ]]; then echo "[]"; exit 0; fi\necho "$*" >> "$PM2_CALLS"\nif [[ "$1" == startOrRestart && "$2" == "$NEW_RELEASE/ecosystem.config.cjs" && "${FAIL_START:-0}" == 1 ]]; then exit 1; fi\n',
		curl: "#!/bin/bash\nif [[ \"$*\" == */health* ]]; then printf '{\"service\":\"earthly-public-maps\",\"release\":\"%s\"}\\n' \"${HEALTH_RELEASE:-new}\"; fi\n",
		// Production is Linux; exercise atomic pointer replacement on macOS too.
		mv: '#!/bin/bash\nif [[ "$1" == -Tf ]]; then python3 -c "import os,sys;os.replace(sys.argv[1],sys.argv[2])" "$2" "$3"; else /bin/mv "$@"; fi\n',
	}
	for (const [name, script] of Object.entries(scripts)) { const path = join(bin, name); await writeFile(path, script); await chmod(path, 0o755) }
	const calls = join(directory, 'pm2-calls')
	await writeFile(calls, '')
	const run = async (env: Record<string, string> = {}) => {
		const child = Bun.spawn(['bash', join(import.meta.dir, 'activate.sh'), root, 'new'], {
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, REAL_BUN: process.execPath, PM2_CALLS: calls, NEW_RELEASE: newRelease, EARTHLY_MAP_HEALTH_TIMEOUT_SECONDS: '1', ...env }, stdout: 'pipe', stderr: 'pipe',
		})
		const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
		return { code, stdout, stderr, calls: await readFile(calls, 'utf8') }
	}
	return { root, oldRelease, newRelease, run }
}

describe('map service activation transaction', () => {
	test('does not restart anything when the candidate build fails', async () => {
		const f = await fixture(), result = await f.run({ FAIL_BUILD: '1' })
		expect(result.code).not.toBe(0)
		expect(result.calls).toBe('')
		expect(await readlink(join(f.root, 'current'))).toBe(f.oldRelease)
	})
	test('restores only the previous map service runtime after a failed restart', async () => {
		const f = await fixture(), result = await f.run({ FAIL_START: '1' })
		expect(result.code).not.toBe(0)
		expect(result.calls).toContain(`startOrRestart ${f.oldRelease}/ecosystem.config.cjs`)
		expect(result.calls).not.toContain('earthly-web')
		expect(await readlink(join(f.root, 'current'))).toBe(f.oldRelease)
		expect(await readFile(join(f.root, 'shared/relay/retained-event'), 'utf8')).toBe('keep me')
	})
	test('rejects an old process answering health on the intended port', async () => {
		const f = await fixture(), result = await f.run({ HEALTH_RELEASE: 'old' })
		expect(result.code).not.toBe(0)
		expect(result.stderr).toContain('health check timed out')
		expect(result.calls).toContain(`startOrRestart ${f.oldRelease}/ecosystem.config.cjs`)
		expect(await readlink(join(f.root, 'current'))).toBe(f.oldRelease)
	})
	test('activates a healthy release while retaining the previous release and existing data', async () => {
		const f = await fixture(), result = await f.run()
		expect(result.code, result.stdout + result.stderr).toBe(0)
		expect(await readlink(join(f.root, 'current'))).toBe(f.newRelease)
		expect(await readlink(join(f.root, 'previous'))).toBe(f.oldRelease)
		expect(await readFile(join(f.root, 'shared/relay/retained-event'), 'utf8')).toBe('keep me')
	})
	test('supports the first deployment without a current symlink', async () => {
		const f = await fixture(true), result = await f.run()
		expect(result.code, result.stdout + result.stderr).toBe(0)
		expect(await readlink(join(f.root, 'current'))).toBe(f.newRelease)
		expect(result.calls).not.toContain('delete')
	})
	test('cleans up only the map process after a failed first deployment', async () => {
		const f = await fixture(true), result = await f.run({ FAIL_START: '1' })
		expect(result.code).not.toBe(0)
		expect(result.calls).toContain('delete earthly-maps\n')
		expect(result.calls).not.toMatch(/earthly-web|earthly-relay/)
	})

})
