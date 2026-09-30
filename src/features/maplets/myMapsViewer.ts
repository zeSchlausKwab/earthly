import type { FeatureCollection } from 'geojson'
import type { EventTemplate, NostrEvent } from 'nostr-tools'
import { parseMapletKml } from './kml'
import { myMapsExportUrl } from './myMaps'
import { createMyMapsModel, type MyMapsSource, type MyMapsAnnouncement } from './myMapsModel'

export const MY_MAPS_VIEWER_DEFINITION = {
	id: 'my-maps-viewer',
	title: 'GMapper',
	description:
		'View public Google My Maps. Create, use and share configurations with chosen layers and styles.',
	requires: ['map', 'identity', 'resource', 'storage', 'relay'],
} as const

interface ViewerBridge {
	map: {
		replace(
			collection: FeatureCollection,
			options?: {
				warnings: string[]
				entries: {
					id: string
					title: string
					collection: FeatureCollection
					warnings: string[]
					visible: boolean
					preview?: boolean
					previewOf?: string
				}[]
			},
		): Promise<void>
		resize(height: number): void
		onRefresh(callback: () => void): void
		workspace(action: string, payload?: unknown): Promise<unknown>
		onWorkspaceChanged(callback: (value: unknown) => void): void
	}
	identity: { getPublicKey(): Promise<string>; onChanged(callback: (key: string) => void): void }
	storage: {
		getItem(key: string): Promise<unknown>
		setItem(key: string, value: unknown): Promise<void>
	}
	resource: { bytes(url: string, options: { signal: AbortSignal }): Promise<Blob> }
	relay: {
		query(filters: unknown[]): Promise<{ event: NostrEvent }[]>
		publish(event: EventTemplate): Promise<NostrEvent>
		publishEncrypted(event: EventTemplate, recipient: string): Promise<NostrEvent>
	}
}

