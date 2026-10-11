import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deploymentSettings, MAP_PROCESS, runtimeArtifacts } from './config'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const env = { EARTHLY_MAP_PUBLIC_URL: 'https://maps.example.com/', EARTHLY_MAP_RELAYS: 'wss://relay.example.com' }
const settings = deploymentSettings(env)

describe('map deployment boundaries', () => {
	test('requires an HTTPS origin, explicit public relays, and a separate service port', () => {
		expect(settings.publicUrl).toBe('https://maps.example.com')
		for (const origin of ['http://example.com', 'https://user:password@example.com', 'https://example.com/maps', 'https://example.com?secret=1', 'https://127.0.0.1', 'https://example.com:3337']) {
			expect(() => deploymentSettings({ ...env, EARTHLY_MAP_PUBLIC_URL: origin })).toThrow()
		}
		for (const port of ['3000', '3334', '3544', '8888', '0', '65536']) {
			expect(() => deploymentSettings({ ...env, EARTHLY_MAP_PORT: port })).toThrow()
		}
		for (const relay of [undefined, '', 'ws://localhost:3334', 'wss://key@relay.example.com', 'wss://relay.example.com?token=secret']) {
			expect(() => deploymentSettings({ ...env, EARTHLY_MAP_RELAYS: relay })).toThrow()
		}
	})

	test('manages only the single map process and reuses the configured relay', () => {
		const { ecosystem, caddy } = runtimeArtifacts(settings, '/srv/maps/releases/abc', '/srv/maps/shared', 'abc', '/usr/local/bin/bun')
		const { apps } = JSON.parse(ecosystem.replace('module.exports = ', ''))
		expect(apps.map((app: { name: string }) => app.name)).toEqual([MAP_PROCESS])
		expect(apps[0].instances).toBe(1)
		expect(apps[0].exec_mode).toBe('fork')
		expect(apps[0].cwd).toBe('/srv/maps/releases/abc')
		expect(apps[0].env.EARTHLY_MAP_RELAYS).toBe('wss://relay.example.com')
		expect(apps[0].env.EARTHLY_MAP_HOST).toBe('127.0.0.1')
		expect(apps[0].env.EARTHLY_MAP_RELEASE).toBe('abc')
		expect(apps[0].interpreter_args).toBe('--no-env-file')
		expect(ecosystem).not.toMatch(/SERVER_KEY|APP_PRIVATE_KEY|reset-all|earthly-web|earthly-relay/)
		expect(caddy).toContain('reverse_proxy 127.0.0.1:3337')
		expect(caddy).toContain('flush_interval -1')
		expect(caddy).not.toContain('X-Frame-Options')
	})

	test('Caddy installation is idempotent and preserves existing production routes', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'earthly-map-caddy-'))
		temporary.push(directory)
		const current = join(directory, 'Caddyfile'), block = join(directory, 'maps.caddy'), output = join(directory, 'candidate')
		const original = '{\n\temail ops@example.com\n}\n\nearthly.example.com {\n\treverse_proxy 127.0.0.1:3000\n}\n'
		const { caddy } = runtimeArtifacts(settings, '/srv/release', '/srv/shared', 'abc', '/usr/bin/bun')
		await writeFile(current, original)
		await writeFile(block, caddy)
		const merge = async () => {
			const process = Bun.spawn(['python3', join(import.meta.dir, 'merge-caddy.py'), current, block, output], { stdout: 'pipe', stderr: 'pipe' })
			return { code: await process.exited, error: await new Response(process.stderr).text() }
		}
		expect((await merge()).code).toBe(0)
		const first = await readFile(output, 'utf8')
		expect(first.startsWith(original)).toBe(true)
		await writeFile(current, first)
		expect((await merge()).code).toBe(0)
		expect(await readFile(output, 'utf8')).toBe(first)
		await writeFile(current, `${original}\nmaps.example.com { respond "owned elsewhere" }\n`)
		expect((await merge()).error).toContain('already exists outside')
		await writeFile(current, `${original}\n# BEGIN earthly-map-plugin\n`)
		expect((await merge()).error).toContain('Ambiguous')
		await writeFile(current, `${original}\n# END earthly-map-plugin\n# BEGIN earthly-map-plugin\n`)
		expect((await merge()).error).toContain('Reversed')
	})
})
