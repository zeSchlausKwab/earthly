import type { FeatureCollection } from 'geojson'
import {
	createMapletImporter,
	type MapletImportCandidate,
	type MapletImportRecipe,
} from './importer'
import type { mapLiveuamapPayload } from './liveMapper'
import { parseMapletKml } from './kml'
import { myMapsExportUrl } from './myMaps'

type Layer = {
	id: string
	name: string
	groupId?: string | null
	collection: FeatureCollection
	recipe?: MapletImportRecipe
	provenance?: Record<string, unknown>
}
type Collection = {
	id: string
	owner: string
	name: string
	groups: { id: string; name: string }[]
	layers: Layer[]
	address?: string
	naddr?: string
	eventId?: string
}
type Workspace = {
	pubkey: string | null
	collections: Collection[]
	selectedCollectionId: string | null
	subscriptions: {
		address: string
		naddr?: string
		status: string
		collection?: Collection
		error?: string
	}[]
	visibility: Record<string, boolean>
	renderCollection: FeatureCollection
	warnings: string[]
	error?: string
}
type Bridge = {
	identity: {
		getPublicKey(): Promise<string>
		onChanged(callback: (pubkey: string) => void): unknown
	}
	resource: { bytes(url: string): Promise<Blob> }
	map: {
		replace(collection: FeatureCollection, options?: { warnings?: string[] }): Promise<void>
		workspace(action: string, payload?: unknown): Promise<Workspace>
		onWorkspaceChanged(callback: (state: Workspace) => void): unknown
		resize(height: number): void
	}
}

