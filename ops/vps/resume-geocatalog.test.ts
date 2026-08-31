import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const resumeScript = join(repositoryRoot, 'ops/vps/resume-geocatalog.sh')
const temporaryDirectories: string[] = []
const overtureRelease = '2026-08-19.0'

type DataRoot = 'legacy' | 'shared'

interface ResumeFixture {
	archiveName: string
	checksumName: string
	currentLinkTarget: string
	fakeBin: string
	installerName: string
	invocationPath: string
	persistentDataRoot: string
	root: string
	seedDir: string
	workerId: string
}

async function pathExists(path: string): Promise<boolean> {
	return lstat(path)
		.then(() => true)
		.catch(() => false)
}

async function writeExecutable(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, content)
	await chmod(path, 0o755)
}

async function writeArchiveChecksum(fixture: ResumeFixture, checksum?: string): Promise<void> {
	const archivePath = join(fixture.root, fixture.archiveName)
	const digest = checksum ?? createHash('sha256').update(await readFile(archivePath)).digest('hex')
	await writeFile(join(fixture.root, fixture.checksumName), `${digest}  ${fixture.archiveName}\n`)
}

async function createResumeFixture(dataRoot: DataRoot): Promise<ResumeFixture> {
	const unresolvedRoot = await mkdtemp(join(tmpdir(), 'earthly-geocatalog-resume-'))
	const root = await realpath(unresolvedRoot)
	temporaryDirectories.push(root)

	const workerId = `resume-${dataRoot}`
	const archiveName = `${workerId}.tar.gz`
	const checksumName = `${archiveName}.sha256`
	const installerName = `${workerId}.installer.sh`
	const currentLinkTarget = 'releases/current-release'
	const currentRelease = join(root, currentLinkTarget)
	const sharedRoot = join(root, 'shared')
	const persistentDataRoot =
		dataRoot === 'legacy' ? join(root, 'data') : join(sharedRoot, 'data')
	const seedDir = join(root, `.geocatalog-worker-seed-${workerId}`)
	const invocationPath = join(sharedRoot, 'resume-invocation.txt')
	const fakeBin = join(root, 'fake-bin')

	await mkdir(join(currentRelease, 'node_modules'), { recursive: true })
	await mkdir(persistentDataRoot, { recursive: true })
	await mkdir(sharedRoot, { recursive: true })
	await writeFile(join(currentRelease, '.env'), 'NODE_ENV=production\n')
	await symlink(persistentDataRoot, join(currentRelease, 'data'))
	await symlink(currentLinkTarget, join(root, 'current'))

	const archiveRoot = join(root, 'archive-root')
	const requiredFiles = [
		'ops/vps/geocatalog.sh',
		'scripts/export-overture-planet-lite.py',
		'scripts/build-geocatalog.ts',
		'contextvm/geocatalog/index.ts',
		'docs/legal/Apache-2.0.txt',
		'src/config/env.server.ts',
		'src/config/env.schema.ts',
	]
	for (const relativePath of requiredFiles) {
		const destination = join(archiveRoot, relativePath)
		await mkdir(dirname(destination), { recursive: true })
		await writeFile(destination, `${relativePath}\n`)
	}
	await writeExecutable(
		join(archiveRoot, 'ops/vps/geocatalog.sh'),
		[
			'#!/usr/bin/env bash',
			'set -euo pipefail',
			'printf "%s\\n" "$@" > "$2/resume-invocation.txt"',
			'[[ "$1" == "update" || "$1" == "activate" ]]',
			'',
		].join('\n'),
	)

	const archive = Bun.spawnSync([
		'tar',
		'-czf',
		join(root, archiveName),
		'-C',
		archiveRoot,
		'.',
	])
	if (archive.exitCode !== 0) {
		throw new Error(`Could not create resume fixture archive: ${archive.stderr.toString()}`)
	}
	await rm(archiveRoot, { recursive: true })

	const fixture: ResumeFixture = {
		archiveName,
		checksumName,
		currentLinkTarget,
		fakeBin,
		installerName,
		invocationPath,
		persistentDataRoot,
		root,
		seedDir,
		workerId,
	}
	await writeArchiveChecksum(fixture)
	await writeFile(join(root, installerName), '#!/usr/bin/env bash\n')
	await writeExecutable(
		join(fakeBin, 'sha256sum'),
		[
			'#!/usr/bin/env bash',
			'set -euo pipefail',
			'[[ "$#" -eq 2 && "$1" == "-c" ]] || exit 64',
			'while read -r expected filename; do',
			'  actual="$("$BUN_EXECUTABLE" -e \'const bytes = await Bun.file(process.argv[1]).arrayBuffer(); console.log(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"))\' "$filename")"',
			'  if [[ "$actual" != "$expected" ]]; then',
			'    echo "$filename: FAILED" >&2',
			'    exit 1',
			'  fi',
			'  echo "$filename: OK"',
			'done < "$2"',
			'',
		].join('\n'),
	)

	return fixture
}

