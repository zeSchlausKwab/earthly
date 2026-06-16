import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHeadlessEditor } from '../core/test-harness'
import { createAuthoring } from './authoring'

const API_DIR = dirname(fileURLToPath(import.meta.url))

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

describe('Authoring surface is geometry-only (V4 access-control / T-02-03)', () => {
	it('exposes only geometry methods — no signer/wallet/store/getState', () => {
		const editor = createHeadlessEditor()
		const authoring = createAuthoring(editor)
		const keys = Object.keys(authoring).sort()

		expect(keys).toEqual(['addFeature', 'editorCommand', 'writeGeoJSON'])

		const forbidden = ['signer', 'wallet', 'store', 'getState', 'editor', 'eventStore', 'accounts']
		for (const key of forbidden) {
			expect(authoring).not.toHaveProperty(key)
		}
	})
})