/** Serialized Maplet program. Fetching, configurations and UI remain owned by GMapper. */
function runMyMapsViewer(
	canonicalize: typeof myMapsExportUrl,
	parse: typeof parseMapletKml,
	createModel: typeof createMyMapsModel,
) {
	const nap = (window as unknown as { napplet: ViewerBridge }).napplet
	const model = createModel(canonicalize)
	type Loaded = {
		source: MyMapsSource
		layers?: Record<string, FeatureCollection>
		fetchedAt?: number
		warnings: string[]
		error?: string
		controller?: AbortController
		manual?: boolean
	}
	const root =
		document.getElementById('app') ??
		(() => {
			throw new Error('Missing GMapper root')
		})()
	let pubkey = '',
		epoch = 0,
		loading = true,
		busy = false,
		discovering = false
	let sources: Loaded[] = [],
		drafts: Loaded[] = [],
		announcements: MyMapsAnnouncement[] = []
	const publicCache = new Map<string, Loaded>(),
		updates = new Map<string, MyMapsAnnouncement>()
	let screen: 'directory' | 'detail' | 'editor' | 'review' | 'update' | 'unpublish' = 'directory'
	let tab: 'explore' | 'yours' = 'explore',
		detailTab: 'configuration' | 'view' | 'geometry' = 'configuration'
	let selected = '',
		editor: Loaded | undefined,
		search = '',
		limit = 100,
		error = '',
		notice = '',
		dirty = false
	let emission = Promise.resolve(),
		persistence = Promise.resolve()
	const selectedGeometry = new Set<string>()
	const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
		const node = document.createElement(tag)
		if (text !== undefined) node.textContent = text
		if (className) node.className = className
		return node
	}
	const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason))
	const clone = (source: MyMapsSource) => model.source(JSON.parse(JSON.stringify(source)))
	const publicKey = (item: MyMapsAnnouncement) => `${item.pubkey}:${item.identifier}`
	const reference = (source: MyMapsSource) =>
		source.publication ? `${source.publication.pubkey}:${source.publication.identifier}` : ''
	const owns = (source: MyMapsSource) =>
		source.owner
			? source.owner === pubkey
			: !source.publication || source.publication.pubkey === pubkey
	const publisher = (source: MyMapsSource) =>
		owns(source)
			? pubkey
				? 'You'
				: 'This device'
			: `${(source.owner ?? source.publication?.pubkey ?? '').slice(0, 8)}…`
	function button(text: string, action: () => unknown, disabled = false, className = '') {
		const node = el('button', text, className)
		node.type = 'button'
		node.disabled = disabled || loading
		node.onclick = () => {
			void Promise.resolve()
				.then(action)
				.catch((reason) => {
					error = message(reason)
					render()
				})
		}
		return node
	}
	function field(label: string, value: string, update: (value: string) => void, multiline = false) {
		const wrapper = el('label', label, 'field'),
			input = multiline ? el('textarea') : el('input')
		input.value = value
		input.disabled = busy || loading
		input.oninput = () => update(input.value)
		wrapper.append(input)
		return wrapper
	}
	function prefs() {
		return model.preferences({
			version: 2,
			sources: sources.map((item) => item.source),
			drafts: drafts.map((item) => ({
				...item.source,
				title: item.source.title.trim() || 'New configuration',
			})),
		})
	}
	function persist() {
		dirty = true
		const current = epoch,
			value = prefs()
		persistence = persistence
			.catch(() => {})
			.then(async () => {
				if (current === epoch) await nap.storage.setItem('saved', value)
			})
		return persistence
	}
	function changed() {
		void Promise.resolve()
			.then(persist)
			.catch((reason) => {
				error = message(reason)
				render()
			})
	}
	function findSelected() {
		return sources.find((item) => item.source.id === selected) ?? publicCache.get(selected)
	}
	function activeFor(source: MyMapsSource) {
		return sources.find((item) =>
			reference(source)
				? reference(item.source) === reference(source)
				: item.source.id === source.id && !reference(item.source),
		)
	}
	function currentPreview() {
		return (screen === 'editor' || screen === 'review') && editor?.layers ? editor : undefined
	}
	function collection(item: Loaded, preview = false): FeatureCollection {
		const view = preview ? item.source : model.effectiveView(item.source)
		return {
			type: 'FeatureCollection',
			features: Object.entries(item.layers ?? {}).flatMap(([name, layer]) =>
				view.hiddenLayers.includes(name)
					? []
					: layer.features.map((feature) => ({
							...feature,
							id: `${preview ? 'preview:' : ''}${item.source.id}:${feature.id}`,
							properties: {
								...feature.properties,
								sourceUrl: item.source.url,
								mapletConfiguration: item.source.id,
								...(item.source.publication
									? {
											sourcePubkey: item.source.publication.pubkey,
											sourceEventId: item.source.publication.eventId,
											sourceAddress: `${model.kind}:${item.source.publication.pubkey}:${item.source.publication.identifier}`,
										}
									: {}),
								...(view.layerColors[name]
									? { fillColor: view.layerColors[name], strokeColor: view.layerColors[name] }
									: {}),
								fillOpacity:
									Number(
										feature.properties?.fillOpacity ??
											(['Point', 'MultiPoint'].includes(feature.geometry.type) ? 1 : 0.35),
									) * view.opacity,
								strokeOpacity: Number(feature.properties?.strokeOpacity ?? 1) * view.opacity,
							},
						})),
			),
		}
	}
	function display() {
		const current = epoch
		emission = emission
			.catch(() => {})
			.then(async () => {
				if (current !== epoch) return
				const entries: NonNullable<Parameters<ViewerBridge['map']['replace']>[1]>['entries'] =
					sources
						.filter((item) => item.source.active)
						.map((item) => ({
							id: item.source.id,
							title: item.source.title,
							collection: collection(item),
							visible: item.source.visible,
							warnings: [...item.warnings, ...(item.error ? [item.error] : [])],
						}))
				const preview = currentPreview()
				if (preview)
					entries.push({
						id: `preview:${preview.source.id}`,
						title: 'Configuration preview',
						collection: collection(preview, true),
						visible: true,
						warnings: preview.warnings,
						preview: true,
						...(sources.some((item) => item.source.active && item.source.id === preview.source.id)
							? { previewOf: preview.source.id }
							: {}),
					})
				await nap.map.replace(
					{
						type: 'FeatureCollection',
						features: entries
							.filter((item) => item.visible)
							.flatMap((item) => item.collection.features),
					},
					{ entries, warnings: entries.flatMap((item) => item.warnings) },
				)
			})
		return emission
	}
	async function readKml(text: string, url: string) {
		const parsed = parse(text, url),
			duplicates = new Map<string, number>()
		for (const [layer, content] of Object.entries(parsed.payload.layers))
			for (const feature of content.features) {
				const identity = JSON.stringify([
					url,
					layer,
					feature.id ?? [feature.geometry, feature.properties],
				])
				const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
				const hash = Array.from(new Uint8Array(digest), (byte) =>
					byte.toString(16).padStart(2, '0'),
				).join('')
				const occurrence = duplicates.get(hash) ?? 0
				duplicates.set(hash, occurrence + 1)
				feature.id = `my-maps:${hash}:${occurrence}`
			}
		return parsed
	}
	function retained(item: Loaded) {
		return (
			sources.includes(item) || drafts.includes(item) || [...publicCache.values()].includes(item)
		)
	}
	async function fetchSource(item: Loaded) {
		item.controller?.abort()
		const controller = new AbortController(),
			current = epoch,
			previous = item.layers
		item.controller = controller
		item.error = undefined
		render()
		try {
			const blob = await nap.resource.bytes(item.source.url, { signal: controller.signal })
			const parsed = await readKml(await blob.text(), item.source.url)
			if (current !== epoch || controller.signal.aborted || !retained(item)) return
			item.layers = parsed.payload.layers
			item.warnings = parsed.warnings
			if (item.source.title === 'New configuration')
				item.source.title = parsed.name.slice(0, 160).trim() || 'New configuration'
			item.fetchedAt = Date.now()
			item.manual = false
			await display()
			if (current === epoch && drafts.includes(item)) changed()
		} catch (reason) {
			if (current !== epoch || controller.signal.aborted) return
			item.layers = previous
			item.error = `${message(reason)}${previous ? ' Showing the last successful fetch.' : ''}`
			await display().catch(() => {})
		} finally {
			if (current === epoch && item.controller === controller) {
				item.controller = undefined
				render()
			}
		}
	}
	async function perform(action: () => Promise<void>) {
		if (busy) return
		const current = epoch
		busy = true
		error = ''
		render()
		try {
			await action()
		} catch (reason) {
			if (current === epoch) error = message(reason)
		} finally {
			if (current === epoch) {
				busy = false
				render()
			}
		}
	}
	async function saveAccount() {
		const current = epoch,
			value = prefs()
		await persist()
		if (current !== epoch) return
		notice = pubkey ? 'Saved on this device. Syncing to your account…' : 'Saved on this device.'
		if (pubkey) {
			await nap.relay.publishEncrypted(
				{
					kind: 30078,
					created_at: 0,
					tags: [['d', model.preferencesId]],
					content: JSON.stringify(value),
				},
				pubkey,
			)
			if (current !== epoch) return
			notice = 'Saved privately for your account. Links and preferences are encrypted.'
		}
		dirty = false
	}
	async function restore(remote: boolean) {
		const current = epoch
		let value: unknown
		if (remote) {
			if (dirty) throw new Error('Save your changes for your account before restoring.')
			const results = await nap.relay.query([
				{ kinds: [30078], authors: [pubkey], '#d': [model.preferencesId], limit: 1 },
			])
			if (current !== epoch) return
			const latest = results
				.map((entry) => entry.event)
				.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]
			if (!latest) {
				notice = 'No configurations saved to this account yet.'
				return
			}
			value = JSON.parse(latest.content)
		} else value = await nap.storage.getItem('saved')
		if (current !== epoch || value == null) return
		const saved = model.preferences(value)
		for (const item of [...sources, ...drafts]) item.controller?.abort()
		sources = saved.sources.map((source) => ({ source, warnings: [] }))
		drafts = saved.drafts.map((source) => ({ source, warnings: [] }))
		dirty = false
		editor = undefined
		selected = ''
		screen = 'directory'
		if (remote) await nap.storage.setItem('saved', saved)
		if (current !== epoch) return
		await display()
		for (const item of sources) {
			if (current !== epoch) return
			if (item.source.active && item.source.visible) await fetchSource(item)
		}
		notice = remote
			? 'Restored private configurations from your account.'
			: 'Restored configurations saved on this device.'
	}
	async function discover() {
		const current = epoch
		discovering = true
		error = ''
		render()
		try {
			const results = await nap.relay.query([
				{ kinds: [model.kind], '#t': ['maplet-source'], limit },
			])
			if (current !== epoch) return
			const all = model.latest(
				results.map((entry) => entry.event),
				true,
			)
			announcements = all.filter((item) => !item.deleted)
			for (const item of sources) {
				const update = all.find((entry) => publicKey(entry) === reference(item.source))
				if (update && update.id !== item.source.publication?.eventId)
					updates.set(item.source.id, update)
			}
		} catch (reason) {
			if (current === epoch) error = message(reason)
		} finally {
			if (current === epoch) {
				discovering = false
				render()
			}
		}
	}
	function open(item: Loaded, key = item.source.id) {
		selected = key
		selectedGeometry.clear()
		screen = 'detail'
		detailTab = 'configuration'
		editor = undefined
		error = ''
		notice = ''
		render()
		void display()
	}
	function openAnnouncement(announcement: MyMapsAnnouncement) {
		const local = sources.find((item) => reference(item.source) === publicKey(announcement))
		if (local) return open(local)
		const key = `public:${publicKey(announcement)}`
		let item = publicCache.get(key)
		if (!item || item.source.publication?.eventId !== announcement.id) {
			item = { source: clone(announcement.source), warnings: [] }
			publicCache.set(key, item)
		}
		open(item, key)
	}
	async function add(item: Loaded) {
		const current = epoch
		const local = activeFor(item.source)
		if (local) {
			local.source.active = true
			local.source.visible = true
			selected = local.source.id
			if (!local.layers) await fetchSource(local)
		} else {
			if (sources.length >= 12)
				throw new Error('Remove a saved configuration before adding another (limit: 12).')
			const added = {
				...item,
				source: model.source({
					...item.source,
					id:
						owns(item.source) && !sources.some((entry) => entry.source.id === item.source.id)
							? item.source.id
							: crypto.randomUUID(),
					active: true,
					visible: true,
				}),
				controller: undefined,
			}
			sources.push(added)
			selected = added.source.id
			if (!added.layers) await fetchSource(added)
		}
		if (current !== epoch) return
		await persist()
		if (current !== epoch) return
		await display()
		if (current !== epoch) return
		await nap.map.workspace('fit', { entryId: selected })
		if (current !== epoch) return
		detailTab = 'view'
		render()
	}
	function startEditor(item?: Loaded, copy = false) {
		const current = copy && item ? (activeFor(item.source) ?? item) : item
		const existing =
			!copy && current && drafts.find((draft) => draft.source.id === current.source.id)
		if (existing) editor = existing
		else {
			if (drafts.length >= 12)
				throw new Error('Finish or discard a draft before creating another (limit: 12).')
			const source = current
				? copy
					? model.copy(current.source)
					: clone(current.source)
				: model.source({
						url: canonicalize('https://www.google.com/maps/d/viewer?mid=earthly-draft-placeholder'),
						title: 'New configuration',
						active: false,
					})
			source.active = false
			source.visible = true
			source.view = undefined
			source.owner = pubkey || undefined
			if (copy) source.title += ' · my version'
			editor = {
				source,
				layers: current?.layers,
				fetchedAt: current?.fetchedAt,
				manual: current?.manual,
				warnings: current?.warnings ?? [],
			}
			if (!current) editor.source.inputUrl = ''
			drafts.push(editor)
		}
		screen = 'editor'
		error = ''
		notice = ''
		changed()
		render()
		void display()
		if (current && !editor.layers) void fetchSource(editor)
	}
	function validateEditor() {
		if (!editor?.layers) throw new Error('Load your Google map before saving this configuration.')
		if (editor.source.inputUrl !== undefined) {
			if (canonicalize(editor.source.inputUrl) !== editor.source.url)
				throw new Error('Load the preview for your changed Google link before saving.')
			editor.source.inputUrl = undefined
		}
		editor.source = model.source(editor.source)
		const item = editor
		if (!Object.keys(item.layers ?? {}).some((layer) => !item.source.hiddenLayers.includes(layer)))
			throw new Error('Choose at least one layer.')
		return editor
	}
	async function saveEditor(publish = false) {
		const current = epoch,
			item = validateEditor(),
			previous = sources.find((entry) => entry.source.id === item.source.id)
		if (!previous && sources.length >= 12)
			throw new Error('Remove a saved configuration before saving another (limit: 12).')
		let source = clone(item.source)
		if (publish) {
			if (!pubkey) throw new Error('Sign in to publish under your key.')
			const event = await nap.relay.publish(model.announcement(source))
			if (current !== epoch) return
			const published = model.parseAnnouncement(event)
			source = model.source({ ...published.source, id: item.source.id })
			announcements = [
				published,
				...announcements.filter((entry) => publicKey(entry) !== publicKey(published)),
			]
		}
		const saved: Loaded = {
			...item,
			source: model.source({
				...source,
				owner: pubkey || undefined,
				active: previous?.source.active ?? false,
				visible: previous?.source.visible ?? true,
				view: previous?.source.view,
			}),
			controller: undefined,
		}
		if (previous) sources[sources.indexOf(previous)] = saved
		else sources.push(saved)
		drafts = drafts.filter((draft) => draft !== item)
		updates.delete(saved.source.id)
		editor = undefined
		selected = saved.source.id
		screen = 'detail'
		detailTab = 'configuration'
		await display()
		if (current !== epoch) return
		await saveAccount()
		if (current === epoch && publish)
			notice = 'Configuration published. Find it in GMapper → Explore configurations.'
	}
	async function unpublish(item: Loaded) {
		const current = epoch,
			event = await nap.relay.publish(model.announcement(item.source, true))
		if (current !== epoch) return
		const tombstone = model.parseAnnouncement(event)
		announcements = announcements.filter((entry) => publicKey(entry) !== publicKey(tombstone))
		item.source.published = false
		item.source.publication = tombstone.source.publication
		if (!sources.includes(item)) {
			item.source = model.source({
				...item.source,
				id: sources.some((entry) => entry.source.id === item.source.id)
					? crypto.randomUUID()
					: item.source.id,
				active: false,
			})
			sources.push(item)
			selected = item.source.id
		}
		await persist()
		if (current !== epoch) return
		screen = 'detail'
		notice = 'Removed from discovery. Your private copy and existing users’ views remain.'
	}
	async function applyUpdate(item: Loaded) {
		const update = updates.get(item.source.id),
			current = epoch
		if (!update) return
		if (update.deleted) {
			item.source.published = false
			item.source.publication = update.source.publication
		} else {
			const oldUrl = item.source.url
			item.source = model.mergeAnnouncement(item.source, update)
			if (oldUrl !== item.source.url) {
				item.layers = undefined
				await fetchSource(item)
			}
		}
		if (current !== epoch) return
		updates.delete(item.source.id)
		await persist()
		if (current !== epoch) return
		await display()
		if (current !== epoch) return
		screen = 'detail'
		detailTab = 'view'
		notice = 'Applied the update. Your personal viewing choices were preserved.'
	}
	function status(source: MyMapsSource, draft = false) {
		return draft
			? 'Draft'
			: source.published
				? 'Published'
				: source.owner
					? 'Private'
					: 'This device'
	}
	function header(back: string, action: () => unknown, kind: string, title: string, meta?: string) {
		const head = el('header', undefined, 'object-header'),
			top = el('div', undefined, 'row between')
		top.append(button(`← ${back}`, action, busy, 'link'), el('span', kind, 'eyebrow'))
		head.append(top, el('h1', title))
		if (meta) head.append(el('p', meta, 'meta'))
		root.append(head)
	}
	function goDirectory() {
		editor = undefined
		screen = 'directory'
		search = ''
		error = ''
		notice = ''
		render()
		void display()
	}
	function renderMessages() {
		if (error) {
			const alert = el('p', error, 'error')
			alert.setAttribute('role', 'alert')
			root.append(alert)
		}
		if (notice) {
			const status = el('p', notice, 'notice')
			status.setAttribute('role', 'status')
			root.append(status)
		}
		if (loading) root.append(el('p', 'Opening your configurations…', 'meta'))
	}
	function tabs<T extends string>(
		label: string,
		values: [T, string][],
		current: T,
		update: (value: T) => void,
	) {
		const nav = el('nav', undefined, 'tabs')
		nav.setAttribute('role', 'tablist')
		nav.setAttribute('aria-label', label)
		for (const [value, title] of values) {
			const node = button(title, () => update(value), false, current === value ? 'selected' : '')
			node.setAttribute('role', 'tab')
			node.setAttribute('aria-selected', String(current === value))
			nav.append(node)
		}
		return nav
	}
	function configurationRow(item: Loaded, action: () => unknown, draft = false) {
		const row = el('article', undefined, 'configuration-row')
		row.setAttribute('aria-label', item.source.title)
		const open = button(
				draft ? `Resume draft: ${item.source.title}` : item.source.title,
				action,
				busy,
				'row-title',
			),
			meta = el('p', `${publisher(item.source)} · ${status(item.source, draft)}`, 'meta')
		if (item.source.active && sources.includes(item)) meta.append(el('span', ' · On your map'))
		if (!draft && drafts.some((entry) => entry.source.id === item.source.id))
			meta.append(el('span', ' · Draft changes'))
		row.append(open, meta)
		if (item.source.description) row.append(el('p', item.source.description, 'description'))
		if (item.source.tags.length) row.append(el('p', item.source.tags.join(' · '), 'tags'))
		return row
	}
	function renderDirectory() {
		header(
			'Maplets',
			() => nap.map.workspace('back'),
			'Maplet',
			'GMapper',
			'By Earthly · Google My Maps',
		)
		const intro = el('section', undefined, 'block')
		intro.append(
			el(
				'p',
				'One Google link, your chosen layers and styles. Use a shared configuration or create your own.',
				'description',
			),
			button('Create configuration', () => startEditor(), busy, 'primary'),
		)
		root.append(
			intro,
			tabs(
				'Configurations',
				[
					['explore', 'Explore configurations'],
					['yours', 'Yours'],
				],
				tab,
				(value) => {
					tab = value
					search = ''
					render()
					if (value === 'explore') void discover()
				},
			),
		)
		renderMessages()
		const searchField = field('Search configurations', search, (value) => {
			search = value
			renderList()
		})
		const searchInput = searchField.querySelector('input')
		if (searchInput)
			searchInput.placeholder = tab === 'explore' ? 'Name, tag or publisher' : 'Name or tag'
		root.append(searchField)
		const list = el('div')
		list.id = 'configuration-list'
		root.append(list)
		renderList()
		const tools = el('section', undefined, 'block actions')
		if (tab === 'explore') {
			tools.append(
				button(
					discovering ? 'Looking for configurations…' : 'Refresh discovery',
					discover,
					busy || discovering,
					'quiet',
				),
			)
			if (limit < 500)
				tools.append(
					button(
						'Load more configurations',
						() => {
							limit += 100
							return discover()
						},
						discovering,
						'link',
					),
				)
		} else {
			tools.append(
				button(
					pubkey ? 'Save for my account' : 'Save on this device',
					() => perform(saveAccount),
					busy,
					'quiet',
				),
			)
			if (pubkey)
				tools.append(
					button('Restore from account', () => perform(() => restore(true)), busy || dirty, 'link'),
				)
		}
		root.append(
			tools,
			el(
				'p',
				tab === 'explore'
					? 'Anyone can use a shared configuration. Your browser fetches geometry from Google when you add it.'
					: pubkey
						? 'Private configurations and drafts sync encrypted to your account when you save.'
						: 'Save keeps configurations on this device. Sign in to sync and publish.',
				'meta footer',
			),
		)
	}
	function renderList() {
		const list = document.getElementById('configuration-list')
		if (!list) return
		list.replaceChildren()
		const matches = (source: MyMapsSource) =>
			search
				.toLowerCase()
				.split(/\s+/)
				.filter(Boolean)
				.every((term) =>
					[source.title, source.description, ...source.tags, source.owner ?? '']
						.join(' ')
						.toLowerCase()
						.includes(term),
				)
		if (tab === 'explore')
			for (const announcement of announcements.filter((item) => matches(item.source)))
				list.append(
					configurationRow({ source: announcement.source, warnings: [] }, () =>
						openAnnouncement(announcement),
					),
				)
		else {
			for (const item of drafts.filter((item) => matches(item.source)))
				list.append(
					configurationRow(
						item,
						() => {
							editor = item
							screen = 'editor'
							render()
							void display()
							if (
								!item.layers &&
								item.source.url.includes('mid=earthly-draft-placeholder') === false
							)
								void fetchSource(item)
						},
						true,
					),
				)
			for (const item of sources.filter((item) => matches(item.source)))
				list.append(configurationRow(item, () => open(item)))
		}
		if (!list.childElementCount)
			list.append(
				el(
					'p',
					search
						? 'No matching configurations.'
						: tab === 'explore'
							? discovering
								? 'Discovering configurations…'
								: 'No configurations published on your relays yet.'
							: 'Create a configuration, or make a copy of one you discover.',
					'empty',
				),
			)
	}
	function loadStatus(item: Loaded, container: HTMLElement) {
		const count = Object.values(item.layers ?? {}).reduce(
			(total, layer) => total + layer.features.length,
			0,
		)
		const status = el(
			'p',
			item.controller
				? 'Fetching from Google…'
				: item.fetchedAt
					? `${count} geometries · ${item.manual ? 'Local KML' : 'Fetched'} ${new Date(item.fetchedAt).toLocaleTimeString()}`
					: 'Not fetched yet',
			'meta',
		)
		status.setAttribute('role', 'status')
		container.append(status)
		if (item.error) {
			const alert = el('p', item.error, 'error')
			alert.setAttribute('role', 'alert')
			container.append(alert)
			const fallback = el('label', 'Choose KML file for this Google source', 'field'),
				file = el('input')
			file.type = 'file'
			file.accept = '.kml,application/vnd.google-earth.kml+xml'
			file.disabled = busy
			file.onchange = () => {
				const chosen = file.files?.[0]
				if (!chosen) return
				void perform(async () => {
					const current = epoch
					if (chosen.size > 5 * 1024 * 1024)
						throw new Error('Choose a KML file smaller than 5 MiB.')
					const parsed = await readKml(await chosen.text(), item.source.url)
					if (current !== epoch || !retained(item)) return
					item.layers = parsed.payload.layers
					item.fetchedAt = Date.now()
					item.manual = true
					item.error = undefined
					if (item.source.title === 'New configuration')
						item.source.title = parsed.name.slice(0, 160).trim() || 'New configuration'
					item.warnings = [
						...parsed.warnings,
						'Local KML preview. Saved and published links still fetch Google; this file is not uploaded.',
					]
					changed()
					await display()
				})
			}
			fallback.append(file)
			container.append(fallback)
		}
		if (item.warnings.length) {
			const notes = el('details')
			notes.append(el('summary', `${item.warnings.length} source notes`))
			for (const warning of item.warnings) notes.append(el('p', warning, 'meta'))
			container.append(notes)
		}
	}
	function colorFor(item: Loaded, name: string, personal: boolean) {
		const style = personal ? model.effectiveView(item.source) : item.source
		const feature = item.layers?.[name]?.features[0],
			color =
				style.layerColors[name] ??
				feature?.properties?.fillColor ??
				feature?.properties?.strokeColor
		return typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? color : '#38533a'
	}
	function layerControls(item: Loaded, personal = false) {
		const controls = el('section', undefined, 'layer-controls'),
			view = personal ? model.effectiveView(item.source) : item.source
		controls.append(
			el('p', personal ? 'Your layers and colours' : 'Default layers and colours', 'eyebrow'),
		)
		for (const [name, layer] of Object.entries(item.layers ?? {})) {
			const row = el('div', undefined, 'layer-row'),
				label = el('label', undefined, 'layer-name'),
				check = el('input')
			check.type = 'checkbox'
			check.checked = !view.hiddenLayers.includes(name)
			check.disabled = busy
			check.onchange = () => {
				const previous = personal
					? model.effectiveView(item.source).hiddenLayers
					: item.source.hiddenLayers
				const hidden = check.checked
					? previous.filter((entry) => entry !== name)
					: [...previous, name]
				if (personal) item.source.view = { ...item.source.view, hiddenLayers: hidden }
				else item.source.hiddenLayers = hidden
				changed()
				void display()
			}
			label.append(check, el('span', name.replace(/^Layer: /, '')))
			row.append(label, el('small', String(layer.features.length), 'meta'))
			const color = el('input')
			color.type = 'color'
			color.value = colorFor(item, name, personal)
			color.disabled = busy
			color.setAttribute('aria-label', `${name.replace(/^Layer: /, '')} colour`)
			color.oninput = () => {
				if (personal)
					item.source.view = {
						...item.source.view,
						layerColors: { ...item.source.view?.layerColors, [name]: color.value },
					}
				else item.source.layerColors[name] = color.value
				changed()
				void display()
			}
			row.append(color)
			controls.append(row)
		}
		const opacity = el('label', undefined, 'field opacity'),
			value = el('span', `${Math.round(view.opacity * 100)}%`, 'meta')
		opacity.append(el('span', personal ? 'View opacity' : 'Default opacity'), value)
		const slider = el('input')
		slider.type = 'range'
		slider.min = '0'
		slider.max = '100'
		slider.value = String(view.opacity * 100)
		slider.disabled = busy
		slider.setAttribute('aria-label', personal ? 'View opacity' : 'Default opacity')
		slider.oninput = () => {
			const amount = Number(slider.value) / 100
			if (personal) item.source.view = { ...item.source.view, opacity: amount }
			else item.source.opacity = amount
			value.textContent = `${slider.value}%`
			changed()
			void display()
		}
		opacity.append(slider)
		controls.append(opacity)
		return controls
	}
	function renderDetail() {
		const item = findSelected()
		if (!item) {
			goDirectory()
			return
		}
		const active = activeFor(item.source),
			isActive = !!active?.source.active
		header(
			'GMapper',
			goDirectory,
			'Configuration',
			item.source.title,
			`By ${publisher(item.source)} · ${status(item.source)}`,
		)
		const actions = el('section', undefined, 'block actions')
		actions.append(
			button(
				isActive ? 'On your map' : 'Add to map',
				() => {
					if (isActive) {
						detailTab = 'view'
						render()
					} else return perform(() => add(item))
				},
				busy,
				'primary',
			),
			button(
				owns(item.source) ? 'Edit configuration' : 'Make a copy',
				() => startEditor(item, !owns(item.source)),
				busy,
				'quiet',
			),
		)
		root.append(
			actions,
			tabs(
				'Configuration details',
				[
					['configuration', 'Configuration'],
					['view', 'Your view'],
					['geometry', 'Geometry'],
				],
				detailTab,
				(value) => {
					detailTab = value
					render()
				},
			),
		)
		renderMessages()
		const body = el('section', undefined, 'block stack')
		root.append(body)
		if (detailTab === 'configuration') {
			if (item.source.description) body.append(el('p', item.source.description, 'description'))
			body.append(el('p', 'Configuration defaults', 'eyebrow'))
			const layers = item.layers ?? active?.layers
			if (layers)
				for (const name of Object.keys(layers)) {
					const row = el('div', undefined, 'layer-row'),
						swatch = el('span', undefined, 'swatch')
					swatch.style.background = colorFor({ ...item, layers }, name, false)
					row.append(
						swatch,
						el('span', name.replace(/^Layer: /, ''), 'grow'),
						el('small', item.source.hiddenLayers.includes(name) ? 'Hidden' : 'Shown', 'meta'),
					)
					body.append(row)
				}
			else
				body.append(
					el(
						'p',
						`${item.source.hiddenLayers.length} hidden layer choices · Source colours unless overridden. Add to map to load the full layer list.`,
						'meta',
					),
				)
			body.append(
				el('p', `Opacity ${Math.round(item.source.opacity * 100)}%`, 'meta'),
				el('p', 'Google source', 'eyebrow'),
				el('p', item.source.url, 'source-url'),
				el(
					'p',
					'This configuration shares the link and viewing defaults. Google remains the source of the geometry.',
					'meta',
				),
			)
			if (item.source.tags.length) body.append(el('p', item.source.tags.join(' · '), 'tags'))
			if (owns(item.source) && item.source.published)
				body.append(
					button(
						'Remove from discovery…',
						() => {
							screen = 'unpublish'
							render()
						},
						busy,
						'link',
					),
				)
			if (sources.includes(item))
				body.append(
					button(
						owns(item.source) ? 'Delete saved configuration' : 'Delete saved copy',
						() =>
							perform(async () => {
								item.controller?.abort()
								sources = sources.filter((entry) => entry !== item)
								drafts = drafts.filter((entry) => entry.source.id !== item.source.id)
								await persist()
								await display()
								goDirectory()
								notice = 'Deleted your saved copy. Public discovery remains until you unpublish it.'
								render()
							}),
						busy,
						'link',
					),
				)
		} else if (!isActive || !active)
			body.append(
				el('p', 'Add this configuration to your map to adjust your view or copy geometry.', 'meta'),
			)
		else if (detailTab === 'view') {
			const update = updates.get(active.source.id)
			if (update) {
				const note = el('div', undefined, 'notice')
				note.append(
					el(
						'p',
						update.deleted
							? 'Publisher removed this configuration from discovery. Your saved view remains.'
							: 'Configuration updated. Review the new defaults before applying them.',
						'description',
					),
					button(
						'Review update',
						() => {
							screen = 'update'
							render()
						},
						busy,
						'quiet',
					),
				)
				body.append(note)
			}
			body.append(
				el(
					'p',
					'These choices change your view. They do not change the published configuration.',
					'notice',
				),
			)
			loadStatus(active, body)
			if (active.layers)
				body.append(
					layerControls(active, true),
					button(
						'Reset to configuration defaults',
						() =>
							perform(async () => {
								active.source.view = undefined
								await persist()
								await display()
							}),
						busy,
						'quiet',
					),
				)
			const tools = el('div', undefined, 'actions')
			tools.append(
				button('Refresh data', () => fetchSource(active), !!active.controller || busy, 'quiet'),
				button(
					'Fit on map',
					() => nap.map.workspace('fit', { entryId: active.source.id }),
					!active.layers || busy,
					'quiet',
				),
				button(
					'Remove from map',
					() =>
						perform(async () => {
							active.source.active = false
							await persist()
							await display()
							render()
						}),
					busy,
					'link',
				),
			)
			body.append(tools)
		} else {
			body.append(
				el(
					'p',
					'Copy geometry into an independent editor draft. Source attribution stays with your copy.',
					'meta',
				),
			)
			const features = collection(active).features
			const availableIds = new Set(features.map((feature) => String(feature.id)))
			for (const id of selectedGeometry) if (!availableIds.has(id)) selectedGeometry.delete(id)
			if (!features.length)
				body.append(el('p', 'No visible geometry. Enable layers in Your view.', 'empty'))
			else {
				const all = el('label', undefined, 'layer-name'),
					check = el('input')
				check.type = 'checkbox'
				check.checked = features.every((feature) => selectedGeometry.has(String(feature.id)))
				check.onchange = () => {
					selectedGeometry.clear()
					if (check.checked)
						for (const feature of features) selectedGeometry.add(String(feature.id))
					render()
				}
				all.append(check, el('span', 'Select all'))
				body.append(all)
				const list = el('div', undefined, 'geometry-list')
				for (const feature of features) {
					const row = el('div', undefined, 'layer-row'),
						select = el('input')
					select.type = 'checkbox'
					select.checked = selectedGeometry.has(String(feature.id))
					select.setAttribute('aria-label', `Select ${feature.properties?.name ?? feature.id}`)
					select.onchange = () => {
						if (select.checked) selectedGeometry.add(String(feature.id))
						else selectedGeometry.delete(String(feature.id))
						render()
					}
					row.append(
						select,
						button(
							String(feature.properties?.name ?? 'Untitled geometry'),
							() =>
								nap.map.workspace('select', { entryId: active.source.id, featureId: feature.id }),
							busy,
							'geometry-title',
						),
						el('small', feature.geometry.type, 'meta'),
					)
					list.append(row)
				}
				body.append(
					list,
					button(
						`Copy ${selectedGeometry.size || 'selected'} to editor`,
						() =>
							nap.map.workspace('copy', {
								entryId: active.source.id,
								featureIds: [...selectedGeometry],
							}),
						!selectedGeometry.size || busy,
						'quiet',
					),
				)
			}
		}
	}
	function renderEditor() {
		if (!editor) {
			goDirectory()
			return
		}
		const item = editor,
			unloaded = item.source.url.includes('mid=earthly-draft-placeholder')
		header(
			'GMapper',
			goDirectory,
			item.source.published ? 'Edit configuration' : 'New configuration',
			item.source.published ? 'Edit configuration' : 'Create configuration',
			'GMapper · Draft',
		)
		renderMessages()
		const body = el('section', undefined, 'block stack')
		root.append(body)
		body.append(
			el(
				'p',
				item.layers
					? 'Previewing your configuration. Changes stay unpublished until you publish.'
					: '1 · Google link → 2 · Layers & details → 3 · Save or publish',
				item.layers ? 'notice' : 'meta',
			),
		)
		let value = item.source.inputUrl ?? (unloaded ? '' : item.source.url)
		const url = field('Google My Maps link', value, (next) => {
			value = next
			item.source.inputUrl = next
			changed()
		})
		const urlInput = url.querySelector('input')
		if (urlInput) {
			urlInput.placeholder = 'https://www.google.com/maps/d/…'
			urlInput.type = 'url'
		}
		body.append(
			url,
			button(
				item.controller ? 'Loading preview…' : item.layers ? 'Reload preview' : 'Load preview',
				() =>
					perform(async () => {
						const current = epoch
						const canonical = canonicalize(value)
						if (canonical !== item.source.url) {
							item.layers = undefined
							item.source.hiddenLayers = []
							item.source.layerColors = {}
						}
						item.source.url = canonical
						item.source.inputUrl = undefined
						await persist()
						if (current !== epoch) return
						await fetchSource(item)
						if (current === epoch && item.layers)
							await nap.map.workspace('fit', { entryId: `preview:${item.source.id}` })
					}),
				busy || !!item.controller,
				'primary',
			),
		)
		loadStatus(item, body)
		if (!item.layers) {
			body.append(
				el(
					'p',
					'Nothing is published while you preview. If Google blocks the request, load a downloaded KML file for this source.',
					'meta',
				),
			)
			return
		}
		body.append(
			field('Configuration name', item.source.title, (value) => {
				item.source.title = value
				changed()
			}),
			field(
				'Description',
				item.source.description,
				(value) => {
					item.source.description = value
					changed()
				},
				true,
			),
			layerControls(item),
			field('Tags', item.source.tags.join(', '), (value) => {
				item.source.tags = value
					.split(',')
					.map((tag) => tag.trim())
					.filter(Boolean)
				changed()
			}),
		)
		const actions = el('section', undefined, 'sticky-actions actions')
		if (item.source.published)
			actions.append(
				button(
					'Save draft',
					() =>
						perform(async () => {
							await saveAccount()
							editor = undefined
							screen = 'directory'
							tab = 'yours'
							await display()
							notice = 'Draft saved. The published configuration is unchanged.'
						}),
					busy,
					'quiet',
				),
			)
		else
			actions.append(
				button(
					pubkey ? 'Save privately' : 'Save on this device',
					() => perform(() => saveEditor()),
					busy,
					'primary',
				),
			)
		actions.append(
			button(
				item.source.published ? 'Review update' : 'Publish…',
				() => {
					validateEditor()
					screen = 'review'
					error = ''
					render()
				},
				busy,
				item.source.published ? 'primary' : 'quiet',
			),
		)
		actions.append(
			button(
				'Discard draft',
				() =>
					perform(async () => {
						item.controller?.abort()
						drafts = drafts.filter((entry) => entry !== item)
						editor = undefined
						await persist()
						goDirectory()
						await display()
					}),
				busy,
				'link',
			),
		)
		root.append(actions)
	}
	function renderReview() {
		if (!editor) {
			goDirectory()
			return
		}
		header(
			'Edit configuration',
			() => {
				screen = 'editor'
				render()
			},
			'Publication review',
			editor.source.title,
		)
		renderMessages()
		const body = el('section', undefined, 'block stack')
		body.append(
			el(
				'p',
				'Public: configuration name, description, tags, Google link, layer choices and style defaults.',
				'notice',
			),
			el('p', 'Geometry is fetched from Google. It is not included in this publication.', 'meta'),
			el('p', 'Included layers', 'eyebrow'),
		)
		for (const name of Object.keys(editor.layers ?? {}).filter(
			(name) => !editor?.source.hiddenLayers.includes(name),
		)) {
			const row = el('div', undefined, 'layer-row'),
				swatch = el('span', undefined, 'swatch')
			swatch.style.background = colorFor(editor, name, false)
			row.append(swatch, el('span', name.replace(/^Layer: /, '')))
			body.append(row)
		}
		body.append(el('p', editor.source.url, 'source-url'))
		if (!pubkey)
			body.append(
				el(
					'p',
					'Sign in to Earthly to publish under your key. Your draft stays on this device.',
					'notice',
				),
			)
		body.append(
			button(
				editor.source.published ? 'Publish update' : 'Publish configuration',
				() => perform(() => saveEditor(true)),
				busy || !pubkey,
				'primary',
			),
		)
		root.append(body)
	}
	function renderUpdate() {
		const item = findSelected(),
			update = item && updates.get(item.source.id)
		if (!item || !update) {
			screen = 'detail'
			render()
			return
		}
		header(
			'Your view',
			() => {
				screen = 'detail'
				detailTab = 'view'
				render()
			},
			'Review update',
			update.source.title,
		)
		renderMessages()
		const body = el('section', undefined, 'block stack')
		body.append(
			el(
				'p',
				update.deleted
					? 'The publisher removed this configuration from discovery. Your saved configuration and view can remain on your map.'
					: 'These are the publisher’s new defaults. Applying them preserves your personal viewing choices.',
				'notice',
			),
		)
		if (!update.deleted) {
			body.append(
				el('p', update.source.description, 'description'),
				el('p', `Opacity ${Math.round(update.source.opacity * 100)}%`, 'meta'),
				el('p', `Hidden layers: ${update.source.hiddenLayers.join(', ') || 'None'}`, 'meta'),
			)
			for (const [name, color] of Object.entries(update.source.layerColors)) {
				const row = el('div', undefined, 'layer-row'),
					swatch = el('span', undefined, 'swatch')
				swatch.style.background = color
				row.append(swatch, el('span', name))
				body.append(row)
			}
			body.append(el('p', update.source.url, 'source-url'))
		}
		body.append(
			button(
				update.deleted ? 'Keep my saved view' : 'Apply update · keep my overrides',
				() => perform(() => applyUpdate(item)),
				busy,
				'primary',
			),
		)
		root.append(body)
	}
	function renderUnpublish() {
		const item = findSelected()
		if (!item) {
			goDirectory()
			return
		}
		header(
			'Configuration',
			() => {
				screen = 'detail'
				render()
			},
			'Remove from discovery',
			`Unpublish ${item.source.title}?`,
		)
		renderMessages()
		const body = el('section', undefined, 'block stack')
		body.append(
			el(
				'p',
				'It will leave GMapper’s shared configuration list. Your private copy and other users’ saved views remain.',
				'description',
			),
			button('Remove from discovery', () => perform(() => unpublish(item)), busy, 'quiet'),
		)
		root.append(body)
	}
	function render() {
		const focused = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
		const label = focused?.parentElement?.classList.contains('field')
			? focused.parentElement.firstChild?.textContent
			: undefined
		const start =
			focused?.tagName === 'INPUT' && focused.type === 'color' ? null : focused?.selectionStart
		root.replaceChildren()
		if (screen === 'directory') renderDirectory()
		else if (screen === 'detail') renderDetail()
		else if (screen === 'editor') renderEditor()
		else if (screen === 'review') renderReview()
		else if (screen === 'update') renderUpdate()
		else renderUnpublish()
		if (label) {
			const field = Array.from(root.querySelectorAll<HTMLLabelElement>('label.field')).find(
					(node) => node.firstChild?.textContent === label,
				),
				input = field?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')
			input?.focus()
			if (start != null && input && !['range', 'color', 'file'].includes(input.type))
				input.setSelectionRange(start, start)
		}
	}
	async function identityChanged(next: string) {
		// Signing in from an anonymous publication review adopts only that unpublished
		// draft. Account-to-account changes never carry private state across identities.
		const handoff =
			!pubkey && next && editor && !editor.source.publication && !editor.source.published
				? { ...editor, source: clone(editor.source), controller: undefined }
				: undefined
		const handoffScreen = screen === 'review' ? 'review' : 'editor'
		const current = ++epoch
		for (const item of [...sources, ...drafts, ...publicCache.values()]) item.controller?.abort()
		pubkey = next
		sources = []
		drafts = []
		announcements = []
		publicCache.clear()
		updates.clear()
		editor = undefined
		selected = ''
		screen = 'directory'
		tab = 'explore'
		search = ''
		limit = 100
		busy = false
		discovering = false
		dirty = false
		error = ''
		notice = ''
		loading = true
		render()
		await display()
		try {
			await restore(false)
		} catch (reason) {
			if (current === epoch) error = message(reason)
		}
		if (current === epoch) {
			if (handoff) {
				handoff.source = model.source({
					...handoff.source,
					id: crypto.randomUUID(),
					owner: next,
					active: false,
				})
				drafts.push(handoff)
				editor = handoff
				screen = handoffScreen
				changed()
				await display()
				if (current !== epoch) return
				notice = 'Your anonymous draft is ready for this account. Review it before publishing.'
			}
			loading = false
			render()
			void discover()
		}
	}
	nap.identity.onChanged((key) => {
		void identityChanged(key)
	})
	nap.map.onRefresh(() => {
		void (async () => {
			const current = epoch
			for (const item of sources) {
				if (current !== epoch) return
				if (item.source.active && item.source.visible) await fetchSource(item)
			}
		})()
	})
	nap.map.onWorkspaceChanged((value) => {
		if (!value || typeof value !== 'object') return
		const event = value as {
				action?: string
				entryId?: string
				visible?: boolean
				featureId?: string
			},
			item = sources.find((entry) => entry.source.id === event.entryId)
		if (event.action === 'openHome') {
			goDirectory()
			return
		}
		if (!item) return
		if (event.action === 'openConfiguration') {
			open(item)
			detailTab = 'view'
			render()
		}
		if (event.action === 'selectFeature') {
			open(item)
			detailTab = 'geometry'
			if (event.featureId) selectedGeometry.add(String(event.featureId))
			render()
		}
		if (event.action === 'refresh') void fetchSource(item)
		if (event.action === 'remove') {
			item.source.active = false
			changed()
			void display()
			render()
		}
		if (event.action === 'visibility') {
			item.source.visible = event.visible ?? !item.source.visible
			changed()
			if (item.source.visible && !item.layers) void fetchSource(item)
			else void display()
			render()
		}
	})
	new ResizeObserver(() => nap.map.resize(document.documentElement.scrollHeight)).observe(root)
	void nap.identity
		.getPublicKey()
		.then(identityChanged)
		.catch((reason) => {
			loading = false
			error = message(reason)
			render()
		})
}

