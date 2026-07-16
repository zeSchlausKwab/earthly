#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PUBLIC_ENV_PATH = join(REPO_ROOT, 'config', 'android-release.env')
const TAURI_CONFIG_PATH = join(REPO_ROOT, 'src-tauri', 'tauri.conf.json')
const CARGO_MANIFEST_PATH = join(REPO_ROOT, 'src-tauri', 'Cargo.toml')
const PACKAGE_PATH = join(REPO_ROOT, 'package.json')
const KEYSTORE_PROPERTIES_PATH = join(
	REPO_ROOT,
	'src-tauri',
	'gen',
	'android',
	'keystore.properties',
)
const ANDROID_ROOT = join(REPO_ROOT, 'src-tauri', 'gen', 'android')
const BUILD_OUTPUT_ROOT = join(ANDROID_ROOT, 'app', 'build', 'outputs')
const PUBLIC_ENV_KEYS = new Set([
	'RELAY_URL',
	'EXTRA_READ_RELAYS',
	'BLOSSOM_SERVER',
	'MAPNOLIA_TRUSTED_PUBKEYS',
	'SERVER_PUBKEY',
	'CORDN_SERVER_PUBKEY',
])

export interface AndroidReleaseMetadata {
	packageName: string
	versionName: string
	versionCode: number
}

export interface ReleaseVersions {
	packageVersion: string
	tauriVersion: string
	cargoVersion: string
	versionCode: number
}

export function parsePublicReleaseEnvironment(contents: string): Record<string, string> {
	const values: Record<string, string> = {}
	for (const [index, rawLine] of contents.split(/\r?\n/u).entries()) {
		const line = rawLine.trim()
		if (!line || line.startsWith('#')) continue
		const separator = line.indexOf('=')
		if (separator <= 0) {
			throw new Error(`Invalid public Android environment entry on line ${index + 1}`)
		}
		const key = line.slice(0, separator).trim()
		if (!PUBLIC_ENV_KEYS.has(key)) {
			throw new Error(`${key} is not an allowed public Android environment value`)
		}
		values[key] = line.slice(separator + 1).trim()
	}
	for (const key of PUBLIC_ENV_KEYS) {
		if (!(key in values)) throw new Error(`Public Android environment is missing ${key}`)
	}
	for (const key of ['RELAY_URL', 'EXTRA_READ_RELAYS']) {
		for (const value of (values[key] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)) {
			const url = new URL(value)
			if (url.protocol !== 'wss:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
				throw new Error(`${key} must contain only secure public wss:// relay URLs`)
			}
		}
	}
	const blossomUrl = new URL(values.BLOSSOM_SERVER as string)
	if (blossomUrl.protocol !== 'https:') {
		throw new Error('BLOSSOM_SERVER must use https:// in the Android release')
	}
	for (const key of ['SERVER_PUBKEY', 'CORDN_SERVER_PUBKEY', 'MAPNOLIA_TRUSTED_PUBKEYS']) {
		const pubkeys = (values[key] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
		if (pubkeys.length === 0 || pubkeys.some((value) => !/^[0-9a-f]{64}$/u.test(value))) {
			throw new Error(`${key} must contain lowercase 64-character public keys`)
		}
	}
	return values
}

export function validateReleaseVersions(versions: ReleaseVersions, gitRef?: string): string[] {
	const errors: string[] = []
	if (versions.packageVersion !== versions.tauriVersion) {
		errors.push('package.json and tauri.conf.json versions differ')
	}
	if (versions.packageVersion !== versions.cargoVersion) {
		errors.push('package.json and src-tauri/Cargo.toml versions differ')
	}
	if (!Number.isSafeInteger(versions.versionCode) || versions.versionCode <= 0) {
		errors.push('Android versionCode must be a positive integer')
	}
	if (gitRef?.startsWith('v') && gitRef.slice(1) !== versions.packageVersion) {
		errors.push(`Git tag ${gitRef} does not match version ${versions.packageVersion}`)
	}
	return errors
}

export function releaseArtifactNames(metadata: AndroidReleaseMetadata): {
	apk: string
	aab: string
} {
	const stem = `earthly-${metadata.versionName}-arm64-v8a`
	return { apk: `${stem}.apk`, aab: `${stem}.aab` }
}

export function parseApkCertificateFingerprint(output: string): string {
	const digest = /certificate SHA-256 digest:\s*([0-9a-f]{64})/iu.exec(output)?.[1]
	if (!digest) throw new Error('Could not read the APK signing certificate fingerprint')
	return digest
		.toUpperCase()
		.match(/.{2}/gu)
		?.join(':') ?? ''
}

export function androidAssetLinksStatement(
	packageName: string,
	certificateFingerprint: string,
): unknown[] {
	return [
		{
			relation: ['delegate_permission/common.handle_all_urls'],
			target: {
				namespace: 'android_app',
				package_name: packageName,
				sha256_cert_fingerprints: [certificateFingerprint],
			},
		},
	]
}

function cargoPackageVersion(contents: string): string {
	const packageSection = contents.split(/^\[package\]\s*$/mu)[1]?.split(/^\[/mu)[0]
	const version = /^version\s*=\s*"([^"]+)"\s*$/mu.exec(packageSection ?? '')?.[1]
	if (!version) throw new Error('Could not read the Earthly package version from Cargo.toml')
	return version
}

