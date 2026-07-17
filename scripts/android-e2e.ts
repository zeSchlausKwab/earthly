#!/usr/bin/env bun

import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	androidScenarios,
	androidTasks,
	catalogMarkdown,
} from '../android-suite/catalog'
import { parseAdbDevices } from './install-android-dev'

export type AndroidE2ECommand = 'list' | 'emulator' | 'smoke' | 'help'

export interface AndroidE2EOptions {
	command: AndroidE2ECommand
	serial?: string
	avd: string
	build: boolean
	preserveData: boolean
	allowPhysical: boolean
	headless: boolean
	format: 'markdown' | 'json'
}

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ANDROID_ROOT = join(REPO_ROOT, 'src-tauri', 'gen', 'android')
const PACKAGE = 'city.earthly'
const TEST_PACKAGE = 'city.earthly.test'
const TEST_RUNNER = `${TEST_PACKAGE}/androidx.test.runner.AndroidJUnitRunner`
const TEST_CLASS = 'city.earthly.e2e.EarthlySmokeTest'
const DEFAULT_AVD = process.env.EARTHLY_ANDROID_AVD || 'Medium_Phone_API_36.1'

export function parseAndroidE2EOptions(argv: string[]): AndroidE2EOptions {
	let command: AndroidE2ECommand = 'smoke'
	let commandSeen = false
	const options: AndroidE2EOptions = {
		command,
		avd: DEFAULT_AVD,
		build: true,
		preserveData: false,
		allowPhysical: false,
		headless: false,
		format: 'markdown',
	}
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]
		if (!argument) continue
		if (['list', 'emulator', 'smoke', 'help'].includes(argument)) {
			if (commandSeen) throw new Error(`Multiple commands provided: ${command}, ${argument}`)
			command = argument as AndroidE2ECommand
			options.command = command
			commandSeen = true
			continue
		}
		const readValue = (name: string): string => {
			const inline = argument.startsWith(`${name}=`)
				? argument.slice(name.length + 1)
				: undefined
			if (inline !== undefined) {
				if (!inline) throw new Error(`${name} requires a value`)
				return inline
			}
			const next = argv[index + 1]
			if (!next || next.startsWith('-')) throw new Error(`${name} requires a value`)
			index += 1
			return next
		}
		if (argument === '--serial' || argument.startsWith('--serial=')) {
			options.serial = readValue('--serial')
		} else if (argument === '--avd' || argument.startsWith('--avd=')) {
			options.avd = readValue('--avd')
		} else if (argument === '--format' || argument.startsWith('--format=')) {
			const format = readValue('--format')
			if (format !== 'markdown' && format !== 'json') {
				throw new Error('--format must be markdown or json')
			}
			options.format = format
		} else if (argument === '--no-build') {
			options.build = false
		} else if (argument === '--preserve-data') {
			options.preserveData = true
		} else if (argument === '--allow-physical') {
			options.allowPhysical = true
		} else if (argument === '--headless') {
			options.headless = true
		} else if (argument === '--help' || argument === '-h') {
			options.command = 'help'
		} else {
			throw new Error(`Unknown option or command: ${argument}`)
		}
	}
	return options
}

export function instrumentationSucceeded(output: string): boolean {
	return (
		/\bOK \(\d+ tests?\)/u.test(output) &&
		!output.includes('FAILURES!!!') &&
		!output.includes('INSTRUMENTATION_FAILED') &&
		!output.includes('Process crashed')
	)
}

function usage(): string {
	return `Run deterministic Earthly Android tests

Usage:
  bun run e2e:android:list [--format markdown|json]
  bun run e2e:android:emulator [--avd NAME] [--headless]
  bun run e2e:android:smoke [--serial DEVICE] [--no-build]

Options:
  --serial DEVICE    Target one ADB device (emulators are required by default)
  --avd NAME         AVD to start when no emulator is running (${DEFAULT_AVD})
  --no-build         Reuse the installed app and existing test APK
  --preserve-data    Keep emulator app data instead of starting clean
  --allow-physical   Explicitly allow a physical target; its data is never cleared
  --headless         Start a new emulator without its window
  --format FORMAT    Catalog output: markdown or json
  --help, -h         Show this help`
}