export const MY_MAPS_VIEWER_HTML = `<body><style>
:root{color-scheme:light dark;--bg:#fafaf6;--ink:#272e27;--muted:#70776c;--line:#d8ddcf;--green:#38533a;--wash:#eef1e7;--error:#a83e25}*{box-sizing:border-box}html,body{height:100%;overflow:hidden}body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.5 ui-sans-serif,system-ui,sans-serif}#app{height:100%;overflow-y:auto;overscroll-behavior:contain;padding:0 16px 22px}h1{font:600 22px/1.25 Georgia,serif;margin:12px 0 5px;letter-spacing:-.4px}p{margin:0}.object-header{padding:12px 0 16px;border-bottom:1px solid var(--line)}.eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:1.4px;color:var(--muted);font-weight:650}.meta{color:var(--muted);font-size:11px}.description{font-size:12px;line-height:1.6}.row,.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.between{justify-content:space-between}.grow{flex:1;min-width:0}.block{padding:16px 0;border-bottom:1px solid var(--line)}.stack{display:flex;flex-direction:column;align-items:stretch;gap:12px}.block>.primary{margin-top:12px}.tabs{display:flex;border-bottom:1px solid var(--line);gap:12px;overflow-x:auto}.tabs button{flex:1;white-space:nowrap;background:transparent;color:var(--muted);border:0;border-bottom:2px solid transparent;padding:12px 0;font-size:11px}.tabs .selected{color:var(--ink);border-bottom-color:#d5ad00}.field{display:grid;gap:6px;font-size:12px;font-weight:550;margin:12px 0}.stack>.field{margin:0}input:not([type=checkbox]):not([type=range]):not([type=color]),textarea{font:inherit;width:100%;min-width:0;border:1px solid var(--line);border-radius:0;padding:9px;background:var(--bg);color:var(--ink)}textarea{min-height:68px;resize:vertical}button{min-height:36px;padding:7px 10px;border:1px solid var(--line);border-radius:0;background:transparent;color:var(--green);font:inherit;font-size:11px;font-weight:600;cursor:pointer;text-align:left}button:disabled{opacity:.5;cursor:default}.primary{background:var(--green);border-color:var(--green);color:#fff}button.link{min-height:32px;border-color:transparent;padding:0;color:var(--muted)}button:focus-visible,input:focus-visible,summary:focus-visible,textarea:focus-visible{outline:2px solid #caa400;outline-offset:2px}.configuration-row{padding:13px 0;border-bottom:1px solid var(--line)}.row-title{display:block;width:100%;border:0;padding:0;font-size:14px;font-weight:650;color:var(--ink);min-height:26px}.configuration-row .description{margin-top:5px}.tags{font-size:10px;color:var(--green);margin-top:6px}.layer-row{display:flex;gap:9px;align-items:center;min-height:42px;border-bottom:1px solid var(--line);font-size:12px}.layer-name{display:flex;align-items:center;gap:9px;flex:1;min-width:0}.layer-name span{overflow-wrap:anywhere}input[type=checkbox]{flex:none;width:16px;height:16px;accent-color:var(--green)}input[type=color]{width:27px;height:27px;padding:1px;border:1px solid var(--line);background:transparent;flex:none}input[type=range]{width:100%;accent-color:var(--green)}.swatch{width:12px;height:12px;flex:none}.source-url{font:10px/1.6 ui-monospace,monospace;color:var(--muted);overflow-wrap:anywhere}.empty{padding:20px 0;font-size:12px;color:var(--muted)}.error,.notice{font-size:11px;padding:11px;background:var(--wash);border-left:2px solid var(--green);overflow-wrap:anywhere;margin:12px 0}.error{color:var(--error);border-color:var(--error)}.stack>.notice,.stack>.error{margin:0}.sticky-actions{position:sticky;bottom:0;padding:12px 0;background:var(--bg);border-top:1px solid var(--line)}.footer{padding:12px 0}.geometry-list{max-height:350px;overflow:auto}.geometry-title{flex:1;min-width:0;border:0;padding:4px 0;overflow-wrap:anywhere;color:var(--ink)}summary{cursor:pointer;font-size:11px;padding:10px 0}details p{margin-bottom:7px}@media(prefers-color-scheme:dark){:root{--bg:#1d231e;--ink:#e9ede4;--muted:#a1ac9a;--line:#424c3e;--green:#547653;--wash:#293328;--error:#f2a68f}}@media(max-width:440px){button{min-height:40px}.tabs{gap:9px}.tabs button{font-size:10px}.object-header h1{font-size:21px}}
</style><main id="app"></main><script>(${runMyMapsViewer.toString()})(${myMapsExportUrl.toString()},${parseMapletKml.toString()},${createMyMapsModel.toString()})</script></body>`
