/**
 * Vision-capability detection ladder (D-07).
 *
 * Replaces the name-only `modelMaySupportVision()` heuristic with a layered,
 * cached, fail-safe detector that is the SINGLE source of truth for whether an
 * image may be sent to a given model (D-09). Both image paths — user-attached
 * images and the autonomous `capture_map_snapshot` one-shot — consult this.
 *
 * Ladder (first authoritative answer wins):
 *   1. Ollama native `POST {baseUrl-without-/v1}/api/show` → `capabilities[]`
 *      (Ollama's OpenAI `/v1/models` surface OMITS capabilities — Pitfall 1).
 *   2. Other providers: `GET {baseUrl}/models` → the model entry's
 *      `capabilities` / `input_modalities` / `architecture.input_modalities`.
 *   3. Name heuristic (the old `visionHints`) → `'uncertain'` (NOT confirmed;
 *      drives the Plan 06 opt-in UI, never the autonomous send).
 *   4. Fail-safe → `'no-vision'` (never silently send to a blind model).
 *
 * Security: the fetch target is ALWAYS `provider.baseUrl` + a fixed path
 * (`/api/show` or `/models`) — never a value derived from file content or model
 * output (T-03-11). On any fetch failure the ladder degrades to the name
 * heuristic and NEVER throws (T-03-13). Results are cached per
 * `(type, baseUrl, modelId)` so detection costs at most one network call per
 * model per session (T-03-12).
 */
import type { ProviderConfig } from '../routstr'

export type VisionSupport = 'vision' | 'no-vision' | 'uncertain'

/**
 * Tier-3 name hints (formerly `store.ts:modelMaySupportVision`'s `visionHints`).
 *
 * WR-06: matched on TOKEN boundaries, not raw `includes`. The bare `'vl'`
 * substring over-matched unrelated ids (`marvel`, `…vllm`, `nouvelle`), so it is
 * replaced by the delimited token forms `'-vl'` / `'vl-'` (e.g. `qwen2.5-vl`,
 * `vl-7b`). Multi-segment hints (`gpt-4o`, `claude-3`) match as a bounded phrase.
 */
const VISION_NAME_HINTS = [
	'vision',
	'-vl',
	'vl-',
	'llava',
	'qwen2.5-vl',
	'gemma-vision',
	'pixtral',
	'gpt-4o',
	'claude-3',
] as const

/**
 * WR-06: does `hint` occur in `id` on TOKEN boundaries? A match requires the hint
 * to be preceded and followed by either a string boundary or a token delimiter
 * (any non-`[a-z0-9.]` char — `.` is kept inside the token so `qwen2.5` stays one
 * token). Hints that already START/END with `-` (e.g. `-vl`) carry their own
 * delimiter, so only the OTHER side needs a boundary. This rejects `marvel`
 * (no `-`/start before `vl`) while accepting `qwen2.5-vl` and `vl-7b`.
 */
function hintMatchesTokenBoundary(id: string, hint: string): boolean {
	let from = 0
	while (true) {
		const idx = id.indexOf(hint, from)
		if (idx < 0) return false
		const before = idx === 0 ? '' : id[idx - 1]
		const afterIdx = idx + hint.length
		const after = afterIdx >= id.length ? '' : id[afterIdx]
		const isTokenChar = (c: string) => c !== '' && /[a-z0-9.]/.test(c)
		// The hint's own leading/trailing `-` already enforces that side's boundary.
		const leftOk = hint.startsWith('-') || !isTokenChar(before)
		const rightOk = hint.endsWith('-') || !isTokenChar(after)
		if (leftOk && rightOk) return true
		from = idx + 1
	}
}

/** Tier 3: name heuristic → `'uncertain'` when a hint matches, else `'no-vision'`. */
function nameHeuristic(modelId: string): VisionSupport {
	const lower = modelId.toLowerCase()
	return VISION_NAME_HINTS.some((hint) => hintMatchesTokenBoundary(lower, hint))
		? 'uncertain'
		: 'no-vision'
}

const visionCache = new Map<string, VisionSupport>()

/** Clear the per-`(type,baseUrl,modelId)` detection cache (test seam). */
export function clearVisionCache(): void {
	visionCache.clear()
}

