import type { RouteState } from '@/features/geo-editor/hooks/useRouting'

export interface DiscoveryEventLike {
	id: string
	pubkey: string
	created_at: number
}

export interface DiscoveryDatasetLike extends DiscoveryEventLike {
	dTag?: string
	datasetId?: string
	boundingBox?: readonly number[]
	featureCollection?: {
		features?: Array<{ geometry?: unknown }>
	}
	blobReferences?: Array<{ url?: string }>
}

export interface DiscoverySelectionOptions {
	featuredPubkeys: readonly string[]
	allowUnfeaturedFallback: boolean
}

export interface LandingGuardInput {
	pathname: string
	search: string
	hash: string
	route: RouteState
	stance: 'browse' | 'focus' | 'author'
	stackUrlHydrated: boolean
	catalogSettled: boolean
	activeDraftId: string | null
	activeWorkspaceId: string | null
	hasEditorFeatures: boolean
	hasDraftStackEntry: boolean
	mapStackSize: number
}

export function normalizeDiscoveryText(value: unknown, maxLength: number): string | undefined {
	if (typeof value !== 'string' || maxLength <= 0) return undefined
	const normalized = value.trim()
	if (!normalized) return undefined
	if (normalized.length <= maxLength) return normalized
	if (maxLength === 1) return '…'
	return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function byNewestThenId<T extends DiscoveryEventLike>(left: T, right: T): number {
	return right.created_at - left.created_at || left.id.localeCompare(right.id)
}

function eligibleAuthor(pubkey: string, options: DiscoverySelectionOptions): boolean {
	if (options.featuredPubkeys.length > 0) return options.featuredPubkeys.includes(pubkey)
	return options.allowUnfeaturedFallback
}

export function selectRecentDiscoveryItems<T extends DiscoveryEventLike>(
	events: readonly T[],
	options: DiscoverySelectionOptions,
	limit = 3,
): T[] {
	if (limit <= 0) return []
	return events
		.filter((event) => eligibleAuthor(event.pubkey, options))
		.slice()
		.sort(byNewestThenId)
		.slice(0, limit)
}

export function isRenderableDiscoveryDataset(dataset: DiscoveryDatasetLike): boolean {
	const identifier = dataset.dTag ?? dataset.datasetId
	if (!identifier?.trim()) return false

	const hasInlineGeometry =
		dataset.featureCollection?.features?.some((feature) => feature.geometry != null) ?? false
	const hasBlobGeometry =
		dataset.blobReferences?.some((reference) => Boolean(reference.url?.trim())) ?? false
	return hasInlineGeometry || hasBlobGeometry
}

/**
 * Landing maps must be immediately frameable. Blob-only datasets remain useful
 * Discover results, but without a published bbox they can finish resolving well
 * after the initial camera decision and leave a first-time visitor looking at
 * the wrong part of the world.
 */
export function isLandingDatasetCandidate(dataset: DiscoveryDatasetLike): boolean {
	if (!isRenderableDiscoveryDataset(dataset)) return false
	const hasInlineGeometry =
		dataset.featureCollection?.features?.some((feature) => feature.geometry != null) ?? false
	const bounds = dataset.boundingBox
	const hasUsableBounds =
		bounds?.length === 4 && bounds.every((coordinate) => Number.isFinite(coordinate))
	return hasInlineGeometry || hasUsableBounds
}

export function selectLatestEligibleDataset<T extends DiscoveryDatasetLike>(
	datasets: readonly T[],
	options: DiscoverySelectionOptions,
): T | undefined {
	return selectRecentDiscoveryItems(datasets.filter(isLandingDatasetCandidate), options, 1)[0]
}

function isPlainRootLocation({
	pathname,
	search,
	hash,
	route,
}: Pick<LandingGuardInput, 'pathname' | 'search' | 'hash' | 'route'>): boolean {
	return (
		pathname === '/' &&
		search === '' &&
		(hash === '' || hash === '#') &&
		route.focusType === 'none' &&
		!route.contextNaddr &&
		!route.privateGroupId &&
		!route.fieldSessionId
	)
}

export function shouldAutoOpenDiscover(
	input: Omit<LandingGuardInput, 'catalogSettled' | 'mapStackSize'>,
): boolean {
	return (
		isPlainRootLocation(input) &&
		input.stance === 'browse' &&
		input.stackUrlHydrated &&
		!input.activeDraftId &&
		!input.activeWorkspaceId &&
		!input.hasEditorFeatures &&
		!input.hasDraftStackEntry
	)
}

export function shouldSeedLandingDataset(input: LandingGuardInput): boolean {
	return shouldAutoOpenDiscover(input) && input.catalogSettled && input.mapStackSize === 0
}