async function readReleaseMetadata(): Promise<AndroidReleaseMetadata> {
	const packageJson = (await Bun.file(PACKAGE_PATH).json()) as { version?: string }
	const tauriConfig = (await Bun.file(TAURI_CONFIG_PATH).json()) as {
		identifier?: string
		version?: string
		bundle?: { android?: { versionCode?: number } }
	}
	const versions: ReleaseVersions = {
		packageVersion: packageJson.version ?? '',
		tauriVersion: tauriConfig.version ?? '',
		cargoVersion: cargoPackageVersion(await readFile(CARGO_MANIFEST_PATH, 'utf8')),
		versionCode: tauriConfig.bundle?.android?.versionCode ?? 0,
	}
	const errors = validateReleaseVersions(versions, process.env.GITHUB_REF_NAME)
	if (errors.length > 0) throw new Error(`Android release metadata is invalid:\n- ${errors.join('\n- ')}`)
	if (tauriConfig.identifier !== 'city.earthly') {
		throw new Error(`Expected Android application id city.earthly, got ${tauriConfig.identifier}`)
	}
	return {
		packageName: tauriConfig.identifier,
		versionName: versions.packageVersion,
		versionCode: versions.versionCode,
	}
}

async function capture(command: string[], label: string, env?: Record<string, string>): Promise<string> {
	const child = Bun.spawn(command, {
		cwd: REPO_ROOT,
		env: { ...process.env, ...env },
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	])
	if (exitCode !== 0) {
		throw new Error(`${label} failed${stderr.trim() ? `:\n${stderr.trim()}` : ''}`)
	}
	return stdout.trim()
}

async function run(command: string[], label: string, env?: Record<string, string>): Promise<void> {
	const child = Bun.spawn(command, {
		cwd: REPO_ROOT,
		env: { ...process.env, ...env },
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit',
	})
	if ((await child.exited) !== 0) throw new Error(`${label} failed`)
}

async function signingProperties(): Promise<Record<string, string>> {
	if (!(await Bun.file(KEYSTORE_PROPERTIES_PATH).exists())) {
		throw new Error(
			`Android release signing is not configured. Create ${relative(REPO_ROOT, KEYSTORE_PROPERTIES_PATH)} as documented in docs/ANDROID-RELEASE.md.`,
		)
	}
	const values: Record<string, string> = {}
	for (const rawLine of (await readFile(KEYSTORE_PROPERTIES_PATH, 'utf8')).split(/\r?\n/u)) {
		const line = rawLine.trim()
		if (!line || line.startsWith('#')) continue
		const separator = line.indexOf('=')
		if (separator > 0) values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
	}
	for (const key of ['storeFile', 'password', 'keyAlias']) {
		if (!values[key]) throw new Error(`Android keystore.properties is missing ${key}`)
	}
	const storeFile = values.storeFile as string
	const resolvedStore = isAbsolute(storeFile) ? storeFile : resolve(ANDROID_ROOT, storeFile)
	if (!(await Bun.file(resolvedStore).exists())) {
		throw new Error(`Android release keystore does not exist: ${resolvedStore}`)
	}
	return values
}

async function walk(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true })
	return (
		await Promise.all(
			entries.map((entry) => {
				const path = join(directory, entry.name)
				return entry.isDirectory() ? walk(path) : Promise.resolve([path])
			}),
		)
	).flat()
}

async function findBuiltArtifact(extension: '.apk' | '.aab'): Promise<string> {
	const candidates = (await walk(BUILD_OUTPUT_ROOT)).filter(
		(path) =>
			path.endsWith(extension) &&
			path.toLowerCase().includes('release') &&
			(path.includes('/arm64/') || path.includes('/arm64Release/')),
	)
	if (extension === '.apk') {
		const signed = candidates.filter((path) => !path.endsWith('-unsigned.apk'))
		if (signed.length === 1) return signed[0] as string
		if (signed.length === 0 && candidates.length > 0) {
			throw new Error('Gradle produced only an unsigned release APK')
		}
		if (signed.length > 1) throw new Error(`Multiple signed release APKs found:\n${signed.join('\n')}`)
	}
	if (candidates.length !== 1) {
		throw new Error(`Expected one arm64 release ${extension}, found ${candidates.length}`)
	}
	return candidates[0] as string
}

