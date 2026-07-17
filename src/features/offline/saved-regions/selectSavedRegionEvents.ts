import { verifyEvent, type NostrEvent } from 'nostr-tools'
import { isArticle } from '@/lib/nostr/article'
import { isGeoDataset } from '@/lib/nostr/geo-event'
import { getCommentThreading, isGeoComment } from '@/lib/nostr/geo-comment'
import { isGroup } from '@/lib/nostr/group'
import {
	ARTICLE_KIND,
	GEO_COMMENT_KIND,
	GEO_EVENT_KIND,
	MAP_CONTEXT_KIND,
	TEMPORAL_SIGHTING_KIND,
} from '@/lib/nostr/kinds'
import { isTemporalSighting } from '@/lib/nostr/temporal-sighting'
import { isExpired } from '@/lib/nostr/expiry'

/** Native import validation uses the same hard ceilings. */
export const MAX_SAVED_REGION_EVENTS = 4_096
/** Sum of UTF-8 encoded JSON event objects, excluding the surrounding manifest. */
export const MAX_SAVED_REGION_EVENT_BYTES = 16 * 1024 * 1024

export type SavedRegionBoundingBox = [number, number, number, number]

export interface SavedRegionEventSelectionCounts {
	/** Caller-required signed records, such as the selected kind-34444 source announcement. */
	required: number
	/** Spatial records selected by bbox, before referenced Group dependencies. */
	spatialRoots: number
	/** Groups outside the direct spatial selection pulled in through `c` references. */
	referencedGroups: number
	roots: number
	datasets: number
	groups: number
	stories: number
	sightings: number
	comments: number
	profiles: number
	total: number
	bytesTotal: number
	/** Otherwise eligible records omitted by the hard count/byte ceilings. */
	omittedEvents: number
}

export interface SavedRegionEventSelection {
	events: NostrEvent[]
	counts: SavedRegionEventSelectionCounts
	truncated: boolean
}

export interface SelectSavedRegionEventsInput {
	bbox: SavedRegionBoundingBox
	events: readonly NostrEvent[]
	/** Records that must be included before the spatial graph or fail the selection. */
	requiredEvents?: readonly NostrEvent[]
	/** Epoch seconds. Injected so Sighting expiry is deterministic. */
	now?: number
}

const ROOT_KINDS = new Set([GEO_EVENT_KIND, MAP_CONTEXT_KIND, ARTICLE_KIND, TEMPORAL_SIGHTING_KIND])
const RELEVANT_KINDS = new Set([...ROOT_KINDS, GEO_COMMENT_KIND, 0])
const textEncoder = new TextEncoder()

interface SelectionAccumulator {
	events: NostrEvent[]
	ids: Set<string>
	bytesTotal: number
	omittedEvents: number
}

function tagValue(event: NostrEvent, name: string): string | undefined {
	return event.tags.find((tag) => tag[0] === name)?.[1]
}

function isPublic(event: NostrEvent): boolean {
	return !event.tags.some((tag) => tag[0] === 'h')
}

function isVerified(event: NostrEvent): boolean {
	try {
		// nostr-tools memoizes verification on an event Symbol. Rebuild the canonical
		// shape so a cloned/tampered cache object cannot carry a stale `true` memo.
		return verifyEvent({
			id: event.id,
			pubkey: event.pubkey,
			created_at: event.created_at,
			kind: event.kind,
			tags: event.tags.map((tag) => [...tag]),
			content: event.content,
			sig: event.sig,
		})
	} catch {
		return false
	}
}

function isJsonObject(content: string): boolean {
	try {
		const parsed = JSON.parse(content) as unknown
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
	} catch {
		return false
	}
}

function isValidDatasetContent(event: NostrEvent): boolean {
	try {
		const parsed = JSON.parse(event.content) as { type?: unknown; features?: unknown }
		return parsed?.type === 'FeatureCollection' && Array.isArray(parsed.features)
	} catch {
		return false
	}
}

function isRootRecord(event: NostrEvent): boolean {
	switch (event.kind) {
		case GEO_EVENT_KIND:
			return isGeoDataset(event) && isValidDatasetContent(event)
		case MAP_CONTEXT_KIND:
			return isGroup(event)
		case ARTICLE_KIND:
			return isArticle(event)
		case TEMPORAL_SIGHTING_KIND:
			return isTemporalSighting(event)
		default:
			return false
	}
}

