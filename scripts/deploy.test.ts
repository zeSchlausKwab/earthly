import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hexToBytes } from '@noble/hashes/utils.js'
import { getPublicKey } from 'nostr-tools/pure'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryDirectories: string[] = []

async function copyFixtureFile(relativePath: string, fixtureRoot: string): Promise<void> {
	const destination = join(fixtureRoot, relativePath)
	await mkdir(dirname(destination), { recursive: true })
	await writeFile(destination, await readFile(join(repoRoot, relativePath)))
}

async function createDeploymentFixture(): Promise<string> {
	await mkdir(join(repoRoot, '.cache'), { recursive: true })
	const fixtureRoot = await mkdtemp(join(repoRoot, '.cache', 'deploy-env-'))
	temporaryDirectories.push(fixtureRoot)

	for (const relativePath of [
		'scripts/deploy.sh',
		'scripts/deploy-remote.sh',
		'scripts/start-cordn-production.sh',
		'scripts/validate-production-env.ts',
		'src/config/env.schema.ts',
	]) {
		await copyFixtureFile(relativePath, fixtureRoot)
	}

	await writeFile(
		join(fixtureRoot, '.env'),
		[
			'VPS_HOST=production.example',
			'VPS_USER=deploy',
			'VPS_PATH=/var/www/earthly',
			'RELAY_URL=ws://localhost:3334',
			'BLOSSOM_SERVER=http://localhost:3544',
			'',
		].join('\n'),
	)

	const serverKey = '2'.repeat(64)
	const cordnKey = '3'.repeat(64)
	await writeFile(
		join(fixtureRoot, '.env.production'),
		[
			'NODE_ENV=production',
			'RELAY_URL=wss://relay.earthly.city',
			'BLOSSOM_SERVER=https://blossom.earthly.city',
			`SERVER_KEY=${serverKey}`,
			`SERVER_PUBKEY=${getPublicKey(hexToBytes(serverKey))}`,
			`CORDN_SERVER_PRIVATE_KEY=${cordnKey}`,
			`CORDN_SERVER_PUBKEY=${getPublicKey(hexToBytes(cordnKey))}`,
			'CORDN_RELAY_URLS=wss://relay.earthly.city',
			'CORDN_IMAGE=ghcr.io/cordn-msg/cordn:v0.4.0',
			'CORDN_STORAGE_BACKEND=sqlite',
			'CORDN_SQLITE_PATH=/data/cordn.sqlite',
			'CORDN_MAX_AGE_DAYS=30',
			'CORDN_RATE_LIMIT_REFILL_PER_MINUTE=500',
			'CORDN_RATE_LIMIT_BURST=160',
			'CORDN_RATE_LIMIT_IDLE_TTL_SECONDS=3600',
			'CORDN_MAX_KEY_PACKAGES_PER_IDENTITY=50',
			'CORDN_MAX_LAST_RESORT_KEY_PACKAGES_PER_IDENTITY=1',
			'',
		].join('\n'),
	)

	return fixtureRoot
}

async function writeExecutable(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, content)
	await chmod(path, 0o755)
}

async function runDeploy(fixtureRoot: string, args: string[] = []) {
	const process = Bun.spawn(['bash', 'scripts/deploy.sh', ...args], {
		cwd: fixtureRoot,
		env: {
			HOME: Bun.env.HOME ?? '',
			PATH: Bun.env.PATH ?? '',
			TMPDIR: Bun.env.TMPDIR ?? '/tmp',
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

describe('deployment environment isolation', () => {
	test('deploy check validates .env.production even when .env contains development URLs', async () => {
		const fixtureRoot = await createDeploymentFixture()
		const { exitCode, stdout, stderr } = await runDeploy(fixtureRoot, ['--check'])

		expect(`${stdout}\n${stderr}`).not.toContain('ws://localhost:3334')
		expect(exitCode).toBe(0)
		expect(stdout).toContain('no build, upload, or restart was performed')
	})

	test('creates a release archive when the optional legacy database is absent', async () => {
		const fixtureRoot = await createDeploymentFixture()
		const fakeBin = join(fixtureRoot, 'fake-bin')
		await writeExecutable(join(fixtureRoot, 'scripts/build-production.sh'), '#!/bin/bash\nexit 0\n')
		await writeExecutable(
			join(fakeBin, 'tar'),
			'#!/bin/bash\ntouch deploy.tar.gz\nexit 0\n',
		)
		for (const command of ['ssh', 'scp']) {
			await writeExecutable(join(fakeBin, command), '#!/bin/bash\nexit 0\n')
		}

		const originalPath = Bun.env.PATH ?? ''
		Bun.env.PATH = `${fakeBin}:${originalPath}`
		try {
			const { exitCode, stdout, stderr } = await runDeploy(fixtureRoot)
			expect(stderr).not.toContain('unbound variable')
			expect(exitCode).toBe(0)
			expect(stdout).toContain('Deployment complete')
		} finally {
			Bun.env.PATH = originalPath
		}
	})
})
