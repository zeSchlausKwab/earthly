import type { EventTemplate, Filter } from 'nostr-tools'
import type { MapletDataPolicy } from '@/lib/maplets/data'
import { myMapsModel, MAPLET_SOURCE_KIND, MY_MAPS_PREFERENCES } from './myMapsModel'

export const myMapsDataPolicy: MapletDataPolicy = {
	namespace: 'my-maps-viewer:v1',
	privateKind: 30078,
	filters(value, pubkey) {
		if (!Array.isArray(value) || value.length !== 1)
			throw new Error('One configuration filter is required')
		const filter = value[0] as Filter
		if (
			!filter ||
			typeof filter !== 'object' ||
			Array.isArray(filter) ||
			!Array.isArray(filter.kinds) ||
			filter.kinds.length !== 1
		)
			throw new Error('Invalid configuration filter')
		if (filter.kinds[0] === 30078) {
			if (
				!pubkey ||
				JSON.stringify(filter.authors) !== JSON.stringify([pubkey]) ||
				JSON.stringify(filter['#d']) !== JSON.stringify([MY_MAPS_PREFERENCES])
			)
				throw new Error('Private sources belong to the signed-in account')
			return [{ kinds: [30078], authors: [pubkey], '#d': [MY_MAPS_PREFERENCES], limit: 1 }]
		}
		if (
			filter.kinds[0] !== MAPLET_SOURCE_KIND ||
			JSON.stringify(filter['#t']) !== '["maplet-source"]'
		)
			throw new Error('Only GMapper configuration discovery is permitted')
		if (
			filter.authors &&
			(!Array.isArray(filter.authors) ||
				filter.authors.length !== 1 ||
				!/^[a-f0-9]{64}$/.test(filter.authors[0] ?? ''))
		)
			throw new Error('Invalid configuration author')
		return [
			{
				kinds: [MAPLET_SOURCE_KIND],
				'#t': ['maplet-source'],
				...(filter.authors ? { authors: filter.authors } : {}),
				limit: Math.min(
					500,
					Math.max(
						1,
						typeof filter.limit === 'number' && Number.isInteger(filter.limit) ? filter.limit : 100,
					),
				),
			},
		]
	},
	template(value, pubkey, encrypted) {
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new Error('Invalid event template')
		const template = value as EventTemplate
		if (
			typeof template.content !== 'string' ||
			template.content.length > 60_000 ||
			!Array.isArray(template.tags)
		)
			throw new Error('Invalid configuration event')
		if (encrypted) {
			if (
				template.kind !== 30078 ||
				JSON.stringify(template.tags) !== JSON.stringify([['d', MY_MAPS_PREFERENCES]])
			)
				throw new Error('Only this Maplet’s private preferences may be saved')
			const prefs = myMapsModel.preferences(JSON.parse(template.content))
			return {
				kind: 30078,
				tags: [['d', MY_MAPS_PREFERENCES]],
				content: JSON.stringify(prefs),
				created_at: 0,
			}
		}
		const parsed = myMapsModel.parseAnnouncement({ ...template, pubkey, id: '' })
		return myMapsModel.announcement(parsed.source, parsed.deleted)
	},
}
