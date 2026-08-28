import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hexToBytes } from '@noble/hashes/utils.js'
import { getPublicKey } from 'nostr-tools/pure'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temporaryDirectories: string[] = []

async function copyFixtureFile(relativePath: string, fixtureRoot: string): Promise<void> {
	const destination = join(fixtureRoot, relativePath)
	await mkdir(dirname(destination), { recursive: true })
	await writeFile(destination, await readFile(join(repositoryRoot, relativePath)))
}

async function writeExecutable(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, content)
	await chmod(path, 0o755)
}

async function run(fixtureRoot: string, command: string[]): Promise<void> {
	const child = Bun.spawn(command, { cwd: fixtureRoot, stdout: 'pipe', stderr: 'pipe' })
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	])
	if (exitCode !== 0) throw new Error(`${command.join(' ')}\n${stdout}\n${stderr}`)
}

async function createDeploymentFixture(): Promise<string> {
	await mkdir(join(repositoryRoot, '.cache'), { recursive: true })
	const fixtureRoot = await mkdtemp(join(repositoryRoot, '.cache', 'deploy-env-'))
	temporaryDirectories.push(fixtureRoot)

	for (const relativePath of [
		'ops/vps/activate.sh',
		'ops/vps/deploy.sh',
		'ops/vps/runtime.sh',
		'ops/vps/rollback.sh',
		'ops/vps/searxng.sh',
		'ops/vps/searxng/compose.yml',
		'ops/vps/searxng/settings.yml',
		'ops/vps/services.config.cjs',
		'ops/vps/setup.sh',
		'ops/vps/start-cordn.sh',
		'scripts/build-production.sh',
		'scripts/ensure-pmtiles.sh',
		'scripts/validate-production-env.ts',
		'src/config/env.schema.ts',
	]) {
		await copyFixtureFile(relativePath, fixtureRoot)
	}

	for (const [relativePath, content] of [
		['src/index.ts', 'export {}\n'],
		['src/lib/og/index.ts', 'export {}\n'],
		['contextvm/server.ts', 'export {}\n'],
		['contextvm/bin/README.md', 'installed during activation\n'],
		['public/static/example.txt', 'public runtime asset\n'],
		['relay/main.go', 'package main\nfunc main() {}\n'],
		['relay/go.mod', 'module example.test/relay\ngo 1.24\n'],
		['bun.lock', ''],
		['tsconfig.json', '{}\n'],
		['package.json', '{"name":"fixture","version":"1.2.3","private":true}\n'],
		['.gitignore', '.env\n.env.*\nrelay/bin/\nrelay/data/\n'],
	] as const) {
		const destination = join(fixtureRoot, relativePath)
		await mkdir(dirname(destination), { recursive: true })
		await writeFile(destination, content)
	}

	await writeFile(
		join(fixtureRoot, '.env.deploy'),
		['VPS_HOST=production.example', 'VPS_USER=deploy', 'VPS_PATH=/var/www/earthly', ''].join(
			'\n',
		),
	)

	const serverKey = '2'.repeat(64)
	const cordnKey = '3'.repeat(64)
	await writeFile(
		join(fixtureRoot, '.env.production'),
		[
			'NODE_ENV=production',
			'RELAY_URL=wss://relay.earthly.city',
			'PUBLIC_BASE_URL=https://earthly.city',
			'BLOSSOM_SERVER=https://blossom.earthly.city',
			'SEARXNG_URL=http://127.0.0.1:8888',
			`SERVER_KEY=${serverKey}`,
			`SERVER_PUBKEY=${getPublicKey(hexToBytes(serverKey))}`,
			`CORDN_SERVER_PRIVATE_KEY=${cordnKey}`,
			`CORDN_SERVER_PUBKEY=${getPublicKey(hexToBytes(cordnKey))}`,
			'CORDN_RELAY_URLS=wss://relay.earthly.city',
			'CORDN_STORAGE_BACKEND=sqlite',
			'CORDN_NATIVE_SQLITE_PATH=data/cordn/cordn.sqlite',
			'CORDN_SQLITE_SYNCHRONOUS=full',
			'CORDN_MAX_AGE_DAYS=30',
			'CORDN_RATE_LIMIT_REFILL_PER_MINUTE=500',
			'CORDN_RATE_LIMIT_BURST=160',
			'CORDN_RATE_LIMIT_IDLE_TTL_SECONDS=3600',
			'CORDN_MAX_KEY_PACKAGES_PER_IDENTITY=50',
			'CORDN_MAX_LAST_RESORT_KEY_PACKAGES_PER_IDENTITY=1',
			`MAPNOLIA_TRUSTED_PUBKEYS=${'5'.repeat(64)}`,
			'',
		].join('\n'),
	)

	await run(fixtureRoot, ['git', 'init', '-q'])
	await run(fixtureRoot, ['git', 'add', '.'])
	await run(fixtureRoot, [
		'git',
		'-c',
		'user.name=Earthly Test',
		'-c',
		'user.email=test@earthly.invalid',
		'commit',
		'-qm',
		'fixture',
	])

	await mkdir(join(fixtureRoot, 'ops/vps/searxng'), { recursive: true })
	await writeFile(join(fixtureRoot, 'ops/vps/searxng/.env'), 'SEARXNG_SECRET=must-not-ship\n')
	await mkdir(join(fixtureRoot, 'relay/bin'), { recursive: true })
	await writeFile(join(fixtureRoot, 'relay/bin/relay'), 'must not ship\n')

	return fixtureRoot
}

