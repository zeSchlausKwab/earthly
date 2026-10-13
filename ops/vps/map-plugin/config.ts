import { isAbsolute, join } from 'node:path'
import { z } from 'zod'

export const MAP_PROCESS = 'earthly-maps'
const port = z.coerce.number().int().min(1024).max(65535)
const releasePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/

export function deploymentSettings(env: Record<string, string | undefined>) {
	const publicUrl = new URL(z.string().min(1).parse(env.EARTHLY_MAP_PUBLIC_URL))
	if (
		publicUrl.protocol !== 'https:' || publicUrl.port || publicUrl.username || publicUrl.password ||
		publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash ||
		!publicUrl.hostname.includes('.') ||
		!publicUrl.hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
		/^\d+(\.\d+){3}$/.test(publicUrl.hostname)
	) throw new Error('Deployment requires an HTTPS hostname without a path, credentials, or custom port')
	const httpPort = port.parse(env.EARTHLY_MAP_PORT ?? 3337)
	if ([3000, 3334, 3544, 8888].includes(httpPort))
		throw new Error('Map service must not use a port owned by another Earthly service')
	const relays = z.array(z.string().url()).min(1).max(5).parse(env.EARTHLY_MAP_RELAYS?.split(',').map((url) => url.trim()))
	for (const value of relays) {
		const url = new URL(value)
		if (url.protocol !== 'wss:' || url.username || url.password || url.hash || url.search)
			throw new Error('Deployment requires public WSS relay URLs without credentials, queries, or fragments')
	}
	return { publicUrl: publicUrl.origin, hostname: publicUrl.hostname, httpPort, relays }
}

export type DeploymentSettings = ReturnType<typeof deploymentSettings>

export function runtimeArtifacts(settings: DeploymentSettings, releaseDir: string, sharedDir: string, releaseId: string, bunPath: string) {
	if (![releaseDir, sharedDir, bunPath].every(isAbsolute) || !releasePattern.test(releaseId))
		throw new Error('Runtime paths must be absolute and the release ID must be a simple filename')
	const apps = [{
		name: MAP_PROCESS, cwd: releaseDir, instances: 1, exec_mode: 'fork', autorestart: true, watch: false,
		kill_timeout: 15000, restart_delay: 1000, max_restarts: 5, min_uptime: 10000,
		merge_logs: true, log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
		// Launch Bun directly: PM2's Bun wrapper uses require(), which rejects top-level await.
		script: bunPath, interpreter: 'none', args: ['--no-env-file', join(releaseDir, 'src/map-plugin/index.ts')],
		max_memory_restart: '500M',
		env: {
			NODE_ENV: 'production', EARTHLY_MAP_HOST: '127.0.0.1', EARTHLY_MAP_PORT: String(settings.httpPort),
			EARTHLY_MAP_PUBLIC_URL: settings.publicUrl, EARTHLY_MAP_RELAYS: settings.relays.join(','),
			EARTHLY_MAP_RELEASE: releaseId,
		},
		out_file: join(sharedDir, 'logs/maps-out.log'), error_file: join(sharedDir, 'logs/maps-error.log'),
	}]
	const caddy = `# BEGIN earthly-map-plugin\n${settings.hostname} {\n\treverse_proxy 127.0.0.1:${settings.httpPort} {\n\t\tflush_interval -1\n\t}\n}\n# END earthly-map-plugin\n`
	return { ecosystem: `module.exports = ${JSON.stringify({ apps }, null, 2)}\n`, caddy }
}

if (import.meta.main) {
	const [mode, ...args] = process.argv.slice(2)
	if (mode === 'settings') {
		const output = args[0]
		if (!output) throw new Error('Usage: config.ts settings <output.json>')
		await Bun.write(output, `${JSON.stringify(deploymentSettings(process.env), null, 2)}\n`)
	} else if (mode === 'runtime') {
		const [settingsPath, releaseDir, sharedDir, releaseId, bunPath] = args
		if (!settingsPath || !releaseDir || !sharedDir || !releaseId || !bunPath)
			throw new Error('Usage: config.ts runtime <settings.json> <release> <shared> <id> <bun>')
		const raw = await Bun.file(settingsPath).json()
		const settings = deploymentSettings({ EARTHLY_MAP_PUBLIC_URL: raw.publicUrl, EARTHLY_MAP_PORT: raw.httpPort, EARTHLY_MAP_RELAYS: raw.relays?.join(',') })
		const artifacts = runtimeArtifacts(settings, releaseDir, sharedDir, releaseId, bunPath)
		await Bun.write(join(releaseDir, 'ecosystem.config.cjs'), artifacts.ecosystem)
		await Bun.write(join(releaseDir, 'maps.caddy'), artifacts.caddy)
		await Bun.write(join(releaseDir, 'maps.json'), JSON.stringify({ ...settings, releaseId }))
	} else throw new Error('Expected settings or runtime')
}