function parseBoundingBox(event: NostrEvent): SavedRegionBoundingBox | null {
	const raw = tagValue(event, 'bbox')
	if (!raw) return null
	const parts = raw.split(',').map((value) => value.trim())
	if (parts.some((value) => value.length === 0)) return null
	const values = parts.map(Number)
	if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null
	const [west, south, east, north] = values as SavedRegionBoundingBox
	if (
		west < -180 ||
		west > 180 ||
		east < -180 ||
		east > 180 ||
		south < -90 ||
		south > 90 ||
		north < -90 ||
		north > 90 ||
		west > east ||
		south > north
	) {
		return null
	}
	return [west, south, east, north]
}

function assertValidSelectionBox(box: SavedRegionBoundingBox): void {
	const eventLike = {
		tags: [['bbox', box.join(',')]],
	} as NostrEvent
	if (!parseBoundingBox(eventLike)) {
		throw new Error('Saved-region bounds must be finite, ordered, and within world coordinates')
	}
}

function intersects(left: SavedRegionBoundingBox, right: SavedRegionBoundingBox): boolean {
	return !(left[2] < right[0] || left[0] > right[2] || left[3] < right[1] || left[1] > right[3])
}

function addressCoordinate(event: NostrEvent): string | null {
	const identifier = tagValue(event, 'd')
	if (!identifier) return null
	return `${event.kind}:${event.pubkey}:${identifier}`
}

function parseCoordinate(value: string | undefined, expectedKind?: number): string | null {
	if (!value) return null
	const [kindRaw, pubkey, ...identifierParts] = value.split(':')
	const kind = Number(kindRaw)
	const identifier = identifierParts.join(':')
	if (
		!Number.isInteger(kind) ||
		String(kind) !== kindRaw ||
		(expectedKind !== undefined && kind !== expectedKind) ||
		!/^[0-9a-f]{64}$/u.test(pubkey ?? '') ||
		!identifier
	) {
		return null
	}
	return `${kind}:${pubkey}:${identifier}`
}

function compareNewestFirst(left: NostrEvent, right: NostrEvent): number {
	return (
		right.created_at - left.created_at || left.kind - right.kind || left.id.localeCompare(right.id)
	)
}

function compareOldestFirst(left: NostrEvent, right: NostrEvent): number {
	return (
		left.created_at - right.created_at || left.kind - right.kind || left.id.localeCompare(right.id)
	)
}

function compareRequiredEvents(left: NostrEvent, right: NostrEvent): number {
	return compareNewestFirst(left, right) || left.sig.localeCompare(right.sig)
}

/** Keep the EventStore-equivalent newest parameterized-replaceable record. */
function latestByCoordinate(events: Iterable<NostrEvent>): Map<string, NostrEvent> {
	const latest = new Map<string, NostrEvent>()
	for (const event of events) {
		const coordinate = addressCoordinate(event)
		if (!coordinate) continue
		const current = latest.get(coordinate)
		if (
			!current ||
			event.created_at > current.created_at ||
			(event.created_at === current.created_at && event.id < current.id)
		) {
			latest.set(coordinate, event)
		}
	}
	return latest
}

function encodedEventBytes(event: NostrEvent): number | null {
	try {
		return textEncoder.encode(JSON.stringify(event)).byteLength
	} catch {
		return null
	}
}

function addWithinLimits(accumulator: SelectionAccumulator, event: NostrEvent): boolean {
	if (accumulator.ids.has(event.id)) return true
	const bytes = encodedEventBytes(event)
	if (
		bytes === null ||
		accumulator.events.length >= MAX_SAVED_REGION_EVENTS ||
		accumulator.bytesTotal + bytes > MAX_SAVED_REGION_EVENT_BYTES
	) {
		accumulator.omittedEvents += 1
		return false
	}
	accumulator.events.push(event)
	accumulator.ids.add(event.id)
	accumulator.bytesTotal += bytes
	return true
}

