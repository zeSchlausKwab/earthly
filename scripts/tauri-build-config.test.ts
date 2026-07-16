import { describe, expect, test } from 'bun:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('Tauri package build configuration', () => {
	test('packages the frontend with production service configuration', async () => {
		const config = await Bun.file(resolve(repoRoot, 'src-tauri/tauri.conf.json')).json()

		expect(config.build.beforeBuildCommand).toBe('bun run build:production')
	})
})
