import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { chromium, expect, type Browser, type BrowserContext } from '@playwright/test'
import { loadLiveAiSettings } from '../core/chat-provider-settings'
import { resolveEnvironment } from '../core/environment'
import { EarthlySession } from '../core/session'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	completeAiChatTurn,
	configureChatProvider,
	openAiChat,
	selectAiChatTarget,
	sendAiChatMessage,
} from '../tasks/chat/conversation'
import { testIdentities } from '../test-identities'
import { installNip07Adapter } from '../test-identities/nip07-adapter'
import { loadCampaignDemoManifest, type CampaignDemoManifest, type XAccountTier } from './manifest'
import { tourDemoResult } from './tour'

type RunMode = 'check' | 'rehearse' | 'record'

interface CliInput {
	mode: RunMode
	manifestPath: string
}

export interface EncodedVideoMetadata {
	width: number
	height: number
	durationSeconds: number
	frameRate: string
	bitRate: number
	fileSizeBytes: number
	codec: string
	pixelFormat: string
	container: string
}

const X_VIDEO_LIMITS = {
	standard: { durationSeconds: 140, maximumFileBytes: 512_000_000 },
	premium: { durationSeconds: 4 * 60 * 60, maximumFileBytes: 16_000_000_000 },
} as const

export function validateXVideoConstraints(video: EncodedVideoMetadata, tier: XAccountTier): void {
	const limits = X_VIDEO_LIMITS[tier]
	const tooLong =
		tier === 'premium'
			? video.durationSeconds >= limits.durationSeconds
			: video.durationSeconds > limits.durationSeconds
	if (tooLong) {
		throw new Error(
			`${tier === 'premium' ? 'Premium' : 'Standard'} X video must be ${tier === 'premium' ? 'shorter than 4 hours' : '140 seconds or shorter'}; received ${video.durationSeconds.toFixed(1)} seconds.`,
		)
	}
	if (video.fileSizeBytes > limits.maximumFileBytes) {
		throw new Error(
			`${tier === 'premium' ? 'Premium' : 'Standard'} X video exceeds the ${tier === 'premium' ? '16 GB' : '512 MB'} upload limit.`,
		)
	}
}

function usage(): string {
	return [
		'Usage:',
		'  bun run demo:check -- <manifest.json>',
		'  bun run demo:rehearse -- <manifest.json>',
		'  bun run demo:record -- <manifest.json>',
	].join('\n')
}

function parseCli(argv: string[]): CliInput {
	const modeFlag = argv.find((value) => ['--check', '--rehearse', '--record'].includes(value))
	const manifestArg = argv.find((value) => !value.startsWith('--'))
	if (!modeFlag || !manifestArg) throw new Error(usage())
	return { mode: modeFlag.slice(2) as RunMode, manifestPath: resolve(manifestArg) }
}

function timestamp(): string {
	return new Date()
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z')
}

function ffmpegPath(): string {
	const path = Bun.which('ffmpeg')
	if (!path) throw new Error('ffmpeg is required to create an X-ready MP4. Install it and retry.')
	return path
}

function ffprobePath(): string {
	const path = Bun.which('ffprobe')
	if (!path)
		throw new Error('ffprobe is required to verify the recorded MP4. Install it and retry.')
	return path
}

export function convertForX(input: string, output: string, trimSeconds: number): void {
	execFileSync(
		ffmpegPath(),
		[
			'-hide_banner',
			'-loglevel',
			'error',
			'-ss',
			Math.max(0, trimSeconds).toFixed(3),
			'-i',
			input,
			'-vf',
			'fps=30,format=yuv420p',
			'-c:v',
			'libx264',
			'-preset',
			'medium',
			'-crf',
			'18',
			'-maxrate',
			'12M',
			'-bufsize',
			'24M',
			'-movflags',
			'+faststart',
			'-an',
			output,
		],
		{ stdio: 'pipe' },
	)
}

