import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHeadlessEditor } from '../core/test-harness'
import { createAuthoring } from './authoring'

const API_DIR = dirname(fileURLToPath(import.meta.url))
// repo src/ root (…/src/features/geo-editor/api → …/src)
const SRC_DIR = join(API_DIR, '..', '..', '..')

/**
 * D-07 strict layering (threat T-02-03): the Authoring API must stay shippable as
 * a standalone editor library and confinable as the Phase 4 sandbox boundary.
 * It therefore imports NOTHING from chat, the tool registry, or Nostr.
 */
const FORBIDDEN_IMPORT_PATTERNS: RegExp[] = [
	/@\/features\/chat/,
	/chat\/tools/,
	/@\/lib\/ndk/,
	/@\/lib\/nostr/,
	/['"]nostr/,
	/applesauce/,
	/@modelcontextprotocol/,
	/@contextvm/,
]

function apiSourceFiles(): string[] {
	return readdirSync(API_DIR)
		.filter((name) => name.endsWith('.ts'))
		.filter((name) => !name.endsWith('.test.ts'))
		.map((name) => join(API_DIR, name))
}

describe('Authoring API import boundary (D-07 / INFRA-02)', () => {
	it('scans at least the four production api/ modules', () => {
		const names = apiSourceFiles().map((p) => p.split('/').pop())
		expect(names).toEqual(
			expect.arrayContaining(['authoring.ts', 'results.ts', 'interceptor.ts', 'index.ts']),
		)
	})

	it.each(
		apiSourceFiles(),
	)('%s imports nothing from chat/registry/Nostr/NDK/applesauce', (file) => {
		const source = readFileSync(file, 'utf8')
		const importLines = source
			.split('\n')
			.filter((line) => /^\s*import\b/.test(line) || /\bfrom\s+['"]/.test(line))

		for (const line of importLines) {
			for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
				expect(line).not.toMatch(pattern)
			}
		}
	})
})

/**
 * A3 mitigation (threat T-02-07, INFRA-02): the Authoring API must be the ONLY
 * caller of `editor.addFeature` (the geometry-create seam this plan closes). Any
 * direct `editor.addFeature(` outside `api/` + `core/GeoEditor.ts` is a bypass hole
 * — fail the build.
 *
 * Scope note: this plan rerouted the feature-CREATE / bulk-import write paths
 * (`addFeature` + the bulk-replace `setFeatures` import path) through `writeGeoJSON`.
 * The per-feature `updateFeature` property-edit paths and `deleteFeatures` paths are
 * deferred — the Authoring facade does not yet expose modify/delete methods; a later
 * plan extends the surface and tightens this assertion to all four verbs.
 */
function tsFilesRecursive(dir: string): string[] {
	const out: string[] = []
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue
		const full = join(dir, name)
		const st = statSync(full)
		if (st.isDirectory()) {
			out.push(...tsFilesRecursive(full))
		} else if (
			(full.endsWith('.ts') || full.endsWith('.tsx')) &&
			!full.endsWith('.test.ts') &&
			!full.endsWith('.test.tsx')
		) {
			out.push(full)
		}
	}
	return out
}

describe('no direct editor.addFeature outside api/ + GeoEditor core (A3 / INFRA-02)', () => {
	it('finds zero bypass sites', () => {
		const offenders: string[] = []
		for (const file of tsFilesRecursive(SRC_DIR)) {
			const rel = relative(SRC_DIR, file)
			// Allowed homes: the Authoring API itself + the GeoEditor core class.
			if (rel.startsWith('features/geo-editor/api/')) continue
			if (rel === 'features/geo-editor/core/GeoEditor.ts') continue

			const source = readFileSync(file, 'utf8')
			source.split('\n').forEach((line, idx) => {
				// Strip line comments so doc-comments mentioning the method don't trip it.
				const code = line.replace(/\/\/.*$/, '')
				if (/\.addFeature\s*\(/.test(code)) {
					offenders.push(`${rel}:${idx + 1}`)
				}
			})
		}
		expect(offenders).toEqual([])
	})
})

describe('chat importFeaturesToEditor no longer dual-writes the store (D-09)', () => {
	it('routes through authoring and does not call the store setFeatures', () => {
		const helpers = readFileSync(
			join(SRC_DIR, 'features/chat/tools/helpers.ts'),
			'utf8',
		)
		// The refactored importFeaturesToEditor must reference the Authoring facade…
		expect(helpers).toMatch(/createAuthoring/)
		// …and must NOT destructure setFeatures off the store for a direct dual-write.
		expect(helpers).not.toMatch(/const\s*{\s*editor\s*,\s*setFeatures\s*}\s*=\s*useEditorStore/)
	})
})

describe('Authoring surface is geometry-only (V4 access-control / T-02-03)', () => {
	it('exposes only geometry methods — no signer/wallet/store/getState', () => {
		const editor = createHeadlessEditor()
		const authoring = createAuthoring(editor)
		const keys = Object.keys(authoring).sort()

		// circle/buffer are geometry-mutation methods (Plan 05 / TOOLS-01) — part of
		// the geometry surface. set/getDatasetMetadata are dataset-level METADATA
		// methods (FeatureCollection name/description/color/props) — still no
		// signer/wallet/store-handle leak (they call setCollectionMeta internally).
		expect(keys).toEqual([
			'addFeature',
			'buffer',
			'circle',
			'editorCommand',
			'getDatasetMetadata',
			'setDatasetMetadata',
			'writeGeoJSON',
		])

		const forbidden = ['signer', 'wallet', 'store', 'getState', 'editor', 'eventStore', 'accounts']
		for (const key of forbidden) {
			expect(authoring).not.toHaveProperty(key)
		}
	})
})