async function runResume(fixture: ResumeFixture, action?: 'resume' | 'activate') {
	const child = Bun.spawn(
		[
			'bash',
			resumeScript,
			fixture.workerId,
			fixture.archiveName,
			fixture.checksumName,
			fixture.installerName,
			overtureRelease,
			...(action ? [action] : []),
		],
		{
			cwd: fixture.root,
			env: {
				...Bun.env,
				BUN_EXECUTABLE: process.execPath,
				PATH: `${fixture.fakeBin}:${Bun.env.PATH ?? ''}`,
			},
			stdout: 'pipe',
			stderr: 'pipe',
		},
	)
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	])
	return { exitCode, stdout, stderr }
}

async function expectResumeArtifactsCleaned(fixture: ResumeFixture): Promise<void> {
	for (const path of [
		join(fixture.root, fixture.archiveName),
		join(fixture.root, fixture.checksumName),
		join(fixture.root, fixture.installerName),
		fixture.seedDir,
	]) {
		expect(await pathExists(path)).toBe(false)
	}
}

function writeOctalField(header: Buffer, offset: number, width: number, value: number): void {
	header.write(`${value.toString(8).padStart(width - 1, '0')}\0`, offset, width, 'ascii')
}

async function writeTraversalArchive(path: string): Promise<void> {
	const header = Buffer.alloc(512)
	header.write('../escape', 0, 100, 'utf8')
	writeOctalField(header, 100, 8, 0o644)
	writeOctalField(header, 108, 8, 0)
	writeOctalField(header, 116, 8, 0)
	writeOctalField(header, 124, 12, 0)
	writeOctalField(header, 136, 12, 0)
	header.fill(0x20, 148, 156)
	header.write('0', 156, 1, 'ascii')
	header.write('ustar\0', 257, 6, 'ascii')
	header.write('00', 263, 2, 'ascii')
	const checksum = header.reduce((total, byte) => total + byte, 0)
	header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
	await writeFile(path, gzipSync(Buffer.concat([header, Buffer.alloc(1024)])))
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('GeoCatalog worker resume installer', () => {
	for (const dataRoot of ['legacy', 'shared'] as const) {
		test(`resumes with the ${dataRoot} persistent data root without switching releases`, async () => {
			const fixture = await createResumeFixture(dataRoot)
			const currentBefore = await readlink(join(fixture.root, 'current'))
			const result = await runResume(fixture)

			expect(result.exitCode).toBe(0)
			expect(result.stderr).toBe('')
			expect(result.stdout).toContain('Starting GeoCatalog resume worker')
			expect(result.stdout).toContain('GeoCatalog worker resume queued')
			expect((await readFile(fixture.invocationPath, 'utf8')).trim().split('\n')).toEqual([
				'update',
				join(fixture.root, 'shared'),
				fixture.seedDir,
				overtureRelease,
			])
			expect(await readlink(join(fixture.root, 'current'))).toBe(currentBefore)
			expect(await pathExists(fixture.persistentDataRoot)).toBe(true)
			await expectResumeArtifactsCleaned(fixture)
		})
	}

	test('activates a completed snapshot synchronously without switching releases', async () => {
		const fixture = await createResumeFixture('shared')
		const currentBefore = await readlink(join(fixture.root, 'current'))
		const result = await runResume(fixture, 'activate')

		expect(result.exitCode).toBe(0)
		expect(result.stderr).toBe('')
		expect(result.stdout).toContain('Starting GeoCatalog activation worker')
		expect(result.stdout).toContain('GeoCatalog snapshot activation finished')
		expect((await readFile(fixture.invocationPath, 'utf8')).trim().split('\n')).toEqual([
			'activate',
			join(fixture.root, 'shared'),
			fixture.seedDir,
			overtureRelease,
		])
		expect(await readlink(join(fixture.root, 'current'))).toBe(currentBefore)
		expect(await pathExists(fixture.persistentDataRoot)).toBe(true)
		await expectResumeArtifactsCleaned(fixture)
	})

	test('rejects a checksum mismatch and cleans the uploaded files', async () => {
		const fixture = await createResumeFixture('shared')
		await writeArchiveChecksum(fixture, '0'.repeat(64))
		const result = await runResume(fixture)

		expect(result.exitCode).not.toBe(0)
		expect(result.stderr).toContain('FAILED')
		expect(await pathExists(fixture.invocationPath)).toBe(false)
		expect(await readlink(join(fixture.root, 'current'))).toBe(fixture.currentLinkTarget)
		await expectResumeArtifactsCleaned(fixture)
	})

	test('rejects a traversal archive before starting the worker', async () => {
		const fixture = await createResumeFixture('shared')
		await writeTraversalArchive(join(fixture.root, fixture.archiveName))
		await writeArchiveChecksum(fixture)
		const result = await runResume(fixture)

		expect(result.exitCode).not.toBe(0)
		expect(result.stderr).toContain(
			'GeoCatalog worker archive contains an unsafe path: ../escape',
		)
		expect(await pathExists(fixture.invocationPath)).toBe(false)
		expect(await pathExists(join(fixture.root, 'escape'))).toBe(false)
		expect(await readlink(join(fixture.root, 'current'))).toBe(fixture.currentLinkTarget)
		await expectResumeArtifactsCleaned(fixture)
	})
})