export function inspectEncodedVideo(path: string): EncodedVideoMetadata {
	const raw = execFileSync(
		ffprobePath(),
		[
			'-v',
			'error',
			'-select_streams',
			'v:0',
			'-show_entries',
			'stream=codec_name,pix_fmt,width,height,r_frame_rate,bit_rate:format=format_name,duration,bit_rate,size',
			'-of',
			'json',
			path,
		],
		{ encoding: 'utf8' },
	)
	const result = JSON.parse(raw) as {
		streams?: Array<{
			codec_name?: string
			pix_fmt?: string
			width?: number
			height?: number
			r_frame_rate?: string
			bit_rate?: string
		}>
		format?: { format_name?: string; duration?: string; bit_rate?: string; size?: string }
	}
	const stream = result.streams?.[0]
	const durationSeconds = Number(result.format?.duration)
	const fileSizeBytes = Number(result.format?.size ?? statSync(path).size)
	const container = result.format?.format_name ?? ''
	if (
		stream?.width !== 1920 ||
		stream.height !== 1080 ||
		stream.r_frame_rate !== '30/1' ||
		stream.codec_name !== 'h264' ||
		stream.pix_fmt !== 'yuv420p' ||
		!container.split(',').includes('mp4') ||
		!Number.isFinite(durationSeconds) ||
		durationSeconds <= 0 ||
		!Number.isFinite(fileSizeBytes) ||
		fileSizeBytes <= 0
	) {
		throw new Error(
			'Encoded video failed the MP4/H.264/yuv420p, 1920×1080, 30 fps output verification.',
		)
	}
	const reportedBitRate = Number(stream.bit_rate ?? result.format?.bit_rate)
	const bitRate = Number.isFinite(reportedBitRate)
		? reportedBitRate
		: (fileSizeBytes * 8) / durationSeconds
	if (!Number.isFinite(bitRate) || bitRate <= 0 || bitRate > 25_000_000) {
		throw new Error("Encoded video exceeds X's 25 Mbps web upload limit.")
	}
	return {
		width: stream.width,
		height: stream.height,
		durationSeconds,
		frameRate: stream.r_frame_rate,
		bitRate,
		fileSizeBytes,
		codec: stream.codec_name,
		pixelFormat: stream.pix_fmt,
		container,
	}
}

async function prepareStorageState(
	browser: Browser,
	manifest: CampaignDemoManifest,
): Promise<Awaited<ReturnType<BrowserContext['storageState']>>> {
	const settings = loadLiveAiSettings()
	if (!settings) {
		throw new Error(
			'Set EARTHLY_LIVE_AI_SETTINGS_FILE to an exported chat-settings snapshot before rehearsing or recording.',
		)
	}
	const environment = resolveEnvironment()
	const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
	try {
		const earthly = new EarthlySession(await context.newPage(), environment)
		await authorizeJourneyIdentity(earthly, 'owner')
		await configureChatProvider(earthly, { ...settings, safetyLevel: manifest.safetyLevel })
		return await context.storageState({ indexedDB: true })
	} finally {
		await context.close()
	}
}

async function runPromptChain(
	earthly: EarthlySession,
	manifest: CampaignDemoManifest,
): Promise<void> {
	for (const prompt of manifest.prompts) {
		const before = await earthly.page
			.getByRole('region', { name: 'AI chat', exact: true })
			.getByTitle('Copy assistant message')
			.count()
		await sendAiChatMessage(earthly, prompt.text, { typingDelayMs: manifest.typingDelayMs })
		await completeAiChatTurn(earthly, before, {
			approvals: prompt.approvals,
			timeoutMs: manifest.maxTurnMs,
		})
	}
	await tourDemoResult(earthly, manifest.tour)
}

