import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getOrCreateOGImage, pruneOGImageCache } from './imageCache'

const tempDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
	)
})

describe('getOrCreateOGImage', () => {
	test('stores and reuses an immutable image by entity type and content version', async () => {
		const root = await mkdtemp(join(tmpdir(), 'earthly-og-image-'))
		tempDirectories.push(root)
		const version = `${'a'.repeat(64)}-v2`
		let renders = 0
		const render = async () => {
			renders += 1
			return new Uint8Array([137, 80, 78, 71, renders])
		}

		const first = await getOrCreateOGImage({ type: 'geoevent', version, root, render })
		const second = await getOrCreateOGImage({ type: 'geoevent', version, root, render })

		expect(first.cacheStatus).toBe('miss')
		expect(second.cacheStatus).toBe('hit')
		expect(Array.from(second.png)).toEqual([137, 80, 78, 71, 1])
		expect(renders).toBe(1)
	})

	test('rejects a path-like version before touching the filesystem', async () => {
		const root = await mkdtemp(join(tmpdir(), 'earthly-og-image-'))
		tempDirectories.push(root)
		await expect(
			getOrCreateOGImage({
				type: 'story',
				version: '../../escape',
				root,
				render: async () => new Uint8Array([1]),
			}),
		).rejects.toThrow('Invalid OG image version')
	})

	test('removes stale temporary files and oldest images over the storage budget', async () => {
		const root = await mkdtemp(join(tmpdir(), 'earthly-og-image-'))
		tempDirectories.push(root)
		const directory = join(root, 'story')
		await mkdir(directory, { recursive: true })
		const now = Date.now()
		const versions = ['a', 'b', 'c'].map((character) => `${character.repeat(64)}-v2.png`)
		for (const [index, version] of versions.entries()) {
			const path = join(directory, version)
			await writeFile(path, new Uint8Array([index, index, index, index]))
			const timestamp = new Date(now - (3 - index) * 1000)
			await utimes(path, timestamp, timestamp)
		}
		const temporaryPath = join(directory, `${'d'.repeat(64)}-v2.png.abandoned.tmp`)
		await writeFile(temporaryPath, new Uint8Array([1]))
		const staleTimestamp = new Date(now - 10_000)
		await utimes(temporaryPath, staleTimestamp, staleTimestamp)

		const result = await pruneOGImageCache(root, {
			now,
			maxAgeMs: Number.POSITIVE_INFINITY,
			maxFiles: 2,
			maxBytes: Number.POSITIVE_INFINITY,
			temporaryMaxAgeMs: 1000,
		})
		const remaining = await readdir(directory)

		expect(result.removedImages).toBe(1)
		expect(result.removedTemporaryFiles).toBe(1)
		expect(result.remainingImages).toBe(2)
		expect(remaining.sort()).toEqual(versions.slice(1).sort())
	})
})