async function findAndroidBuildTool(name: string): Promise<string> {
	const androidHome = process.env.ANDROID_HOME ?? join(homedir(), 'Library', 'Android', 'sdk')
	const directory = join(androidHome, 'build-tools')
	const versions = (await readdir(directory, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
	for (const version of versions) {
		const candidate = join(directory, version, name)
		if (await Bun.file(candidate).exists()) return candidate
	}
	throw new Error(`${name} was not found below ${directory}`)
}

async function verifyApk(apk: string, expected: AndroidReleaseMetadata): Promise<string> {
	const signature = await capture(
		[await findAndroidBuildTool('apksigner'), 'verify', '--verbose', '--print-certs', apk],
		'APK signature verification',
	)
	const badging = await capture([await findAndroidBuildTool('aapt'), 'dump', 'badging', apk], 'APK metadata inspection')
	const packageLine = badging.split(/\r?\n/u).find((line) => line.startsWith('package:')) ?? ''
	for (const [label, value] of [
		['name', expected.packageName],
		['versionCode', String(expected.versionCode)],
		['versionName', expected.versionName],
	] as const) {
		if (!packageLine.includes(`${label}='${value}'`)) {
			throw new Error(`Release APK ${label} does not match ${value}: ${packageLine}`)
		}
	}
	return parseApkCertificateFingerprint(signature)
}

async function sha256(path: string): Promise<string> {
	const hash = createHash('sha256')
	for await (const chunk of createReadStream(path)) hash.update(chunk)
	return hash.digest('hex')
}

async function check(): Promise<AndroidReleaseMetadata> {
	const metadata = await readReleaseMetadata()
	parsePublicReleaseEnvironment(await readFile(PUBLIC_ENV_PATH, 'utf8'))
	console.log(
		`Android release metadata is consistent: ${metadata.packageName} ${metadata.versionName} (${metadata.versionCode}).`,
	)
	return metadata
}

async function build(): Promise<void> {
	const metadata = await check()
	await signingProperties()
	const publicEnvironment = parsePublicReleaseEnvironment(await readFile(PUBLIC_ENV_PATH, 'utf8'))
	await run(
		[
			process.execPath,
			'run',
			'tauri',
			'android',
			'build',
			'--apk',
			'--aab',
			'--ci',
			'--split-per-abi',
			'--target',
			'aarch64',
		],
		'Android release build',
		publicEnvironment,
	)

	const apk = await findBuiltArtifact('.apk')
	const aab = await findBuiltArtifact('.aab')
	const certificateFingerprint = await verifyApk(apk, metadata)
	await capture(['jarsigner', '-verify', aab], 'AAB signature verification')

	const outputDirectory = join(REPO_ROOT, 'out', 'android', metadata.versionName)
	await mkdir(outputDirectory, { recursive: true })
	const names = releaseArtifactNames(metadata)
	const outputApk = join(outputDirectory, names.apk)
	const outputAab = join(outputDirectory, names.aab)
	await Promise.all([copyFile(apk, outputApk), copyFile(aab, outputAab)])
	const [apkHash, aabHash, commit] = await Promise.all([
		sha256(outputApk),
		sha256(outputAab),
		capture(['git', 'rev-parse', 'HEAD'], 'Git commit lookup'),
	])
	const manifest = {
		schemaVersion: 1,
		...metadata,
		commit,
		certificateFingerprint,
		artifacts: [
			{ file: names.apk, sha256: apkHash },
			{ file: names.aab, sha256: aabHash },
		],
	}
	await Promise.all([
		writeFile(
			join(outputDirectory, 'SHA256SUMS.txt'),
			`${apkHash}  ${names.apk}\n${aabHash}  ${names.aab}\n`,
		),
		writeFile(join(outputDirectory, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
		writeFile(
			join(outputDirectory, 'assetlinks.json'),
			`${JSON.stringify(androidAssetLinksStatement(metadata.packageName, certificateFingerprint), null, 2)}\n`,
		),
	])
	console.log(`Signed Android release written to ${relative(REPO_ROOT, outputDirectory)}`)
}

function printUsage(): void {
	console.log(`Prepare the Earthly Android release

Usage:
  bun run scripts/android-release.ts check
  bun run scripts/android-release.ts build

check  Validate public build configuration and version alignment without secrets.
build  Require protected signing material, build signed arm64 APK/AAB artifacts,
       verify them, and write checksums plus a release manifest under out/android/.`)
}

if (import.meta.main) {
	const command = process.argv[2]
	Promise.resolve()
		.then(async () => {
			switch (command) {
				case 'check':
					await check()
					break
				case 'build':
					await build()
					break
				case '--help':
				case '-h':
				case undefined:
					printUsage()
					break
				default:
					throw new Error(`Unknown command: ${command}`)
			}
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : error)
			process.exit(1)
		})
}
