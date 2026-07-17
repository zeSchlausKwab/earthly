import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('Tauri package build configuration', () => {
	test('packages the frontend with production service configuration', async () => {
		const config = await Bun.file(resolve(repoRoot, 'src-tauri/tauri.conf.json')).json()

		expect(config.build.beforeBuildCommand).toBe('bun run build:production')
	})

	test('keeps a preloaded Android trust policy authoritative over conflicting env files', async () => {
		const fixture = await mkdtemp(resolve(tmpdir(), 'earthly-tauri-build-'))
		const bin = resolve(fixture, 'bin')
		const capture = resolve(fixture, 'captured-mapnolia-key')
		const trusted = 'a'.repeat(64)
		await mkdir(bin)
		await Bun.write(
			resolve(fixture, '.env.production'),
			`MAPNOLIA_TRUSTED_PUBKEYS=${'b'.repeat(64)}\n`,
		)
		const fakeBun = resolve(bin, 'bun')
		await Bun.write(
			fakeBun,
			'#!/bin/sh\nprintf "%s" "$MAPNOLIA_TRUSTED_PUBKEYS" > "$EARTHLY_ENV_CAPTURE"\n',
		)
		await chmod(fakeBun, 0o755)

		try {
			const child = Bun.spawn(
				['bash', resolve(repoRoot, 'scripts/build-production.sh')],
				{
					cwd: fixture,
					env: {
						...process.env,
						PATH: `${bin}:${process.env.PATH ?? ''}`,
						EARTHLY_PUBLIC_ENV_PRELOADED: '1',
						EARTHLY_ENV_CAPTURE: capture,
						MAPNOLIA_TRUSTED_PUBKEYS: trusted,
					},
					stdout: 'ignore',
					stderr: 'pipe',
				},
			)
			const stderr = await new Response(child.stderr).text()
			expect(await child.exited, stderr).toBe(0)
			expect(await Bun.file(capture).text()).toBe(trusted)
		} finally {
			await rm(fixture, { recursive: true, force: true })
		}
	})
})