function addRequiredWithinLimits(accumulator: SelectionAccumulator, event: NostrEvent): void {
	if (accumulator.ids.has(event.id)) return
	const bytes = encodedEventBytes(event)
	if (bytes === null) throw new Error(`Required Nostr event ${event.id} cannot be encoded`)
	if (
		accumulator.events.length >= MAX_SAVED_REGION_EVENTS ||
		accumulator.bytesTotal + bytes > MAX_SAVED_REGION_EVENT_BYTES
	) {
		throw new Error('Required Nostr events exceed the saved-region event limits')
	}
	accumulator.events.push(event)
	accumulator.ids.add(event.id)
	accumulator.bytesTotal += bytes
}

function prepareRequiredEvents(events: readonly NostrEvent[]): NostrEvent[] {
	const byId = new Map<string, NostrEvent>()
	for (const event of events) {
		if (!isVerified(event)) throw new Error('A required Nostr event has an invalid signature')
		if (!isPublic(event)) throw new Error('A required Nostr event is not public')
		const current = byId.get(event.id)
		if (!current || compareRequiredEvents(event, current) < 0) byId.set(event.id, event)
	}
	return [...byId.values()].sort(compareRequiredEvents)
}

function selectedRootKindCounts(events: readonly NostrEvent[]) {
	return {
		datasets: events.filter((event) => event.kind === GEO_EVENT_KIND).length,
		groups: events.filter((event) => event.kind === MAP_CONTEXT_KIND).length,
		stories: events.filter((event) => event.kind === ARTICLE_KIND).length,
		sightings: events.filter((event) => event.kind === TEMPORAL_SIGHTING_KIND).length,
	}
}

/**
 * Select the signed public Earthly event graph needed beside a saved basemap region.
 *
 * Replacement lineages are collapsed before spatial filtering, so an old version
 * cannot leak into a region after its newest version moved elsewhere. Dependencies
 * are added in this order: required records, spatial roots, referenced Groups,
 * reachable comment threads, then author profiles. That ordering preserves exact
 * source provenance, useful roots, and comment parents when the shared native
 * count/byte ceilings truncate the graph.
 */
