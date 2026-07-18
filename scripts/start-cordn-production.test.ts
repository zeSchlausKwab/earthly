import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

describe('native Cordn production launcher', () => {
	test('passes only Cordn configuration to the supervised process', async () => {
		const fixtureRoot = await mkdtemp(join(resolve('.cache'), 'cordn-launch-'))
		const fakeBin = join(fixtureRoot, 'fake-bin')
		const capturePath = join(fixtureRoot, 'cordn-environment.txt')
		const cordnBinary = join(fixtureRoot, 'cordn-server')
		const dataDirectory = join(fixtureRoot, 'data')
		const backupDirectory = join(fixtureRoot, 'backups')
		try {
			await mkdir(fakeBin, { recursive: true })
			await writeFile(cordnBinary, '#!/bin/bash\nexit 0\n')
			await chmod(cordnBinary, 0o755)
			await writeFile(
				join(fakeBin, 'pm2'),
				[
					'#!/bin/bash',
					'case "$1" in',
					'  describe) exit 1 ;;',
					`  start) env | sort > '${capturePath}'; exit 0 ;;`,
					'  pid) echo 123; exit 0 ;;',
					'  delete|logs|restart|stop) exit 0 ;;',
					'esac',
					'exit 0',
					'',
				].join('\n'),
			)
			await chmod(join(fakeBin, 'pm2'), 0o755)
			await writeFile(
				join(fixtureRoot, '.env'),
				[
					`SERVER_KEY=${'2'.repeat(64)}`,
					`CORDN_SERVER_PRIVATE_KEY=${'3'.repeat(64)}`,
					'CORDN_RELAY_URLS=wss://relay.earthly.city',
					'CORDN_STORAGE_BACKEND=sqlite',
					`CORDN_DATA_DIR=${dataDirectory}`,
					`CORDN_BACKUP_DIR=${backupDirectory}`,
					'CORDN_STARTUP_CHECK_ATTEMPTS=1',
					'',
				].join('\n'),
			)

			const process = Bun.spawn(
				['bash', 'scripts/start-cordn-production.sh', join(fixtureRoot, '.env'), cordnBinary],
				{
					cwd: resolve('.'),
					env: {
						HOME: Bun.env.HOME ?? '',
						PATH: `${fakeBin}:${Bun.env.PATH ?? ''}`,
						TMPDIR: Bun.env.TMPDIR ?? '/tmp',
					},
					stdout: 'pipe',
					stderr: 'pipe',
				},
			)
			const [exitCode, stdout, stderr] = await Promise.all([
				process.exited,
				new Response(process.stdout).text(),
				new Response(process.stderr).text(),
			])
			const capturedEnvironment = await readFile(capturePath, 'utf8')

			expect(stderr).toBe('')
			expect(exitCode).toBe(0)
			expect(stdout).toContain('Native Cordn ContextVM coordinator is running')
			expect(capturedEnvironment).toContain(`CORDN_SERVER_PRIVATE_KEY=${'3'.repeat(64)}`)
			expect(capturedEnvironment).not.toContain('SERVER_KEY=')
		} finally {
			await rm(fixtureRoot, { recursive: true, force: true })
		}
	})
})
