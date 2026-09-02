// Static server for the sketch. Usage: bun docs/sketch-map-with-a-margin/serve.ts [port]
const dir = import.meta.dir
const port = Number(process.argv[2] ?? process.env.PORT ?? 4177)
Bun.serve({
	port,
	async fetch(req) {
		const url = new URL(req.url)
		let path = decodeURIComponent(url.pathname)
		if (path === '/' || path === '') path = '/index.html'
		const file = Bun.file(`${dir}${path}`)
		if (!(await file.exists())) return new Response('Not found', { status: 404 })
		return new Response(file, { headers: { 'cache-control': 'no-store' } })
	},
})
console.log(`sketch: http://localhost:${port}/`)