/** Serialized into the verified iframe. Imports are interpreted here, never in the host UI. */
function runWorkbench(
	sample: unknown,
	sourceUrl: string,
	importerFactory: typeof createMapletImporter,
	mapPayload: typeof mapLiveuamapPayload,
	parseKml: typeof parseMapletKml,
	exportUrl: typeof myMapsExportUrl,
) {
	const napplet = (window as unknown as Window & { napplet: Bridge }).napplet
	const importer = importerFactory(mapPayload)
	const root = document.getElementById('workbench') as HTMLElement
	let workspace: Workspace | undefined
	let pubkey = ''
	let tab = 'layers'
	let busy = false
	let message = ''
	let failed = false
	let accountGeneration = 0
	let taskSequence = 0
	let importGeneration = 0
	let importOpen = false
	let pasted = ''
	let payload: unknown
	let rawHash = ''
	let inputName = ''
	let inputSourceUrl = ''
	let inputIsSample = false
	let inputWarnings: string[] = []
	let wholeKmlPreview = false
	let myMapsUrl = ''
	let candidates: MapletImportCandidate[] = []
	let candidateIndex = 0
	let recipe: MapletImportRecipe | undefined
	let result: { featureCollection: FeatureCollection; warnings: string[] } | undefined
	let previewing = false
	let targetLayerId = ''
	let targetGroupId = ''
	let targetName = ''
	let importMode: 'replace' | 'merge' = 'merge'
	let publishReview = false
	let splitLayers = false
	let collectionName = ''
	let groupName = ''
	let followAddress = ''
	const htmlEscape = (value: unknown) =>
		String(value ?? '').replace(
			/[&<>"']/g,
			(character) =>
				({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
				character,
		)
	const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
	const selected = () =>
		workspace?.collections.find((item) => item.id === workspace?.selectedCollectionId) ??
		workspace?.subscriptions.find((item) => item.address === workspace?.selectedCollectionId)
			?.collection
	const owned = () =>
		!!pubkey &&
		selected()?.owner === pubkey &&
		!!workspace?.collections.some((item) => item.id === selected()?.id)
	const layerKey = (layerId: string) =>
		workspace?.collections.some((item) => item.id === workspace?.selectedCollectionId)
			? `collection:${selected()?.id}:layer:${layerId}`
			: `subscription:${workspace?.selectedCollectionId}:layer:${layerId}`
	const button = (action: string, label: string, options = '') =>
		`<button type="button" data-action="${action}" ${busy ? 'disabled' : ''} ${options}>${label}</button>`
	const options = (items: { value: string; label: string }[], value: string) =>
		items
			.map(
				(item) =>
					`<option value="${htmlEscape(item.value)}" ${item.value === value ? 'selected' : ''}>${htmlEscape(item.label)}</option>`,
			)
			.join('')
	function notice(text: string, error = false) {
		message = text
		failed = error
		render()
	}
	async function showOutput() {
		if (!previewing)
			await napplet.map.replace(workspace?.renderCollection ?? empty, {
				warnings: workspace?.warnings ?? [],
			})
	}
	async function action(name: string, data: unknown = {}) {
		const generation = accountGeneration
		// UI optionals are omitted on the wire; the host accepts strict JSON only.
		const next = await napplet.map.workspace(name, JSON.parse(JSON.stringify(data)))
		if (generation !== accountGeneration)
			throw new Error('The active account changed. Reopen this action with your current account.')
		workspace = next
		await showOutput()
		if (generation !== accountGeneration)
			throw new Error('The active account changed. Start this action again.')
		render()
		return next
	}
	async function task(operation: (check: () => void) => Promise<void>) {
		if (busy) return
		const generation = accountGeneration
		const sequence = ++taskSequence
		const currentTask = () => generation === accountGeneration && sequence === taskSequence
		const check = () => {
			if (!currentTask()) throw new Error('The active account changed. Start this action again.')
		}
		busy = true
		message = ''
		failed = false
		render()
		try {
			await operation(check)
		} catch (error) {
			if (currentTask()) {
				message = error instanceof Error ? error.message : String(error)
				failed = true
			}
		} finally {
			if (currentTask()) {
				busy = false
				render()
			}
		}
	}
	function resetImport() {
		importGeneration++
		payload = undefined
		pasted = ''
		candidates = []
		recipe = undefined
		result = undefined
		rawHash = ''
		inputName = ''
		inputSourceUrl = ''
		inputIsSample = false
		inputWarnings = []
		wholeKmlPreview = false
		previewing = false
		publishReview = false
	}
	async function readInput(text: string, name: string, url = '', isSample = false) {
		const version = ++importGeneration
		const account = accountGeneration
		if (/\.kmz$/i.test(name))
			throw new Error(
				'Compressed KMZ is not supported yet. Export an uncompressed KML file instead.',
			)
		if (new TextEncoder().encode(text).length > 5 * 1024 * 1024)
			throw new Error('Choose a JSON or KML response smaller than 5 MiB.')
		const kml = text.trimStart().startsWith('<') ? parseKml(text, url) : undefined
		const parsed = kml?.payload ?? importer.parse(text)
		const found = importer.discover(parsed)
		if (!found.length)
			throw new Error(
				'No supported geographic data found. Choose GeoJSON or a response supported by an import adapter.',
			)
		const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
		if (version !== importGeneration || account !== accountGeneration) return
		result = undefined
		recipe = undefined
		previewing = false
		inputWarnings = kml?.warnings ?? []
		wholeKmlPreview = false
		// KML exports are complete layer snapshots and often lack source IDs.
		// Replacing avoids retaining deleted or moved features as duplicate records.
		if (kml) importMode = 'replace'
		payload = parsed
		candidates = found
		candidateIndex = 0
		inputName = kml ? `${kml.name}.kml` : name
		inputSourceUrl = url
		inputIsSample = isSample
		rawHash = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(
			'',
		)
		const existing = selected()?.layers.find((layer) => layer.id === targetLayerId)
		if (existing?.recipe) {
			recipe = structuredClone(existing.recipe)
			const match = found.findIndex(
				(candidate) =>
					candidate.adapter === recipe?.adapter &&
					JSON.stringify(candidate.path) === JSON.stringify(recipe.path),
			)
			candidateIndex = match
			result = importer.apply(
				payload,
				recipe,
				inputSourceUrl ? { sourceUrl: inputSourceUrl } : undefined,
			)
			message = 'Saved recipe applied. Review the update before saving.'
		} else {
			chooseCandidate(0)
			message = `${found.length} geographic ${found.length === 1 ? 'candidate' : 'candidates'} found. Choose what to import.`
		}
		await showOutput()
		if (version !== importGeneration || account !== accountGeneration) return
		importOpen = true
		render()
	}
	function chooseCandidate(index: number) {
		const candidate = candidates[index]
		if (!candidate) return
		candidateIndex = index
		wholeKmlPreview = false
		recipe = {
			version: 1,
			path: candidate.path,
			adapter: candidate.adapter,
			retainProperties: [...candidate.propertyKeys],
			...(candidate.suggestedIdProperty ? { idProperty: candidate.suggestedIdProperty } : {}),
			...(candidate.suggestedNameProperty ? { nameProperty: candidate.suggestedNameProperty } : {}),
		}
		result = undefined
		splitLayers = candidate.adapter === 'liveuamap' && !targetLayerId
		if (
			!targetLayerId &&
			candidate.path[0] === 'layers' &&
			candidate.path[1]?.startsWith('Layer: ')
		)
			targetName = candidate.path[1].slice(7)
		else if (!targetName) targetName = inputName.replace(/\.[^.]+$/, '') || 'Imported layer'
	}
	function diff() {
		if (!result) return ''
		const old =
			selected()?.layers.find((layer) => layer.id === targetLayerId)?.collection.features ?? []
		const next = result.featureCollection.features
		const previous = new Map(old.map((feature) => [String(feature.id), feature]))
		const incoming = new Set(next.map((feature) => String(feature.id)))
		const incomingSources = new Set(
			next.flatMap((feature) =>
				feature.properties?.sourceId === undefined ? [] : [String(feature.properties.sourceId)],
			),
		)
		let added = 0
		let changed = 0
		for (const feature of next) {
			const before = previous.get(String(feature.id))
			if (!before) added++
			else if (
				JSON.stringify(before.geometry) !== JSON.stringify(feature.geometry) ||
				JSON.stringify(before.properties) !== JSON.stringify(feature.properties)
			)
				changed++
		}
		const removed = old.filter(
			(feature) =>
				!incoming.has(String(feature.id)) &&
				(importMode === 'replace' ||
					(feature.properties?.sourceId !== undefined &&
						incomingSources.has(String(feature.properties.sourceId)))),
		).length
		return `${added} added · ${changed} changed · ${removed} removed${importMode === 'merge' ? ' · Other records retained' : ''}`
	}
	function renderImporter() {
		const current = selected()
		const candidate = candidates[candidateIndex]
		const propertyKeys = candidate?.propertyKeys ?? recipe?.retainProperties ?? []
		return `<section class="importer" aria-label="Guided geographic import">
			<div class="row"><h2>Import data</h2>${button('cancel-import', 'Cancel')}</div>
			<div class="step"><label>Google My Maps link<input id="my-maps-url" type="url" placeholder="https://www.google.com/maps/d/viewer?mid=…" value="${htmlEscape(myMapsUrl)}"></label>${button('fetch-kml', 'Fetch KML in browser', 'class="primary"')}<p class="muted small">Public maps only. Downloads directly from Google without an Earthly backend or Google sign-in. Fetch again to review a newer snapshot.</p><label class="file-label">Choose KML file<input id="kml-file" type="file" accept=".kml,application/vnd.google-earth.kml+xml,application/xml,text/xml" ${busy ? 'disabled' : ''}></label><p class="muted small">If fetching fails, use My Maps → menu → Export to KML/KMZ. Choose KML, with actual data rather than a network link, then select or drop the file here. Compressed KMZ is not supported yet.</p></div>
			<details ${candidates.length ? '' : 'open'}><summary>${candidates.length ? `Input: ${htmlEscape(inputName)}` : 'Choose an input'}</summary><div class="drop" id="drop-zone"><strong>Drop a JSON or KML file</strong><span class="muted">or choose a response from your computer</span><label class="file-label">Choose JSON file<input id="json-file" type="file" accept=".json,.geojson,application/json,application/geo+json" ${busy ? 'disabled' : ''}></label></div>
			<details ${pasted ? 'open' : ''}><summary>Paste a response</summary><label>JSON response<textarea id="json-paste" rows="5" placeholder="Paste the response body">${htmlEscape(pasted)}</textarea></label>${button('analyze-paste', 'Find geographic data')}</details>
			<div class="actions">${button('sample', 'Try example data')}${button('connector', 'Try available connector')}</div>
			<p class="muted small">GeoJSON, KML and supported source adapters. Request headers and cookies are not needed for file imports.</p></details>
			${inputWarnings.length && candidates.length > 1 ? button('preview-kml-map', 'Preview entire KML map') : ''}
			${inputWarnings.length ? `<ul class="muted small">${inputWarnings.map((warning) => `<li>${htmlEscape(warning)}</li>`).join('')}</ul>` : ''}
			${
				candidates.length
					? `<div class="step"><span class="eyebrow">01 / Locate</span><label>Geographic data<select id="candidate" aria-label="Geographic data">${options(
							candidates.map((item, index) => ({
								value: String(index),
								label: `${item.path.length ? item.path.join(' → ') : 'Root'} · ${item.adapter === 'geojson' ? 'GeoJSON' : 'Liveuamap adapter'} · ${item.count} geometries`,
							})),
							String(candidateIndex),
						)}</select></label><p class="muted small">${htmlEscape(inputName)}${inputIsSample ? ' · Captured example; source time unknown' : ''}</p>${targetLayerId ? button('reset-recipe', 'Use detected mapping') : ''}</div>
			<div class="step"><span class="eyebrow">02 / Interpret</span><div class="columns"><label>Feature name<select id="name-property" aria-label="Feature name">${options([{ value: '', label: 'Keep existing names' }, ...propertyKeys.map((key) => ({ value: key, label: key }))], recipe?.nameProperty ?? '')}</select></label><label>Stable identifier<select id="id-property" aria-label="Stable identifier">${options([{ value: '', label: 'Use source feature IDs' }, ...propertyKeys.map((key) => ({ value: key, label: key }))], recipe?.idProperty ?? '')}</select></label></div>
			<details><summary>Properties to retain (${recipe?.retainProperties?.length ?? propertyKeys.length})</summary><div class="properties">${propertyKeys.map((key) => `<label class="check"><input type="checkbox" data-property="${htmlEscape(key)}" ${recipe?.retainProperties?.includes(key) !== false ? 'checked' : ''}>${htmlEscape(key)}</label>`).join('')}</div></details></div>
			<div class="step"><span class="eyebrow">03 / Place</span>${current && owned() ? `<div class="columns"><label>Destination layer<select id="target-layer" aria-label="Destination layer">${options([{ value: '', label: 'Create a new layer' }, ...current.layers.map((layer) => ({ value: layer.id, label: layer.name }))], targetLayerId)}</select></label><label>Group<select id="target-group" aria-label="Group">${options([{ value: '', label: 'Ungrouped' }, ...current.groups.map((group) => ({ value: group.id, label: group.name }))], targetGroupId)}</select></label></div>` : '<p class="muted">Create a collection in Manage to save this import. Preview is available now.</p>'}
			${!targetLayerId && candidate?.adapter === 'liveuamap' ? `<label class="check"><input id="split-layers" type="checkbox" ${splitLayers ? 'checked' : ''}>Create a named layer for each source overlay</label>` : ''}
			${!splitLayers ? `<label>Layer name<input id="target-name" value="${htmlEscape(targetName)}" maxlength="160"></label>` : ''}
			${
				targetLayerId
					? `<label>Update behavior<select id="import-mode" aria-label="Update behavior">${options(
							[
								{ value: 'merge', label: 'Update included records' },
								{ value: 'replace', label: 'Replace this complete layer' },
							],
							importMode,
						)}</select></label>`
					: ''
			}
			${button('preview', 'Preview geometry', 'class="primary"')}</div>`
					: ''
			}
			${
				result
					? `<div class="step"><span class="eyebrow">04 / Review</span><h3>${result.featureCollection.features.length} geometries</h3><p>${wholeKmlPreview ? 'Entire KML map preview. Choose a geographic layer and preview it to save with its recipe.' : htmlEscape(diff())}</p><div class="sample-rows">${result.featureCollection.features
							.slice(0, 4)
							.map(
								(feature) =>
									`<div class="row"><span>${htmlEscape(feature.properties?.name ?? feature.id)}</span><span class="muted">${htmlEscape(feature.geometry?.type)}</span></div>`,
							)
							.join(
								'',
							)}</div>${result.warnings.length ? `<details><summary>Import notes (${result.warnings.length})</summary><ul>${result.warnings.map((warning) => `<li>${htmlEscape(warning)}</li>`).join('')}</ul></details>` : ''}<div class="actions">${button('view-map', 'View on map')}${owned() && !wholeKmlPreview ? button('apply-import', targetLayerId ? 'Apply update & save recipe' : 'Add layers & save recipe', 'class="primary"') : ''}</div><p class="muted small">Saving updates your local collection. Publishing is a separate action.</p></div>`
					: ''
			}
		</section>`
	}
	function renderLayers() {
		const collection = selected()
		if (!collection)
			return `<section class="empty"><h2>Your next layer starts here</h2><p class="muted">Follow a contributor’s collection or bring a My Maps export or JSON response into layers of your own.</p><div class="actions">${button('open-import', 'Import My Maps / KML', 'class="primary"')}${button('open-import', 'Explore a JSON file')}${pubkey ? button('manage', 'Create a collection') : ''}</div></section>`
		const grouped = [...collection.groups, { id: '', name: 'Ungrouped' }]
		const subscription = workspace?.subscriptions.find(
			(item) => item.address === workspace?.selectedCollectionId,
		)
		return `<section><div class="collection-heading"><h2>${htmlEscape(collection.name)}</h2><p class="muted small">${owned() ? 'Your local working collection' : 'Following a signed snapshot'}${subscription?.status === 'error' ? ' · Update unavailable; previous snapshot retained' : ''}</p></div>
		${grouped
			.map((group) => {
				const layers = collection.layers.filter((layer) => (layer.groupId ?? '') === group.id)
				if (!layers.length) return ''
				return `<section class="layer-group"><div class="row"><h3>${htmlEscape(group.name)}</h3><label class="check"><input type="checkbox" data-group-visible="${htmlEscape(group.id)}" ${layers.every((layer) => workspace?.visibility[layerKey(layer.id)] !== false) ? 'checked' : ''}>Show group</label></div>${layers.map((layer) => `<div class="layer-row"><label class="check"><input type="checkbox" data-layer-visible="${htmlEscape(layer.id)}" ${workspace?.visibility[layerKey(layer.id)] !== false ? 'checked' : ''}><span>${htmlEscape(layer.name)}<small class="muted">${layer.collection.features.length} geometries</small></span></label>${owned() ? button('update-layer', 'Update', `data-layer="${htmlEscape(layer.id)}"`) : ''}</div>`).join('')}</section>`
			})
			.join('')}
		${!collection.layers.length ? '<p class="muted">This collection has no layers yet. Import a response to get started.</p>' : ''}
		<div class="actions">${button('view-map', 'View on map')}${owned() ? button('open-import', 'Import data', 'class="primary"') : button('unfollow', 'Unfollow collection')}</div>
		${subscription?.error ? `<p role="alert" class="error">${htmlEscape(subscription.error)}</p>` : ''}
		<p class="muted small">Use “Copy to editor” in Earthly to make independent geometry. Source attribution stays attached.</p></section>`
	}
	function renderManage() {
		const current = selected()
		return `<section><div class="step"><span class="eyebrow">Collection</span><label>New collection name<input id="collection-name" maxlength="160" placeholder="e.g. Regional observations" value="${htmlEscape(collectionName)}"></label>${button('create', 'Create collection', 'class="primary"')}</div>
		${
			owned() && current
				? `<div class="step"><div class="row"><h2>${htmlEscape(current.name)}</h2></div><label>Collection name<input id="rename-collection" maxlength="160" value="${htmlEscape(current.name)}"></label>${button('rename-collection', 'Save name')}
		<label>New group name<input id="group-name" maxlength="160" placeholder="e.g. Yemen" value="${htmlEscape(groupName)}"></label>${button('add-group', 'Add group')}
		${current.groups.map((group) => `<div class="edit-row"><label>Group name<input data-group-name="${htmlEscape(group.id)}" value="${htmlEscape(group.name)}" maxlength="160"></label>${button('rename-group', 'Rename', `data-group="${htmlEscape(group.id)}"`)}${button('remove-group', 'Remove', `data-group="${htmlEscape(group.id)}"`)}</div>`).join('')}</div>
		${current.layers.length ? `<div class="step"><span class="eyebrow">Layers</span>${current.layers.map((layer) => `<div class="edit-layer"><label>Layer name<input data-layer-name="${htmlEscape(layer.id)}" value="${htmlEscape(layer.name)}" maxlength="160"></label><label>Group<select aria-label="Layer group" data-layer-group="${htmlEscape(layer.id)}">${options([{ value: '', label: 'Ungrouped' }, ...current.groups.map((group) => ({ value: group.id, label: group.name }))], layer.groupId ?? '')}</select></label><div class="actions">${button('rename-layer', 'Save layer name', `data-layer="${htmlEscape(layer.id)}"`)}${button('update-layer', 'Import update', `data-layer="${htmlEscape(layer.id)}"`)}${button('remove-layer', 'Remove layer', `data-layer="${htmlEscape(layer.id)}"`)}</div></div>`).join('')}</div>` : ''}
		<div class="step"><span class="eyebrow">Publish</span><p>Publish the complete collection, including its named groups, layers and attribution.</p>${publishReview ? `<div class="review"><strong>${htmlEscape(current.name)}</strong><p>${current.groups.length} groups · ${current.layers.length} layers · ${current.layers.reduce((count, layer) => count + layer.collection.features.length, 0)} geometries</p><p class="muted small">Your current account signs this public snapshot. Raw imports and local recipes stay on this device.</p><div class="actions">${button('publish', 'Sign & publish snapshot', 'class="primary"')}${button('cancel-publish', 'Cancel')}</div></div>` : button('review-publish', 'Review snapshot for publishing', current.layers.length ? 'class="primary"' : 'disabled')}
		${current.address ? `<label class="share-label">Collection address<input readonly value="${htmlEscape(current.naddr ?? current.address)}" aria-label="Collection address"></label><p class="muted small">Share this address with readers. They can follow future snapshots.</p>` : ''}</div>`
				: ''
		}</section>`
	}
	function render() {
		const choices = [
			...(workspace?.collections ?? []).map((item) => ({
				value: item.id,
				label: `${item.name} · Yours`,
			})),
			...(workspace?.subscriptions ?? []).map((item) => ({
				value: item.address,
				label: item.collection?.name ?? `${item.address.slice(0, 24)}… · ${item.status}`,
			})),
		]
		root.innerHTML = `<header class="intro"><div><span class="eyebrow">Composable map data</span><h1>Live Mapper</h1></div><span class="account">${pubkey ? `${htmlEscape(pubkey.slice(0, 8))}…` : 'Reader'}</span></header>
		${choices.length ? `<label class="collection-picker">Collection<select id="collection-picker" aria-label="Collection">${options(choices, workspace?.selectedCollectionId ?? '')}</select></label>` : ''}
		<nav aria-label="Workspace views">${button('layers', 'Layers', `aria-pressed="${tab === 'layers'}"`)}${pubkey ? button('manage', 'Manage', `aria-pressed="${tab === 'manage'}"`) : ''}${button('follow-tab', 'Follow', `aria-pressed="${tab === 'follow'}"`)}</nav>
		${message ? `<div class="notice ${failed ? 'error' : ''}" role="${failed ? 'alert' : 'status'}">${htmlEscape(message)}</div>` : ''}
		${workspace?.error ? `<p role="alert" class="error">${htmlEscape(workspace.error)}</p>` : ''}
		${busy ? '<p role="status" class="muted">Working…</p>' : ''}
		${
			importOpen
				? renderImporter()
				: tab === 'follow'
					? `<section class="step"><h2>Follow a collection</h2><p class="muted">Paste the collection address shared by its publisher. Updates come from that exact author and collection.</p><label>Collection address<input id="follow-address" value="${htmlEscape(followAddress)}" placeholder="naddr1… or 37515:pubkey:identifier"></label>${button('follow', 'Follow collection', 'class="primary"')}${(
							workspace?.subscriptions ?? []
						)
							.filter((item) => item.error)
							.map((item) => `<p role="alert" class="error">${htmlEscape(item.error)}</p>`)
							.join('')}</section>`
					: tab === 'manage' && pubkey
						? renderManage()
						: renderLayers()
		}
		${!pubkey ? '<footer>Sign in to Earthly to create and publish your own collections. You can follow collections and preview imports without signing in.</footer>' : ''}`
		requestAnimationFrame(() => napplet.map.resize(root.getBoundingClientRect().height + 44))
	}
	function fieldValue(id: string) {
		return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? ''
	}
	function findField(attribute: string, value: string): HTMLInputElement | undefined {
		return Array.from(root.querySelectorAll<HTMLInputElement>(`[${attribute}]`)).find(
			(field) => field.getAttribute(attribute) === value,
		)
	}
	root.addEventListener('input', (event) => {
		const field = event.target as HTMLInputElement
		if (field.id === 'json-paste') pasted = field.value
		if (field.id === 'target-name') targetName = field.value
		if (field.id === 'collection-name') collectionName = field.value
		if (field.id === 'group-name') groupName = field.value
		if (field.id === 'follow-address') followAddress = field.value
		if (field.id === 'my-maps-url') myMapsUrl = field.value
	})
	root.addEventListener('change', (event) => {
		const field = event.target as HTMLInputElement
		if ((field.id === 'json-file' || field.id === 'kml-file') && field.files?.[0]) {
			const file = field.files[0]
			void task(async (check) => {
				if (file.size > 5 * 1024 * 1024)
					throw new Error('Choose a JSON or KML response smaller than 5 MiB.')
				const text = await file.text()
				check()
				await readInput(text, file.name)
			})
			return
		}
		if (field.id === 'collection-picker') {
			resetImport()
			importOpen = false
			tab = 'layers'
			void task(async () => {
				await action('selectCollection', { collectionId: field.value })
			})
			return
		}
		if (field.id === 'candidate') {
			chooseCandidate(Number(field.value))
			render()
			return
		}
		if (field.id === 'target-layer') {
			targetLayerId = field.value
			const layer = selected()?.layers.find((item) => item.id === targetLayerId)
			targetName = layer?.name ?? inputName
			targetGroupId = layer?.groupId ?? ''
			splitLayers = false
			if (layer?.recipe) {
				recipe = structuredClone(layer.recipe)
				candidateIndex = candidates.findIndex(
					(candidate) =>
						JSON.stringify(candidate.path) === JSON.stringify(recipe?.path) &&
						candidate.adapter === recipe?.adapter,
				)
			}
			result = undefined
			render()
			return
		}
		if (field.id === 'target-group') targetGroupId = field.value
		if (field.id === 'split-layers') {
			splitLayers = field.checked
			render()
		}
		if (field.id === 'import-mode') {
			importMode = field.value === 'replace' ? 'replace' : 'merge'
			render()
		}
		if (field.id === 'name-property' && recipe) {
			if (field.value) recipe.nameProperty = field.value
			else delete recipe.nameProperty
			result = undefined
			render()
		}
		if (field.id === 'id-property' && recipe) {
			if (field.value) recipe.idProperty = field.value
			else delete recipe.idProperty
			result = undefined
			render()
		}
		if (field.dataset.property && recipe) {
			recipe.retainProperties = field.checked
				? [...(recipe.retainProperties ?? []), field.dataset.property]
				: (recipe.retainProperties ?? []).filter((key) => key !== field.dataset.property)
			result = undefined
			render()
		}
		if (field.dataset.layerVisible)
			void task(async () => {
				await action('setVisibility', {
					key: layerKey(field.dataset.layerVisible ?? ''),
					visible: field.checked,
				})
			})
		if (field.hasAttribute('data-group-visible')) {
			const layers =
				selected()?.layers.filter(
					(layer) => (layer.groupId ?? '') === field.dataset.groupVisible,
				) ?? []
			void task(async () => {
				for (const layer of layers)
					await action('setVisibility', { key: layerKey(layer.id), visible: field.checked })
			})
		}
		if (field.dataset.layerGroup)
			void task(async () => {
				await action('moveLayer', {
					collectionId: selected()?.id,
					layerId: field.dataset.layerGroup,
					groupId: field.value || null,
				})
			})
	})
	root.addEventListener('click', (event) => {
		const control = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')
		if (!control || control.disabled || busy) return
		const name = control.dataset.action
		const current = selected()
		if (name === 'layers' || name === 'manage' || name === 'follow-tab') {
			tab = name === 'follow-tab' ? 'follow' : name
			importOpen = false
			publishReview = false
			previewing = false
			void showOutput()
			render()
			return
		}
		if (name === 'open-import' || name === 'update-layer') {
			resetImport()
			targetLayerId = control.dataset.layer ?? ''
			const layer = current?.layers.find((item) => item.id === targetLayerId)
			targetName = layer?.name ?? ''
			targetGroupId = layer?.groupId ?? ''
			importMode = 'merge'
			importOpen = true
			render()
			return
		}
		if (name === 'cancel-import') {
			resetImport()
			importOpen = false
			void showOutput()
			render()
			return
		}
		if (name === 'reset-recipe') {
			chooseCandidate(Math.max(0, candidateIndex))
			const savedRecipe = current?.layers.find((layer) => layer.id === targetLayerId)?.recipe
			if (recipe && savedRecipe?.sourceIds) recipe.sourceIds = [...savedRecipe.sourceIds]
			message = 'Detected mapping selected. Review properties and preview again.'
			failed = false
			render()
			return
		}
		if (name === 'review-publish' || name === 'cancel-publish') {
			publishReview = name === 'review-publish'
			render()
			return
		}
		const renamedCollection = fieldValue('rename-collection')
		const renamedGroup = findField('data-group-name', control.dataset.group ?? '')?.value
		const renamedLayer = findField('data-layer-name', control.dataset.layer ?? '')?.value
		void task(async (check) => {
			switch (name) {
				case 'sample':
					await readInput(JSON.stringify(sample), 'Captured example.json', sourceUrl, true)
					break
				case 'connector': {
					const text = await (await napplet.resource.bytes(sourceUrl)).text()
					check()
					await readInput(text, 'Source response.json', sourceUrl)
					break
				}
				case 'fetch-kml': {
					const url = exportUrl(myMapsUrl)
					const text = await (await napplet.resource.bytes(url)).text()
					check()
					if (!text.trimStart().startsWith('<'))
						throw new Error('The export did not contain KML. Choose a downloaded KML file.')
					await readInput(text, 'My Maps.kml', url)
					break
				}
				case 'analyze-paste':
					await readInput(pasted, 'Pasted response.json')
					break
				case 'create':
					await action('createCollection', { name: collectionName })
					collectionName = ''
					tab = 'manage'
					break
				case 'rename-collection':
					await action('renameCollection', { collectionId: current?.id, name: renamedCollection })
					break
				case 'add-group':
					await action('addGroup', { collectionId: current?.id, name: groupName })
					groupName = ''
					break
				case 'rename-group':
					await action('renameGroup', {
						collectionId: current?.id,
						groupId: control.dataset.group,
						name: renamedGroup,
					})
					break
				case 'remove-group':
					await action('removeGroup', { collectionId: current?.id, groupId: control.dataset.group })
					break
				case 'rename-layer':
					await action('renameLayer', {
						collectionId: current?.id,
						layerId: control.dataset.layer,
						name: renamedLayer,
					})
					break
				case 'remove-layer':
					await action('removeLayer', { collectionId: current?.id, layerId: control.dataset.layer })
					break
				case 'follow':
					await action('follow', { address: followAddress.trim() })
					followAddress = ''
					tab = 'layers'
					break
				case 'unfollow':
					await action('unfollow', { address: workspace?.selectedCollectionId })
					break
				case 'preview-kml-map': {
					const mapped = candidates.map((candidate) =>
						importer.apply(payload, {
							version: 1,
							path: candidate.path,
							adapter: candidate.adapter,
						}),
					)
					const combined = {
						featureCollection: {
							type: 'FeatureCollection' as const,
							features: mapped.flatMap((item) => item.featureCollection.features),
						},
						warnings: [...new Set(mapped.flatMap((item) => item.warnings))],
					}
					await napplet.map.replace(combined.featureCollection, {
						warnings: [
							...inputWarnings,
							...combined.warnings,
							'Import preview: these geometries have not been saved or published.',
						],
					})
					check()
					result = combined
					previewing = true
					wholeKmlPreview = true
					message =
						'Entire KML map preview ready. View on map, or select one layer to save its import recipe.'
					break
				}
				case 'preview': {
					wholeKmlPreview = false
					if (!recipe || payload === undefined) throw new Error('Choose geographic data first.')
					result = importer.apply(
						payload,
						recipe,
						inputSourceUrl ? { sourceUrl: inputSourceUrl } : undefined,
					)
					previewing = true
					await napplet.map.replace(result.featureCollection, {
						warnings: [
							...inputWarnings,
							...result.warnings,
							'Import preview: these geometries have not been saved or published.',
						],
					})
					message = 'Preview ready. Inspect the map, then add this data to your collection.'
					break
				}
				case 'view-map':
					await napplet.map.workspace('viewMap')
					break
				case 'apply-import': {
					if (!owned() || !current || !recipe || !result)
						throw new Error('Preview an import into a collection you own first.')
					const provenance = {
						adapter: recipe.adapter,
						adapterVersion: 1,
						inputHash: rawHash,
						importedAt: new Date().toISOString(),
						sourceUrl: inputSourceUrl || undefined,
						sourceCapturedAt: null,
						sample: inputIsSample,
					}
					if (splitLayers && !targetLayerId) {
						const groups = new Map<string, FeatureCollection['features']>()
						for (const feature of result.featureCollection.features) {
							const key = String(feature.properties?.sourceId ?? feature.id)
							groups.set(key, [...(groups.get(key) ?? []), feature])
						}
						for (const [sourceId, features] of groups) {
							check()
							const existing = current.layers.find(
								(layer) =>
									(layer.groupId ?? '') === targetGroupId &&
									layer.collection.features.some(
										(feature) => String(feature.properties?.sourceId) === sourceId,
									),
							)
							await action('saveLayer', {
								collectionId: current.id,
								layerId: existing?.id,
								name: existing?.name ?? String(features[0]?.properties?.name ?? targetName),
								groupId: targetGroupId || null,
								collection: { type: 'FeatureCollection', features },
								mode: 'merge',
								recipe: { ...recipe, sourceIds: [sourceId] },
								provenance,
							})
						}
					} else
						await action('saveLayer', {
							collectionId: current.id,
							layerId: targetLayerId || undefined,
							name: targetName,
							groupId: targetGroupId || null,
							collection: result.featureCollection,
							mode: importMode,
							recipe,
							provenance,
						})
					resetImport()
					importOpen = false
					tab = 'layers'
					await showOutput()
					message = 'Saved locally with its import recipe. Review and publish when ready.'
					break
				}
				case 'publish':
					await action('publish', { collectionId: current?.id })
					publishReview = false
					message = 'Snapshot published. Share its collection address with readers.'
					break
			}
		})
	})
	root.addEventListener('dragover', (event) => {
		if (importOpen) event.preventDefault()
	})
	root.addEventListener('drop', (event) => {
		event.preventDefault()
		const file = event.dataTransfer?.files[0]
		if (!importOpen || !file || busy) return
		void task(async (check) => {
			if (file.size > 5 * 1024 * 1024)
				throw new Error('Choose a JSON or KML response smaller than 5 MiB.')
			const text = await file.text()
			check()
			await readInput(text, file.name)
		})
	})
	napplet.map.onWorkspaceChanged((state) => {
		if ((state.pubkey ?? '') !== pubkey) return
		workspace = state
		if (!busy) {
			render()
			void showOutput().catch((error) => notice(String(error), true))
		}
	})
	napplet.identity.onChanged((next) => {
		accountGeneration++
		pubkey = next
		workspace = undefined
		resetImport()
		importOpen = false
		tab = 'layers'
		collectionName = ''
		groupName = ''
		followAddress = ''
		myMapsUrl = ''
		busy = false
		void napplet.map.replace(empty)
		const generation = accountGeneration
		void action('state').catch((error) => {
			if (generation === accountGeneration) notice(String(error), true)
		})
	})
	void (async () => {
		const generation = accountGeneration
		try {
			const initialPubkey = await napplet.identity.getPublicKey()
			if (generation !== accountGeneration) return
			pubkey = initialPubkey
			await action('state')
		} catch (error) {
			if (generation === accountGeneration)
				notice(error instanceof Error ? error.message : String(error), true)
		}
	})()
	new ResizeObserver(() => napplet.map.resize(root.getBoundingClientRect().height + 44)).observe(
		root,
	)
	render()
}

export function createLiveMapperWorkbenchHtml(
	sample: unknown,
	sourceUrl: string,
	mapper: typeof mapLiveuamapPayload,
): string {
	const literal = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c')
	return `<html lang="en"><head><meta charset="utf-8"><title>Live Mapper</title><style>
:root{color-scheme:light dark;--bg:light-dark(#fafaf7,#20231f);--fg:light-dark(#292f28,#e7ece2);--muted:light-dark(#626b5d,#aeb8a6);--line:light-dark(#d9dfd2,#424b3d);--soft:light-dark(#eef1e8,#2c3427);--accent:light-dark(#355235,#c3d7aa);--on-accent:light-dark(#fff,#25331e);--error:light-dark(#a33823,#ffb19e)}*{box-sizing:border-box}body{margin:0;padding:22px;color:var(--fg);background:var(--bg);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}button,input,textarea,select{font:inherit;color:inherit}button{padding:8px 12px;border:1px solid var(--line);border-radius:5px;background:var(--bg);cursor:pointer}button:disabled{opacity:.5;cursor:default}button.primary,nav button[aria-pressed=true]{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}button:hover:enabled{filter:brightness(.96)}input:not([type=checkbox]):not([type=file]),textarea,select{width:100%;padding:9px 10px;margin-top:6px;border:1px solid var(--line);border-radius:5px;background:var(--bg)}textarea{resize:vertical}label{display:block}input[type=checkbox]{accent-color:var(--accent);width:17px;height:17px;flex-shrink:0}h1{font-size:25px;letter-spacing:-.8px;margin:3px 0}h2{font-size:18px;letter-spacing:-.4px;margin:0 0 8px}h3{font-size:14px;margin:0}p{margin:8px 0 12px}.intro,.row{display:flex;align-items:center;justify-content:space-between;gap:12px}.eyebrow{text-transform:uppercase;font-size:10px;letter-spacing:1.8px;color:var(--muted);display:block;margin-bottom:8px}.account{font:12px ui-monospace,monospace;color:var(--muted)}.muted,footer{color:var(--muted)}.small{font-size:12px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.collection-picker{margin:18px 0}.collection-heading{margin:20px 0}nav{display:flex;gap:7px;padding:15px 0;border-bottom:1px solid var(--line);margin-bottom:20px}nav button{border:0}.empty{padding:14px 0 20px}.step{border-top:1px solid var(--line);margin-top:22px;padding-top:22px}.step>label,.edit-layer>label{margin:14px 0}.columns{display:grid;grid-template-columns:1fr 1fr;gap:14px}.notice{padding:12px;background:var(--soft);margin-bottom:16px;border-radius:5px}.error{color:var(--error)}.drop{display:grid;justify-items:center;gap:6px;padding:24px 12px;margin:16px 0;border:1px dashed var(--line);background:var(--soft);border-radius:5px;text-align:center}.file-label{margin-top:8px;max-width:100%}.file-label input{display:block;margin:8px auto 0;max-width:100%}.layer-group{margin:22px 0}.layer-group h3{color:var(--muted)}.layer-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}.check{display:flex;align-items:center;gap:9px;min-height:34px}.check small{display:block;font-size:12px}.edit-row{display:flex;align-items:end;gap:8px;margin:14px 0}.edit-row label{flex:1;min-width:0}.edit-layer{padding:14px 0;border-bottom:1px solid var(--line)}details{margin:16px 0}summary{cursor:pointer;padding:5px 0}.properties{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;margin:10px 0}.properties label{overflow-wrap:anywhere}.sample-rows{padding:8px 0}.sample-rows .row{padding:7px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.review{background:var(--soft);padding:16px;border-radius:5px}.share-label{margin-top:20px}footer{font-size:12px;border-top:1px solid var(--line);margin-top:24px;padding-top:16px}ul{padding-left:20px}li{margin:7px 0;overflow-wrap:anywhere}@media(max-width:480px){body{padding:16px}.columns,.properties{grid-template-columns:1fr}.edit-row{flex-wrap:wrap}.edit-row label{flex-basis:100%}button{min-height:44px}input,select,textarea{font-size:16px}.account{max-width:90px;overflow:hidden}}
</style></head><body><main id="workbench"></main><script>(${runWorkbench.toString()})(${literal(sample)},${literal(sourceUrl)},${createMapletImporter.toString()},${mapper.toString()},${parseMapletKml.toString()},${myMapsExportUrl.toString()})</script></body></html>`
}