async function capture(
	command: string[],
	label: string,
	options: { cwd?: string; allowFailure?: boolean; env?: Record<string, string> } = {},
): Promise<{ output: string; exitCode: number }> {
	const child = Bun.spawn(command, {
		cwd: options.cwd || REPO_ROOT,
		env: { ...process.env, ...options.env },
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	])
	const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
	if (exitCode !== 0 && !options.allowFailure) {
		throw new Error(`${label} failed${output ? `:\n${output}` : ''}`)
	}
	return { output, exitCode }
}

async function adbDevices() {
	return parseAdbDevices((await capture(['adb', 'devices', '-l'], 'ADB discovery')).output)
}

function isEmulator(serial: string): boolean {
	return serial.startsWith('emulator-')
}

async function delay(milliseconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function emulatorPath(): string {
	const androidHome = process.env.ANDROID_HOME || join(homedir(), 'Library', 'Android', 'sdk')
	return join(androidHome, 'emulator', 'emulator')
}

async function waitForBoot(serial: string): Promise<void> {
	const deadline = Date.now() + 180_000
	while (Date.now() < deadline) {
		const state = await capture(
			['adb', '-s', serial, 'get-state'],
			`Waiting for ${serial}`,
			{ allowFailure: true },
		)
		const booted = await capture(
			['adb', '-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
			`Waiting for ${serial} to boot`,
			{ allowFailure: true },
		)
		if (state.output.trim() === 'device' && booted.output.trim() === '1') return
		await delay(1_000)
	}
	throw new Error(`${serial} did not finish booting within three minutes`)
}

async function ensureEmulator(options: AndroidE2EOptions): Promise<string> {
	const devices = await adbDevices()
	if (options.serial) {
		const selected = devices.find((device) => device.serial === options.serial)
		if (!selected || selected.state !== 'device') {
			throw new Error(`Requested Android device is not ready: ${options.serial}`)
		}
		if (!isEmulator(selected.serial) && !options.allowPhysical) {
			throw new Error('Physical Android devices require the explicit --allow-physical option')
		}
		await waitForBoot(selected.serial)
		return selected.serial
	}
	const running = devices.find(
		(device) => device.state === 'device' && isEmulator(device.serial),
	)
	if (running) {
		await waitForBoot(running.serial)
		return running.serial
	}

	const existing = new Set(devices.map((device) => device.serial))
	const emulator = emulatorPath()
	if (!(await Bun.file(emulator).exists())) {
		throw new Error(`Android emulator was not found: ${emulator}`)
	}
	console.log(`Starting Android emulator ${options.avd}…`)
	const child = Bun.spawn(
		[
			emulator,
			'-avd',
			options.avd,
			'-no-boot-anim',
			'-no-snapshot-save',
			...(options.headless ? ['-no-window'] : []),
		],
		{ cwd: REPO_ROOT, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
	)
	child.unref()

	const deadline = Date.now() + 60_000
	while (Date.now() < deadline) {
		const started = (await adbDevices()).find(
			(device) => isEmulator(device.serial) && !existing.has(device.serial),
		)
		if (started) {
			await waitForBoot(started.serial)
			return started.serial
		}
		await delay(1_000)
	}
	throw new Error(`Android emulator ${options.avd} did not appear in ADB`)
}

function javaHome(): string | undefined {
	if (process.env.JAVA_HOME) return process.env.JAVA_HOME
	return '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
}

interface AndroidTestVariant {
	gradleName: string
	apkPath: string
}

async function testVariantForDevice(serial: string): Promise<AndroidTestVariant> {
	const abi = (
		await capture(
			['adb', '-s', serial, 'shell', 'getprop', 'ro.product.cpu.abi'],
			`Reading the ABI from ${serial}`,
		)
	).output.trim()
	const variant = {
		'arm64-v8a': { gradleName: 'Arm64', outputName: 'arm64' },
		'armeabi-v7a': { gradleName: 'Arm', outputName: 'arm' },
		x86: { gradleName: 'X86', outputName: 'x86' },
		x86_64: { gradleName: 'X86_64', outputName: 'x86_64' },
	}[abi]
	if (!variant) throw new Error(`Android test runner does not support ABI: ${abi || 'unknown'}`)
	return {
		gradleName: variant.gradleName,
		apkPath: join(
			ANDROID_ROOT,
			'app',
			'build',
			'outputs',
			'apk',
			'androidTest',
			variant.outputName,
			'debug',
			`app-${variant.outputName}-debug-androidTest.apk`,
		),
	}
}

async function buildAndInstall(serial: string, testVariant: AndroidTestVariant): Promise<void> {
	console.log(`Building and installing Earthly on ${serial}…`)
	await capture(
		[process.execPath, 'run', 'scripts/install-android-dev.ts', '--debug-only', '--serial', serial],
		'Building and installing the Earthly development app',
	)
	console.log('Building the Android instrumentation APK…')
	await capture(
		[
			'./gradlew',
			`:app:assemble${testVariant.gradleName}DebugAndroidTest`,
			'-x',
			`:app:rustBuild${testVariant.gradleName}Debug`,
		],
		'Android test build',
		{
			cwd: ANDROID_ROOT,
			env: { JAVA_HOME: javaHome() || '' },
		},
	)
	if (!(await Bun.file(testVariant.apkPath).exists())) {
		throw new Error(`Android test APK is missing: ${testVariant.apkPath}`)
	}
	await capture(
		['adb', '-s', serial, 'install', '-r', '-t', testVariant.apkPath],
		'Installing the Android test APK',
	)
}

async function resetEmulatorData(serial: string, options: AndroidE2EOptions): Promise<void> {
	if (options.preserveData || !isEmulator(serial)) return
	console.log('Resetting Earthly app data on the emulator…')
	await capture(['adb', '-s', serial, 'shell', 'pm', 'clear', PACKAGE], 'Resetting Earthly app data')
}

async function failureArtifacts(serial: string, instrumentation: string): Promise<string> {
	const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
	const directory = join(REPO_ROOT, 'android-suite', 'artifacts', `${stamp}-${serial}`)
	await mkdir(directory, { recursive: true })
	await Bun.write(join(directory, 'instrumentation.txt'), instrumentation)
	const logcat = await capture(['adb', '-s', serial, 'logcat', '-d'], 'Reading logcat', {
		allowFailure: true,
	})
	await Bun.write(join(directory, 'logcat.txt'), logcat.output)
	await capture(
		['adb', '-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/earthly-e2e-window.xml'],
		'Dumping the Android UI',
		{ allowFailure: true },
	)
	const hierarchy = await capture(
		['adb', '-s', serial, 'exec-out', 'cat', '/sdcard/earthly-e2e-window.xml'],
		'Reading the Android UI dump',
		{ allowFailure: true },
	)
	await Bun.write(join(directory, 'window.xml'), hierarchy.output)
	const screenshot = Bun.spawn(['adb', '-s', serial, 'exec-out', 'screencap', '-p'], {
		stdout: 'pipe',
		stderr: 'ignore',
	})
	await Bun.write(join(directory, 'screenshot.png'), await new Response(screenshot.stdout).arrayBuffer())
	await screenshot.exited
	return directory
}

async function runSmoke(options: AndroidE2EOptions): Promise<void> {
	const serial = await ensureEmulator(options)
	const testVariant = await testVariantForDevice(serial)
	console.log(`Using Android target ${serial}.`)
	if (options.build) await buildAndInstall(serial, testVariant)
	if (!(await Bun.file(testVariant.apkPath).exists())) {
		throw new Error(
			`Android test APK is missing; run without --no-build first: ${testVariant.apkPath}`,
		)
	}
	await resetEmulatorData(serial, options)
	await capture(['adb', '-s', serial, 'logcat', '-c'], 'Clearing logcat', { allowFailure: true })
	console.log('Running smoke.workspace-app-links…')
	const result = await capture(
		[
			'adb',
			'-s',
			serial,
			'shell',
			'am',
			'instrument',
			'-w',
			'-r',
			'-e',
			'class',
			TEST_CLASS,
			'-e',
			'waitForActivitiesToComplete',
			'false',
			TEST_RUNNER,
		],
		'Android instrumentation',
		{ allowFailure: true },
	)
	console.log(result.output)
	if (result.exitCode !== 0 || !instrumentationSucceeded(result.output)) {
		const artifacts = await failureArtifacts(serial, result.output)
		throw new Error(`Android smoke scenario failed. Diagnostics: ${artifacts}`)
	}
	console.log('Android smoke scenario passed.')
}

async function main(): Promise<void> {
	const options = parseAndroidE2EOptions(process.argv.slice(2))
	if (options.command === 'help') {
		console.log(usage())
		return
	}
	if (options.command === 'list') {
		console.log(
			options.format === 'json'
				? JSON.stringify({ tasks: androidTasks, scenarios: androidScenarios }, null, 2)
				: catalogMarkdown(),
		)
		return
	}
	if (options.command === 'emulator') {
		console.log(await ensureEmulator(options))
		return
	}
	await runSmoke(options)
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error)
		process.exit(1)
	})
}
