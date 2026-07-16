import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AdbDevice {
	serial: string
	state: string
	description: string
}

export type TauriAndroidTarget = 'aarch64' | 'armv7' | 'i686' | 'x86_64'

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

async function apkForTarget(target: TauriAndroidTarget): Promise<string> {
	const directory = join(APK_OUTPUT_ROOT, APK_DIRECTORY_BY_TARGET[target], 'debug')
	const metadataPath = join(directory, 'output-metadata.json')
	if (!(await Bun.file(metadataPath).exists())) {
		throw new Error(`Gradle did not produce metadata for ${target}: ${metadataPath}`)
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

async function main(): Promise<void> {
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
	console.log(
		`Building Earthly for ${ready.length} device${ready.length === 1 ? '' : 's'} (${targets.join(', ')})…`,
	)
	await run(
		[
			process.execPath,
			'run',
			'tauri',
			'android',
			'build',
			'--debug',
			'--apk',
			'--ci',
			'--split-per-abi',
			'--target',
			...targets,
		],
		'Android development build',
	)

	const apks = new Map(
		await Promise.all(targets.map(async (target) => [target, await apkForTarget(target)] as const)),
	)
	const installs = await Promise.allSettled(
		detected.map(async ({ device, target }) => {
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

	const failures: string[] = []
	for (const [index, result] of installs.entries()) {
		const device = detected[index]?.device
		if (result.status === 'fulfilled') {
			console.log(`Installed on ${deviceLabel(result.value.device)} (${result.value.output})`)
		} else {
			failures.push(
				`${device ? deviceLabel(device) : `device ${index + 1}`}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
			)
		}
	}
	if (failures.length > 0) throw new Error(`Installation failed:\n- ${failures.join('\n- ')}`)

	console.log('Development APK installed on every authorized connected Android device.')
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error)
		process.exit(1)
	})
}
