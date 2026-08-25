import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
	convertForX,
	type EncodedVideoMetadata,
	inspectEncodedVideo,
	validateXVideoConstraints,
} from './record'

const validVideo: EncodedVideoMetadata = {
	width: 1920,
	height: 1080,
	durationSeconds: 120,
	frameRate: '30/1',
	bitRate: 8_000_000,
	fileSizeBytes: 120_000_000,
	codec: 'h264',
	pixelFormat: 'yuv420p',
	container: 'mov,mp4,m4a,3gp,3g2,mj2',
}

describe('X account-tier media limits', () => {
	test('hard-fails standard duration and file limits', () => {
		expect(() =>
			validateXVideoConstraints({ ...validVideo, durationSeconds: 140.01 }, 'standard'),
		).toThrow('140 seconds or shorter')
		expect(() =>
			validateXVideoConstraints({ ...validVideo, fileSizeBytes: 512_000_001 }, 'standard'),
		).toThrow('512 MB')
	})

	test('uses the larger but still hard Premium limits', () => {
		expect(() =>
			validateXVideoConstraints({ ...validVideo, durationSeconds: 141 }, 'premium'),
		).not.toThrow()
		expect(() =>
			validateXVideoConstraints({ ...validVideo, durationSeconds: 4 * 60 * 60 }, 'premium'),
		).toThrow('shorter than 4 hours')
		expect(() =>
			validateXVideoConstraints({ ...validVideo, fileSizeBytes: 16_000_000_001 }, 'premium'),
		).toThrow('16 GB')
	})
})

test.skipIf(!Bun.which('ffmpeg') || !Bun.which('ffprobe'))(
	'encodes and verifies the campaign video contract',
	() => {
		const directory = mkdtempSync(join(tmpdir(), 'earthly-demo-media-test-'))
		try {
			const source = join(directory, 'source.webm')
			const output = join(directory, 'output.mp4')
			execFileSync(
				Bun.which('ffmpeg') as string,
				[
					'-hide_banner',
					'-loglevel',
					'error',
					'-f',
					'lavfi',
					'-i',
					'color=c=#172033:s=1920x1080:r=30',
					'-t',
					'1',
					'-c:v',
					'libvpx',
					'-deadline',
					'realtime',
					'-cpu-used',
					'8',
					source,
				],
				{ stdio: 'pipe' },
			)

			convertForX(source, output, 0)
			expect(inspectEncodedVideo(output)).toMatchObject({
				width: 1920,
				height: 1080,
				frameRate: '30/1',
				codec: 'h264',
				pixelFormat: 'yuv420p',
			})
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	},
	60_000,
)
