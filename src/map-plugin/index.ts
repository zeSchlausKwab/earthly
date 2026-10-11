import { z } from 'zod'
import { NostrMapGateway } from './gateway'
import { createMapHttpHandler } from './server'
import { buildWorkerSource } from '@/lib/workers/buildWorker'
import { WORKER_ASSETS } from '@/lib/workers/workerAssets'

const port = z.coerce
	.number()
	.int()
	.min(1)
	.max(65535)
	.parse(process.env.EARTHLY_MAP_PORT ?? 3337)
const hostname = process.env.EARTHLY_MAP_HOST ?? '127.0.0.1'
const baseUrl = (process.env.EARTHLY_MAP_PUBLIC_URL ?? `http://127.0.0.1:${port}`).replace(
	/\/+$/,
	'',
)
const relays = (process.env.EARTHLY_MAP_RELAYS ?? 'ws://127.0.0.1:3334')
	.split(',')
	.map((relay) => relay.trim())
	.filter(Boolean)
const built = await Bun.build({
	entrypoints: ['./src/features/public-map/viewer.tsx'],
	target: 'browser',
	format: 'esm',
	minify: true,
	define: { 'process.env.NODE_ENV': JSON.stringify('production') },
})
if (!built.success) throw new AggregateError(built.logs, 'Public map viewer build failed')
const assets = new Map<string, { body: Blob | string; type: string }>()
for (const output of built.outputs) {
	if (output.path.endsWith('.js'))
		assets.set('/assets/viewer.js', { body: output, type: 'text/javascript' })
	if (output.path.endsWith('.css'))
		assets.set('/assets/viewer.css', { body: output, type: 'text/css' })
}
assets.set('/assets/maplibre-worker.js', {
	body: await buildWorkerSource(WORKER_ASSETS.maplibre.sourcePath, true),
	type: 'text/javascript',
})
const gateway = new NostrMapGateway(relays)
const handler = createMapHttpHandler({ baseUrl, gateway, assets })
const server = Bun.serve({
	hostname,
	port,
	maxRequestBodySize: 96 * 1024,
	idleTimeout: 30,
	fetch: handler.fetch,
})
console.log(`Earthly public map plugin: ${baseUrl}/mcp (guest editing sessions: 2 hours)`)
for (const signal of ['SIGINT', 'SIGTERM'] as const)
	process.on(signal, async () => {
		await handler.close()
		gateway.close()
		server.stop(true)
		process.exit(0)
	})
