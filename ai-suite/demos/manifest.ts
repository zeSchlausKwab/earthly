import { readFileSync } from 'node:fs'

const MAX_MANIFEST_BYTES = 65_536
const TOUR_KINDS = ['chat', 'geometry', 'story'] as const
const TARGET_KINDS = ['new-dataset', 'current-dataset'] as const
const APPROVAL_KINDS = ['edits', 'reference-publish'] as const
const X_ACCOUNT_TIERS = ['standard', 'premium'] as const
const X_POST_LIMITS = { standard: 280, premium: 25_000 } as const
const X_ALT_TEXT_LIMIT = 1_000

export type DemoTourKind = (typeof TOUR_KINDS)[number]
export type DemoTargetKind = (typeof TARGET_KINDS)[number]
export type DemoApprovalKind = (typeof APPROVAL_KINDS)[number]
export type XAccountTier = (typeof X_ACCOUNT_TIERS)[number]

export interface DemoPrompt {
	text: string
	/** Every listed gate must appear at least once; repeated gates are all approved. */
	approvals: DemoApprovalKind[]
}

export interface CampaignDemoManifest {
	id: string
	title: string
	post: string
	videoAltText?: string
	prompts: DemoPrompt[]
	tour: DemoTourKind[]
	target: DemoTargetKind
	xAccountTier: XAccountTier
	startPath: string
	typingDelayMs: number
	actionDelayMs: number
	maxTurnMs: number
	safetyLevel: 1 | 2 | 3
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object.`)
	}
	return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must not be empty.`)
	return value.trim()
}

function unicodeLength(value: string): number {
	return Array.from(value).length
}

function xCopy(value: unknown, label: string, maximum: number): string {
	const normalized = nonEmptyString(value, label)
	if (unicodeLength(normalized) > maximum) {
		throw new Error(`${label} must be at most ${maximum.toLocaleString('en-US')} characters.`)
	}
	return normalized
}

function approvalKinds(prompt: Record<string, unknown>, index: number): DemoApprovalKind[] {
	// Preserve existing manifests while normalizing the former singular flag into
	// the explicit policy. New manifests should use `approvals` exclusively.
	if (prompt.approvals === undefined) {
		if (prompt.approveEdit !== undefined && typeof prompt.approveEdit !== 'boolean') {
			throw new Error(`prompts[${index}].approveEdit must be true or false.`)
		}
		return prompt.approveEdit === true ? ['edits'] : []
	}
	if (prompt.approveEdit !== undefined) {
		throw new Error(`prompts[${index}] cannot use both approvals and approveEdit.`)
	}
	if (!Array.isArray(prompt.approvals)) {
		throw new Error(`prompts[${index}].approvals must be an array.`)
	}
	const approvals = prompt.approvals.map((value, approvalIndex): DemoApprovalKind => {
		if (typeof value !== 'string' || !(APPROVAL_KINDS as readonly string[]).includes(value)) {
			throw new Error(
				`prompts[${index}].approvals[${approvalIndex}] must be one of: ${APPROVAL_KINDS.join(', ')}.`,
			)
		}
		return value as DemoApprovalKind
	})
	if (new Set(approvals).size !== approvals.length) {
		throw new Error(`prompts[${index}].approvals must not contain duplicates.`)
	}
	return approvals
}

function boundedNumber(
	value: unknown,
	label: string,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	if (value === undefined) return fallback
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new Error(`${label} must be between ${minimum} and ${maximum}.`)
	}
	return value
}

export function parseCampaignDemoManifest(value: unknown): CampaignDemoManifest {
	const input = record(value, 'Demo manifest')
	const id = nonEmptyString(input.id, 'id')
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
		throw new Error('id must use lowercase kebab-case so it is safe in artifact names.')
	}

	if (!Array.isArray(input.prompts) || input.prompts.length === 0) {
		throw new Error('prompts must contain at least one prompt.')
	}
	const prompts = input.prompts.map((value, index): DemoPrompt => {
		const prompt = record(value, `prompts[${index}]`)
		return {
			text: nonEmptyString(prompt.text, `prompts[${index}].text`),
			approvals: approvalKinds(prompt, index),
		}
	})

	const rawTour = input.tour ?? ['chat']
	if (!Array.isArray(rawTour) || rawTour.length === 0) {
		throw new Error('tour must contain at least one of chat, geometry, or story.')
	}
	const tour = rawTour.map((value, index): DemoTourKind => {
		if (typeof value !== 'string' || !(TOUR_KINDS as readonly string[]).includes(value)) {
			throw new Error(`tour[${index}] must be one of: ${TOUR_KINDS.join(', ')}.`)
		}
		return value as DemoTourKind
	})
	const target = input.target
	if (typeof target !== 'string' || !(TARGET_KINDS as readonly string[]).includes(target)) {
		throw new Error(`target is required and must be one of: ${TARGET_KINDS.join(', ')}.`)
	}
	const xAccountTier = input.xAccountTier ?? 'standard'
	if (
		typeof xAccountTier !== 'string' ||
		!(X_ACCOUNT_TIERS as readonly string[]).includes(xAccountTier)
	) {
		throw new Error(`xAccountTier must be one of: ${X_ACCOUNT_TIERS.join(', ')}.`)
	}
	const typedXAccountTier = xAccountTier as XAccountTier

	const startPath =
		input.startPath === undefined ? '/' : nonEmptyString(input.startPath, 'startPath')
	if (!startPath.startsWith('/') || startPath.startsWith('//')) {
		throw new Error('startPath must be an app-relative path beginning with one slash.')
	}

	const safetyLevel = input.safetyLevel ?? 1
	if (safetyLevel !== 1 && safetyLevel !== 2 && safetyLevel !== 3) {
		throw new Error('safetyLevel must be 1, 2, or 3.')
	}

	return {
		id,
		title: nonEmptyString(input.title, 'title'),
		post: xCopy(input.post, 'post', X_POST_LIMITS[typedXAccountTier]),
		videoAltText:
			input.videoAltText === undefined
				? undefined
				: xCopy(input.videoAltText, 'videoAltText', X_ALT_TEXT_LIMIT),
		prompts,
		tour,
		target: target as DemoTargetKind,
		xAccountTier: typedXAccountTier,
		startPath,
		typingDelayMs: boundedNumber(input.typingDelayMs, 'typingDelayMs', 28, 0, 250),
		actionDelayMs: boundedNumber(input.actionDelayMs, 'actionDelayMs', 240, 0, 2_000),
		maxTurnMs: boundedNumber(input.maxTurnMs, 'maxTurnMs', 180_000, 10_000, 600_000),
		safetyLevel,
	}
}

export function loadCampaignDemoManifest(path: string): CampaignDemoManifest {
	const raw = readFileSync(path, 'utf8')
	if (raw.length > MAX_MANIFEST_BYTES) throw new Error('Demo manifest is unexpectedly large.')
	return parseCampaignDemoManifest(JSON.parse(raw) as unknown)
}
