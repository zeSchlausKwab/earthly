// Inline styles.css, data.js and app.js into one self-contained HTML file.
// Usage: bun docs/sketch-map-with-a-margin/bundle.ts [out.html]
const dir = import.meta.dir
const out = process.argv[2] ?? `${dir}/dist/sketch.html`
const [html, css, data, app] = await Promise.all([
	Bun.file(`${dir}/index.html`).text(),
	Bun.file(`${dir}/styles.css`).text(),
	Bun.file(`${dir}/data.js`).text(),
	Bun.file(`${dir}/app.js`).text(),
])
let bundled = html
	.replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`)
	.replace('<script src="data.js"></script>', `<script>\n${data}\n</script>`)
	.replace('<script src="app.js"></script>', `<script>\n${app}\n</script>`)
if (process.argv.includes('--artifact')) {
	// Artifacts supply their own document skeleton and block tile fetches; strip ours and fall back to the SVG canvas.
	bundled = bundled
		.replace(/<link rel="stylesheet" href="https:\/\/unpkg.com\/maplibre-gl[^>]*>\s*/i, '')
		.replace(/<script src="https:\/\/unpkg.com\/maplibre-gl[^>]*><\/script>\s*/i, '<script>window.SKETCH_NO_BASEMAP = true</script>\n')
		.replace(/^<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, '')
		.replace(/<meta charset="utf-8">\s*/i, '')
		.replace(/<meta name="viewport"[^>]*>\s*/i, '')
		.replace(/<\/head>\s*<body>/i, '')
		.replace(/<\/body>\s*<\/html>\s*$/i, '')
}
await Bun.write(out, bundled)
console.log(`wrote ${out} (${(bundled.length / 1024).toFixed(0)} KB)`)