async function runDeploy(fixtureRoot: string, args: string[] = []) {
	const process = Bun.spawn(['bash', 'ops/vps/deploy.sh', ...args], {
		cwd: fixtureRoot,
		env: {
			HOME: Bun.env.HOME ?? '',
			PATH: Bun.env.PATH ?? '',
			TMPDIR: Bun.env.TMPDIR ?? '/tmp',
			CAPTURED_ARCHIVE: join(fixtureRoot, 'captured-release.tar.gz'),
		},
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [exitCode, stdout, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
	])
	return { exitCode, stdout, stderr }
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('deployment environment and bundle isolation', () => {
	test('check validates the production environment without building or connecting', async () => {
		const fixtureRoot = await createDeploymentFixture()
		const { exitCode, stdout, stderr } = await runDeploy(fixtureRoot, ['--check'])

		expect(stderr).toBe('')
		expect(exitCode).toBe(0)
		expect(stdout).toContain('no build, upload, or restart was performed')
	})

	test('rejects a broad VPS deployment path before connecting', async () => {
		const fixtureRoot = await createDeploymentFixture()
		await writeFile(
			join(fixtureRoot, '.env.deploy'),
			'VPS_HOST=production.example\nVPS_USER=deploy\nVPS_PATH=/\n',
		)
		const { exitCode, stderr } = await runDeploy(fixtureRoot, ['--check'])

		expect(exitCode).toBe(1)
		expect(stderr).toContain('VPS_USER, VPS_HOST, or VPS_PATH contains unsupported')
	})

	test('ships runtime files without ignored secrets, binaries, tests, or docs', async () => {
		const fixtureRoot = await createDeploymentFixture()
		const fakeBin = join(fixtureRoot, 'fake-bin')
		await writeExecutable(
			join(fixtureRoot, 'scripts/build-production.sh'),
			'#!/bin/bash\nmkdir -p dist\nprintf "<script type=\\"module\\" src=\\"/app.js\\"></script>" > dist/index.html\nprintf "export {}" > dist/app.js\n',
		)
		await writeExecutable(join(fakeBin, 'ssh'), '#!/bin/bash\ncat >/dev/null || true\nexit 0\n')
		await writeExecutable(
			join(fakeBin, 'scp'),
			[
				'#!/bin/bash',
				'if [[ "$1" == *.tar.gz ]]; then cp "$1" "$CAPTURED_ARCHIVE"; fi',
				'exit 0',
				'',
			].join('\n'),
		)

		const originalPath = Bun.env.PATH ?? ''
		Bun.env.PATH = `${fakeBin}:${originalPath}`
		try {
			const { exitCode, stdout, stderr } = await runDeploy(fixtureRoot)
			expect(stderr).toBe('')
			expect(exitCode).toBe(0)
			expect(stdout).toContain('Deployment complete')

			const archive = Bun.spawnSync(['tar', '-tzf', join(fixtureRoot, 'captured-release.tar.gz')])
			expect(archive.exitCode).toBe(0)
			const entries = archive.stdout.toString()
			expect(entries).toContain('./dist/index.html')
			expect(entries).toContain('./src/index.ts')
			expect(entries).toContain('./release-manifest.json')
			expect(entries).not.toContain('searxng/.env')
			expect(entries).not.toContain('relay/bin')
			expect(entries).not.toContain('.test.ts')
			expect(entries).not.toContain('./docs/')
			expect(entries).not.toContain('./scripts/build-geocatalog.ts')
		} finally {
			Bun.env.PATH = originalPath
		}
	})
})
