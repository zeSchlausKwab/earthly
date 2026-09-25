import type { FeatureCollection } from 'geojson'
import type { EventTemplate, NostrEvent } from 'nostr-tools'
import { parseMapletKml } from './kml'
import { myMapsExportUrl } from './myMaps'
import { createMyMapsModel, type MyMapsSource, type MyMapsAnnouncement } from './myMapsModel'

export const MY_MAPS_VIEWER_DEFINITION = {
	id: 'my-maps-viewer',
	title: 'My Maps Viewer',
	description:
		'Display public Google My Maps directly in your browser. Save your sources and discover maps shared by others.',
	requires: ['map', 'identity', 'resource', 'storage', 'relay'],
} as const

interface ViewerBridge {
	map: {
		replace(collection: FeatureCollection, options?: { warnings: string[] }): Promise<void>
		resize(height: number): void
		onRefresh(callback: () => void): void
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

/** The actual Maplet program: URL handling, fetching decisions, conversion and UI stay here. */
function runMyMapsViewer(
	canonicalize: typeof myMapsExportUrl,
	parse: typeof parseMapletKml,
	createModel: typeof createMyMapsModel,
) {
	const nap = (window as unknown as { napplet: ViewerBridge }).napplet
	const model = createModel(canonicalize)
	type LoadedSource = {
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
			throw new Error('Missing viewer root')
		})()
	let pubkey = ''
	let epoch = 0
	let sources: LoadedSource[] = []
	let announcements: MyMapsAnnouncement[] = []
	let tab = 'sources'
	let loading = true
	let busy = false
	let discovering = false
	let limit = 100
	let search = ''
	let error = ''
	let notice = ''
	let link = ''
	let dirty = false
	let emission = Promise.resolve()
	const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
		const node = document.createElement(tag)
		if (text !== undefined) node.textContent = text
		if (className) node.className = className
		return node
	}
	const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason))
	function button(text: string, action: () => unknown, disabled = false, className = '') {
		const node = el('button', text, className)
		node.type = 'button'
		node.disabled = disabled || loading
		node.onclick = () => {
			void action()
		}
		return node
	}
	function field(label: string, value: string, update: (value: string) => void, multiline = false) {
		const wrapper = el('label', label, 'field')
		const input = multiline ? el('textarea') : el('input')
		input.value = value
		input.disabled = busy || loading
		input.oninput = () => update(input.value)
		wrapper.append(input)
		return wrapper
	}
	function preferences() {
		return model.preferences({ version: 1, sources: sources.map((item) => item.source) })
	}
	function changed() {
		dirty = true
		notice = 'Changes are not saved yet.'
	}
	function compose(): FeatureCollection {
		return {
			type: 'FeatureCollection',
			features: sources.flatMap((item) =>
				item.source.visible
					? Object.entries(item.layers ?? {}).flatMap(([name, layer]) =>
							item.source.hiddenLayers.includes(name)
								? []
								: layer.features.map((feature) => ({
										...feature,
										properties: {
											...feature.properties,
											sourceUrl: item.source.url,
											fillOpacity:
												Number(feature.properties?.fillOpacity ?? 0.35) * item.source.opacity,
											strokeOpacity:
												Number(feature.properties?.strokeOpacity ?? 1) * item.source.opacity,
										},
									})),
						)
					: [],
			),
		}
	}
	async function readKml(text: string, url: string) {
		const parsed = parse(text, url)
		const duplicates = new Map<string, number>()
		for (const [layer, collection] of Object.entries(parsed.payload.layers)) {
			for (const feature of collection.features) {
				// XML IDs survive updates. Otherwise content IDs avoid silently changing a
				// selected feature's meaning when Google reorders an export or a source is removed.
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
		}
		return parsed
	}
	function display() {
		const current = epoch
		// Serialize replacements so overlapping source fetches cannot restore an older map.
		emission = emission
			.catch(() => {})
			.then(async () => {
				if (current !== epoch) return
				await nap.map.replace(compose(), {
					warnings: sources.flatMap((item) => [
						...item.warnings,
						...(item.error ? [`${item.source.title}: ${item.error}`] : []),
					]),
				})
			})
		return emission
	}
	async function fetchSource(item: LoadedSource) {
		item.controller?.abort()
		const controller = new AbortController()
		item.controller = controller
		const current = epoch
		item.error = undefined
		render()
		const previous = item.layers
		try {
			const blob = await nap.resource.bytes(item.source.url, { signal: controller.signal })
			const parsed = await readKml(await blob.text(), item.source.url)
			if (current !== epoch || controller.signal.aborted || !sources.includes(item)) return
			item.layers = parsed.payload.layers
			item.warnings = parsed.warnings
			if (item.source.title === 'New My Maps source') item.source.title = parsed.name
			await display()
			if (current !== epoch || controller.signal.aborted) return
			item.fetchedAt = Date.now()
			item.manual = false
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
	async function add(value: string | MyMapsSource) {
		try {
			error = ''
			const source = model.source(
				typeof value === 'string' ? { url: value, title: 'New My Maps source' } : value,
			)
			if (sources.some((item) => item.source.url === source.url))
				throw new Error('This source is already on your map.')
			if (sources.length >= 12)
				throw new Error('Remove a source before adding another (limit: 12).')
			const item: LoadedSource = { source, warnings: [] }
			sources.push(item)
			link = ''
			tab = 'sources'
			changed()
			await fetchSource(item)
		} catch (reason) {
			error = message(reason)
			render()
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
	async function save() {
		const current = epoch
		const value = preferences()
		await nap.storage.setItem('saved', value)
		if (current !== epoch) return
		notice = 'Saved on this device.'
		dirty = false
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
			if (current === epoch)
				notice =
					'Saved for your account. Source links and preferences are encrypted; geometry stays with Google.'
		}
	}
	async function restore(remote: boolean) {
		const current = epoch
		let value: unknown
		if (remote) {
			if (dirty) throw new Error('Save your current changes before restoring from your account.')
			const results = await nap.relay.query([
				{ kinds: [30078], authors: [pubkey], '#d': [model.preferencesId], limit: 1 },
			])
			if (current !== epoch) return
			const newest = results
				.map((entry) => entry.event)
				.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]
			if (!newest) {
				notice = 'No sources saved to this account yet.'
				return
			}
			value = JSON.parse(newest.content)
		} else value = await nap.storage.getItem('saved')
		if (current !== epoch || value === null || value === undefined) return
		const saved = model.preferences(value)
		for (const item of sources) item.controller?.abort()
		sources = saved.sources.map((source) => ({ source, warnings: [] }))
		dirty = false
		if (remote) await nap.storage.setItem('saved', saved)
		if (current !== epoch) return
		await display()
		// Sequential fetches stay below the runtime's concurrent request quota.
		for (const item of sources) {
			if (current !== epoch) return
			if (item.source.visible) await fetchSource(item)
		}
		notice = remote
			? 'Restored your saved sources from Nostr.'
			: 'Restored sources saved on this device.'
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
			announcements = model.latest(results.map((entry) => entry.event))
		} catch (reason) {
			if (current === epoch) error = message(reason)
		} finally {
			if (current === epoch) {
				discovering = false
				render()
			}
		}
	}
	async function publishSource(item: MyMapsSource, deleted = false) {
		const current = epoch
		const event = await nap.relay.publish(model.announcement(item, deleted))
		if (current !== epoch) return
		announcements = model.latest([
			...announcements
				.filter(
					(entry) =>
						entry.pubkey !== event.pubkey ||
						entry.identifier !== model.parseAnnouncement(event).identifier,
				)
				.map((entry) => ({
					...model.announcement(entry.source),
					pubkey: entry.pubkey,
					id: entry.id,
					sig: '',
					created_at: entry.createdAt,
				})),
			event,
		])
		notice = deleted
			? 'Source removed from discovery. Existing subscribers keep their link.'
			: 'Source published. Others can discover its link and fetch the map directly from Google.'
	}
	function renderSource(item: LoadedSource) {
		const card = el('article', undefined, 'source')
		card.setAttribute('aria-label', item.source.title)
		const head = el('div', undefined, 'row')
		head.append(
			el('h2', item.source.title),
			button(
				'Remove',
				async () => {
					item.controller?.abort()
					sources = sources.filter((entry) => entry !== item)
					changed()
					await display()
					render()
				},
				busy,
				'quiet',
			),
		)
		card.append(head, el('p', new URL(item.source.url).searchParams.get('mid') ?? '', 'source-id'))
		const status = el(
			'p',
			item.controller
				? 'Fetching from Google…'
				: item.fetchedAt
					? `${Object.values(item.layers ?? {}).reduce((count, layer) => count + layer.features.length, 0)} geometries · ${item.manual ? 'KML file loaded' : 'Last fetched'} ${new Date(item.fetchedAt).toLocaleTimeString()}`
					: 'Not loaded',
			'muted',
		)
		status.setAttribute('role', 'status')
		card.append(status)
		if (item.error) {
			const alert = el('p', item.error, 'error')
			alert.setAttribute('role', 'alert')
			card.append(alert)
			const fallback = el('label', 'Choose KML file for this source', 'field')
			const file = el('input')
			file.type = 'file'
			file.accept = '.kml,application/vnd.google-earth.kml+xml'
			file.disabled = busy
			file.onchange = () => {
				const selected = file.files?.[0]
				if (!selected) return
				void perform(async () => {
					const current = epoch
					if (selected.size > 5 * 1024 * 1024)
						throw new Error('Choose a KML file smaller than 5 MiB')
					const parsed = await readKml(await selected.text(), item.source.url)
					if (current !== epoch) return
					const previous = item.layers
					item.layers = parsed.payload.layers
					try {
						await display()
					} catch (reason) {
						item.layers = previous
						throw reason
					}
					if (current !== epoch) return
					item.manual = true
					item.fetchedAt = Date.now()
					item.error = undefined
					item.warnings = [
						...parsed.warnings,
						'Local KML preview. Saved and published links still fetch Google; this file is not uploaded.',
					]
					await display()
				})
			}
			fallback.append(file)
			card.append(fallback)
		}
		const actions = el('div', undefined, 'actions')
		actions.append(
			button(
				item.source.visible ? 'Hide source' : 'Show source',
				async () => {
					item.source.visible = !item.source.visible
					changed()
					if (item.source.visible && !item.layers) await fetchSource(item)
					else await display()
					render()
				},
				busy,
			),
			button('Refresh source', () => fetchSource(item), !!item.controller || busy),
		)
		card.append(actions)
		if (item.layers) {
			const opacity = el('label', 'Opacity', 'opacity')
			const slider = el('input')
			slider.type = 'range'
			slider.min = '0'
			slider.max = '100'
			slider.value = String(item.source.opacity * 100)
			slider.oninput = () => {
				item.source.opacity = Number(slider.value) / 100
				changed()
				void display().catch((reason) => {
					error = message(reason)
					render()
				})
			}
			slider.disabled = busy
			opacity.append(slider)
			card.append(opacity)
			for (const [name, layer] of Object.entries(item.layers)) {
				const label = el('label', undefined, 'layer')
				const check = el('input')
				check.type = 'checkbox'
				check.checked = !item.source.hiddenLayers.includes(name)
				check.disabled = busy
				check.onchange = async () => {
					item.source.hiddenLayers = check.checked
						? item.source.hiddenLayers.filter((entry) => entry !== name)
						: [...item.source.hiddenLayers, name]
					changed()
					await display()
					render()
				}
				label.append(
					check,
					el('span', name.replace(/^Layer: /, '')),
					el('small', String(layer.features.length)),
				)
				card.append(label)
			}
		}
		if (item.warnings.length) {
			const notes = el('details')
			notes.append(el('summary', `${item.warnings.length} source notes`))
			for (const warning of item.warnings) notes.append(el('p', warning, 'muted'))
			card.append(notes)
		}
		const share = el('details', undefined, 'share')
		share.append(el('summary', 'Name & publish source'))
		const form = el('form')
		form.append(
			field('Source title', item.source.title, (value) => {
				item.source.title = value
				changed()
			}),
			field(
				'Source description',
				item.source.description,
				(value) => {
					item.source.description = value
					changed()
				},
				true,
			),
			field('Source tags', item.source.tags.join(', '), (value) => {
				item.source.tags = value
					.split(',')
					.map((tag) => tag.trim())
					.filter(Boolean)
				changed()
			}),
		)
		form.append(
			el(
				'p',
				'Publish the link and description under your public key. Google remains the source of the geometry.',
				'muted',
			),
		)
		const submit = button(
			pubkey ? 'Publish source' : 'Sign in to publish',
			() => perform(() => publishSource(item.source)),
			!pubkey || busy,
		)
		form.append(submit)
		form.onsubmit = (event) => event.preventDefault()
		share.append(form)
		card.append(share)
		return card
	}
	function render() {
		root.replaceChildren()
		const header = el('header')
		header.append(
			el('p', 'GOOGLE MY MAPS · CLIENT VIEWER', 'eyebrow'),
			el('h1', 'A link becomes a layer.'),
			el(
				'p',
				'Bring public maps into Earthly. Geometry is fetched directly from Google in your browser.',
				'muted',
			),
		)
		root.append(header)
		const nav = el('nav', undefined, 'tabs')
		nav.setAttribute('aria-label', 'Viewer sections')
		nav.append(
			button(
				'My sources',
				() => {
					tab = 'sources'
					render()
				},
				false,
				tab === 'sources' ? 'selected' : '',
			),
			button(
				'Discover sources',
				() => {
					tab = 'discover'
					void discover()
				},
				false,
				tab === 'discover' ? 'selected' : '',
			),
		)
		root.append(nav)
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
		if (loading) root.append(el('p', 'Opening your sources…', 'muted'))
		if (tab === 'sources') {
			const form = el('form', undefined, 'add')
			const label = field('Google My Maps link', link, (value) => {
				link = value
			})
			const input = label.querySelector('input')
			if (!input) return
			input.type = 'url'
			input.placeholder = 'https://www.google.com/maps/d/…'
			input.required = true
			const submit = button('Add source', () => add(link), busy)
			input.onkeydown = (event) => {
				if (event.key === 'Enter') {
					event.preventDefault()
					if (!busy && !loading) void add(link)
				}
			}
			form.append(label, submit)
			form.onsubmit = (event) => {
				event.preventDefault()
				void add(link)
			}
			root.append(form)
			const tools = el('div', undefined, 'actions save')
			tools.append(
				button(
					busy ? 'Working…' : 'Save for me',
					() => perform(save),
					busy || sources.some((item) => !!item.controller),
				),
			)
			if (pubkey)
				tools.append(
					button(
						'Restore from account',
						() => perform(() => restore(true)),
						busy || dirty,
						'quiet',
					),
				)
			root.append(
				tools,
				el(
					'p',
					pubkey
						? 'Save syncs encrypted links and preferences to your account.'
						: 'Browsing without an account. Save keeps sources on this device.',
					'muted',
				),
			)
			if (!sources.length)
				root.append(
					el(
						'p',
						'Paste a public My Maps link above, or discover a source shared by someone else.',
						'empty',
					),
				)
			for (const item of sources) root.append(renderSource(item))
		} else {
			root.append(
				el(
					'p',
					'Source links shared on your configured relays. Each map is fetched only when you add it.',
					'muted',
				),
			)
			const searchField = field('Search published sources', search, (value) => {
				search = value
				renderDirectory()
			})
			root.append(
				searchField,
				button(discovering ? 'Looking for sources…' : 'Refresh discovery', discover, discovering),
			)
			const results = el('div')
			results.id = 'directory'
			root.append(results)
			renderDirectory()
			if (limit < 500)
				root.append(
					button(
						'Load more sources',
						() => {
							limit += 100
							void discover()
						},
						discovering,
						'quiet',
					),
				)
		}
	}
	function renderDirectory() {
		const list = document.getElementById('directory')
		if (!list) return
		list.replaceChildren()
		const terms = search.toLowerCase().split(/\s+/).filter(Boolean)
		const filtered = announcements.filter((item) =>
			terms.every((term) =>
				[item.source.title, item.source.description, ...item.source.tags, item.pubkey]
					.join(' ')
					.toLowerCase()
					.includes(term),
			),
		)
		if (!filtered.length && !discovering)
			list.append(
				el(
					'p',
					search ? 'No matching sources.' : 'No published sources found on these relays yet.',
					'empty',
				),
			)
		for (const item of filtered) {
			const card = el('article', undefined, 'source')
			card.setAttribute('aria-label', `${item.source.title} published source`)
			card.append(
				el('h2', item.source.title),
				el('p', item.source.description, 'muted'),
				el('p', `Shared by ${item.pubkey}`, 'source-id'),
			)
			if (item.source.tags.length) card.append(el('p', item.source.tags.join(' · '), 'tags'))
			const added = sources.some((source) => source.source.url === item.source.url)
			card.append(
				button(added ? 'On your map' : 'Add to my map', () => add(item.source), added || busy),
			)
			if (pubkey === item.pubkey)
				card.append(
					button(
						'Unpublish source',
						() => perform(() => publishSource(item.source, true)),
						busy,
						'quiet',
					),
				)
			list.append(card)
		}
	}
	async function identityChanged(next: string) {
		const current = ++epoch
		for (const item of sources) item.controller?.abort()
		pubkey = next
		link = ''
		search = ''
		tab = 'sources'
		limit = 100
		sources = []
		announcements = []
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
			loading = false
			render()
		}
	}
	nap.identity.onChanged((key) => {
		void identityChanged(key)
	})
	nap.map.onRefresh(() => {
		void (async () => {
			for (const item of sources) if (item.source.visible) await fetchSource(item)
		})()
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
:root{color-scheme:light dark;--bg:#fafaf6;--ink:#272e27;--muted:#70776c;--line:#d8ddcf;--green:#38533a;--wash:#eef1e7;--error:#a83e25}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}#app{padding:24px}h1{font:500 30px/1.15 Georgia,serif;margin:9px 0 12px;letter-spacing:-.7px}h2{font-size:17px;line-height:1.4;margin:0}p{margin:10px 0}.eyebrow{font-size:10px;letter-spacing:2px;color:var(--green);font-weight:700}.muted{color:var(--muted);font-size:12px}.source-id{font:10px/1.6 ui-monospace,monospace;color:var(--muted);overflow-wrap:anywhere}.row,.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.row{justify-content:space-between}.tabs{display:flex;border-bottom:1px solid var(--line);margin:22px 0 20px;gap:8px;padding-bottom:10px}.tabs button{background:transparent;color:var(--ink);border-color:transparent}.tabs .selected{background:var(--green);color:#fff}.field{display:grid;gap:7px;font-size:12px;font-weight:600;margin:12px 0}input:not([type=checkbox]):not([type=range]),textarea{font:inherit;font-size:14px;width:100%;min-width:0;border:1px solid var(--line);border-radius:3px;padding:10px;background:var(--bg);color:var(--ink)}textarea{min-height:76px;resize:vertical}button{min-height:40px;padding:8px 13px;border:1px solid var(--green);border-radius:3px;background:var(--green);color:white;font:inherit;font-size:12px;font-weight:600;cursor:pointer}button:disabled{opacity:.5;cursor:default}button.quiet{color:var(--green);border-color:var(--line);background:transparent}button:focus-visible,input:focus-visible,summary:focus-visible,textarea:focus-visible{outline:2px solid #caa400;outline-offset:3px}.add{display:flex;gap:10px;align-items:end}.add .field{flex:1;margin:0}.save{margin-top:22px}.source{border-top:1px solid var(--line);margin-top:22px;padding-top:20px}.source .actions{margin:13px 0}.layer{display:flex;gap:10px;align-items:center;min-height:42px;border-bottom:1px solid var(--line);font-size:13px}.layer input{width:17px;height:17px;accent-color:var(--green)}.layer span{flex:1}.layer small{color:var(--muted)}.opacity{display:flex;align-items:center;gap:14px;font-size:12px}.opacity input{flex:1;accent-color:var(--green)}summary{cursor:pointer;font-size:12px;padding:13px 0}.share{margin-top:8px}.empty{padding:25px 0;font:20px/1.5 Georgia,serif;color:var(--muted)}.error,.notice{font-size:12px;padding:12px;background:var(--wash);border-left:3px solid var(--green);overflow-wrap:anywhere}.error{color:var(--error);border-color:var(--error)}.tags{font-size:11px;color:var(--green)}
@media(prefers-color-scheme:dark){:root{--bg:#1d231e;--ink:#e9ede4;--muted:#a1ac9a;--line:#424c3e;--green:#547653;--wash:#293328;--error:#f2a68f}}@media(max-width:440px){#app{padding:17px}h1{font-size:27px}.add{display:block}.add button{width:100%;margin-top:10px}button{min-height:44px}.tabs button{flex:1}.source h2{font-size:16px}}
</style><main id="app"></main><script>(${runMyMapsViewer.toString()})(${myMapsExportUrl.toString()},${parseMapletKml.toString()},${createMyMapsModel.toString()})</script></body>`
