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
 * A3 mitigation (threat T-02-07, INFRA-02): the AI / sandbox write path must NEVER
 * call a geometry-write editor verb directly — every AI-originated mutation MUST
 * route through `createAuthoring(editor)`, which is the single intercept/classify
 * seam (the new `modifyFeature`/`deleteFeatures` verbs widen that surface and this
 * plan landed them). A direct `editor.addFeature/setFeatures/updateFeature/
 * deleteFeatures` inside the AI trust boundary is a bypass hole — fail the build.
 *
 * SCOPE (D-12 decision, Plan 01): the scan is deliberately scoped to the AI TRUST
 * BOUNDARY, not the whole src/ tree. The INFRA-02 guarantee is specifically that
 * the *AI / sandbox* path cannot bypass the facade — manual feature-editing UI,
 * annotation-draft composers, and dataset load/clear plumbing legitimately drive the
 * editor directly and are NOT in scope (rerouting those ~35 sites is explicitly out
 * of scope and was rejected). The AI write path is:
 *   - `src/features/chat/**`   — the AI tool layer + sandbox replay path, EXCEPT
 *                                the manual annotation-draft composer (see allow-list).
 *   - any `** /sandbox/** `      — run_code replay / sandbox host surface.
 *
 * The four write verbs covered: addFeature, setFeatures, updateFeature,
 * deleteFeatures/deleteFeature.
 */
const WRITE_VERB_RE = /\.(addFeature|setFeatures|updateFeature|deleteFeatures|deleteFeature)\s*\(/

/**
 * Documented allow-list of acknowledged NON-AI direct-write homes inside the scanned
 * AI-boundary paths. Each entry stays a direct `editor.<verb>(` call ON PURPOSE — it
 * is NOT an AI-originated write — with a one-line rationale so a future scan does not
 * regress these silently (and so genuine new AI bypass sites are NOT hidden).
 *
 * NOTE: only files that fall INSIDE the scanned scope (chat/** + **​/sandbox/**) need
 * an entry. The bulk of the app's legitimate direct-write sites (info-panel manual
 * editing UI, social/comments annotation composers, useDatasetManagement / Editor.tsx
 * / sessionSyncSlice / commands.ts / GeoEditorView.tsx dataset-load + store-mirror
 * plumbing) live OUTSIDE this scope and are out-of-scope by construction.
 */
const A3_ALLOW_LIST: Record<string, string> = {
	// Transient draft-canvas snapshot/restore UI for MANUALLY composing a chat
	// geometry attachment — a user-drawn draft, NOT an AI/run_code write path. It
	// snapshots/restores the canvas around a manual annotation draft, so it drives
	// editor.setFeatures/updateFeature/deleteFeatures directly by design.
	'features/chat/ChatGeometryAttachment.tsx':
		'Manual annotation-draft composer (transient draft-canvas snapshot/restore), not an AI write path.',
}

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

/** Is this repo-relative path inside the AI trust boundary the A3 scan covers? */
function isAiWritePath(rel: string): boolean {
	if (rel.startsWith('features/chat/')) return true
	// any **​/sandbox/** segment (run_code replay / sandbox host surface)
	if (/(^|\/)sandbox\//.test(rel)) return true
	return false
}

describe('AI write path never bypasses createAuthoring across all four verbs (A3 / INFRA-02)', () => {
	it('finds zero direct editor-write-verb sites in the AI/sandbox boundary', () => {
		const offenders: string[] = []
		for (const file of tsFilesRecursive(SRC_DIR)) {
			const rel = relative(SRC_DIR, file)
			// The facade itself + the GeoEditor core class are always allowed homes.
			if (rel.startsWith('features/geo-editor/api/')) continue
			if (rel === 'features/geo-editor/core/GeoEditor.ts') continue
			// Scope: only scan the AI trust boundary (chat/** + **​/sandbox/**).
			if (!isAiWritePath(rel)) continue
			// Documented, intentional non-AI direct-write homes inside that scope.
			if (rel in A3_ALLOW_LIST) continue

			const source = readFileSync(file, 'utf8')
			source.split('\n').forEach((line, idx) => {
				// Strip line comments so doc-comments mentioning the methods don't trip it.
				const code = line.replace(/\/\/.*$/, '')
				if (WRITE_VERB_RE.test(code)) {
					offenders.push(`${rel}:${idx + 1}`)
				}
			})
		}
		expect(offenders).toEqual([])
	})

	it('every allow-list entry is real, in-scope, and carries a rationale', () => {
		for (const [rel, rationale] of Object.entries(A3_ALLOW_LIST)) {
			// In scope (otherwise the entry is dead weight that hides nothing).
			expect(isAiWritePath(rel)).toBe(true)
			// Documented rationale present.
			expect(rationale.length).toBeGreaterThan(0)
			// File still exists and still actually does a direct write (else remove it).
			const source = readFileSync(join(SRC_DIR, rel), 'utf8')
			expect(WRITE_VERB_RE.test(source)).toBe(true)
		}
	})
})

describe('chat importFeaturesToEditor no longer dual-writes the store (D-09)', () => {
	it('routes through authoring and does not call the store setFeatures', () => {
		const helpers = readFileSync(join(SRC_DIR, 'features/chat/tools/helpers.ts'), 'utf8')
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
			'commitDataset',
			'deleteFeatures',
			'editorCommand',
			'getDatasetMetadata',
			'modifyFeature',
			'setDatasetMetadata',
			'writeGeoJSON',
		])

		const forbidden = ['signer', 'wallet', 'store', 'getState', 'editor', 'eventStore', 'accounts']
		for (const key of forbidden) {
			expect(authoring).not.toHaveProperty(key)
		}
	})
})
