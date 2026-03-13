import type { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'

export interface OrderedContextDisplayItem {
	context: NDKMapContextEvent
	depth: number
	displayParentCoordinate: string | null
}

function getContextKey(context: NDKMapContextEvent, index: number): string {
	return context.contextCoordinate ?? context.id ?? `${context.pubkey}:${context.contextId ?? index}`
}

export function orderContextsForDisplay(
	contexts: NDKMapContextEvent[],
): OrderedContextDisplayItem[] {
	if (contexts.length <= 1) {
		return contexts.map((context) => ({
			context,
			depth: 0,
			displayParentCoordinate: null,
		}))
	}

	const keyedContexts = contexts.map((context, index) => ({
		context,
		key: getContextKey(context, index),
	}))
	const keySet = new Set(keyedContexts.map((entry) => entry.key))
	const coordinateToKey = new Map<string, string>()
	keyedContexts.forEach(({ context, key }) => {
		const coordinate = context.contextCoordinate
		if (coordinate) coordinateToKey.set(coordinate, key)
	})

	const parentByKey = new Map<string, string | null>()
	keyedContexts.forEach(({ context, key }) => {
		const visibleParent = context.contextReferences.find((coordinate) => {
			const candidateKey = coordinateToKey.get(coordinate)
			return Boolean(candidateKey && candidateKey !== key)
		})
		parentByKey.set(key, visibleParent ? coordinateToKey.get(visibleParent) ?? null : null)
	})

	const childrenByKey = new Map<string, typeof keyedContexts>()
	const roots: typeof keyedContexts = []
	keyedContexts.forEach((entry) => {
		const parentKey = parentByKey.get(entry.key)
		if (parentKey && keySet.has(parentKey)) {
			const siblings = childrenByKey.get(parentKey)
			if (siblings) {
				siblings.push(entry)
			} else {
				childrenByKey.set(parentKey, [entry])
			}
			return
		}
		roots.push(entry)
	})

	const ordered: OrderedContextDisplayItem[] = []
	const visited = new Set<string>()
	const active = new Set<string>()

	const visit = (entry: (typeof keyedContexts)[number], depth: number) => {
		if (visited.has(entry.key) || active.has(entry.key)) return
		active.add(entry.key)
		ordered.push({
			context: entry.context,
			depth,
			displayParentCoordinate:
				depth > 0
					? entry.context.contextReferences.find((coordinate) => {
							const candidateKey = coordinateToKey.get(coordinate)
							return Boolean(candidateKey && parentByKey.get(entry.key) === candidateKey)
						}) ?? null
					: null,
		})
		for (const child of childrenByKey.get(entry.key) ?? []) {
			visit(child, depth + 1)
		}
		active.delete(entry.key)
		visited.add(entry.key)
	}

	for (const entry of roots) {
		visit(entry, 0)
	}
	for (const entry of keyedContexts) {
		visit(entry, 0)
	}

	return ordered
}