function cacheKey(provider: ProviderConfig, modelId: string): string {
	return `${provider.type}|${provider.baseUrl}|${modelId}`
}

/** Does any of the capability-bearing fields list an image input modality? */
function entryAdvertisesImage(entry: Record<string, unknown>): boolean | undefined {
	const candidates: unknown[] = [
		entry.capabilities,
		entry.input_modalities,
		(entry.architecture as Record<string, unknown> | undefined)?.input_modalities,
	]

	let sawCapabilityField = false
	for (const candidate of candidates) {
		if (Array.isArray(candidate)) {
			sawCapabilityField = true
			if (candidate.some((m) => typeof m === 'string' && m.toLowerCase().includes('image'))) {
				return true
			}
			// Some providers list 'vision' rather than 'image' in a capabilities array.
			if (candidate.some((m) => typeof m === 'string' && m.toLowerCase().includes('vision'))) {
				return true
			}
		}
	}

	// Capability data was present but did not advertise image → authoritative no.
	// No capability data at all → undefined (fall through to the name heuristic).
	return sawCapabilityField ? false : undefined
}

/** Tier 1: Ollama native `/api/show`. Returns a verdict, or `undefined` to fall through. */
async function detectOllama(
	provider: ProviderConfig,
	modelId: string,
): Promise<VisionSupport | undefined> {
	const ollamaBase = provider.baseUrl.replace(/\/v1\/?$/, '')
	const res = await fetch(`${ollamaBase}/api/show`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: modelId }),
	})
	if (!res.ok) return undefined
	const data = (await res.json()) as { capabilities?: unknown }
	if (Array.isArray(data.capabilities)) {
		return data.capabilities.some((c) => typeof c === 'string' && c.toLowerCase() === 'vision')
			? 'vision'
			: 'no-vision'
	}
	return undefined
}

/** Tier 2: other providers' `/v1/models`. Returns a verdict, or `undefined` to fall through. */
async function detectOpenAiCompatible(
	provider: ProviderConfig,
	modelId: string,
): Promise<VisionSupport | undefined> {
	const headers: Record<string, string> = {}
	// WR-05: a `custom` provider's baseUrl is fully user-controlled (it can come
	// from a shared/imported settings blob pointing at an attacker origin). The
	// capability probe hits `{baseUrl}/models`, which is typically a PUBLIC list,
	// so do NOT fan the provider API key out to that unvetted origin — omit the
	// bearer for custom providers. Trusted built-in providers (routstr, lmstudio,
	// ollama) still send it. On a real auth-gated custom /models the probe simply
	// 401s → undefined → falls through to the name heuristic (never throws).
	if (provider.apiKey && provider.type !== 'custom') {
		headers.Authorization = `Bearer ${provider.apiKey}`
	}
	const res = await fetch(`${provider.baseUrl}/models`, { headers })
	if (!res.ok) return undefined
	const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
	const entries = Array.isArray(data.data) ? data.data : []
	const entry = entries.find((e) => e.id === modelId)
	if (!entry) return undefined
	const advertisesImage = entryAdvertisesImage(entry)
	if (advertisesImage === undefined) return undefined
	return advertisesImage ? 'vision' : 'no-vision'
}

/**
 * Detect whether `modelId` on `provider` supports image input.
 *
 * Cached per `(type, baseUrl, modelId)`. Never throws: on any fetch error it
 * degrades to the name heuristic (`'uncertain'` for a vision-named model,
 * `'no-vision'` otherwise).
 */
export async function detectVisionSupport(
	provider: ProviderConfig,
	modelId: string,
): Promise<VisionSupport> {
	const key = cacheKey(provider, modelId)
	const cached = visionCache.get(key)
	if (cached !== undefined) return cached

	let result: VisionSupport
	try {
		const authoritative =
			provider.type === 'ollama'
				? await detectOllama(provider, modelId)
				: await detectOpenAiCompatible(provider, modelId)
		result = authoritative ?? nameHeuristic(modelId)
	} catch {
		// Provider down / CORS / malformed JSON — degrade, never throw (T-03-13).
		result = nameHeuristic(modelId)
	}

	visionCache.set(key, result)
	return result
}
