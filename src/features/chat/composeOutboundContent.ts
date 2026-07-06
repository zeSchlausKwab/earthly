/**
 * The ChatPanel send-composition seam (D-11 / D-08 / D-09).
 *
 * `composeOutboundContent` is the LAST point before an outbound user message
 * leaves for the model. It enforces two invariants structurally, so they are
 * testable without rendering ChatPanel (`ingestSendPath.test.ts`):
 *
 *  - D-11 (BLOCKER 3 / success criterion #2): an attached dataset is composed as
 *    `{ handleId, summary }` (the cached model-facing `IngestSummary`, sampled
 *    rows only) — NEVER the raw `fullRows`. The full table lives solely in the
 *    ingest store, reachable by tools/sandbox via `getDataset(handleId)`.
 *
 *  - D-08/D-09 three-tier vision gate: an attached image's `image_url` part is
 *    included ONLY when the model's vision support is confirmed `'vision'`, or
 *    `'uncertain'` WITH an explicit Send-anyway opt-in. `'no-vision'` (and an
 *    un-opted `'uncertain'`) NEVER include it — an image is never silently sent
 *    to a blind model (acceptance criterion #4). This is the SAME gate that
 *    governs the autonomous `capture_map_snapshot` one-shot (wired in Plan 04).
 */

import type { ChatContentPart, ChatMessageContent } from './routstr'
import type { AttachedFileView } from './components/FileChip'
import type { VisionSupport } from './vision/detectVisionSupport'

export interface ComposeOutboundContentArgs {
	/** The user's typed message. */
	text: string
	/** The attached-file chips (datasets + images). */
	attachedFiles: AttachedFileView[]
	/** The resolved vision support for the selected model (D-09 single gate). */
	visionSupport: VisionSupport
	/** The explicit `Send anyway` opt-in for an `'uncertain'` model (D-08). */
	sendAnyway: boolean
}

/** Should an attached image's bytes be included for THIS vision verdict? */
export function canSendImage(visionSupport: VisionSupport, sendAnyway: boolean): boolean {
	if (visionSupport === 'vision') return true
	if (visionSupport === 'uncertain') return sendAnyway
	return false // 'no-vision' — never (hard gate)
}

/**
 * Compose the outbound message content. Returns a plain string when there are no
 * attachments (the common case), or a `ChatContentPart[]` when datasets/images
 * are attached. Datasets are flattened to a `{ ingestHandle, ingestSummary }`
 * text part (the prompt-path compaction in `helpers.ts` recognizes this shape);
 * images become `image_url` parts gated per D-08/D-09.
 */
export function composeOutboundContent(args: ComposeOutboundContentArgs): ChatMessageContent {
	const { text, attachedFiles, visionSupport, sendAnyway } = args

	const datasetParts: ChatContentPart[] = []
	const imageParts: ChatContentPart[] = []

	for (const file of attachedFiles) {
		if (file.status === 'parsed' && file.summary) {
			// D-11: carry ONLY the handle + cached summary, never fullRows.
			datasetParts.push({
				type: 'text',
				text: JSON.stringify({
					ingestHandle: file.summary.handleId,
					ingestSummary: file.summary,
				}),
			})
			continue
		}
		if (file.status === 'image' && file.imageUrl) {
			// D-08/D-09: include the image ONLY when the gate permits.
			if (canSendImage(visionSupport, sendAnyway)) {
				imageParts.push({ type: 'image_url', image_url: { url: file.imageUrl } })
			}
		}
	}

	// No attachments → keep the message a plain string (unchanged legacy path).
	if (datasetParts.length === 0 && imageParts.length === 0) {
		return text
	}

	const parts: ChatContentPart[] = []
	if (text.length > 0) {
		parts.push({ type: 'text', text })
	}
	parts.push(...datasetParts, ...imageParts)
	return parts
}