export function selectSavedRegionEvents({
	bbox,
	events,
	requiredEvents = [],
	now = Math.floor(Date.now() / 1_000),
}: SelectSavedRegionEventsInput): SavedRegionEventSelection {
	assertValidSelectionBox(bbox)
	const required = prepareRequiredEvents(requiredEvents)
	const accumulator: SelectionAccumulator = {
		events: [],
		ids: new Set(),
		bytesTotal: 0,
		omittedEvents: 0,
	}
	for (const event of required) addRequiredWithinLimits(accumulator, event)

	const verifiedById = new Map<string, NostrEvent>()
	for (const candidate of events) {
		if (!RELEVANT_KINDS.has(candidate.kind) || verifiedById.has(candidate.id)) continue
		if (!isVerified(candidate)) continue
		verifiedById.set(candidate.id, candidate)
	}
	const verified = [...verifiedById.values()]

	// Collapse each signed lineage before applying public/model/content gates. A
	// newer private or malformed replacement must not resurrect an older public copy.
	const currentRoots = new Map(
		[
			...latestByCoordinate(verified.filter((event) => ROOT_KINDS.has(event.kind))).entries(),
		].filter(([, event]) => isPublic(event) && isRootRecord(event)),
	)
	const spatialCandidates = [...currentRoots.values()]
		.filter((event) => {
			if (event.kind === TEMPORAL_SIGHTING_KIND && isExpired(event, now)) return false
			const eventBox = parseBoundingBox(event)
			return eventBox !== null && intersects(bbox, eventBox)
		})
		.sort(compareNewestFirst)

	const selectedRoots: NostrEvent[] = []
	const selectedRootCoordinates = new Set<string>()
	const spatialRootIds = new Set<string>()
	for (const event of spatialCandidates) {
		if (!addWithinLimits(accumulator, event)) continue
		const coordinate = addressCoordinate(event)
		if (!coordinate) continue
		selectedRoots.push(event)
		selectedRootCoordinates.add(coordinate)
		spatialRootIds.add(event.id)
	}

	// A selected root may recommend one or more Groups through `c` tags. Resolve
	// them from the same verified cache even when the Group has no/intersects no bbox.
	const currentGroups = new Map(
		[...currentRoots.entries()].filter(([, event]) => event.kind === MAP_CONTEXT_KIND),
	)
	const referencedGroupIds = new Set<string>()
	const groupQueue = [...selectedRoots]
	for (let index = 0; index < groupQueue.length; index += 1) {
		const source = groupQueue[index]
		if (!source) continue
		const references = source.tags
			.filter((tag) => tag[0] === 'c')
			.map((tag) => parseCoordinate(tag[1], MAP_CONTEXT_KIND))
			.filter((coordinate): coordinate is string => coordinate !== null)
			.sort()
		for (const coordinate of references) {
			if (selectedRootCoordinates.has(coordinate)) continue
			const group = currentGroups.get(coordinate)
			if (!group || !addWithinLimits(accumulator, group)) continue
			selectedRoots.push(group)
			selectedRootCoordinates.add(coordinate)
			referencedGroupIds.add(group.id)
			groupQueue.push(group)
		}
	}

	// Collapse edited comments, then walk from valid top-level comments to replies.
	// A dangling reply is not a thread dependency and is deliberately left out.
	const currentComments = [
		...latestByCoordinate(verified.filter((event) => event.kind === GEO_COMMENT_KIND)).values(),
	]
		.filter((event) => isPublic(event) && isGeoComment(event))
		.sort(compareOldestFirst)
	const selectedComments: NostrEvent[] = []
	const selectedCommentIds = new Set<string>()
	const selectedCommentCoordinates = new Set<string>()
	const pendingComments = [...currentComments]
	let madeProgress = true
	while (madeProgress && pendingComments.length > 0) {
		madeProgress = false
		for (let index = 0; index < pendingComments.length; ) {
			const comment = pendingComments[index]
			if (!comment) {
				pendingComments.splice(index, 1)
				continue
			}
			const threading = getCommentThreading(comment)
			const root = parseCoordinate(threading.rootAddress)
			if (!root || !selectedRootCoordinates.has(root)) {
				pendingComments.splice(index, 1)
				continue
			}
			const rootKind = Number(root.split(':', 1)[0])
			if (threading.rootKind !== String(rootKind)) {
				pendingComments.splice(index, 1)
				continue
			}

			let reachable = false
			if (threading.parentKind === String(GEO_COMMENT_KIND)) {
				const parentAddress = parseCoordinate(threading.parentAddress, GEO_COMMENT_KIND)
				reachable =
					(parentAddress !== null && selectedCommentCoordinates.has(parentAddress)) ||
					(!!threading.parentEventId && selectedCommentIds.has(threading.parentEventId))
			} else {
				reachable =
					threading.parentKind === String(rootKind) &&
					parseCoordinate(threading.parentAddress) === root
			}
			if (!reachable) {
				index += 1
				continue
			}

			pendingComments.splice(index, 1)
			if (!addWithinLimits(accumulator, comment)) continue
			const coordinate = addressCoordinate(comment)
			if (!coordinate) continue
			selectedComments.push(comment)
			selectedCommentIds.add(comment.id)
			selectedCommentCoordinates.add(coordinate)
			madeProgress = true
		}
	}

	const authorPubkeys = new Set(
		[...selectedRoots, ...selectedComments].map((event) => event.pubkey),
	)
	const currentProfiles = new Map<string, NostrEvent>()
	for (const profile of verified) {
		if (profile.kind !== 0) continue
		const current = currentProfiles.get(profile.pubkey)
		if (
			!current ||
			profile.created_at > current.created_at ||
			(profile.created_at === current.created_at && profile.id < current.id)
		) {
			currentProfiles.set(profile.pubkey, profile)
		}
	}
	const selectedProfiles: NostrEvent[] = []
	for (const pubkey of [...authorPubkeys].sort()) {
		const profile = currentProfiles.get(pubkey)
		if (
			profile &&
			isPublic(profile) &&
			isJsonObject(profile.content) &&
			addWithinLimits(accumulator, profile)
		) {
			selectedProfiles.push(profile)
		}
	}

	const kindCounts = selectedRootKindCounts(selectedRoots)
	const counts: SavedRegionEventSelectionCounts = {
		required: required.length,
		spatialRoots: spatialRootIds.size,
		referencedGroups: referencedGroupIds.size,
		roots: selectedRoots.length,
		...kindCounts,
		comments: selectedComments.length,
		profiles: selectedProfiles.length,
		total: accumulator.events.length,
		bytesTotal: accumulator.bytesTotal,
		omittedEvents: accumulator.omittedEvents,
	}
	return {
		events: accumulator.events,
		counts,
		truncated: accumulator.omittedEvents > 0,
	}
}
