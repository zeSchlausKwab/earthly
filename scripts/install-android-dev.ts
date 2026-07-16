import { readdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AdbDevice {
	serial: string
	state: string
	description: string
}

export type TauriAndroidTarget = 'aarch64' | 'armv7' | 'i686' | 'x86_64'
export type AndroidDevBuildMode = 'debug' | 'optimized'

export interface AndroidInstallOptions {
	optimized: boolean
	debugOnly: boolean
	help: boolean
}

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const APK_OUTPUT_ROOT = join(
	REPO_ROOT,
	'src-tauri/gen/android/app/build/outputs/apk',
)
const TARGET_ORDER: TauriAndroidTarget[] = ['aarch64', 'armv7', 'i686', 'x86_64']
const APK_DIRECTORY_BY_TARGET: Record<TauriAndroidTarget, string> = {
	aarch64: 'arm64',
	armv7: 'arm',
	i686: 'x86',
	x86_64: 'x86_64',
}

export function parseAdbDevices(output: string): AdbDevice[] {
	return output
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(
			(line) =>
				line.length > 0 &&
				!line.startsWith('List of devices attached') &&
				!line.startsWith('*'),
		)
		.flatMap((line) => {
			const [serial, state, ...details] = line.split(/\s+/u)
			if (!serial || !state) return []
			return [{ serial, state, description: details.join(' ') }]
		})
}

export function tauriTargetForAbi(abi: string): TauriAndroidTarget | undefined {
	switch (abi.trim()) {
		case 'arm64-v8a':
			return 'aarch64'
		case 'armeabi-v7a':
			return 'armv7'
		case 'x86':
			return 'i686'
		case 'x86_64':
			return 'x86_64'
		default:
			return undefined
	}
}

export function parseInstallOptions(argv: string[]): AndroidInstallOptions {
	const options: AndroidInstallOptions = { optimized: false, debugOnly: false, help: false }
	for (const argument of argv) {
		switch (argument) {
			case '--optimized':
				options.optimized = true
				break
			case '--debug-only':
				options.debugOnly = true
				break
			case '--help':
			case '-h':
				options.help = true
				break
			default:
				throw new Error(`Unknown option: ${argument}`)
		}
	}
	if (options.optimized && options.debugOnly) {
		throw new Error('--optimized and --debug-only cannot be used together')
	}
	return options
}

export function needsOptimizedFallback(message: string): boolean {
	return message.includes('INSTALL_FAILED_INSUFFICIENT_STORAGE')
}

function printUsage(): void {
	console.log(`Install Earthly on every authorized Android device

Usage:
  bun run tauri:android:install:dev [--optimized | --debug-only]

Options:
  --optimized   Build the compact optimized APK immediately
  --debug-only  Do not retry a low-storage device with an optimized APK
  --help, -h    Show this help

The default builds debuggable split APKs. If Android rejects one for insufficient
installer space, only the affected ABI is rebuilt as an optimized APK, signed with
the standard development key, and installed without clearing app data.`)
}

async function capture(command: string[], label: string): Promise<string> {
	const child = Bun.spawn(command, {
		cwd: REPO_ROOT,
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	])
	if (exitCode !== 0) {
		throw new Error(`${label} failed${stderr.trim() ? `: ${stderr.trim()}` : ''}`)
	}
	return stdout.trim()
}

async function run(command: string[], label: string): Promise<void> {
	const child = Bun.spawn(command, {
		cwd: REPO_ROOT,
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit',
	})
	const exitCode = await child.exited
	if (exitCode !== 0) throw new Error(`${label} failed with exit code ${exitCode}`)
}

function deviceLabel(device: AdbDevice): string {
	const model = /(?:^|\s)model:([^\s]+)/u.exec(device.description)?.[1]?.replaceAll('_', ' ')
	return model ? `${model} (${device.serial})` : device.serial
}

async function apkForTarget(
	target: TauriAndroidTarget,
	mode: AndroidDevBuildMode,
): Promise<string> {
	const profile = mode === 'debug' ? 'debug' : 'release'
	const directory = join(APK_OUTPUT_ROOT, APK_DIRECTORY_BY_TARGET[target], profile)
	const metadataPath = join(directory, 'output-metadata.json')
	if (!(await Bun.file(metadataPath).exists())) {
		throw new Error(`Gradle did not produce ${mode} metadata for ${target}: ${metadataPath}`)
	}
	const metadata = (await Bun.file(metadataPath).json()) as {
		elements?: Array<{ outputFile?: string }>
	}
	const outputFile = metadata.elements?.find((element) => element.outputFile)?.outputFile
	if (!outputFile) throw new Error(`Gradle metadata contains no APK for ${target}`)
	const apkPath = join(directory, outputFile)
	if (!(await Bun.file(apkPath).exists())) throw new Error(`Built APK is missing: ${apkPath}`)
	return apkPath
}

async function findApkSigner(): Promise<string> {
	const androidHome = process.env.ANDROID_HOME
	if (!androidHome) throw new Error('ANDROID_HOME is required to sign an optimized development APK')
	const buildTools = join(androidHome, 'build-tools')
	const versions = (await readdir(buildTools, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
	for (const version of versions) {
		const candidate = join(buildTools, version, 'apksigner')
		if (await Bun.file(candidate).exists()) return candidate
	}
	throw new Error(`Android apksigner was not found below ${buildTools}`)
}

async function signOptimizedApk(target: TauriAndroidTarget, apk: string): Promise<string> {
	const keystore = join(homedir(), '.android', 'debug.keystore')
	if (!(await Bun.file(keystore).exists())) {
		throw new Error(`The standard Android development keystore is missing: ${keystore}`)
	}
	const output = join(tmpdir(), `earthly-${target}-optimized-dev.apk`)
	await run(
		[
			await findApkSigner(),
			'sign',
			'--ks',
			keystore,
			'--ks-pass',
			'pass:android',
			'--key-pass',
			'pass:android',
			'--out',
			output,
			apk,
		],
		`Signing the optimized ${target} development APK`,
	)
	return output
}

async function buildApks(
	targets: TauriAndroidTarget[],
	mode: AndroidDevBuildMode,
): Promise<Map<TauriAndroidTarget, string>> {
	console.log(`Building ${mode} Earthly APKs (${targets.join(', ')})…`)
	await run(
		[
			process.execPath,
			'run',
			'tauri',
			'android',
			'build',
			...(mode === 'debug' ? ['--debug'] : []),
			'--apk',
			'--ci',
			'--split-per-abi',
			'--target',
			...targets,
		],
		`Android ${mode} development build`,
	)
	return new Map(
		await Promise.all(
			targets.map(async (target) => {
				const apk = await apkForTarget(target, mode)
				return [target, mode === 'debug' ? apk : await signOptimizedApk(target, apk)] as const
			}),
		),
	)
}

interface DetectedDevice {
	device: AdbDevice
	abi: string
	target: TauriAndroidTarget | undefined
}

interface InstallFailure {
	detected: DetectedDevice
	message: string
}

async function installOnDevices(
	detected: DetectedDevice[],
	apks: Map<TauriAndroidTarget, string>,
): Promise<InstallFailure[]> {
	const installs = await Promise.allSettled(
		detected.map(async (item) => {
			const { device, target } = item
			if (!target) throw new Error(`No build target for ${device.serial}`)
			const apk = apks.get(target)
			if (!apk) throw new Error(`No ${target} APK was built`)
			const output = await capture(
				['adb', '-s', device.serial, 'install', '-r', '-t', apk],
				`Installing on ${deviceLabel(device)}`,
			)
			return { device, output }
		}),
	)
	const failures: InstallFailure[] = []
	for (const [index, result] of installs.entries()) {
		const item = detected[index]
		if (!item) continue
		if (result.status === 'fulfilled') {
			console.log(`Installed on ${deviceLabel(result.value.device)} (${result.value.output})`)
		} else {
			failures.push({
				detected: item,
				message: result.reason instanceof Error ? result.reason.message : String(result.reason),
			})
		}
	}
	return failures
}

async function main(): Promise<void> {
	const options = parseInstallOptions(process.argv.slice(2))
	if (options.help) {
		printUsage()
		return
	}
	const devices = parseAdbDevices(await capture(['adb', 'devices', '-l'], 'ADB discovery'))
	const ready = devices.filter((device) => device.state === 'device')
	const unavailable = devices.filter((device) => device.state !== 'device')

	for (const device of unavailable) {
		console.warn(`Skipping ${device.serial}: ADB state is ${device.state}`)
	}
	if (ready.length === 0) {
		throw new Error(
			'No authorized Android devices are connected. Check USB/Wi-Fi debugging and run `adb devices -l`.',
		)
	}

	const detected = await Promise.all(
		ready.map(async (device) => {
			const abi = await capture(
				['adb', '-s', device.serial, 'shell', 'getprop', 'ro.product.cpu.abi'],
				`Reading the ABI from ${device.serial}`,
			)
			return { device, abi, target: tauriTargetForAbi(abi) }
		}),
	)
	const unsupported = detected.filter((item) => !item.target)
	if (unsupported.length > 0) {
		throw new Error(
			`Unsupported Android ABI: ${unsupported
				.map((item) => `${deviceLabel(item.device)}=${item.abi || 'unknown'}`)
				.join(', ')}`,
		)
	}

	const targets = TARGET_ORDER.filter((target) =>
		detected.some((item) => item.target === target),
	)
	const initialMode: AndroidDevBuildMode = options.optimized ? 'optimized' : 'debug'
	let failures = await installOnDevices(detected, await buildApks(targets, initialMode))
	if (!options.optimized && !options.debugOnly) {
		const lowStorage = failures.filter((failure) => needsOptimizedFallback(failure.message))
		if (lowStorage.length > 0) {
			console.warn(
				`Android reserved too much installer space on ${lowStorage.length} device${lowStorage.length === 1 ? '' : 's'}; retrying with a compact optimized development APK…`,
			)
			const fallbackTargets = TARGET_ORDER.filter((target) =>
				lowStorage.some((failure) => failure.detected.target === target),
			)
			const retried = await installOnDevices(
				lowStorage.map((failure) => failure.detected),
				await buildApks(fallbackTargets, 'optimized'),
			)
			failures = [
				...failures.filter((failure) => !needsOptimizedFallback(failure.message)),
				...retried,
			]
		}
	}
	if (failures.length > 0) {
		throw new Error(
			`Installation failed:\n- ${failures
				.map(
					(failure) =>
						`${deviceLabel(failure.detected.device)}: ${failure.message}`,
				)
				.join('\n- ')}`,
		)
	}

	console.log('Development APK installed on every authorized connected Android device.')
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error)
		process.exit(1)
	})
}
