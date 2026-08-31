/**
 * One-off generator for `src/features/geo-editor/icons/lucideIcons.ts`.
 *
 * Inlines a curated subset of the Lucide icon set (ISC, https://lucide.dev)
 * as SVG strings in a checked-in TS module so the custom bun build never has
 * to resolve icon assets at runtime. Reads the raw SVGs from the installed
 * `lucide-static` dev dependency (node_modules/lucide-static/icons).
 *
 * Usage:
 *   bun scripts/generate-lucide-icons.ts                    # read from node_modules/lucide-static
 *   bun scripts/generate-lucide-icons.ts --from <iconsDir>  # read from a custom icons dir
 */

import { join } from 'node:path'

/**
 * Curated subset (60 icons) covering common mapping needs. Keep this list in
 * sync with the "Phase 1 bundled set" note in SPEC.md §1.7. Every name must
 * exist in lucide-static/icons — the generator hard-fails on missing names.
 */
const CURATED_ICON_NAMES = [
	// Transport & infrastructure
	'anchor',
	'ship',
	'sailboat',
	'plane',
	'plane-takeoff',
	'train-front',
	'tram-front',
	'bus',
	'car',
	'truck',
	'fuel',
	'square-parking',
	// Civic & emergency
	'hospital',
	'cross',
	'shield',
	'flame',
	'school',
	'landmark',
	'university',
	'banknote',
	// Culture & points of interest
	'church',
	'castle',
	'tent',
	'info',
	'eye',
	'flag',
	// Nature & water
	'trees',
	'tree-pine',
	'tree-deciduous',
	'mountain',
	'mountain-snow',
	'waves',
	'droplet',
	'wheat',
	'leaf',
	'flower',
	'bird',
	'fish',
	// Built environment
	'factory',
	'warehouse',
	'building',
	'building-2',
	'house',
	'store',
	'radio-tower',
	'tower-control',
	'construction',
	// Food & lodging
	'utensils',
	'coffee',
	'beer',
	'wine',
	'bed',
	// Generic shapes & markers
	'map-pin',
	'crosshair',
	'triangle-alert',
	'star',
	'heart',
	'circle',
	'square',
	'triangle',
] as const

function normalizeSvg(raw: string, name: string): string {
	let svg = raw
		// Strip the XML declaration and the @license header comment.
		.replace(/<\?xml[^?]*\?>\s*/g, '')
		.replace(/<!--[\s\S]*?-->\s*/g, '')
		// Strip class/id attributes so inlined copies never collide or restyle.
		.replace(/\s+class="[^"]*"/g, '')
		.replace(/\s+id="[^"]*"/g, '')
		// lucide-static pretty-prints attributes across lines — collapse them.
		.replace(/\s+/g, ' ')
		.replace(/>\s+</g, '><')
		.replace(/\s*\/>/g, '/>')
		.replace(/\s+>/g, '>')
		.trim()

	if (!svg.startsWith('<svg')) throw new Error(`Unexpected SVG shape for '${name}'`)
	if (!svg.includes('xmlns=')) throw new Error(`SVG for '${name}' lost its xmlns attribute`)
	if (!svg.includes('viewBox="0 0 24 24"')) {
		throw new Error(`SVG for '${name}' is not a 24x24 Lucide glyph`)
	}
	if (!svg.includes('stroke="currentColor"')) {
		throw new Error(`SVG for '${name}' lost its stroke="currentColor" attribute`)
	}
	return svg
}

async function loadSvg(name: string, iconsDir: string): Promise<string> {
	const file = Bun.file(join(iconsDir, `${name}.svg`))
	if (!(await file.exists())) {
		throw new Error(`Icon '${name}' does not exist in ${iconsDir} — remove it from the curated list`)
	}
	return await file.text()
}

async function main() {
	const fromFlagIndex = process.argv.indexOf('--from')
	const iconsDir =
		fromFlagIndex >= 0 && process.argv[fromFlagIndex + 1]
			? process.argv[fromFlagIndex + 1]
			: join(import.meta.dir, '../node_modules/lucide-static/icons')

	const { version } = await Bun.file(
		join(import.meta.dir, '../node_modules/lucide-static/package.json'),
	).json()

	const entries: string[] = []
	for (const name of CURATED_ICON_NAMES) {
		const svg = normalizeSvg(await loadSvg(name, iconsDir), name)
		entries.push(`\t'${name}': '${svg.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`)
	}

	const output = `/**
 * Curated subset of the Lucide icon set, inlined as SVG strings.
 *
 * GENERATED FILE — regenerate with \`bun scripts/generate-lucide-icons.ts\`
 * (see that script for the curated list). Do not hand-edit the SVG strings.
 *
 * Lucide (https://lucide.dev, lucide-static@${version}) is released under the
 * ISC license — Copyright (c) Lucide Contributors. All icons are 24×24
 * stroke-based SVGs (\`stroke="currentColor"\`, \`fill="none"\`).
 */

export const LUCIDE_ICON_NAMES = [
${CURATED_ICON_NAMES.map((name) => `\t'${name}',`).join('\n')}
] as const

export type LucideIconName = (typeof LUCIDE_ICON_NAMES)[number]

/** Lucide icon name → raw 24×24 SVG markup. */
export const LUCIDE_ICONS: Record<LucideIconName, string> = {
${entries.join('\n')}
}
`

	const outPath = join(import.meta.dir, '../src/features/geo-editor/icons/lucideIcons.ts')
	await Bun.write(outPath, output)

	// Normalize the generated module to the repo's Biome style (key quoting etc.).
	await Bun.spawn(['bunx', 'biome', 'check', '--write', outPath]).exited

	console.log(`Wrote ${CURATED_ICON_NAMES.length} icons to ${outPath}`)
}

await main()
