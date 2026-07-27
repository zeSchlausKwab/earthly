import { afterEach, describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '..')
const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
	)
})

describe('production deployment runtime', () => {
	test('the OG server graph imports without relying on the repository tsconfig', async () => {
		const releaseRoot = await mkdtemp(join(tmpdir(), 'earthly-server-runtime-'))
		temporaryDirectories.push(releaseRoot)
		await mkdir(join(releaseRoot, 'src/lib/og'), { recursive: true })
		await mkdir(join(releaseRoot, 'src/lib/geo'), { recursive: true })
		await cp(
			join(repositoryRoot, 'src/lib/og/resolveGeoBlobs.ts'),
			join(releaseRoot, 'src/lib/og/resolveGeoBlobs.ts'),
		)
		await cp(
			join(repositoryRoot, 'src/lib/og/publicRemote.ts'),
			join(releaseRoot, 'src/lib/og/publicRemote.ts'),
		)
		await cp(
			join(repositoryRoot, 'src/lib/geo/normalizeGeoJSON.ts'),
			join(releaseRoot, 'src/lib/geo/normalizeGeoJSON.ts'),
		)

		const child = Bun.spawn(
			[process.execPath, '-e', "await import('./src/lib/og/resolveGeoBlobs.ts')"],
			{
				cwd: releaseRoot,
				stdout: 'pipe',
				stderr: 'pipe',
			},
		)
		const [exitCode, stderr] = await Promise.all([
			child.exited,
			new Response(child.stderr).text(),
		])

		expect(stderr).toBe('')
		expect(exitCode).toBe(0)
	})

	test('the release archive carries runtime resolution config and preflights server imports', async () => {
		const deploy = await Bun.file(join(repositoryRoot, 'scripts/deploy.sh')).text()
		const remoteDeploy = await Bun.file(join(repositoryRoot, 'scripts/deploy-remote.sh')).text()

		expect(deploy).toMatch(/\n\s+tsconfig\.json\n/u)
		expect(remoteDeploy).toContain("await import('./src/lib/og/index.ts')")
	})
})
