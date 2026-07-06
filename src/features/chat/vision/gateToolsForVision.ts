/**
 * Vision-gating of the ADVERTISED tool surface (D-08/D-09).
 *
 * `capture_map_snapshot` only produces value for a model that can consume the
 * resulting image. The autonomous-snapshot loop already gates the IMAGE SEND on a
 * confirmed `'vision'` verdict (store.ts `canUseVision`); this gates the matching
 * TOOL ADVERTISEMENT so a no-vision (or merely `'uncertain'`) model never sees the
 * tool, calls it, and then wastes a round reasoning that it cannot view the image.
 *
 * Pure + framework-agnostic so the gate is unit-tested in isolation, mirroring the
 * `detectVisionSupport` test patterns. The `canUseVision` flag is the SAME boolean
 * the store derives from `detectVisionSupport` (confirmed `'vision'` + enough
 * context for an inline image) — this module does not re-derive it.
 */

import type { Tool } from '../tools/types'

/** Tools whose only value is to a vision-capable model (D-08/D-09). */
export const VISION_ONLY_TOOLS = new Set(['capture_map_snapshot'])

/**
 * Drop vision-only tools from the advertised list when the active model cannot use
 * an image. When `canUseVision` is true the list passes through unchanged.
 */
export function gateToolsForVision(tools: Tool[], canUseVision: boolean): Tool[] {
	if (canUseVision) return tools
	return tools.filter((t) => !VISION_ONLY_TOOLS.has(t.function.name))
}