async function runBrowserDemo(manifest: CampaignDemoManifest, mode: Exclude<RunMode, 'check'>) {
	const environment = resolveEnvironment()
	const temporaryVideoDir = mkdtempSync(join(tmpdir(), 'earthly-demo-'))
	const browser = await chromium.launch({
		headless: environment.headless,
		slowMo: manifest.actionDelayMs,
	})
	let recordingContext: BrowserContext | undefined
	try {
		const storageState = await prepareStorageState(browser, manifest)
		recordingContext = await browser.newContext({
			storageState,
			viewport: { width: 1920, height: 1080 },
			deviceScaleFactor: 1,
			recordVideo:
				mode === 'record'
					? { dir: temporaryVideoDir, size: { width: 1920, height: 1080 } }
					: undefined,
		})
		const page = await recordingContext.newPage()
		const recordingStartedAt = Date.now()
		await installNip07Adapter(page, testIdentities.owner)
		const earthly = new EarthlySession(page, environment)
		await earthly.open({ path: manifest.startPath, tour: 'seen', discover: 'seen' })
		await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
		await openAiChat(earthly)
		// Target choice is setup, not campaign content. Make the binding visible and
		// stable before establishing the trim point so the clip begins with typing.
		await selectAiChatTarget(earthly, manifest.target)
		const contentStartedAt = Date.now()
		await runPromptChain(earthly, manifest)

		if (mode === 'rehearse') return null
		const video = page.video()
		if (!video) throw new Error('Playwright did not start the requested recording.')
		await recordingContext.close()
		recordingContext = undefined

		const artifactDirectory = resolve('ai-suite/artifacts/demos', manifest.id)
		mkdirSync(artifactDirectory, { recursive: true })
		const artifactStem = `${manifest.id}-${timestamp()}`
		const rawVideo = join(temporaryVideoDir, `${artifactStem}.webm`)
		const mp4 = join(artifactDirectory, `${artifactStem}.mp4`)
		if (existsSync(mp4)) throw new Error(`Refusing to overwrite existing artifact: ${mp4}`)
		await video.saveAs(rawVideo)
		convertForX(rawVideo, mp4, (contentStartedAt - recordingStartedAt) / 1_000)
		const encodedVideo = inspectEncodedVideo(mp4)
		validateXVideoConstraints(encodedVideo, manifest.xAccountTier)
		writeFileSync(join(artifactDirectory, `${artifactStem}-post.txt`), `${manifest.post}\n`)
		if (manifest.videoAltText) {
			writeFileSync(
				join(artifactDirectory, `${artifactStem}-alt.txt`),
				`${manifest.videoAltText}\n`,
			)
		}
		writeFileSync(
			join(artifactDirectory, `${artifactStem}-details.json`),
			`${JSON.stringify(
				{
					id: manifest.id,
					title: manifest.title,
					video: { file: basename(mp4), ...encodedVideo },
					prompts: manifest.prompts,
					target: manifest.target,
					tour: manifest.tour,
					xAccountTier: manifest.xAccountTier,
				},
				null,
				2,
			)}\n`,
		)
		return { directory: artifactDirectory, video: mp4 }
	} finally {
		if (recordingContext) await recordingContext.close()
		await browser.close()
		rmSync(temporaryVideoDir, { recursive: true, force: true })
	}
}

async function main(): Promise<void> {
	const input = parseCli(process.argv.slice(2))
	if (extname(input.manifestPath) !== '.json') throw new Error('Demo manifests must be JSON files.')
	const manifest = loadCampaignDemoManifest(input.manifestPath)
	console.log(`✓ ${manifest.title}`)
	console.log(`  ${manifest.prompts.length} prompt(s) · ${manifest.tour.join(' + ')} tour`)
	if (input.mode === 'check') return

	const result = await runBrowserDemo(manifest, input.mode)
	if (!result) {
		console.log('✓ Rehearsal completed without creating a video.')
		return
	}
	console.log(`✓ Video: ${result.video}`)
	console.log(`✓ Post package: ${result.directory}`)
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error)
		console.error(`Demo recording failed: ${message}`)
		process.exitCode = 1
	})
}
