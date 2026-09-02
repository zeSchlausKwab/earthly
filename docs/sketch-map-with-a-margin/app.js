/* A Map with a Margin — clickable sketch. Vanilla JS, hash routing, local state. */
;(function () {
	const D = window.SKETCH_DATA
	const $ = (s, r) => (r || document).querySelector(s)
	const $$ = (s, r) => Array.from((r || document).querySelectorAll(s))
	const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
	const clone = (v) => JSON.parse(JSON.stringify(v))
	const isMobile = () => window.matchMedia('(max-width: 760px)').matches
	const today = '2026-09-02'

	// ------------------------------------------------------------------ state
	const S = {
		route: { kind: null, id: null, edit: false },
		shelf: [{ id: 'bri', visible: true }, { id: 'cables-atlantic', visible: true }],
		liveOn: false,
		editing: null, // {kind,id}
		drafts: {}, // id -> working copy
		proposal: null,
		reviewOpen: false,
		onlyChanges: false,
		selection: new Set(),
		refs: [],
		tab: 'details',
		threads: {},
		run: null,
		safety: 'ask',
		detailsOpen: false,
		menu: null,
		dialog: null,
		tool: null,
		drawing: [],
		undo: [],
		redo: [],
		filter: null,
		query: '',
		resultsOpen: false,
		view: { x: 0, y: 0, k: 1 },
		popup: null,
		detent: 'half',
		threadSide: true,
		aboutOpen: false,
		browse: { kind: 'maps', q: '', sort: 'new' },
		glass: false,
		lens: null,
		basemap: 'svg',
		ask: { msgs: [] },
		counter: 1,
	}

	// ---------------------------------------------------------------- objects
	const KINDS = { map: D.maps, story: D.stories, atlas: D.atlases }
	function obj(kind, id) {
		if (kind === 'sighting') return D.sightings.find((s) => s.id === id)
		if (kind === 'person') return D.people[id]
		return KINDS[kind] && KINDS[kind][id]
	}
	const person = (id) => D.people[id] || D.people.me
	const mine = (o) => o && o.author === 'me'
	const key = (kind, id) => `${kind}:${id}`
	// The object as the user sees it: the working copy if one exists and is in Edit, else the published one.
	function view(kind, id) {
		const d = S.drafts[id]
		if (d && S.editing && S.editing.id === id) return d
		return obj(kind, id)
	}
	function storiesReferencing(mapId) {
		return Object.values(D.stories).filter((s) => s.maps.includes(mapId))
	}
	function fitState(map, atlas) {
		if (atlas.pinned.includes(map.id)) return { cls: 'ok', text: `In ${atlas.title} ✓` }
		if (atlas.policy === 'open') return { cls: 'ok', text: `In ${atlas.title} ✓` }
		if (atlas.policy === 'schema') {
			const missing = (atlas.schemaFields || []).filter((f) => !(map.props && map.props[f.key])).map((f) => f.key)
			return missing.length === 0
				? { cls: 'ok', text: `In ${atlas.title} ✓` }
				: { cls: 'warn', text: `${atlas.title} · doesn’t fit: missing “${missing.join('”, “')}”` }
		}
		return { cls: 'closed', text: `${atlas.title} · closed, ask the owner` }
	}
	function atlasMembers(atlas) {
		const all = Object.values(D.maps).filter((m) => m.belongsTo.includes(atlas.id) && !atlas.pinned.includes(m.id))
		const added = all.filter((m) => fitState(m, atlas).cls === 'ok')
		const waiting = all.filter((m) => fitState(m, atlas).cls !== 'ok')
		return { pinned: atlas.pinned.map((id) => D.maps[id]).filter(Boolean), added, waiting }
	}
	function bbox(features) {
		let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
		const eat = (p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]) }
		features.forEach((f) => (f.type === 'point' ? eat(f.coords) : f.coords.forEach(eat)))
		if (x0 > x1) return [10, 40, 20, 48]
		return [x0, y0, x1, y1]
	}
	function sideThreadActive() {
		return S.threadSide && !isMobile() && innerWidth >= 1280 && ['map', 'story', 'atlas'].includes(S.route.kind)
	}
	const lensAtlas = () => (S.lens ? D.atlases[S.lens] : null)
	const noun = (a, n) => { const w = a && a.noun ? a.noun : 'map'; return n === 1 ? w : `${w}s` }
	function inAtlas(m, a) { return !!a && (a.pinned.includes(m.id) || m.belongsTo.includes(a.id)) }
	function schemaFor(m) {
		const ids = new Set([...(m.belongsTo || []), ...Object.values(D.atlases).filter((a) => a.pinned.includes(m.id)).map((a) => a.id)])
		const fields = []
		ids.forEach((id) => { const a = D.atlases[id]; if (a && a.schemaFields) a.schemaFields.forEach((f) => { if (!fields.some((x) => x.key === f.key)) fields.push(Object.assign({ atlas: a.title }, f)) }) })
		return fields
	}
	function enterLens(id) {
		const a = D.atlases[id]; if (!a) return
		S.lens = id
		S.filter = null
		S.browse.kind = 'maps'; S.browse.q = ''
		const mem = atlasMembers(a)
		const ids = [...mem.pinned, ...mem.added].map((m) => m.id)
		S.shelf = ids.map((mid) => ({ id: mid, visible: true }))
		applyLensTheme()
		location.hash = hashFor({ kind: 'browse', id: 'maps', edit: false })
		setTimeout(() => flyToMaps(ids), 60)
		toast(`You are in “${a.title}”. Lists show its ${noun(a, 2)}; new ${noun(a, 2)} belong here.`)
	}
	function leaveLens() {
		const a = lensAtlas()
		S.lens = null
		applyLensTheme()
		if (S.route.kind === 'browse' || !S.route.kind) location.hash = hashFor({ kind: 'browse', id: S.browse.kind, edit: false })
		else { syncHash(); render() }
		if (a) toast(`Left “${a.title}”. Drafts keep what they belong to.`)
	}
	function applyLensTheme() {
		const a = lensAtlas()
		const root = document.documentElement
		if (a && a.color) { root.style.setProperty('--accent', a.color); root.style.setProperty('--accent-soft', `color-mix(in srgb, ${a.color} 18%, var(--surface))`); root.style.setProperty('--working', a.color) } else { root.style.removeProperty('--accent'); root.style.removeProperty('--accent-soft'); root.style.removeProperty('--working') }
		document.body.classList.toggle('in-lens', !!a)
		applyMlColors()
	}
	function policyText(p) {
		return p === 'open' ? 'Anyone can add maps' : p === 'schema' ? 'Anyone, if the map fits the schema' : 'Only the owner adds maps'
	}

	// ---------------------------------------------------------------- routing
	function parseHash() {
		const h = location.hash.replace(/^#/, '') || '/'
		const [path, qs] = h.split('?')
		const seg = path.split('/').filter(Boolean)
		const q = new URLSearchParams(qs || '')
		return { kind: seg[0] || null, id: seg[1] || null, edit: seg[2] === 'edit', on: q.get('on'), live: q.get('live') === '1', lens: q.get('in') }
	}
	function hashFor(r) {
		let p = r.kind ? `/${r.kind}/${r.id}${r.edit ? '/edit' : ''}` : '/'
		const q = new URLSearchParams()
		if (S.shelf.length) q.set('on', S.shelf.filter((e) => e.visible).map((e) => e.id).join(','))
		if (S.liveOn) q.set('live', '1')
		if (S.lens) q.set('in', S.lens)
		const qs = q.toString()
		return `#${p}${qs ? '?' + qs : ''}`
	}
	function go(kind, id, edit) {
		location.hash = hashFor({ kind, id, edit: !!edit })
	}
	function syncHash() {
		history.replaceState(null, '', hashFor(S.route))
	}
	let pendingEditPrompt = false
	function onRoute() {
		const r = parseHash()
		const prev = S.route
		if (r.on && !prev.kind && S.route.kind === null && !onRoute.done) {
			// First load: honour ?on=
			const ids = r.on.split(',').filter((id) => D.maps[id])
			if (ids.length) S.shelf = ids.map((id) => ({ id, visible: true }))
			S.liveOn = r.live
		}
		if (!onRoute.done && r.lens && D.atlases[r.lens]) { S.lens = r.lens; applyLensTheme() }
		onRoute.done = true
		if (r.kind === 'in') { if (D.atlases[r.id]) enterLens(r.id); else location.hash = '#/'; return }
		if (r.kind === 'browse') S.browse.kind = r.id && BROWSE_KINDS.some((k) => k[0] === r.id) ? r.id : 'maps'
		if (r.kind && !['shelf', 'browse', 'ask', 'in'].includes(r.kind) && !obj(r.kind, r.id)) {
			toast('That link points at nothing here.')
			location.hash = '#/'
			return
		}
		S.route = { kind: r.kind, id: r.id, edit: r.edit }
		S.menu = null
		S.popup = null
		S.resultsOpen = false
		closeTool()
		// Open = margin + canvas. Maps join the Shelf; Stories bring their maps.
		if (r.kind === 'map') {
			addToShelf(r.id, { fly: prev.id !== r.id })
		} else if (r.kind === 'story') {
			const st = D.stories[r.id]
			st.maps.forEach((m) => addToShelf(m, { silent: true }))
			if (prev.id !== r.id) flyToMaps(st.maps)
		} else if (r.kind === 'sighting') {
			S.liveOn = true
			flyTo(bbox([{ type: 'point', coords: obj('sighting', r.id).coords }]), true)
		}
		// Edit is a state of exactly one object.
		if (r.edit && (r.kind === 'map' || r.kind === 'story' || r.kind === 'atlas')) {
			if (S.editing && S.editing.id !== r.id && !pendingEditPrompt) {
				pendingEditPrompt = true
				S.route.edit = false
				S.dialog = { type: 'finish-first', next: { kind: r.kind, id: r.id } }
			} else if (!S.editing || S.editing.id !== r.id) {
				beginEdit(r.kind, r.id)
			}
		}
		if (r.kind !== 'map' && r.kind !== 'story' && r.kind !== 'atlas') S.tab = 'details'
		if (!r.edit) { S.selection.clear() }
		if (isMobile() && r.kind && r.kind !== 'browse') S.detent = 'half'
		if (isMobile() && r.kind === 'browse' && S.detent === 'peek') S.detent = 'half'
		render()
	}

	// ------------------------------------------------------------------ shelf
	function addToShelf(id, o = {}) {
		if (!D.maps[id]) return
		const e = S.shelf.find((x) => x.id === id)
		if (e) e.visible = true
		else S.shelf.push({ id, visible: true })
		if (o.fly) flyToMaps([id])
		if (!o.silent) syncHash()
	}
	function removeFromShelf(id) {
		S.shelf = S.shelf.filter((e) => e.id !== id)
		if (S.route.kind === 'map' && S.route.id === id) go(null)
		else { syncHash(); render() }
	}
	function toggleVisible(id) {
		const e = S.shelf.find((x) => x.id === id)
		if (e) e.visible = !e.visible
		syncHash(); render()
	}

	// ---------------------------------------------------------------- editing
	function beginEdit(kind, id) {
		const o = obj(kind, id)
		if (!o) return
		if (!mine(o) && kind === 'map') { fork(id); return }
		if (!S.drafts[id]) S.drafts[id] = Object.assign(clone(o), { kind, base: o.version || 1, audience: 'everyone', isDraft: true })
		S.editing = { kind, id }
		S.undo = []; S.redo = []
		S.selection.clear()
		if (kind === 'map') addToShelf(id, { silent: true })
		syncHash()
	}
	function fork(id) {
		const src = D.maps[id]
		const nid = `${id}-fork`
		if (!D.maps[nid]) {
			D.maps[nid] = Object.assign(clone(src), { id: nid, title: `${src.title} (my copy)`, author: 'me', published: null, version: 0, forkOf: id, features: clone(src.features) })
		}
		toast(`Forked “${src.title}”. You are editing your copy.`)
		S.shelf = S.shelf.filter((e) => e.id !== id)
		location.hash = hashFor({ kind: 'map', id: nid, edit: true })
	}
	function endEdit(keep) {
		if (!S.editing) return
		const { kind, id } = S.editing
		if (!keep) delete S.drafts[id]
		S.editing = null
		S.proposal = null
		S.selection.clear()
		closeTool()
		if (S.route.edit && S.route.id === id) location.hash = hashFor({ kind, id, edit: false })
		else { syncHash(); render() }
		if (keep) toast('Draft kept. Resume it from Drafts.')
	}
	function publish(mode) {
		const { kind, id } = S.editing
		const d = S.drafts[id]
		const aud = d.audience === 'everyone' ? 'Everyone' : d.audience === 'circle' ? 'Circle: Alpine rescue' : 'Nearby: Saturday survey'
		let target = obj(kind, id)
		if (kind === 'map' && mode === 'new') {
			const nid = `map-${++S.counter}`
			D.maps[nid] = Object.assign(clone(d), { id: nid, author: 'me', version: 1, published: today, isDraft: false })
			delete D.maps[nid].kind; delete D.maps[nid].base; delete D.maps[nid].audience
			delete S.drafts[id]; S.editing = null; S.proposal = null
			S.shelf = S.shelf.map((e) => (e.id === id ? { id: nid, visible: true } : e))
			toast(`Published as new map to ${aud}.`)
			location.hash = hashFor({ kind: 'map', id: nid, edit: false })
			return
		}
		const patch = clone(d); delete patch.kind; delete patch.base; delete patch.audience; delete patch.isDraft
		Object.assign(target, patch, { version: (target.version || 0) + 1, published: today, draft: false })
		delete S.drafts[id]
		S.editing = null; S.proposal = null; S.selection.clear(); closeTool()
		toast(`Published update to ${aud} · v${target.version}`)
		location.hash = hashFor({ kind, id, edit: false })
	}
	function pushUndo() {
		const d = S.drafts[S.editing.id]
		S.undo.push(clone(d.features)); if (S.undo.length > 40) S.undo.shift(); S.redo = []
	}
	function undo() { const d = S.drafts[S.editing.id]; if (!S.undo.length) return; S.redo.push(clone(d.features)); d.features = S.undo.pop(); render() }
	function redo() { const d = S.drafts[S.editing.id]; if (!S.redo.length) return; S.undo.push(clone(d.features)); d.features = S.redo.pop(); render() }

	// -------------------------------------------------------------- proposals
	function applyProposal(picked) {
		const p = S.proposal
		if (!p) return
		if (p.kind === 'map') {
			const d = S.drafts[p.mapId]; pushUndo()
			const want = (f) => !picked || picked.has(f.id)
			p.add.filter(want).forEach((f) => d.features.push(f))
			p.modify.filter(want).forEach((m) => { const f = d.features.find((x) => x.id === m.id); if (f) Object.assign(f.props, m.props) })
			p.remove.filter((id) => !picked || picked.has(id)).forEach((id) => { d.features = d.features.filter((f) => f.id !== id) })
			toast(`Applied ${p.add.length + p.modify.length + p.remove.length} changes to “${d.title}”.`, { label: 'Undo', fn: undo })
		} else if (p.kind === 'story') {
			const d = S.drafts[p.storyId]
			d.body.splice(p.insertAfter + 1, 0, p.para)
			toast('Paragraph added to the draft.')
		} else if (p.kind === 'atlas') {
			const d = S.drafts[p.atlasId]
			if (p.pins) p.pins.forEach((id) => { if (!d.pinned.includes(id)) d.pinned.push(id) })
			if (p.description) d.description = p.description
			toast('Atlas draft updated.')
		}
		S.proposal = null; S.reviewOpen = false; S.onlyChanges = false
		render()
	}
	function discardProposal() { S.proposal = null; S.reviewOpen = false; S.onlyChanges = false; render(); toast('Proposal discarded.') }

	// ----------------------------------------------------------------- thread
	function thread(k) { return (S.threads[k] = S.threads[k] || []) }
	function canned(kind, o, text) {
		const t = text.toLowerCase()
		const now = () => Math.round(400 + Math.random() * 900)
		if (kind === 'map') {
			const b = bbox(o.features)
			if (/stop|bus|between/.test(t) && o.id.startsWith('hippie')) {
				const line = o.features.find((f) => f.type === 'line')
				const add = line.coords.filter((_, i) => i % 6 === 3).slice(0, 5).map((c, i) => ({ id: `bus-${Date.now()}-${i}`, name: ['Erzurum', 'Qazvin', 'Nishapur', 'Ghazni', 'Jalalabad'][i], type: 'point', coords: [r3(c[0]), r3(c[1] - 0.4)], props: { kind: 'bus stop' } }))
				return { op: `Drew ${add.length} bus stops between Istanbul and Kabul`, details: [['wikipedia_extract · Hippie trail § Route', now()], ['geocode × 5', now()], ['commit_dataset (+5)', 40]], proposal: { kind: 'map', mapId: o.id, add, modify: [], remove: [] } }
			}
			if (/recolo|translate|rename|colour|color/.test(t)) {
				const ids = S.selection.size ? Array.from(S.selection) : o.features.filter((f) => f.type === 'point').slice(0, 6).map((f) => f.id)
				return { op: `Recoloured and renamed ${ids.length} selected features`, details: [['get_selection', 12], ['translate × ' + ids.length, now()], ['set_properties (~' + ids.length + ')', 30]], proposal: { kind: 'map', mapId: o.id, add: [], modify: ids.map((id) => ({ id, props: { color: '#B7791F', translated: true } })), remove: [] } }
			}
			if (/remove|delete|drop/.test(t)) {
				const ids = S.selection.size ? Array.from(S.selection) : o.features.filter((f) => f.type === 'point').slice(-2).map((f) => f.id)
				return { op: `Removed ${ids.length} features`, details: [['find_features', 20], ['delete_features (−' + ids.length + ')', 18]], proposal: { kind: 'map', mapId: o.id, add: [], modify: [], remove: ids } }
			}
			const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2
			const sp = Math.max(0.05, (b[2] - b[0]) / 12)
			const add = [0, 1, 2].map((i) => ({ id: `ai-${Date.now()}-${i}`, name: ['Waypoint A', 'Waypoint B', 'Waypoint C'][i], type: 'point', coords: [r3(cx + (i - 1) * sp), r3(cy - sp * (0.6 + i * 0.2))], props: { source: 'wikipedia' } }))
			return { op: 'Researched 2 sources and drew 3 points', details: [['web_search (searxng, wikipedia)', now()], ['geocode × 3', now()], ['commit_dataset (+3)', 32]], proposal: { kind: 'map', mapId: o.id, add, modify: [], remove: [] } }
		}
		if (kind === 'story') {
			const map = D.maps[o.maps[0]]
			const feats = map.features.filter((f) => f.type === 'point')
			const pick = feats.find((f) => t.includes(f.name.toLowerCase())) || feats[3] || feats[0]
			const refs = [{ map: map.id, feature: pick.id, label: pick.name }]
			if (feats[7] && !refs.some((r) => r.feature === feats[7].id)) refs.push({ map: map.id, feature: feats[7].id, label: feats[7].name })
			const para = /summar/.test(t)
				? { type: 'p', text: `This story rests on ${o.maps.length} map${o.maps.length > 1 ? 's' : ''}: ${o.maps.map((m) => D.maps[m].title).join(' and ')}. Between them they hold ${o.maps.reduce((n, m) => n + D.maps[m].features.length, 0)} features, from ${pick.name} outward.`, refs }
				: { type: 'p', text: `${pick.name} was where the trail slowed down. Visas took a week, sometimes two, and the cheap hotels near the bus station filled with people waiting for the same stamp. The route only made sense because everyone waited in the same places.`, refs }
			return { op: `Drafted a paragraph with ${refs.length} feature references`, details: [['read_story', 10], ['find_features (' + map.title + ')', 24], ['propose_text (+1 ¶)', 18]], proposal: { kind: 'story', storyId: o.id, insertAfter: o.body.length - 1, para } }
		}
		if (kind === 'atlas') {
			const mem = atlasMembers(o)
			if (/lack|missing|which/.test(t)) {
				const keys = (o.schemaFields || []).map((f) => f.key)
				const lacking = [...mem.pinned, ...mem.added, ...mem.waiting].filter((m) => keys.some((k) => !(m.props && m.props[k])))
				return { op: `Checked ${mem.pinned.length + mem.added.length + mem.waiting.length} maps: ${lacking.length} lack ${keys.map((k) => '“' + k + '”').join(' or ')}`, text: lacking.length ? `Incomplete: ${lacking.map((m) => m.title).join(', ')}. I can draft proposals to their authors.` : 'Every map here fits the schema.', details: [['list_atlas_members', 14], ['validate_schema × ' + (mem.pinned.length + mem.added.length + mem.waiting.length), 210]] }
			}
			if (/pin|accept|add/.test(t) && mem.waiting.length) {
				return { op: `Proposed pinning ${mem.waiting.length} waiting map${mem.waiting.length > 1 ? 's' : ''}`, details: [['list_waiting', 12], ['propose_pin × ' + mem.waiting.length, 20]], proposal: { kind: 'atlas', atlasId: o.id, pins: mem.waiting.map((m) => m.id) } }
			}
			return { op: 'Rewrote the description', details: [['read_atlas', 8], ['propose_text', 380]], proposal: { kind: 'atlas', atlasId: o.id, description: `${o.description.split('.')[0]}. Pinned: ${mem.pinned.map((m) => m.title).join(', ') || 'nothing yet'}. ${policyText(o.policy)}.` } }
		}
		return { op: 'Answered', text: 'This sketch only knows a few canned moves. Try one of the suggestions.' }
	}
	function send(text) {
		const { kind, id } = S.route
		if (!kind || !obj(kind, id)) return
		const o = obj(kind, id)
		const k = key(kind, id)
		const inEdit = S.editing && S.editing.id === id
		// Binding happens in the send gesture, never before.
		if (!inEdit && (kind === 'map' || kind === 'story' || kind === 'atlas') && (mine(o) || kind === 'map')) {
			if (S.editing && S.editing.id !== id) { S.dialog = { type: 'finish-first', next: { kind, id }, thenSend: text }; render(); return }
			if (!mine(o) && kind === 'map') { thread(k).push({ role: 'user', text }); fork(id); return }
			beginEdit(kind, id)
			location.hash = hashFor({ kind, id, edit: true })
		}
		const target = view(kind, id)
		const t = thread(k)
		t.push({ role: 'user', text, refs: S.refs.slice(), scope: S.selection.size })
		S.refs = []
		const placeholder = { role: 'ai', working: true }
		t.push(placeholder)
		S.run = { key: k, id }
		render()
		setTimeout(() => {
			const r = canned(kind, target, text)
			const i = t.indexOf(placeholder)
			t[i] = { role: 'ai', op: r.op, text: r.text, details: r.details || [] }
			S.run = null
			if (r.proposal) {
				if (S.safety === 'auto') { S.proposal = r.proposal; applyProposal(); return }
				S.proposal = r.proposal
				S.reviewOpen = S.safety === 'every'
			}
			render()
		}, 1300)
	}

	// --------------------------------------------------------------- concierge
	function startMapFrom(q) {
		const nid = `map-${++S.counter}`
		const [cx, cy] = screenToWorld(innerWidth / 2, innerHeight / 2)
		D.maps[nid] = { id: nid, kind: 'map', title: q.replace(/\?$/, '').slice(0, 48), author: 'me', published: null, version: 0, summary: '', topics: [], belongsTo: S.lens ? [S.lens] : [], size: '1 KB', props: {}, features: [0, 1, 2].map((i) => ({ id: `s${i}`, name: `Result ${i + 1}`, type: 'point', coords: [r3(cx - 0.6 + i * 0.6), r3(cy + (i % 2) * 0.3)], props: {} })) }
		const moved = S.ask.msgs.length ? S.ask.msgs.slice() : [{ role: 'user', text: q }, { role: 'ai', text: conciergeAnswer(q.toLowerCase()) }]
		thread(key('map', nid)).push(...moved, { role: 'ai', text: `I moved our conversation into this map and put three candidate points down so you can edit them.`, op: 'Started a map from the question', details: [['web_search', 640], ['geocode × 3', 280], ['commit_dataset (+3)', 30]] })
		S.ask.msgs = []
		S.query = ''; S.resultsOpen = false; S.tab = 'thread'
		location.hash = hashFor({ kind: 'map', id: nid, edit: true })
	}

	// ------------------------------------------------------------------- misc
	function toast(msg, action) {
		const el = document.createElement('div')
		el.className = 'toast'
		el.innerHTML = esc(msg) + (action ? ` <button>${esc(action.label)}</button>` : '')
		if (action) $('button', el).onclick = () => { action.fn(); el.remove() }
		$('#toasts').appendChild(el)
		setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300) }, 3200)
	}
	function openMenu(type, anchor, data) {
		const r = anchor.getBoundingClientRect()
		S.menu = { type, x: r.left, right: innerWidth - r.right, y: r.bottom + 6, data: data || {} }
		render()
	}
	function closeMenus() { S.menu = null; render() }
	function closeTool() { S.tool = null; S.drawing = [] }
	function thumb(features, w = 160, h = 90) {
		const b = bbox(features); const pad = 12
		const vw = Math.max(b[2] - b[0], 40) + pad * 2, vh = Math.max(b[3] - b[1], 24) + pad * 2
		const inner = features.map((f) => f.type === 'point'
			? `<circle cx="${f.coords[0]}" cy="${f.coords[1]}" r="${vw / 60}" fill="var(--working)"/>`
			: `<path d="M${f.coords.map((c) => c.join(' ')).join(' L')}${f.type === 'polygon' ? ' Z' : ''}" fill="${f.type === 'polygon' ? 'var(--working)' : 'none'}" fill-opacity=".3" stroke="var(--working)" stroke-width="${vw / 90}"/>`).join('')
		return `<svg viewBox="${b[0] - pad} ${b[1] - pad} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" width="${w}" height="${h}">${inner}</svg>`
	}

	// ------------------------------------------------------------- rendering
	function render() {
		renderTopbar(); renderMargin(); renderCanvas(); renderShelf(); renderToolpill(); renderDiffbar(); renderMenus(); renderDialog(); renderMobile(); renderStatus()
		document.body.classList.toggle('glass', !!S.glass)
		renderLensBar()
		const stage = $('#stage')
		stage.classList.toggle('margin-open', !!S.route.kind || S.route.kind === null && !!landingOpen())
		stage.classList.toggle('thread-side', sideThreadActive())
		$('#margin').dataset.detent = S.detent
		if (isMobile()) {
			const h = S.detent === 'peek' ? '96px' : S.detent === 'half' ? '50%' : 'calc(100% - 64px)'
			$('#margin').style.setProperty('--sheet-h', h)
			const px = S.detent === 'peek' ? 96 : S.detent === 'half' ? innerHeight * 0.5 : innerHeight - 64
			document.documentElement.style.setProperty('--sheet-peek', (S.route.kind ? px : 0) + 'px')
		} else $('#margin').style.removeProperty('--sheet-h')
	}
	function landingOpen() { return true }
	function lensBarHtml() {
		const a = lensAtlas()
		if (!a) return ''
		const mem = atlasMembers(a)
		return `<span class="emblem">${esc(a.emblem || '◈')}</span><span class="lt"><b>${esc(a.title)}</b><span class="ls">${mem.pinned.length + mem.added.length} ${noun(a, 2)} · ${esc(policyText(a.policy))}${mine(a) ? '' : ' · by ' + esc(person(a.author).name)}</span></span><span class="lrule">Lists show only this atlas. New ${noun(a, 2)} belong here.</span><button class="btn sm quiet" data-act="open" data-kind="atlas" data-id="${a.id}">About</button><button class="btn sm quiet" data-act="menu" data-menu="share">Share app link</button><button class="btn sm" data-act="leave-lens">Leave ×</button>`
	}
	function renderLensBar() {
		const bar = $('#lensbar'); const a = lensAtlas()
		bar.hidden = !a
		bar.innerHTML = a ? lensBarHtml() : ''
		document.documentElement.style.setProperty('--lens-h', a && !isMobile() ? '38px' : '0px')
	}

	function renderTopbar() {
		$('#search').innerHTML = searchHtml()
		const drafts = Object.keys(S.drafts).length
		$('#topright').innerHTML = `
			<button class="btn quiet ${S.route.kind === 'browse' || !S.route.kind ? 'on' : ''}" data-act="open" data-kind="browse" data-id="${S.browse.kind}">Browse</button>
			<button class="btn quiet" data-act="menu" data-menu="drafts">Drafts ${drafts ? `<span class="badge">${drafts}</span>` : ''}</button>
			<button class="btn quiet" data-act="menu" data-menu="me" aria-label="Me"><span class="avatar sm">YO</span> Me</button>
			<button class="btn quiet sm" data-act="about" title="About this sketch" aria-label="About this sketch">?</button>`
	}
	function searchHtml() {
		const f = S.filter
		return `<div class="field">
			<span class="muted">⌕</span>
			${f ? `<span class="filter">Browsing ${esc(f.label)} <button data-act="clear-filter" aria-label="Clear filter">×</button></span>` : ''}
			<input id="q" type="search" placeholder="${lensAtlas() ? 'Search ' + esc(noun(lensAtlas(), 2)) + ' in ' + esc(lensAtlas().title) + '… or ask' : f ? 'Search in ' + esc(f.label) + '…' : 'Search maps, stories, atlases, people… or ask a question'}" value="${esc(S.query)}" autocomplete="off">
		</div>
		<div class="results ${S.resultsOpen && S.query ? 'open' : ''}" id="results">${S.query ? resultsHtml(S.query) : ''}</div>`
	}
	function resultsHtml(q) {
		const t = q.toLowerCase().trim()
		const ask = /\?$/.test(t) || /^(how|what|where|which|why|who|when)\b/.test(t)
		const L = lensAtlas()
		const within = (o) => (!L || inAtlas(o, L)) && (!S.filter || S.filter.type !== 'atlas' || (o.kind === 'map' && (o.belongsTo.includes(S.filter.id) || D.atlases[S.filter.id].pinned.includes(o.id))))
		const hit = (s) => String(s || '').toLowerCase().includes(t.replace(/\?$/, ''))
		const groups = [
			['Maps', Object.values(D.maps).filter((m) => within(m) && (hit(m.title) || m.topics.some(hit))).map((m) => ({ kind: 'map', id: m.id, t: m.title, s: `${person(m.author).name} · ${m.features.length} features` }))],
			['Stories', Object.values(D.stories).filter((s) => !S.filter && (!L || s.maps.some((m) => D.maps[m] && inAtlas(D.maps[m], L))) && (hit(s.title) || hit(s.summary))).map((s) => ({ kind: 'story', id: s.id, t: s.title, s: person(s.author).name }))],
			['Atlases', Object.values(D.atlases).filter((a) => !S.filter && !L && hit(a.title)).map((a) => ({ kind: 'atlas', id: a.id, t: a.title, s: policyText(a.policy) }))],
			['People', Object.values(D.people).filter((p) => p.id !== 'me' && hit(p.name)).map((p) => ({ kind: 'person', id: p.id, t: p.name, s: p.handle }))],
			['Places', Object.keys(D.places).filter(hit).map((p) => ({ kind: 'place', id: p, t: p, s: 'Fly there' }))],
		]
		const any = groups.some((g) => g[1].length)
		return `${ask ? `<button class="row" data-act="ask-go" data-q="${esc(q)}" style="background:var(--accent-soft)"><span class="kicon">ask</span><span><div class="t">Ask Earthly: “${esc(q)}”</div><div class="s">Read-only answer in the margin. Nothing is drawn until you start a map from it. ↵</div></span><span class="muted">↵</span></button>` : ''}
		${groups.filter((g) => g[1].length).map(([name, rows]) => `<div class="grp eyebrow">${name}</div>${rows.slice(0, 5).map((r) => `<button class="row" data-act="open" data-kind="${r.kind}" data-id="${esc(r.id)}"><span class="kicon ${r.kind}">${r.kind.slice(0, 3)}</span><span><div class="t">${esc(r.t)}</div><div class="s">${esc(r.s)}</div></span><span class="muted">↵</span></button>`).join('')}`).join('')}
		${!any && !ask ? `<div class="empty" style="padding:.6rem">Nothing matches “${esc(q)}”. End with “?” to ask instead.</div>` : ''}`
	}
	function conciergeAnswer(t) {
		if (/hippie|kabul|istanbul/.test(t)) return 'The Hippie Trail ran roughly 6,000 km from Istanbul to Kathmandu via Tehran and Kabul, mostly 1957–1978. Two maps and one story on Earthly cover it.'
		if (/cable|internet/.test(t)) return 'Around 550 active submarine cables carry over 95% of intercontinental traffic. The Atlantic map here shows seven systems and five landing stations.'
		return 'I can find, measure, geocode and explain without touching any map. To draw, start a map and I will move this conversation into it.'
	}

	// ---- Margin
	function renderMargin() {
		const m = $('#margin')
		const { kind, id, edit } = S.route
		const sideThread = sideThreadActive()
		let html = ''
		if (!kind || kind === 'browse') html = browseHtml()
		else if (kind === 'ask') html = askHtml()
		else if (kind === 'map') html = mapHtml(id, edit, sideThread)
		else if (kind === 'story') html = storyHtml(id, edit, sideThread)
		else if (kind === 'atlas') html = atlasHtml(id, edit, sideThread)
		else if (kind === 'sighting') html = sightingHtml(id)
		else if (kind === 'person') html = personHtml(id)
		else if (kind === 'shelf') html = shelfPageHtml()
		const prevScroll = $('.margin-body', m) ? $('.margin-body', m).scrollTop : 0
		const mk = `${kind}:${id}:${edit}:${S.tab}:${S.browse.kind}`
		const changed = renderMargin.last !== mk
		renderMargin.last = mk
		m.innerHTML = `<div class="handle" data-act="detent" aria-hidden="true" style="height:14px;flex:none;cursor:grab"></div>${html}`
		m.classList.toggle('enter', changed)
		if ($('.margin-body', m) && !changed) $('.margin-body', m).scrollTop = prevScroll
		const tc = $('#threadcol')
		tc.hidden = !sideThread
		if (sideThread) tc.innerHTML = `<div class="margin-head" style="padding-bottom:.35rem"><div class="nav"><span class="eyebrow">Thread · ${esc(kind)}</span><span style="flex:1"></span><button class="btn sm quiet" data-act="thread-dock" title="Show the Thread as a tab of the margin instead">⇤ Dock</button></div></div>${threadHtml(kind, id)}`
		const ta = $('#composer-text'); if (ta) autoGrow(ta)
	}
	function head(o, kind, opts = {}) {
		const p = person(o.author)
		const inEdit = S.editing && S.editing.id === o.id
		const editable = inEdit ? ' contenteditable="true" data-bind="title" spellcheck="false"' : ''
		return `<div class="margin-head">
			<div class="nav"><button class="btn sm quiet" data-act="back">◂ Back</button><span style="flex:1"></span>${opts.nav || ''}<button class="btn sm quiet glassbtn" data-act="glass" data-v="${S.glass ? '0' : '1'}" title="${S.glass ? 'Solid panels' : 'See the map through the panels'}">◐</button></div>
			<div class="sub"><span class="eyebrow">${esc(kind)}</span>${inEdit ? `<span class="state-pill edit">✎ editing${o.forkOf ? ' · fork' : ''}</span>` : o.draft || o.published === null ? '<span class="state-pill draft">draft · unpublished</span>' : `<span class="state-pill">v${o.version || 1} · ${esc(o.published)}</span>`}</div>
			<div class="title"${editable}>${esc(o.title)}</div>
			<div class="sub"><span class="avatar sm">${p.initials}</span><button class="btn sm quiet" style="padding:0 .3rem" data-act="open" data-kind="person" data-id="${p.id}">${esc(p.name)}</button>${opts.sub || ''}</div>
			<div class="actions">${opts.actions || ''}</div>
		</div>`
	}
	function tabsHtml(kind, id, sideThread) {
		if (sideThread) return ''
		const running = S.run && S.run.id === id
		return `<div class="tabs" role="tablist">
			<button role="tab" class="${S.tab === 'details' ? 'on' : ''}" data-act="tab" data-tab="details">Details</button>
			<button role="tab" class="${S.tab === 'thread' ? 'on' : ''}" data-act="tab" data-tab="thread">Thread${running ? '<span class="run"></span>' : ''}</button>
			<span class="spacer"></span>
			${S.tab === 'thread' && !isMobile() && innerWidth >= 1280 ? '<button class="btn sm quiet" data-act="thread-side" title="Pull the thread out to the right">⇥ Pull out</button>' : ''}
		</div>`
	}
	const BROWSE_KINDS = [['maps', 'Maps'], ['stories', 'Stories'], ['atlases', 'Atlases'], ['sightings', 'Sightings'], ['people', 'People']]
	function browseItems(kind) {
		const q = S.browse.q.trim().toLowerCase()
		const hit = (...xs) => !q || xs.some((x) => String(x || '').toLowerCase().includes(q))
		const inFilter = (m) => !S.filter || (S.filter.type === 'atlas' ? m.belongsTo.includes(S.filter.id) || D.atlases[S.filter.id].pinned.includes(m.id) : S.filter.type === 'tag' ? m.topics.includes(S.filter.id) : true)
		let items = []
		const L = lensAtlas()
		if (kind === 'maps') items = Object.values(D.maps).filter((m) => (m.published || mine(m)) && (!L || inAtlas(m, L)) && inFilter(m) && hit(m.title, person(m.author).name, m.topics.join(' '))).map((m) => ({ kind: 'map', id: m.id, title: m.title, author: m.author, date: m.published || 'draft', meta: `${m.features.length} features · ${m.size}${m.topics.length ? ' · #' + m.topics.slice(0, 2).join(' #') : ''}`, feats: m.features, onShelf: S.shelf.some((e) => e.id === m.id) }))
		if (kind === 'stories') items = Object.values(D.stories).filter((st) => (!st.draft || mine(st)) && (!L || st.maps.some((m) => D.maps[m] && inAtlas(D.maps[m], L))) && hit(st.title, st.summary)).map((st) => ({ kind: 'story', id: st.id, title: st.title, author: st.author, date: st.published || 'draft', meta: `${st.maps.length} map${st.maps.length === 1 ? '' : 's'} · ${st.body.filter((b) => b.type === 'p').length} ¶`, feats: st.maps.flatMap((m) => (D.maps[m] || { features: [] }).features) }))
		if (kind === 'atlases') items = Object.values(D.atlases).filter((a) => hit(a.title, a.description)).map((a) => { const mem = atlasMembers(a); return { kind: 'atlas', id: a.id, title: a.title, author: a.author, date: a.published || today, meta: `${mem.pinned.length + mem.added.length} maps · ${policyText(a.policy)}`, feats: mem.pinned.flatMap((m) => m.features) } })
		if (kind === 'sightings') items = D.sightings.filter((x) => hit(x.title, x.note)).map((x) => ({ kind: 'sighting', id: x.id, title: x.title, author: x.author, date: x.when.slice(0, 10), meta: `expires ${x.expires}`, feats: [{ type: 'point', coords: x.coords }] }))
		if (kind === 'people') items = Object.values(D.people).filter((p) => p.id !== 'me' && (!L || Object.values(D.maps).some((m) => m.author === p.id && inAtlas(m, L))) && hit(p.name, p.handle)).map((p) => ({ kind: 'person', id: p.id, title: p.name, author: p.id, date: '', meta: `${Object.values(D.maps).filter((m) => m.author === p.id).length} maps · ${Object.values(D.stories).filter((st) => st.author === p.id).length} stories`, feats: Object.values(D.maps).filter((m) => m.author === p.id).flatMap((m) => m.features) }))
		const sort = S.browse.sort
		items.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'author' ? person(a.author).name.localeCompare(person(b.author).name) || b.date.localeCompare(a.date) : b.date.localeCompare(a.date))
		return items
	}
	function browseRows() {
		const items = browseItems(S.browse.kind)
		if (!items.length) return `<div class="empty" style="padding:.6rem .7rem">Nothing here${S.browse.q ? ` for “${esc(S.browse.q)}”` : ''}${S.filter ? ` in ${esc(S.filter.label)}` : ''}.</div>`
		return items.map((it) => {
			const on = S.route.kind === it.kind && S.route.id === it.id
			const acts = it.kind === 'map'
				? `<button data-act="${it.onShelf ? 'remove-shelf' : 'add-shelf'}" data-id="${it.id}" class="${it.onShelf ? 'on' : ''}" title="${it.onShelf ? 'Remove from map' : 'Show on map'}">${it.onShelf ? '◉' : '○'}</button>${mine(D.maps[it.id]) ? `<button data-act="edit-id" data-kind="map" data-id="${it.id}" title="Edit">✎</button>` : ''}`
				: it.kind === 'story' ? `<button data-act="fly-story" data-id="${it.id}" title="Show its maps">⌖</button>` : it.kind === 'atlas' ? `<button data-act="show-all" data-id="${it.id}" title="Show all on map">⌖</button>` : ''
			return `<div class="lrow ${on ? 'on' : ''}" data-hover-map="${it.kind === 'map' ? it.id : ''}"><div class="thumb">${it.feats.length ? thumb(it.feats, 40, 28) : ''}</div><button class="lmain" data-act="open" data-kind="${it.kind}" data-id="${esc(it.id)}"><div class="t">${esc(it.title)}</div><div class="s">${it.kind === 'person' ? esc(it.meta) : `${esc(person(it.author).name)} · ${esc(it.date)} · ${esc(it.meta)}`}</div></button><div class="act">${acts}</div></div>`
		}).join('')
	}
	function browseKinds() { const L = lensAtlas(); return L ? [['maps', noun(L, 2)[0].toUpperCase() + noun(L, 2).slice(1)], ['stories', 'Stories'], ['people', 'People']] : BROWSE_KINDS }
	function browseHtml() {
		const L = lensAtlas()
		if (L && !browseKinds().some((x) => x[0] === S.browse.kind)) S.browse.kind = 'maps'
		const k = S.browse.kind
		const label = browseKinds().find((x) => x[0] === k)[1]
		return `<div class="margin-head" style="padding-bottom:.3rem"><div class="nav"><span class="eyebrow">${L ? 'Browse · ' + esc(L.title) : 'Browse'}</span><span style="flex:1"></span>${S.filter ? `<span class="chip">in ${esc(S.filter.label)} <button class="x" data-act="clear-filter">×</button></span>` : ''}<button class="btn sm quiet" data-act="open" data-kind="shelf" data-id="now">On the map · ${S.shelf.length}</button><button class="btn sm quiet glassbtn" data-act="glass" data-v="${S.glass ? '0' : '1'}" title="Toggle glass panels">◐</button></div><div class="title">${esc(label)}</div>${L && k === 'maps' ? `<div class="muted" style="font-size:.8rem">${L.schemaFields ? 'Each ' + esc(noun(L, 1)) + ' map carries ' + L.schemaFields.map((f) => '<b>' + esc(f.label.toLowerCase()) + '</b>').join(' and ') + '.' : 'Anything that says it belongs here.'} <button class="btn sm primary" style="margin-left:.4rem" data-act="new-map">New ${esc(noun(L, 1))} map</button></div>` : ''}</div>
		<div class="ktabs" role="tablist">${browseKinds().map(([id, name]) => `<button role="tab" class="${k === id ? 'on' : ''}" data-act="browse-kind" data-k="${id}">${name}<span class="n">${browseItems(id).length}</span></button>`).join('')}</div>
		<div class="ltools"><input id="bq" type="search" placeholder="Filter ${label.toLowerCase()}…" value="${esc(S.browse.q)}"><select id="bsort" aria-label="Sort"><option value="new" ${S.browse.sort === 'new' ? 'selected' : ''}>Newest</option><option value="title" ${S.browse.sort === 'title' ? 'selected' : ''}>Title</option><option value="author" ${S.browse.sort === 'author' ? 'selected' : ''}>Author</option></select></div>
		<div class="lhead"><span>${browseItems(k).length} ${label.toLowerCase()}</span><span class="sp"></span><span>${k === 'maps' ? '○ show on map · ✎ edit' : k === 'stories' || k === 'atlases' ? '⌖ frame on map' : ''}</span></div>
		<div class="margin-body" style="padding:0"><div class="lrows" id="lrows">${browseRows()}</div></div>`
	}
	function askFrom(q) {
		const t = q.trim(); if (!t) return
		S.ask.msgs.push({ role: 'user', text: t }, { role: 'ai', text: conciergeAnswer(t.toLowerCase()), op: 'Looked it up, read-only', details: [['web_search (searxng, wikipedia)', 520], ['geocode', 140]] })
		S.query = ''; S.resultsOpen = false
		if (S.route.kind === 'ask') render(); else location.hash = '#/ask/now'
		const ta = $('#askq'); if (ta) ta.value = ''
	}
	function askHtml() {
		const msgs = S.ask.msgs
		return `<div class="askhead"><div class="nav" style="display:flex;align-items:center;gap:.4rem"><button class="btn sm quiet" data-act="back">◂ Back</button><span style="flex:1"></span><span class="state-pill">read-only · concierge</span></div><div class="title">Ask Earthly</div><div class="muted" style="font-size:.82rem">Find, measure, geocode, explain. Nothing is drawn or changed from here.</div></div>
		<div class="thread"><div class="msgs" id="msgs">${msgs.length ? msgs.map(msgHtml).join('') : '<div class="empty">Ask anything about places or about what is on Earthly.</div>'}</div>
		${msgs.length ? `<div class="askcta"><span class="grow">Want this on a map? A new Map opens in Edit and this conversation moves into its Thread.</span><button class="btn sm primary" data-act="start-map" data-q="${esc(msgs[0].text)}">Start a map from this</button></div>` : ''}
		<div class="composer"><div class="box"><textarea id="askq" rows="1" placeholder="Ask a question…"></textarea><button class="btn sm primary" data-act="ask-send">Ask</button></div><div class="hint">${['Where did the Hippie Trail cross into Afghanistan?', 'How many submarine cables land in Bilbao?', 'What is near Klagenfurt from Roman times?'].map((h) => `<button data-act="ask-hint" data-text="${esc(h)}">${esc(h)}</button>`).join('')}${msgs.length ? '<button data-act="ask-clear">Clear</button>' : ''}</div></div></div>`
	}
	function landingHtml() {
		const cards = (list, kind) => list.map((o) => `<button class="card" data-act="open" data-kind="${kind}" data-id="${o.id}"><div class="thumb">${thumb(kind === 'map' ? o.features : kind === 'story' ? o.maps.flatMap((m) => D.maps[m].features) : o.pinned.flatMap((m) => (D.maps[m] || { features: [] }).features))}</div><div class="cb"><div class="t">${esc(o.title)}</div><div class="s">${esc(person(o.author).name)}${kind === 'atlas' ? ' · ' + esc(policyText(o.policy)) : ''}</div></div></button>`).join('')
		return `<div class="margin-head"><div class="nav"><span class="eyebrow">Discover</span><span style="flex:1"></span><button class="btn sm quiet" data-act="open" data-kind="shelf" data-id="now">On the map ▸</button></div><div class="title">Maps people made</div><div class="sub">Open one to read it. Press Edit to make it yours.</div></div>
		<div class="margin-body">
			<div class="section"><h4>Stories</h4><div class="gallery">${cards(Object.values(D.stories).filter((s) => !s.draft), 'story')}</div></div>
			<div class="section"><h4>Maps</h4><div class="gallery">${cards(Object.values(D.maps).filter((m) => m.published), 'map')}</div></div>
			<div class="section"><h4>Atlases</h4><div class="gallery">${cards(Object.values(D.atlases), 'atlas')}</div></div>
		</div>`
	}
	function shelfPageHtml() {
		return `<div class="margin-head"><div class="nav"><button class="btn sm quiet" data-act="back">◂ Back</button></div><div class="title">On the map</div><div class="sub">${S.shelf.length} map${S.shelf.length === 1 ? '' : 's'} on the Shelf</div><div class="actions"><button class="btn sm" data-act="save-view">Save this view as an Atlas</button></div></div>
		<div class="margin-body"><div class="list">${S.shelf.map((e) => { const m = D.maps[e.id]; return `<div class="item"><div class="thumb">${thumb(m.features)}</div><button style="text-align:left" data-act="open" data-kind="map" data-id="${m.id}"><div class="t">${esc(m.title)}</div><div class="s">${esc(person(m.author).name)} · ${m.features.length} features</div></button><div class="act"><button class="btn sm quiet" data-act="toggle-vis" data-id="${m.id}">${e.visible ? '◉' : '○'}</button><button class="btn sm quiet" data-act="remove-shelf" data-id="${m.id}">×</button></div></div>` }).join('') || '<div class="empty">Nothing on the map. Open a Map or Story.</div>'}</div></div>`
	}
	function mapHtml(id, edit, sideThread) {
		const m = view('map', id)
		const pub = D.maps[id]
		const inEdit = S.editing && S.editing.id === id
		const onShelf = S.shelf.some((e) => e.id === id)
		const actions = inEdit
			? `<span class="split"><button class="btn primary keep" data-act="publish" data-mode="${pub.published ? 'update' : 'new'}">${pub.published ? 'Publish update' : 'Publish'}</button><button class="btn primary keep" data-act="menu" data-menu="publish" aria-label="Publish options">▾</button></span><button class="btn keep" data-act="done">Done</button>`
			: `${mine(pub) ? `<button class="btn primary keep" data-act="edit">Edit</button>` : `<button class="btn primary keep" data-act="edit">Fork</button>`}<button class="btn" data-act="menu" data-menu="share">Share</button><button class="btn" data-act="${onShelf ? 'remove-shelf' : 'add-shelf'}" data-id="${id}">${onShelf ? 'Remove from map' : 'Show on map'}</button>`
		const stories = storiesReferencing(id)
		const details = `<div class="margin-body">
			<div class="section">${inEdit ? `<textarea data-bind="summary" rows="3" placeholder="What is this map?">${esc(m.summary)}</textarea>` : `<p>${esc(m.summary) || '<span class="muted">No description.</span>'}</p>`}</div>
			<div class="section"><h4>Belongs to <span class="sp"></span>${inEdit ? '' : `<span class="muted" style="font-weight:400;letter-spacing:0;text-transform:none">edit the map to change</span>`}</h4>
				<div class="chips">${m.belongsTo.map((aid) => { const a = D.atlases[aid]; if (!a) return ''; const f = fitState(m, a); return `<span class="chip ${f.cls}" title="${esc(policyText(a.policy))}"><button style="display:contents" data-act="open" data-kind="atlas" data-id="${aid}">${esc(f.text)}</button>${inEdit ? `<button class="x" data-act="belong-remove" data-id="${aid}" aria-label="Remove">×</button>` : ''}</span>` }).join('')}
				${inEdit ? `<button class="chip add" data-act="dialog" data-dialog="add-to-atlas">+ Add to atlas…</button>` : m.belongsTo.length ? '' : '<span class="empty">Not in any atlas.</span>'}</div></div>
			${schemaFor(m).length ? `<div class="section"><h4>Properties <span class="sp"></span><span class="muted" style="font-weight:400;letter-spacing:0;text-transform:none">from ${esc([...new Set(schemaFor(m).map((f) => f.atlas))].join(', '))}</span></h4><dl class="kv">${schemaFor(m).map((f) => `<dt>${esc(f.label)}</dt><dd>${inEdit ? `<select data-bind-prop="${esc(f.key)}"><option value="">—</option>${f.options.map((o) => `<option ${m.props[f.key] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : esc(m.props[f.key] || '') || '<span style="color:var(--amber)">missing</span>'}</dd>`).join('')}</dl></div>` : ''}
			<div class="section"><h4>Topics</h4><div class="chips">${m.topics.map((t) => `<button class="chip" data-act="filter-tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}${inEdit ? `<button class="chip add" data-act="add-topic">+ topic</button>` : ''}</div></div>
			<div class="section"><h4>Appears in</h4>${stories.length ? `<div class="list">${stories.map((s) => `<button class="item" data-act="open" data-kind="story" data-id="${s.id}"><span class="kicon story">sto</span><span style="text-align:left"><div class="t">${esc(s.title)}</div><div class="s">${esc(person(s.author).name)}</div></span><span></span></button>`).join('')}</div>` : '<div class="empty">No story references this map yet.</div>'}</div>
			<div class="section"><h4>About</h4><dl class="kv"><dt>Features</dt><dd>${m.features.length}</dd><dt>Size</dt><dd>${esc(m.size)}</dd><dt>Version</dt><dd>${pub.version || 0}${inEdit ? ' → ' + ((pub.version || 0) + 1) + ' on publish' : ''}</dd><dt>Audience</dt><dd>${inEdit ? esc(audienceLabel(S.drafts[id].audience)) : 'Everyone'}</dd>${pub.forkOf ? `<dt>Forked from</dt><dd><button class="btn sm quiet" data-act="open" data-kind="map" data-id="${pub.forkOf}">${esc(D.maps[pub.forkOf].title)}</button></dd>` : ''}</dl></div>
			${inEdit ? `<div class="section"><h4>Danger</h4><button class="btn sm danger" data-act="dialog" data-dialog="discard">Discard this draft</button></div>` : mine(pub) ? `<div class="section"><h4>Danger</h4><button class="btn sm danger" data-act="dialog" data-dialog="delete">Delete map…</button></div>` : ''}
		</div>`
		return head(m, 'map', { actions, sub: `<span class="muted">· ${m.features.length} features${stories.length ? ` · in ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'}` : ''}</span>` }) + tabsHtml('map', id, sideThread) + (S.tab === 'thread' && !sideThread ? threadHtml('map', id) : details)
	}
	function audienceLabel(a) { return a === 'circle' ? 'Circle: Alpine rescue' : a === 'nearby' ? 'Nearby: Saturday survey' : 'Everyone' }
	function storyHtml(id, edit, sideThread) {
		const s = view('story', id)
		const pub = D.stories[id]
		const inEdit = S.editing && S.editing.id === id
		const actions = inEdit
			? `<span class="split"><button class="btn primary keep" data-act="publish" data-mode="update">${pub.published ? 'Publish update' : 'Publish'}</button><button class="btn primary keep" data-act="menu" data-menu="publish">▾</button></span><button class="btn keep" data-act="done">Done</button>`
			: `${mine(pub) ? `<button class="btn primary keep" data-act="edit">Edit</button>` : `<button class="btn primary keep" data-act="propose">Propose an edit</button>`}<button class="btn" data-act="menu" data-menu="share">Share</button>`
		const p = S.proposal && S.proposal.kind === 'story' && S.proposal.storyId === id ? S.proposal : null
		const body = s.body.map((b, i) => (b.type === 'h' ? `<h5${inEdit ? ' contenteditable="true"' : ''}>${esc(b.text)}</h5>` : `<p${inEdit ? ' contenteditable="true"' : ''}>${esc(b.text)} ${(b.refs || []).map((r) => refChip(r)).join(' ')}</p>`) + (p && p.insertAfter === i ? `<p class="ins">${esc(p.para.text)} ${p.para.refs.map((r) => refChip(r)).join(' ')}</p>` : '')).join('')
		const details = `<div class="margin-body">
			${p ? `<div class="diffbar-margin"><span class="grow">+1 paragraph · ${p.para.refs.length} references</span><button class="btn sm primary" data-act="apply">Apply</button><button class="btn sm" data-act="discard">Discard</button></div>` : ''}
			<div class="prose">${body}</div>
			<div class="section" style="margin-top:1rem"><h4>Maps in this story</h4><div class="list">${s.maps.map((mid) => { const m = D.maps[mid]; return `<div class="item"><div class="thumb">${thumb(m.features)}</div><button style="text-align:left" data-act="open" data-kind="map" data-id="${mid}"><div class="t">${esc(m.title)}</div><div class="s">${m.features.length} features</div></button><button class="btn sm quiet" data-act="fly-map" data-id="${mid}" title="Frame on the map">⌖</button></div>` }).join('')}${inEdit ? `<button class="chip add" data-act="dialog" data-dialog="pick-map" data-for="story">+ Reference a map</button>` : ''}</div></div>
		</div>`
		return head(s, 'story', { actions, sub: `<span class="muted">· ${s.maps.length} map${s.maps.length === 1 ? '' : 's'}</span>` }) + tabsHtml('story', id, sideThread) + (S.tab === 'thread' && !sideThread ? threadHtml('story', id) : details)
	}
	function refChip(r) {
		const m = D.maps[r.map]; const f = m && m.features.find((x) => x.id === r.feature)
		return `<span class="ref" data-act="ref" data-map="${r.map}" data-fid="${esc(r.feature || '')}" data-hover-map="${r.map}" title="${esc(m ? m.title : '')}">⌖ ${esc(r.label || (f ? f.name : m ? m.title : 'reference'))}</span>`
	}
	function atlasHtml(id, edit, sideThread) {
		const a = view('atlas', id)
		const pub = D.atlases[id]
		const inEdit = S.editing && S.editing.id === id
		const mem = atlasMembers(a)
		const p = S.proposal && S.proposal.kind === 'atlas' && S.proposal.atlasId === id ? S.proposal : null
		const actions = inEdit
			? `<span class="split"><button class="btn primary keep" data-act="publish" data-mode="update">Publish update</button><button class="btn primary keep" data-act="menu" data-menu="publish">▾</button></span><button class="btn keep" data-act="done">Done</button>`
			: `${mine(pub) ? `<button class="btn primary keep" data-act="edit">Edit</button>` : ''}<span class="split"><button class="btn keep" data-act="menu" data-menu="add-map">Add a map</button><button class="btn keep" data-act="menu" data-menu="add-map">▾</button></span><button class="btn" data-act="show-all" data-id="${id}">Show all on map</button>${S.lens === id ? `<button class="btn keep" data-act="leave-lens">Leave atlas</button>` : `<button class="btn keep" data-act="enter-lens" data-id="${id}" title="Only this atlas in lists and search; new maps belong here">Enter atlas ▸</button>`}<button class="btn" data-act="menu" data-menu="share">Share</button>`
		const row = (m, acts) => `<div class="item"><div class="thumb">${thumb(m.features)}</div><button style="text-align:left" data-act="open" data-kind="map" data-id="${m.id}"><div class="t">${esc(m.title)}</div><div class="s">${esc(person(m.author).name)} · ${m.features.length} features${p && p.pins && p.pins.includes(m.id) ? ' · <span style="color:var(--amber)">will be pinned</span>' : ''}</div></button><div class="act">${acts}</div></div>`
		const details = `<div class="margin-body">
			${p ? `<div class="diffbar-margin"><span class="grow">${p.pins ? `pin ${p.pins.length}` : 'new description'}</span><button class="btn sm primary" data-act="apply">Apply</button><button class="btn sm" data-act="discard">Discard</button></div>` : ''}
			<div class="section">${inEdit ? `<textarea data-bind="description" rows="3">${esc(a.description)}</textarea>` : `<p>${esc(p && p.description ? p.description : a.description)}</p>`}${p && p.description ? '<p class="ins" style="font-size:.85rem">Proposed description shown above.</p>' : ''}</div>
			<div class="section"><h4>Who can add maps here</h4>${inEdit ? `<div class="policy">${[['open', 'Anyone', 'Maps appear as soon as they say they belong.'], ['schema', 'Anyone, if the map fits the schema', `Requires ${(a.schemaFields || []).map((f) => '“' + esc(f.key) + '”').join(' and ') || 'the schema fields'}. Others wait until they fit.`], ['closed', 'Only me', 'Maps that ask to belong wait until I pin them.']].map(([v, t, s]) => `<label class="${a.policy === v ? 'on' : ''}"><input type="radio" name="policy" value="${v}" ${a.policy === v ? 'checked' : ''} data-bind="policy"><span>${t}<small>${s}</small></span></label>`).join('')}</div>` : `<p>${esc(policyText(a.policy))}${a.policy === 'schema' && a.schemaFields ? ` · needs ${a.schemaFields.map((f) => `<code class="mono">${esc(f.key)}</code>`).join(', ')}` : ''}.</p>`}</div>
			<div class="section"><h4>Pinned <span class="muted" style="letter-spacing:0">${mem.pinned.length}</span></h4><div class="list">${mem.pinned.map((m) => row(m, inEdit ? `<button class="btn sm quiet" data-act="unpin" data-id="${m.id}" title="Unpin">⊘</button>` : `<button class="btn sm quiet" data-act="fly-map" data-id="${m.id}">⌖</button>`)).join('') || '<div class="empty">Nothing pinned yet.</div>'}</div></div>
			<div class="section"><h4>Added by others <span class="muted" style="letter-spacing:0">${mem.added.length}</span></h4><div class="list">${mem.added.map((m) => row(m, `${inEdit || mine(pub) ? `<button class="btn sm quiet" data-act="pin" data-id="${m.id}" title="Pin">⊕</button>` : ''}<button class="btn sm quiet" data-act="fly-map" data-id="${m.id}">⌖</button>`)).join('') || '<div class="empty">No one has added a map yet.</div>'}</div></div>
			${mine(pub) ? `<div class="section"><h4>Waiting <span class="muted" style="letter-spacing:0">${mem.waiting.length}</span></h4><div class="list">${mem.waiting.map((m) => row(m, `<button class="btn sm" data-act="pin" data-id="${m.id}">Pin · accept</button>`)).join('') || '<div class="empty">Nothing waiting.</div>'}</div><p class="muted" style="font-size:.8rem;margin:.4rem 0 0">Maps that say they belong here but don’t fit the policy yet. Pinning accepts them.</p></div>` : ''}
		</div>`
		return head(a, 'atlas', { actions, sub: `<span class="muted">· ${mem.pinned.length + mem.added.length} map${mem.pinned.length + mem.added.length === 1 ? '' : 's'}</span>` }) + tabsHtml('atlas', id, sideThread) + (S.tab === 'thread' && !sideThread ? threadHtml('atlas', id) : details)
	}
	function sightingHtml(id) {
		const s = obj('sighting', id)
		return head(s, 'sighting', { actions: `<button class="btn" data-act="menu" data-menu="share">Share</button><button class="btn" data-act="react">♥ React</button>`, sub: `<span class="muted">· ${esc(s.when)} · expires ${esc(s.expires)}</span>` }) + `<div class="margin-body"><div class="section"><div style="height:120px;border-radius:8px;background:linear-gradient(135deg,var(--surface-2),var(--surface-3));display:grid;place-items:center;color:var(--muted)">photo</div></div><div class="section"><p>${esc(s.note)}</p></div><div class="section"><h4>Comments</h4><div class="empty">Be the first. Comments are NIP-22 replies any Nostr client can see.</div></div></div>`
	}
	function personHtml(id) {
		const p = person(id)
		const list = (arr, kind) => arr.length ? `<div class="list">${arr.map((o) => `<button class="item" data-act="open" data-kind="${kind}" data-id="${o.id}"><span class="kicon ${kind}">${kind.slice(0, 3)}</span><span style="text-align:left"><div class="t">${esc(o.title)}</div><div class="s">${kind === 'map' ? o.features.length + ' features' : kind === 'atlas' ? esc(policyText(o.policy)) : esc(o.summary || '')}</div></span><span></span></button>`).join('')}</div>` : '<div class="empty">None yet.</div>'
		return `<div class="margin-head"><div class="nav"><button class="btn sm quiet" data-act="back">◂ Back</button></div><div class="sub"><span class="eyebrow">person</span></div><div class="title">${esc(p.name)}</div><div class="sub"><span class="mono">${esc(p.handle)}</span></div><div class="actions"><button class="btn">Follow</button><button class="btn" data-act="menu" data-menu="share">Share</button></div></div>
		<div class="margin-body"><div class="section"><h4>Maps</h4>${list(Object.values(D.maps).filter((m) => m.author === id && m.published), 'map')}</div><div class="section"><h4>Stories</h4>${list(Object.values(D.stories).filter((s) => s.author === id && !s.draft), 'story')}</div><div class="section"><h4>Atlases</h4>${list(Object.values(D.atlases).filter((a) => a.author === id), 'atlas')}</div></div>`
	}

	// ---- Thread
	function threadHtml(kind, id) {
		const o = obj(kind, id)
		const k = key(kind, id)
		const inEdit = S.editing && S.editing.id === id
		const msgs = thread(k)
		const state = inEdit ? 'editing' : kind === 'atlas' && !mine(o) ? 'read-only · concierge' : 'read-only'
		const sendLabel = inEdit ? 'Send' : kind === 'map' ? (mine(o) ? 'Edit & send' : 'Fork & send') : kind === 'story' ? (mine(o) ? 'Edit & send' : 'Propose & send') : mine(o) ? 'Edit & send' : 'Ask'
		const LA = lensAtlas()
		const hints = kind === 'map' && LA && (S.editing && S.editing.id === id) && inAtlas(o, LA)
			? [`Add a ${noun(LA, 1)} at the next plaza east of here`, 'Fill in the missing properties from the descriptions', 'Remove the selected features']
			: kind === 'map'
			? (id.startsWith('hippie') ? ['Add the 1970s overland bus stops between Istanbul and Kabul', 'Recolour the selected stops and translate their names', 'Remove the two easternmost stops'] : ['Research three more landing points and add them', 'Recolour the selected features', 'Remove the selected features'])
			: kind === 'story' ? ['Write a paragraph about the Tehran visa wait, referencing the Tehran stop', 'Summarise the maps in this story'] : ['Which maps here lack a period property?', 'Pin the waiting maps', 'Rewrite the description']
		const safety = { auto: 'Apply automatically', ask: 'Ask before changing', every: 'Ask before every change' }[S.safety]
		return `<div class="thread">
			<div class="th"><span class="who"><b>${esc(o.title)}</b> · ${state}</span><span class="ctl"><button class="btn sm quiet" data-act="menu" data-menu="safety" title="Safety">${esc(safety)} ▾</button><button class="btn sm quiet ${S.detailsOpen ? 'on' : ''}" data-act="toggle-details" title="Show tool details">${S.detailsOpen ? 'Details on' : 'Details'}</button></span></div>
			<div class="msgs" id="msgs">${msgs.length ? msgs.map(msgHtml).join('') : `<div class="empty">${kind === 'map' ? 'Ask for changes to this map. Writes go to the map in Edit; select features to narrow the scope.' : kind === 'story' ? 'Ask for prose. References to features come along as chips you can follow on the map.' : mine(o) ? 'Ask about the collection. I can check fit, pin what is waiting, or rewrite the description.' : 'Ask about this atlas. I cannot change it, but I can help you add your own map to it.'}</div>`}</div>
			${S.proposal && ((S.proposal.kind === 'story' && S.proposal.storyId === id) || (S.proposal.kind === 'atlas' && S.proposal.atlasId === id)) ? `<div class="diffbar-margin" style="margin:.4rem .9rem"><span class="grow">${S.proposal.kind === 'story' ? `+1 paragraph · ${S.proposal.para.refs.length} references` : S.proposal.pins ? `pin ${S.proposal.pins.length}` : 'new description'} · see Details</span><button class="btn sm primary" data-act="apply">Apply</button><button class="btn sm" data-act="discard">Discard</button></div>` : ''}
			<div class="composer">
				<div class="scope">${S.selection.size ? `<span class="chip warn">${S.selection.size} feature${S.selection.size === 1 ? '' : 's'} selected <button class="x" data-act="clear-selection" aria-label="Clear scope">×</button></span>` : inEdit && kind === 'map' ? '<span class="chip">Whole map</span>' : ''}${S.refs.map((r, i) => `<span class="chip">⌖ ${esc(r.label)} <button class="x" data-act="ref-remove" data-i="${i}">×</button></span>`).join('')}<button class="chip add" data-act="dialog" data-dialog="pick-ref">+ reference</button></div>
				<div class="box"><textarea id="composer-text" rows="1" placeholder="${inEdit ? 'Ask for a change…' : 'Ask, or describe a change…'}"></textarea><button class="btn sm primary" data-act="send">${sendLabel}</button></div>
				<div class="hint">${hints.map((h) => `<button data-act="hint" data-text="${esc(h)}">${esc(h)}</button>`).join('')}</div>
			</div>
		</div>`
	}
	function msgHtml(m) {
		if (m.role === 'user') return `<div class="msg user">${esc(m.text)}${m.scope ? `<div class="refs"><span class="chip warn" style="height:22px">${m.scope} selected</span></div>` : ''}${m.refs && m.refs.length ? `<div class="refs">${m.refs.map((r) => `<span class="chip" style="height:22px">⌖ ${esc(r.label)}</span>`).join('')}</div>` : ''}</div>`
		if (m.working) return `<div class="msg ai"><span class="working"><i></i> Working on it…</span></div>`
		return `<div class="msg ai">${m.op ? `<div class="op">▸ ${esc(m.op)}${m.details && m.details.length ? `<button data-act="toggle-details">${S.detailsOpen ? 'hide' : m.details.length + ' steps'}</button>` : ''}</div>` : ''}${m.text ? `<div style="margin-top:.3rem">${esc(m.text)}</div>` : ''}${S.detailsOpen && m.details && m.details.length ? `<div class="details">${m.details.map(([t, ms]) => `<span>${esc(t)} · ${ms} ms</span>`).join('')}</div>` : ''}</div>`
	}
	function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px' }

	// ---- Canvas: MapLibre + OpenFreeMap when available, SVG graticule fallback otherwise
	const ML_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
	const svgNS = 'http://www.w3.org/2000/svg'
	let ml = null, mlReady = false, liveMarkers = [], hoverUid = null
	const r3 = (v) => Math.round(v * 1000) / 1000
	const P = (c) => [((c[0] + 180) / 360) * 2000, ((90 - c[1]) / 180) * 1200]
	const Pinv = (x, y) => [r3((x / 2000) * 360 - 180), r3(90 - (y / 1200) * 180)]
	const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
	function el(tag, attrs, parent) { const e = document.createElementNS(svgNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e }
	function initBasemap() {
		if (window.SKETCH_NO_BASEMAP || !window.maplibregl) { buildWorld(); $('#map').hidden = true; S.basemap = 'svg'; return }
		S.basemap = 'openfreemap'
		$('#svg').style.display = 'none'
		ml = new maplibregl.Map({ container: 'map', style: ML_STYLE, center: [20, 40], zoom: 2.2, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false })
		ml.touchZoomRotate.disableRotation()
		ml.on('load', () => { mlReady = true; addMlLayers(); renderCanvas(); if (!S.route.kind) A.fit() })
		ml.on('move', () => { renderPopup(); renderStatus() })
		ml.on('mousemove', onMlHover)
		ml.on('click', onMlClick)
		ml.on('dblclick', (e) => { if (S.drawing.length) { e.preventDefault(); finishDrawing() } })
		ml.on('error', () => {})
	}
	const ML_HIT = ['f-pt', 'f-pt-prop', 'f-line', 'f-line-prop', 'f-fill']
	function mlColors() { return { published: cssVar('--published'), working: cssVar('--working'), proposed: cssVar('--proposed'), live: cssVar('--live'), surface: cssVar('--surface'), ink: cssVar('--ink-2'), amber: cssVar('--amber') } }
	function colorExpr(c) { return ['match', ['get', 'state'], 'working', c.working, 'proposed', c.proposed, c.published] }
	function addMlLayers() {
		const c = mlColors()
		ml.addSource('feats', { type: 'geojson', promoteId: 'uid', data: { type: 'FeatureCollection', features: [] } })
		ml.addSource('live', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
		const op = ['*', ['case', ['get', 'removed'], 0.3, 1], ['case', ['get', 'dim'], 0.25, 1]]
		ml.addLayer({ id: 'f-fill', type: 'fill', source: 'feats', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': colorExpr(c), 'fill-opacity': ['*', 0.25, op] } })
		ml.addLayer({ id: 'f-line', type: 'line', source: 'feats', filter: ['all', ['!=', ['get', 'state'], 'proposed'], ['!=', ['geometry-type'], 'Point']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['boolean', ['get', 'sel'], false], c.amber, colorExpr(c)], 'line-width': ['+', ['case', ['==', ['get', 'state'], 'working'], 3, 2.2], ['case', ['boolean', ['feature-state', 'hov'], false], 1.5, 0]], 'line-opacity': op } })
		ml.addLayer({ id: 'f-line-prop', type: 'line', source: 'feats', filter: ['all', ['==', ['get', 'state'], 'proposed'], ['!=', ['geometry-type'], 'Point']], layout: { 'line-cap': 'round' }, paint: { 'line-color': c.proposed, 'line-width': 3, 'line-dasharray': [2, 1.6] } })
		ml.addLayer({ id: 'f-pt', type: 'circle', source: 'feats', filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'state'], 'proposed']], paint: { 'circle-color': ['case', ['boolean', ['get', 'modified'], false], c.proposed, colorExpr(c)], 'circle-radius': ['+', ['case', ['boolean', ['get', 'sel'], false], 7, ['==', ['get', 'state'], 'working'], 6, 5], ['case', ['boolean', ['feature-state', 'hov'], false], 2, 0]], 'circle-stroke-color': ['case', ['boolean', ['get', 'sel'], false], c.amber, c.surface], 'circle-stroke-width': ['case', ['boolean', ['get', 'sel'], false], 3, 1.5], 'circle-opacity': op, 'circle-stroke-opacity': op } })
		ml.addLayer({ id: 'f-pt-prop', type: 'circle', source: 'feats', filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'state'], 'proposed']], paint: { 'circle-color': c.proposed, 'circle-opacity': 0.25, 'circle-radius': ['case', ['boolean', ['feature-state', 'hov'], false], 9, 7], 'circle-stroke-color': c.proposed, 'circle-stroke-width': 2 } })
		ml.addLayer({ id: 'f-lbl', type: 'symbol', source: 'feats', minzoom: 3.5, filter: ['all', ['==', ['geometry-type'], 'Point'], ['boolean', ['get', 'lbl'], false]], layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-anchor': 'left', 'text-offset': [0.9, 0], 'text-optional': true }, paint: { 'text-color': c.ink, 'text-halo-color': c.surface, 'text-halo-width': 1.4 } })
		ml.addLayer({ id: 'sight', type: 'circle', source: 'live', paint: { 'circle-color': c.live, 'circle-radius': 6, 'circle-stroke-color': c.surface, 'circle-stroke-width': 1.5 } })
		ml.addLayer({ id: 'sight-lbl', type: 'symbol', source: 'live', minzoom: 5, layout: { 'text-field': ['get', 'title'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-anchor': 'left', 'text-offset': [0.9, 0], 'text-optional': true }, paint: { 'text-color': c.ink, 'text-halo-color': c.surface, 'text-halo-width': 1.4 } })
	}
	function applyMlColors() {
		if (!mlReady) return
		const c = mlColors()
		ml.setPaintProperty('f-fill', 'fill-color', colorExpr(c))
		ml.setPaintProperty('f-line', 'line-color', ['case', ['boolean', ['get', 'sel'], false], c.amber, colorExpr(c)])
		ml.setPaintProperty('f-line-prop', 'line-color', c.proposed)
		ml.setPaintProperty('f-pt', 'circle-color', ['case', ['boolean', ['get', 'modified'], false], c.proposed, colorExpr(c)])
		ml.setPaintProperty('f-pt', 'circle-stroke-color', ['case', ['boolean', ['get', 'sel'], false], c.amber, c.surface])
		ml.setPaintProperty('f-pt-prop', 'circle-color', c.proposed); ml.setPaintProperty('f-pt-prop', 'circle-stroke-color', c.proposed)
		;['f-lbl', 'sight-lbl'].forEach((l) => { ml.setPaintProperty(l, 'text-color', c.ink); ml.setPaintProperty(l, 'text-halo-color', c.surface) })
		ml.setPaintProperty('sight', 'circle-color', c.live); ml.setPaintProperty('sight', 'circle-stroke-color', c.surface)
	}
	function toGeo(f, props) {
		const geometry = f.type === 'point' ? { type: 'Point', coordinates: f.coords } : f.type === 'polygon' ? { type: 'Polygon', coordinates: [[...f.coords, f.coords[0]]] } : { type: 'LineString', coordinates: f.coords }
		return { type: 'Feature', id: props.uid, properties: props, geometry }
	}
	// One pass over the Shelf decides what is drawn and in which of the three states.
	function collectFeatures() {
		const out = []
		const focus = S.route.kind === 'map' ? S.route.id : null
		S.shelf.forEach((e) => {
			if (!e.visible) return
			const isEdit = S.editing && S.editing.kind === 'map' && S.editing.id === e.id
			const m = isEdit ? S.drafts[e.id] : D.maps[e.id]
			if (!m) return
			const p = isEdit && S.proposal && S.proposal.kind === 'map' && S.proposal.mapId === e.id ? S.proposal : null
			m.features.forEach((f) => out.push({ f, map: e.id, state: isEdit ? 'working' : 'published', removed: !!(p && p.remove.includes(f.id)), modified: !!(p && p.modify.some((x) => x.id === f.id)), sel: S.selection.has(f.id), lbl: focus === e.id || isEdit, dim: !!(S.onlyChanges && S.proposal) }))
		})
		if (S.proposal && S.proposal.kind === 'map' && S.shelf.some((e) => e.id === S.proposal.mapId && e.visible)) S.proposal.add.forEach((f) => out.push({ f, map: S.proposal.mapId, state: 'proposed', lbl: true }))
		if (S.drawing.length && S.tool) {
			out.push({ f: { id: 'drawing', name: '', type: S.drawing.length > 1 ? 'line' : 'point', coords: S.drawing.length > 1 ? S.drawing : S.drawing[0] }, map: S.editing.id, state: 'proposed' })
			if (S.drawing.length > 1) S.drawing.forEach((c, i) => out.push({ f: { id: 'drawing-' + i, name: '', type: 'point', coords: c }, map: S.editing.id, state: 'proposed' }))
		}
		return out
	}
	function renderCanvas() {
		if (ml) {
			if (!mlReady) return
			const feats = collectFeatures().map((x) => toGeo(x.f, { uid: `${x.map}:${x.f.id}`, map: x.map, fid: x.f.id, name: x.f.props && x.f.props.label ? x.f.props.label : x.f.name, state: x.state, sel: !!x.sel, lbl: !!x.lbl, removed: !!x.removed, modified: !!x.modified, dim: !!x.dim }))
			ml.getSource('feats').setData({ type: 'FeatureCollection', features: feats })
			ml.getSource('live').setData({ type: 'FeatureCollection', features: S.liveOn ? D.sightings.map((s) => ({ type: 'Feature', properties: { id: s.id, title: s.title }, geometry: { type: 'Point', coordinates: s.coords } })) : [] })
			liveMarkers.forEach((mk) => mk.remove()); liveMarkers = []
			if (S.liveOn) D.live.forEach((l) => { const d = document.createElement('div'); d.className = 'livedot'; d.title = l.title; liveMarkers.push(new maplibregl.Marker({ element: d }).setLngLat(l.coords).addTo(ml)) })
			ml.getCanvas().style.cursor = S.tool ? 'crosshair' : ''
			renderPopup()
			return
		}
		const layers = $('#layers'); layers.innerHTML = ''
		const groups = {}
		collectFeatures().forEach((x) => {
			const k = `${x.map}|${x.state}`
			if (!groups[k]) groups[k] = el('g', { class: `lyr ${x.state} ${x.dim ? 'dim' : ''}`, 'data-map': x.map }, layers)
			drawFeature(groups[k], x.f, x.map, { removed: x.removed, modified: x.modified, sel: x.sel, label: x.lbl && S.view.k > 1.5, proposed: x.state === 'proposed' })
		})
		const live = $('#livelayer'); live.innerHTML = ''
		if (S.liveOn) {
			D.sightings.forEach((s) => { const [x, y] = P(s.coords); const g = el('g', { 'data-act': 'open', 'data-kind': 'sighting', 'data-id': s.id, style: 'cursor:pointer' }, live); el('path', { d: `M${x} ${y - 9} l8 9 -8 9 -8 -9 Z`, class: 'sight' }, g); if (S.view.k > 1.5) el('text', { x: x + 11, y: y + 4, class: 'lbl' }, g).textContent = s.title })
			D.live.forEach((l) => { const [x, y] = P(l.coords); const g = el('g', {}, live); el('circle', { cx: x, cy: y, r: 8, class: 'livering' }, g); el('circle', { cx: x, cy: y, r: 5, class: 'livept' }, g) })
		}
		applyView(false)
		renderPopup()
	}
	function onMlHover(e) {
		if (!mlReady) return
		const hit = ml.queryRenderedFeatures(e.point, { layers: ML_HIT })[0]
		const uid = hit ? hit.properties.uid : null
		if (uid !== hoverUid) {
			if (hoverUid) ml.setFeatureState({ source: 'feats', id: hoverUid }, { hov: false })
			if (uid) ml.setFeatureState({ source: 'feats', id: uid }, { hov: true })
			hoverUid = uid
			const mapId = hit ? hit.properties.map : null
			$$('.schip').forEach((c) => c.classList.toggle('hover', !!mapId && c.dataset.map === mapId))
		}
		ml.getCanvas().style.cursor = S.tool ? 'crosshair' : hit || ml.queryRenderedFeatures(e.point, { layers: ['sight'] }).length ? 'pointer' : ''
	}
	function onMlClick(e) {
		if (S.tool && S.editing && S.editing.kind === 'map') { placeAt([r3(e.lngLat.lng), r3(e.lngLat.lat)]); return }
		const sight = ml.queryRenderedFeatures(e.point, { layers: ['sight'] })[0]
		if (sight) { A.open({ kind: 'sighting', id: sight.properties.id }); return }
		const hit = ml.queryRenderedFeatures(e.point, { layers: ML_HIT })[0]
		if (hit) { featureClicked(hit.properties.map, hit.properties.fid, e.originalEvent); return }
		if (S.popup) { S.popup = null; render() }
	}
	function placeAt(p) {
		if (S.tool === 'point') { pushUndo(); S.drafts[S.editing.id].features.push({ id: `p-${Date.now()}`, name: `Point ${S.drafts[S.editing.id].features.length + 1}`, type: 'point', coords: p, props: {} }); render(); return }
		if (S.tool === 'label') { S.dialog = { type: 'label', at: p }; render(); return }
		S.drawing.push(p); renderCanvas()
	}
	function featureClicked(mapId, fid, ev) {
		if (S.editing && S.editing.id === mapId && S.route.id === mapId) {
			if (!(ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) && !isMobile()) S.selection.clear()
			if (S.selection.has(fid)) S.selection.delete(fid); else S.selection.add(fid)
			S.popup = null; render(); return
		}
		S.popup = { mapId, fid }; render()
	}
	// SVG fallback: graticule only, features projected with P().
	function buildWorld() {
		const grat = $('#grat'); for (let x = 0; x <= 2000; x += 2000 / 36) el('line', { x1: x, y1: 0, x2: x, y2: 1200, class: 'grat' }, grat)
		for (let y = 0; y <= 1200; y += 1200 / 18) el('line', { x1: 0, y1: y, x2: 2000, y2: y, class: 'grat' }, grat)
		el('line', { x1: 0, y1: 600, x2: 2000, y2: 600, class: 'grat', style: 'stroke:var(--rule-2)' }, grat)
		const t = el('text', { x: 12, y: 1180, class: 'lbl' }, grat); t.textContent = 'No basemap available in this sandbox. Run the sketch locally to see OpenFreeMap tiles.'
	}
	function pathD(f) { return `M${f.coords.map((c) => P(c).join(' ')).join(' L')}${f.type === 'polygon' ? ' Z' : ''}` }
	function drawFeature(g, f, mapId, o) {
		const cls = `f ${o.sel ? 'sel' : ''}`
		const attrs = { 'data-map': mapId, 'data-fid': f.id }
		if (f.type === 'point') {
			const [cx, cy] = P(f.coords)
			const c = el('circle', Object.assign({ cx, cy, class: `${cls} pt` }, attrs), g)
			if (o.removed) c.style.opacity = '.3'
			if (o.modified) c.setAttribute('fill', 'var(--proposed)')
			el('circle', Object.assign({ cx, cy, class: 'f pt hit' }, attrs), g)
			if (o.label) el('text', { x: cx + 9, y: cy + 4, class: 'lbl' }, g).textContent = f.props && f.props.label ? f.props.label : f.name
		} else {
			const p = el('path', Object.assign({ d: pathD(f), class: `${cls} ${f.type === 'polygon' ? 'poly' : 'line'}` }, attrs), g)
			if (o.removed) p.style.opacity = '.3'
			if (o.modified) p.setAttribute('stroke', 'var(--proposed)')
			el('path', Object.assign({ d: pathD(f), class: 'f hit' }, attrs), g)
		}
	}
	function applyView(fly) {
		const w = $('#world')
		w.classList.toggle('fly', !!fly)
		w.style.transform = `translate(${S.view.x}px, ${S.view.y}px) scale(${S.view.k})`
		w.style.setProperty('--inv', String(1 / S.view.k))
		if (fly) setTimeout(() => w.classList.remove('fly'), 480)
	}
	function canvasRect() { return $('#canvas').getBoundingClientRect() }
	function fitPadding() {
		const mw = isMobile() ? 0 : parseFloat(cssVar('--margin-w')) || 380
		return { top: 70, bottom: isMobile() ? innerHeight * 0.5 + 60 : 90, left: (isMobile() ? 0 : mw) + 40, right: (sideThreadActive() ? mw : 0) + 40 }
	}
	// b = [w, s, e, n] in lon/lat. close = zoom in on a single feature.
	function flyTo(b, close) {
		if (ml) {
			const pad = fitPadding()
			const r = canvasRect()
			if (pad.left + pad.right > r.width - 80 || pad.top + pad.bottom > r.height - 80) { pad.left = pad.right = 20; pad.top = pad.bottom = 40 }
			ml.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad, maxZoom: close ? 14 : 9, duration: 650 })
			return
		}
		const st = $('#stage').getBoundingClientRect()
		const pad = fitPadding()
		const [x0, y1] = P([b[0], b[1]]), [x1, y0] = P([b[2], b[3]])
		const w = st.width - pad.left - pad.right, h = st.height - pad.top - pad.bottom
		let k = Math.min(w / Math.max(x1 - x0, 20), h / Math.max(y1 - y0, 12))
		k = Math.max(0.5, Math.min(close ? 40 : 8, k))
		S.view = { k, x: pad.left + (w - (x0 + x1) * k) / 2, y: pad.top + (h - (y0 + y1) * k) / 2 }
		applyView(true)
		renderStatus()
		setTimeout(renderCanvas, 0)
	}
	function flyToMaps(ids) { const feats = ids.flatMap((id) => (D.maps[id] || { features: [] }).features); if (feats.length) flyTo(bbox(feats)) }
	function flyToPlace(name) { const c = D.places[name]; if (c) flyTo([c[0] - 0.25, c[1] - 0.15, c[0] + 0.25, c[1] + 0.15], true) }
	function screenToWorld(sx, sy) { const r = canvasRect(); if (ml) { const p = ml.unproject([sx - r.left, sy - r.top]); return [r3(p.lng), r3(p.lat)] } return Pinv((sx - r.left - S.view.x) / S.view.k, (sy - r.top - S.view.y) / S.view.k) }
	function worldToScreen(c) { if (ml) { const p = ml.project(c); return [p.x, p.y] } const [x, y] = P(c); return [x * S.view.k + S.view.x, y * S.view.k + S.view.y] }
	function renderPopup() {
		const host = $('#popup')
		if (!S.popup) { host.innerHTML = ''; return }
		const m = view('map', S.popup.mapId); const f = m && m.features.find((x) => x.id === S.popup.fid) || (S.proposal && S.proposal.add.find((x) => x.id === S.popup.fid))
		if (!f) { host.innerHTML = ''; return }
		const pt = worldToScreen(f.type === 'point' ? f.coords : f.coords[Math.floor(f.coords.length / 2)])
		const editingThis = S.editing && S.editing.id === S.popup.mapId
		const schema = schemaFor(m)
		host.innerHTML = `<div class="popup" style="left:${pt[0]}px;top:${pt[1]}px"><div class="t">${esc(f.props && f.props.label || f.name)}</div><div class="s">${esc(m.title)} · ${f.type}${schema.map((fl) => f.props && f.props[fl.key] ? ` · ${esc(f.props[fl.key])}` : '').join('')}</div><div style="display:flex;gap:.3rem;flex-wrap:wrap">${S.route.id !== S.popup.mapId ? `<button class="btn sm" data-act="open" data-kind="map" data-id="${S.popup.mapId}">Open map</button>` : ''}${editingThis ? `<button class="btn sm" data-act="select-one" data-fid="${esc(f.id)}">${S.selection.has(f.id) ? 'Deselect' : 'Select'}</button>` : ''}<button class="btn sm quiet" data-act="popup-close">Close</button></div></div>`
	}
	function renderStatus() {
		let c, z
		if (ml) { const ce = ml.getCenter(); c = [r3(ce.lng), r3(ce.lat)]; z = ml.getZoom().toFixed(1) } else { c = screenToWorld(innerWidth / 2, innerHeight / 2); z = S.view.k.toFixed(2) }
		$('#status').textContent = `z${z} · ${c[1]}, ${c[0]} · ${S.shelf.filter((e) => e.visible).length} on the map${S.liveOn ? ' · live' : ''}${S.basemap === 'svg' ? ' · no basemap' : ''}`
	}
	function zoomBy(f, cx, cy) {
		if (ml) { ml.zoomTo(ml.getZoom() + Math.log2(f), { duration: 220 }); return }
		const r = canvasRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2
		const k = Math.max(0.35, Math.min(40, S.view.k * f))
		S.view.x = cx - (cx - S.view.x) * (k / S.view.k); S.view.y = cy - (cy - S.view.y) * (k / S.view.k); S.view.k = k
		applyView(false); renderStatus(); if (Math.abs(f - 1) > 0.2) renderCanvas()
	}

	// ---- Shelf strip
	function renderShelf() {
		const html = shelfChips()
		$('#shelf').innerHTML = `<span class="lbl">On the map</span>${html}<span class="spacer"></span><button class="btn sm quiet save" data-act="save-view">Save this view</button>`
		const mt = $('#mtop')
		mt.innerHTML = `<div class="search">${searchHtml()}</div><div class="mshelf">${html}</div>`
	}
	function shelfChips() {
		const chips = S.shelf.map((e) => {
			const m = D.maps[e.id]; if (!m) return ''
			const pen = S.editing && S.editing.id === e.id
			const running = S.run && S.run.id === e.id
			const on = S.route.kind === 'map' && S.route.id === e.id
			return `<span class="schip ${pen ? 'pen' : ''} ${running ? 'running' : ''} ${on ? 'on' : ''} ${e.visible ? '' : 'off'}" data-map="${e.id}"><span class="sw"></span>${pen ? '<span class="pencil">✎</span>' : ''}<button class="name" style="width:auto;height:auto;border-radius:0;padding:0" data-act="open" data-kind="map" data-id="${e.id}">${esc(pen ? S.drafts[e.id].title : m.title)}</button><button data-act="toggle-vis" data-id="${e.id}" aria-label="${e.visible ? 'Hide' : 'Show'}" title="${e.visible ? 'Hide' : 'Show'}">${e.visible ? '◉' : '○'}</button><button data-act="remove-shelf" data-id="${e.id}" aria-label="Remove from map">×</button></span>`
		}).join('')
		const liveCount = D.sightings.length + D.live.length
		return chips + `<span class="schip live ${S.liveOn ? 'on' : 'off'}"><span class="sw"></span><button class="name" style="width:auto;height:auto;border-radius:0;padding:0" data-act="toggle-live">Live · ${liveCount}</button></span>`
	}

	// ---- Tool pill / diff bar
	function renderToolpill() {
		const tp = $('#toolpill')
		const on = S.editing && S.editing.kind === 'map' && S.route.kind === 'map' && S.route.id === S.editing.id
		tp.classList.toggle('on', !!on)
		if (!on) { tp.innerHTML = ''; return }
		const t = (k, lbl, title) => `<button class="${S.tool === k ? 'on' : ''}" data-act="tool" data-tool="${k}" title="${title}" aria-label="${title}">${lbl}<span class="tl">${title.replace('Draw ', '').replace('Place ', '')}</span></button>`
		tp.innerHTML = `<span class="tg">✎ ${esc(S.drafts[S.editing.id].title).slice(0, 22)}</span>${t('point', '●', 'Draw point')}${t('line', '╱', 'Draw line')}${t('polygon', '⬠', 'Draw polygon')}${t('label', 'T', 'Place label')}<span class="sep"></span><button data-act="undo" title="Undo" ${S.undo.length ? '' : 'disabled style="opacity:.4"'}>↶</button><button data-act="redo" title="Redo" ${S.redo.length ? '' : 'disabled style="opacity:.4"'}>↷</button><span class="sep"></span><button data-act="menu" data-menu="more-tools" title="More">⋯</button>`
		$('#zoom').innerHTML = ''
	}
	function renderDiffbar() {
		const db = $('#diffbar')
		const p = S.proposal && S.proposal.kind === 'map' ? S.proposal : null
		db.classList.toggle('on', !!p)
		$('#zoom').innerHTML = `<button data-act="zoom" data-d="1" aria-label="Zoom in">+</button><button data-act="zoom" data-d="-1" aria-label="Zoom out">−</button><button data-act="fit" aria-label="Frame what is on the map">⌖</button>`
		if (!p) { db.innerHTML = ''; return }
		const items = [...p.add.map((f) => ({ id: f.id, t: `+ ${f.name}` })), ...p.modify.map((m) => { const f = view('map', p.mapId).features.find((x) => x.id === m.id); return { id: m.id, t: `~ ${f ? f.name : m.id}` } }), ...p.remove.map((id) => { const f = view('map', p.mapId).features.find((x) => x.id === id); return { id, t: `− ${f ? f.name : id}` } })]
		db.innerHTML = `<span class="cnt"><b class="add">+${p.add.length}</b><b class="mod">~${p.modify.length}</b><b class="del">−${p.remove.length}</b></span><span class="muted" style="font-size:.8rem">proposed</span><button class="btn sm primary" data-act="apply">Apply</button><button class="btn sm" data-act="discard">Discard</button><button class="btn sm quiet ${S.reviewOpen ? 'on' : ''}" data-act="review">Review ▾</button><button class="btn sm quiet" data-act="only-changes">${S.onlyChanges ? 'Show all' : 'Only changes'}</button>${S.reviewOpen ? `<div class="review">${items.map((i) => `<label><input type="checkbox" checked data-review="${esc(i.id)}"> ${esc(i.t)}</label>`).join('')}<div style="display:flex;justify-content:flex-end;padding:.3rem"><button class="btn sm primary" data-act="apply-picked">Apply checked</button></div></div>` : ''}`
	}

	// ---- Menus
	function renderMenus() {
		const host = $('#menus')
		if (!S.menu) { host.innerHTML = ''; return }
		const m = S.menu
		const mi = (label, act, extra = '') => `<button class="mi ${extra}" data-act="${act}"><span>${label}</span></button>`
		let body = ''
		if (m.type === 'me') body = `<div class="mh"><b>You</b><br><span class="mono muted">you@earthly.city</span></div><hr>${mi('Profile', 'open-me')}${mi('Drafts', 'menu-drafts')}${mi('Circles <small>Alpine rescue · 6 members</small>', 'toast', '', '')}${mi('Nearby sessions <small>Saturday survey · 3 peers</small>', 'toast')}${mi('Outbox <small>2 delivered · 0 waiting</small>', 'toast')}${mi('Wallet', 'toast')}<hr>${mi('Settings', 'toast')}${mi('Help & tour', 'toast')}<div class="mrow"><span class="muted" style="align-self:center;font-size:.8rem;padding:0 .3rem">Theme</span>${['system', 'light', 'dark'].map((t) => `<button class="btn sm ${theme() === t ? 'primary' : ''}" data-act="theme" data-theme="${t}">${t}</button>`).join('')}</div><div class="mrow"><span class="muted" style="align-self:center;font-size:.8rem;padding:0 .3rem">Panels</span><button class="btn sm ${S.glass ? '' : 'primary'}" data-act="glass" data-v="0">Solid</button><button class="btn sm ${S.glass ? 'primary' : ''}" data-act="glass" data-v="1">Glass</button></div><hr>${mi('Sign out', 'toast', 'danger')}`
		if (m.type === 'drafts') { const ds = Object.values(S.drafts); body = `<div class="mh"><b>Drafts</b> <span class="muted">· saved on this device</span></div>${ds.length ? ds.map((d) => `<div class="mi" style="grid-template-columns:1fr auto auto"><span><span class="kicon ${d.kind}" style="display:inline-grid;width:20px;height:20px;font-size:.55rem;vertical-align:middle">${d.kind.slice(0, 3)}</span> ${esc(d.title)}<small>${esc(d.kind)} · ${S.editing && S.editing.id === d.id ? 'editing now' : 'kept'}</small></span><button class="btn sm" data-act="resume" data-kind="${d.kind}" data-id="${d.id}">Resume</button><button class="btn sm quiet danger" data-act="discard-draft" data-id="${d.id}">Discard</button></div>`).join('') : '<div class="empty" style="padding:.5rem .7rem">No unfinished work. Press Edit on something.</div>'}` }
		if (m.type === 'publish') { const d = S.drafts[S.editing.id]; const isMap = S.editing.kind === 'map'; const pub = obj(S.editing.kind, S.editing.id); body = `${pub.published ? mi(`Publish update<small>same address, becomes v${(pub.version || 0) + 1}</small>`, 'publish-update') : mi('Publish<small>first version</small>', 'publish-update')}${isMap ? mi('Publish as new map<small>new address, keeps this one as it is</small>', 'publish-new') : ''}<hr><div class="mh eyebrow">Who can see it</div>${[['everyone', 'Everyone', 'public relays'], ['circle', 'Circle: Alpine rescue', 'encrypted, 6 members'], ['nearby', 'Nearby: Saturday survey', 'this session only']].map(([v, t, s]) => `<button class="mi ${d.audience === v ? 'on' : ''}" data-act="audience" data-a="${v}"><span>${t}<small>${s}</small></span></button>`).join('')}` }
		if (m.type === 'share') body = `${mi('Copy link', 'toast-copied')}${mi('Copy link with what’s on the map', 'toast-copied')}${mi('Show QR code', 'toast')}${mi('Share to…', 'toast')}`
		if (m.type === 'safety') body = `<div class="mh eyebrow">When the AI changes something</div>${[['auto', 'Apply automatically', 'changes land, undo is one click'], ['ask', 'Ask before changing', 'show the proposal, then Apply'], ['every', 'Ask before every change', 'review each item']].map(([v, t, s]) => `<button class="mi ${S.safety === v ? 'on' : ''}" data-act="safety" data-v="${v}"><span>${t}<small>${s}</small></span></button>`).join('')}`
		if (m.type === 'more-tools') body = `${mi('Import file…<small>GeoJSON, CSV, GPX, shapefile</small>', 'toast')}${mi('Import from OpenStreetMap…', 'toast')}${mi('Paste GeoJSON', 'toast')}<hr>${mi('Simplify geometry…', 'toast')}${mi('Measure', 'toast')}${mi('Snapping<small>on</small>', 'toast')}<hr>${mi('Select all', 'select-all')}${mi('Clear selection', 'clear-selection')}`
		if (m.type === 'add-map') body = `<div class="mh eyebrow">Add a map to this atlas</div>${mi('One of my maps…<small>republishes it with Belongs to</small>', 'dialog-pick-my-map')}${mi('New map in this atlas<small>opens a working copy with Belongs to set</small>', 'new-in-atlas')}`
		if (m.type === 'plus') body = `<div class="mh eyebrow">Add</div>${mi('Sighting here<small>something seen, expires on its own</small>', 'new-sighting')}${mi('Share live location<small>until you stop</small>', 'toast-live')}${mi(`New ${lensAtlas() ? esc(noun(lensAtlas(), 1)) + ' map in ' + esc(lensAtlas().title) : 'map'}${!lensAtlas() && S.filter && S.filter.type === 'atlas' ? ` in ${esc(S.filter.label)}` : ''}<small>points, lines, and the Thread</small>`, 'new-map')}${mi('Import file…', 'toast')}`
		if (m.type === 'shelf') body = `${mi('Frame on the map', 'fly-map')}${mi('Hide', 'toggle-vis')}${mi('Remove from map', 'remove-shelf')}`
		const style = m.right < 260 ? `right:${m.right}px;top:${m.y}px` : `left:${m.x}px;top:${m.y}px`
		host.innerHTML = `<div class="backdrop" data-act="close-menus"></div><div class="menu" style="${style}" role="menu">${body}</div>`
	}
	function theme() { return document.documentElement.dataset.theme || 'system' }

	// ---- Dialogs
	function renderDialog() {
		const host = $('#dialogs')
		if (!S.dialog) { host.innerHTML = ''; return }
		const d = S.dialog
		let body = ''
		if (d.type === 'finish-first') { const cur = obj(S.editing.kind, S.editing.id); body = `<h3>Finish with “${esc(S.drafts[S.editing.id].title || cur.title)}” first?</h3><p>Only one thing is in Edit at a time. Your work on it is saved as a draft either way.</p><div class="acts"><button class="btn quiet left" data-act="dialog-cancel">Cancel</button><button class="btn danger" data-act="finish-discard">Discard draft</button><button class="btn primary" data-act="finish-keep">Keep draft & continue</button></div>` }
		if (d.type === 'add-to-atlas') { const m = S.drafts[S.editing.id]; body = `<h3>Add to atlas</h3><p>The map will say it belongs there. Whether it shows up depends on the atlas’s door policy.</p><div class="list">${Object.values(D.atlases).filter((a) => !m.belongsTo.includes(a.id)).map((a) => { const f = fitState(m, a); return `<button class="item" data-act="belong-add" data-id="${a.id}"><span class="kicon atlas">atl</span><span style="text-align:left"><div class="t">${esc(a.title)}</div><div class="s">${esc(policyText(a.policy))} · <span style="color:${f.cls === 'ok' ? 'var(--green)' : f.cls === 'warn' ? 'var(--amber)' : 'var(--muted)'}">${f.cls === 'ok' ? 'will show' : f.cls === 'warn' ? 'will wait: ' + esc(f.text.split('· ')[1]) : 'will wait for the owner'}</span></div></span><span></span></button>` }).join('') || '<div class="empty">Already in every atlas.</div>'}</div><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button></div>` }
		if (d.type === 'pick-my-map') { const a = obj('atlas', S.route.id); body = `<h3>Add one of my maps</h3><p>It will be republished with “Belongs to: ${esc(a.title)}”.</p><div class="list">${Object.values(D.maps).filter((m) => mine(m) && !m.belongsTo.includes(a.id) && !a.pinned.includes(m.id)).map((m) => `<button class="item" data-act="belong-map-to-atlas" data-id="${m.id}"><div class="thumb">${thumb(m.features)}</div><span style="text-align:left"><div class="t">${esc(m.title)}</div><div class="s">${m.features.length} features</div></span><span></span></button>`).join('') || '<div class="empty">All your maps are already here.</div>'}</div><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button></div>` }
		if (d.type === 'pick-map') body = `<h3>Reference a map</h3><div class="list">${Object.values(D.maps).filter((m) => m.published && !S.drafts[S.editing.id].maps.includes(m.id)).map((m) => `<button class="item" data-act="story-add-map" data-id="${m.id}"><div class="thumb">${thumb(m.features)}</div><span style="text-align:left"><div class="t">${esc(m.title)}</div><div class="s">${esc(person(m.author).name)}</div></span><span></span></button>`).join('')}</div><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button></div>`
		if (d.type === 'pick-ref') body = `<h3>Add a reference</h3><p>Read-only context for the Thread. A reference never grants the AI permission to edit.</p><div class="list">${[...Object.values(D.maps).filter((m) => m.published).map((m) => ({ kind: 'map', id: m.id, label: m.title, s: 'map' })), ...Object.values(D.stories).filter((s) => !s.draft).map((s) => ({ kind: 'story', id: s.id, label: s.title, s: 'story' }))].map((r) => `<button class="item" data-act="ref-add" data-kind="${r.kind}" data-id="${r.id}" data-label="${esc(r.label)}"><span class="kicon ${r.kind}">${r.s.slice(0, 3)}</span><span style="text-align:left"><div class="t">${esc(r.label)}</div><div class="s">${r.s}</div></span><span></span></button>`).join('')}</div><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button></div>`
		if (d.type === 'save-view') body = `<h3>Save this view as an atlas</h3><p>Pins the ${S.shelf.length} map${S.shelf.length === 1 ? '' : 's'} on the Shelf. Only you can add to it unless you change the door policy.</p><input type="text" id="dlg-name" placeholder="Name the atlas" value="${esc(d.value || 'My view · ' + today)}"><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button><button class="btn primary" data-act="save-view-go">Save atlas</button></div>`
		if (d.type === 'label') body = `<h3>Label</h3><input type="text" id="dlg-name" placeholder="Text on the map" autofocus><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button><button class="btn primary" data-act="label-go">Place</button></div>`
		if (d.type === 'discard') body = `<h3>Discard this draft?</h3><p>The published version stays as it is. Unpublished changes on this device are lost.</p><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button><button class="btn danger" data-act="discard-go">Discard</button></div>`
		if (d.type === 'delete') body = `<h3>Delete this map?</h3><p>Earthly publishes a deletion request and hides it here. Relays and other people may keep copies.</p><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button><button class="btn danger" data-act="delete-go">Delete</button></div>`
		if (d.type === 'new-sighting') body = `<h3>Sighting here</h3><p>What did you see? It will show as a diamond at your position and fade after a day.</p><input type="text" id="dlg-name" placeholder="A few words"><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button><button class="btn primary" data-act="sighting-go">Post sighting</button></div>`
		host.innerHTML = `<div class="dialog-wrap" data-act="dialog-backdrop"><div class="dialog" role="dialog" aria-modal="true">${body}</div></div>`
		const inp = $('#dlg-name'); if (inp) setTimeout(() => { inp.focus(); inp.select() }, 30)
	}

	// ---- Mobile nav
	function renderMobile() {
		const nav = $('#mnav')
		const tab = S.menu && S.menu.type === 'me' ? 'me' : S.resultsOpen ? 'search' : 'map'
		nav.innerHTML = `<button class="${tab === 'map' ? 'on' : ''}" data-act="m-map">🗺<span>Map</span></button><button class="${tab === 'search' ? 'on' : ''}" data-act="m-search">⌕<span>Search</span></button><button data-act="menu" data-menu="plus" aria-label="Add"><span class="plus">+</span></button><button class="${tab === 'me' ? 'on' : ''}" data-act="menu" data-menu="me"><span class="avatar sm">YO</span><span>Me</span></button>`
	}

	// ---------------------------------------------------------------- actions
	const A = {
		back() { if (history.length > 1) history.back(); else location.hash = '#/' },
		open(d) { if (d.kind === 'place') { flyToPlace(d.id); S.resultsOpen = false; S.query = ''; render(); return } S.resultsOpen = false; S.query = ''; if (d.kind === 'shelf') { location.hash = '#/shelf/now'; return } if (S.route.kind === d.kind && S.route.id === d.id) { S.menu = null; render(); return } go(d.kind, d.id, false) },
		tab(d) { S.tab = d.tab; if (isMobile() && S.detent === 'peek') S.detent = 'half'; render() },
		'thread-side'() { S.threadSide = true; S.tab = 'details'; render() },
		'thread-dock'() { S.threadSide = false; S.tab = 'thread'; render() },
		edit() { const { kind, id } = S.route; if (S.editing && S.editing.id !== id) { S.dialog = { type: 'finish-first', next: { kind, id } }; render(); return } beginEdit(kind, id); if (!(kind === 'map' && !mine(obj(kind, id)))) location.hash = hashFor({ kind, id, edit: true }) },
		propose() { toast('Proposals (kind 37519) open a working copy the author sees as ghosts. Sketch: same as Edit.'); A.edit() },
		done() { endEdit(true) },
		publish(d) { publish(d.mode) },
		'publish-update'() { S.menu = null; publish('update') },
		'publish-new'() { S.menu = null; publish('new') },
		audience(d) { S.drafts[S.editing.id].audience = d.a; S.menu = null; render(); toast(`Will publish to ${audienceLabel(d.a)}.`) },
		menu(d, el) { if (S.menu && S.menu.type === d.menu) { S.menu = null; render(); return } openMenu(d.menu, el) },
		'menu-drafts'(d, el) { openMenu('drafts', el) },
		'close-menus'() { closeMenus() },
		toast() { S.menu = null; render(); toast('Not part of this sketch.') },
		'toast-copied'() { S.menu = null; render(); toast('Link copied.') },
		'toast-live'() { S.menu = null; S.liveOn = true; D.live.push({ id: 'me', title: 'You · live', coords: screenToWorld(innerWidth / 2, innerHeight / 2), since: 'now' }); render(); toast('You are live. Stop from the Live chip.') },
		theme(d) { if (d.theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = d.theme; try { localStorage.setItem('sketch-theme', d.theme) } catch {} render(); setTimeout(applyMlColors, 30) },
		'open-me'() { S.menu = null; go('person', 'me') },
		resume(d) { S.menu = null; if (S.editing && S.editing.id !== d.id) { S.dialog = { type: 'finish-first', next: { kind: d.kind, id: d.id } }; render(); return } location.hash = hashFor({ kind: d.kind, id: d.id, edit: true }) },
		'discard-draft'(d) { if (S.editing && S.editing.id === d.id) S.editing = null; delete S.drafts[d.id]; S.menu = null; if (S.route.edit && S.route.id === d.id) location.hash = hashFor({ kind: S.route.kind, id: d.id, edit: false }); else render(); toast('Draft discarded.') },
		'clear-filter'() { S.filter = null; render() },
		'filter-tag'(d) { S.filter = { type: 'tag', id: d.tag, label: '#' + d.tag }; S.query = ''; render(); toast(`Lists now show #${d.tag}. The map is unchanged.`) },
		'filter-atlas'(d) { const a = D.atlases[d.id]; S.filter = { type: 'atlas', id: d.id, label: a.title }; render(); toast(`Browsing in “${a.title}”. This only filters lists.`) },
		'start-map'(d) { startMapFrom(d.q) },
		'close-results'() { S.resultsOpen = false; render() },
		'add-shelf'(d) { addToShelf(d.id, { fly: true }); render() },
		'remove-shelf'(d) { S.menu = null; removeFromShelf(d.id || (S.menu && S.menu.data.id)) },
		'toggle-vis'(d) { S.menu = null; toggleVisible(d.id) },
		'toggle-live'() { S.liveOn = !S.liveOn; D.live = D.live.filter((l) => l.id !== 'me'); syncHash(); render() },
		'save-view'() { S.dialog = { type: 'save-view' }; render() },
		'save-view-go'() { const name = $('#dlg-name').value.trim() || 'My view'; const id = `atlas-${++S.counter}`; D.atlases[id] = { id, kind: 'atlas', title: name, author: 'me', policy: 'closed', description: `Saved from the map on ${today}.`, pinned: S.shelf.map((e) => e.id) }; S.dialog = null; toast('Atlas saved. Share it like anything else.'); go('atlas', id) },
		'show-all'(d) { const a = D.atlases[d.id]; const mem = atlasMembers(a); const ids = [...mem.pinned, ...mem.added].map((m) => m.id); ids.forEach((id) => addToShelf(id, { silent: true })); flyToMaps(ids); syncHash(); render() },
		'fly-map'(d) { S.menu = null; addToShelf(d.id || S.menu.data.id, { silent: true }); flyToMaps([d.id || S.menu.data.id]); render() },
		ref(d) { addToShelf(d.map, { silent: true }); const m = D.maps[d.map]; const f = m.features.find((x) => x.id === d.fid); if (f) { flyTo(bbox([f]), true); S.popup = { mapId: d.map, fid: f.id } } else flyToMaps([d.map]); render() },
		'belong-add'(d) { S.drafts[S.editing.id].belongsTo.push(d.id); S.dialog = null; render(); toast(`Will say it belongs to “${D.atlases[d.id].title}” on publish.`) },
		'belong-remove'(d) { const dr = S.drafts[S.editing.id]; dr.belongsTo = dr.belongsTo.filter((x) => x !== d.id); render() },
		'belong-map-to-atlas'(d) { const a = obj('atlas', S.route.id); D.maps[d.id].belongsTo.push(a.id); D.maps[d.id].version++; S.dialog = null; render(); toast(`“${D.maps[d.id].title}” republished with Belongs to: ${a.title}.`) },
		'dialog-pick-my-map'() { S.menu = null; S.dialog = { type: 'pick-my-map' }; render() },
		'new-in-atlas'() { const a = obj('atlas', S.route.id); S.menu = null; if (S.editing) { S.dialog = { type: 'finish-first', next: { kind: 'map', id: '__new__', atlas: a.id } }; render(); return } newMap(a.id) },
		'new-map'() { S.menu = null; const at = S.lens || (S.filter && S.filter.type === 'atlas' ? S.filter.id : null); if (S.editing) { S.dialog = { type: 'finish-first', next: { kind: 'map', id: '__new__', atlas: at } }; render(); return } newMap(at) },
		'enter-lens'(d) { enterLens(d.id) },
		'leave-lens'() { leaveLens() },
		glass(d) { S.glass = d.v === '1'; try { localStorage.setItem('sketch-glass', S.glass ? '1' : '0') } catch {} S.menu = null; render() },
		'new-sighting'() { S.menu = null; S.dialog = { type: 'new-sighting' }; render() },
		'sighting-go'() { const t = $('#dlg-name').value.trim() || 'Something here'; const id = `sight-${++S.counter}`; D.sightings.push({ id, kind: 'sighting', title: t, author: 'me', when: 'just now', expires: 'in 1 day', coords: screenToWorld(innerWidth / 2, innerHeight / 2), note: t }); S.dialog = null; S.liveOn = true; toast('Sighting posted. It fades in a day.'); go('sighting', id) },
		'add-topic'() { const t = prompt('Topic (freeform hashtag)'); if (t) { S.drafts[S.editing.id].topics.push(t.replace(/^#/, '').toLowerCase()); render() } },
		pin(d) { const a = view('atlas', S.route.id); if (!a.pinned.includes(d.id)) a.pinned.push(d.id); if (!(S.editing && S.editing.id === a.id)) D.atlases[a.id].version = (D.atlases[a.id].version || 1) + 1; render(); toast(`Pinned “${D.maps[d.id].title}”. That is the acceptance.`) },
		unpin(d) { const a = view('atlas', S.route.id); a.pinned = a.pinned.filter((x) => x !== d.id); render() },
		'story-add-map'(d) { S.drafts[S.editing.id].maps.push(d.id); S.dialog = null; addToShelf(d.id, { silent: true }); render() },
		'ref-add'(d) { S.refs.push({ kind: d.kind, id: d.id, label: d.label }); S.dialog = null; render() },
		'ref-remove'(d) { S.refs.splice(+d.i, 1); render() },
		send() { const ta = $('#composer-text'); const t = ta && ta.value.trim(); if (!t) return; send(t) },
		hint(d) { send(d.text) },
		'clear-selection'() { S.menu = null; S.selection.clear(); render() },
		'select-all'() { S.menu = null; view('map', S.editing.id).features.forEach((f) => S.selection.add(f.id)); render() },
		'select-one'(d) { if (S.selection.has(d.fid)) S.selection.delete(d.fid); else S.selection.add(d.fid); render() },
		'popup-close'() { S.popup = null; render() },
		'toggle-details'() { S.detailsOpen = !S.detailsOpen; render() },
		safety(d) { S.safety = d.v; S.menu = null; render() },
		apply() { applyProposal() },
		'apply-picked'() { const picked = new Set($$('[data-review]').filter((c) => c.checked).map((c) => c.dataset.review)); applyProposal(picked) },
		discard() { discardProposal() },
		review() { S.reviewOpen = !S.reviewOpen; render() },
		'only-changes'() { S.onlyChanges = !S.onlyChanges; render() },
		tool(d) { S.tool = S.tool === d.tool ? null : d.tool; S.drawing = []; S.popup = null; render() },
		undo() { undo() }, redo() { redo() },
		zoom(d) { zoomBy(+d.d > 0 ? 1.35 : 1 / 1.35) },
		fit() { const ids = S.shelf.filter((e) => e.visible).map((e) => e.id); if (ids.length) flyToMaps(ids); else if (ml) ml.flyTo({ center: [20, 40], zoom: 2.2 }); else { S.view = { x: 0, y: 0, k: Math.min(innerWidth / 2000, innerHeight / 1200) }; applyView(true) } },
		'dialog'(d) { S.dialog = { type: d.dialog, for: d.for }; render() },
		'dialog-cancel'() { S.dialog = null; pendingEditPrompt = false; render() },
		'finish-keep'() { finishFirst(true) },
		'finish-discard'() { finishFirst(false) },
		'discard-go'() { const { kind, id } = S.editing; S.dialog = null; endEdit(false); toast('Draft discarded.') },
		'delete-go'() { const id = S.route.id; delete D.maps[id]; S.shelf = S.shelf.filter((e) => e.id !== id); S.dialog = null; toast('Deletion requested. Relays may keep copies.'); location.hash = '#/' },
		'label-go'() { const t = $('#dlg-name').value.trim(); const at = S.dialog.at; S.dialog = null; if (t && at) { pushUndo(); S.drafts[S.editing.id].features.push({ id: `lbl-${Date.now()}`, name: t, type: 'point', coords: at, props: { label: t, kind: 'annotation' } }) } render() },
		'm-map'() { S.resultsOpen = false; S.menu = null; if (S.route.kind) S.detent = S.detent === 'peek' ? 'half' : 'peek'; render() },
		'm-search'() { S.menu = null; S.detent = 'full'; location.hash = `#/browse/${S.browse.kind}`; setTimeout(() => { const q = $('#bq'); if (q) q.focus() }, 80) },
		detent() { S.detent = S.detent === 'peek' ? 'half' : S.detent === 'half' ? 'full' : 'peek'; render() },
		react() { toast('♥ Reacted. Kind 7, like everywhere else on Nostr.') },
		'edit-id'(d) { if (S.editing && S.editing.id !== d.id) { S.dialog = { type: 'finish-first', next: { kind: d.kind, id: d.id } }; render(); return } beginEdit(d.kind, d.id); location.hash = hashFor({ kind: d.kind, id: d.id, edit: true }) },
		'fly-story'(d) { const st = D.stories[d.id]; st.maps.forEach((m) => addToShelf(m, { silent: true })); flyToMaps(st.maps); syncHash(); render() },
		'browse-kind'(d) { S.browse.kind = d.k; location.hash = `#/browse/${d.k}`; if (S.route.kind === 'browse') render() },
		'ask-go'(d) { askFrom(d.q) },
		'ask-send'() { const ta = $('#askq'); const t = ta && ta.value.trim(); if (!t) return; askFrom(t) },
		'ask-hint'(d) { askFrom(d.text) },
		'ask-clear'() { S.ask.msgs = []; render() },
	}
	function finishFirst(keep) {
		const d = S.dialog; S.dialog = null; pendingEditPrompt = false
		const next = d.next
		endEdit(keep)
		if (next.id === '__new__') { newMap(next.atlas); return }
		beginEdit(next.kind, next.id)
		location.hash = hashFor({ kind: next.kind, id: next.id, edit: true })
		if (d.thenSend) setTimeout(() => send(d.thenSend), 50)
	}
	function newMap(atlasId) {
		const id = `map-${++S.counter}`
		const c = screenToWorld(innerWidth / 2, innerHeight / 2)
		const a = atlasId ? D.atlases[atlasId] : null
		D.maps[id] = { id, kind: 'map', title: a ? `Untitled ${noun(a, 1)} map` : 'Untitled map', author: 'me', published: null, version: 0, summary: '', topics: a ? [a.noun || 'map'] : [], belongsTo: atlasId ? [atlasId] : [], size: '0 KB', props: {}, features: [] }
		S.tab = 'details'
		location.hash = hashFor({ kind: 'map', id, edit: true })
		setTimeout(() => { S.tool = 'point'; render(); toast(atlasId ? `New map in “${D.atlases[atlasId].title}”. Click the map to add points.` : 'New map. Click the map to add points.') }, 60)
	}

	// ------------------------------------------------------------- listeners
	document.addEventListener('click', (e) => {
		const t = e.target.closest('[data-act]')
		if (!t) return
		const act = t.dataset.act
		if (act === 'dialog-backdrop') { if (e.target === t) A['dialog-cancel'](); return }
		if (A[act]) { e.preventDefault(); A[act](t.dataset, t) }
	})
	document.addEventListener('input', (e) => {
		const b = e.target.dataset.bind
		if (e.target.dataset.bindProp && S.editing) { const d = S.drafts[S.editing.id]; d.props = d.props || {}; if (e.target.value) d.props[e.target.dataset.bindProp] = e.target.value; else delete d.props[e.target.dataset.bindProp]; render(); return }
		if (b && S.editing) {
			const d = S.drafts[S.editing.id]
			if (b === 'title') { d.title = e.target.textContent.trim() || 'Untitled'; renderShelf() }
			else if (b === 'policy') { d.policy = e.target.value; render() }
			else d[b] = e.target.value
		}
		if (e.target.id === 'q') { S.query = e.target.value; S.resultsOpen = !!S.query; const res = e.target.closest('.search').querySelector('.results'); res.innerHTML = S.query ? resultsHtml(S.query) : ''; res.classList.toggle('open', !!S.query) }
		if (e.target.id === 'composer-text') autoGrow(e.target)
		if (e.target.id === 'bq') { S.browse.q = e.target.value; const host = $('#lrows'); if (host) host.innerHTML = browseRows() }
		if (e.target.id === 'bsort') { S.browse.sort = e.target.value; render() }
	})
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') { if (S.menu || S.dialog || S.resultsOpen || S.popup || S.tool) { S.menu = null; S.dialog = null; S.resultsOpen = false; S.popup = null; closeTool(); pendingEditPrompt = false; render() } return }
		if (e.target.id === 'composer-text' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); A.send(); return }
		if (e.target.id === 'q' && e.key === 'Enter') { const first = $('#results .row'); const t = S.query.trim().toLowerCase(); if (/\?$/.test(t) || /^(how|what|where|which|why|who|when)\b/.test(t)) askFrom(S.query); else if (first) first.click(); return }
		if (e.target.id === 'askq' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); A['ask-send'](); return }
		if (e.target.id === 'dlg-name' && e.key === 'Enter') { const go = $('.dialog .btn.primary'); if (go) go.click(); return }
		if (e.target.matches('input,textarea,[contenteditable]')) return
		if (e.key === '/') { e.preventDefault(); const q = $('#q'); if (q) q.focus() }
		if (S.editing && S.editing.kind === 'map') {
			if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
			if (e.key === 'Enter' && S.drawing.length) finishDrawing()
			if (e.key === 'Backspace' && S.selection.size) { pushUndo(); const d = S.drafts[S.editing.id]; d.features = d.features.filter((f) => !S.selection.has(f.id)); S.selection.clear(); render() }
		}
	})
	document.addEventListener('focusin', (e) => { if (e.target.id === 'q' && S.query) { S.resultsOpen = true; e.target.closest('.search').querySelector('.results').classList.add('open') } })
	document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.search') && S.resultsOpen && !isMobile()) { S.resultsOpen = false; $$('.results').forEach((r) => r.classList.remove('open')) } })

	// Canvas (SVG fallback only): pan, zoom, hover, click, draw
	const cv = $('#canvas')
	let drag = null
	cv.addEventListener('pointerdown', (e) => {
		if (ml) return
		if (e.target.closest('.overlay,.shelf,.mtop,.popup,#popup')) return
		drag = { x: e.clientX, y: e.clientY, vx: S.view.x, vy: S.view.y, moved: false, target: e.target }
		cv.setPointerCapture(e.pointerId)
	})
	cv.addEventListener('pointermove', (e) => {
		if (ml) return
		if (drag) {
			const dx = e.clientX - drag.x, dy = e.clientY - drag.y
			if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; cv.classList.add('panning') }
			if (drag.moved) { S.view.x = drag.vx + dx; S.view.y = drag.vy + dy; applyView(false); renderStatus(); if (S.popup) renderPopup() }
			return
		}
		const f = e.target.closest('[data-fid]')
		const mapId = f ? f.dataset.map : null
		$$('.schip').forEach((c) => c.classList.toggle('hover', !!mapId && c.dataset.map === mapId))
		$$('.lyr').forEach((l) => l.classList.toggle('hover', !!mapId && l.dataset.map === mapId))
		$$('.f.hov').forEach((x) => x.classList.remove('hov'))
		if (f) { const sib = $$(`[data-fid="${CSS.escape(f.dataset.fid)}"][data-map="${mapId}"]`); sib.forEach((x) => x.classList.add('hov')) }
	})
	document.addEventListener('pointerover', (e) => { const r = e.target.closest('[data-hover-map]'); const id = r ? r.dataset.hoverMap : ''; $$('.schip').forEach((c) => c.classList.toggle('hover', !!id && c.dataset.map === id)); $$('.lyr').forEach((l) => l.classList.toggle('hover', !!id && l.dataset.map === id)) })
	cv.addEventListener('pointerleave', () => { $$('.schip.hover,.lyr.hover').forEach((c) => c.classList.remove('hover')) })
	cv.addEventListener('pointerup', (e) => {
		if (ml || !drag) return
		const wasDrag = drag.moved; const target = drag.target; drag = null; cv.classList.remove('panning')
		if (wasDrag) return
		if (target.closest('.overlay,.shelf,.mtop,#popup')) return
		const hit = target.closest('[data-fid]')
		const sight = target.closest('[data-act="open"]')
		if (sight && !hit) { A.open(sight.dataset); return }
		if (S.tool && S.editing && S.editing.kind === 'map') { placeAt(screenToWorld(e.clientX, e.clientY)); return }
		if (hit) { featureClicked(hit.dataset.map, hit.dataset.fid, e); return }
		if (S.popup) { S.popup = null; render() }
	})
	cv.addEventListener('dblclick', (e) => { if (!ml && S.drawing.length) { e.preventDefault(); finishDrawing() } })
	cv.addEventListener('wheel', (e) => { if (ml) return; e.preventDefault(); const r = canvasRect(); zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top) }, { passive: false })
	function finishDrawing() {
		const need = S.tool === 'polygon' ? 3 : 2
		if (S.drawing.length >= need) { pushUndo(); const d = S.drafts[S.editing.id]; d.features.push({ id: `${S.tool}-${Date.now()}`, name: `${S.tool === 'polygon' ? 'Area' : 'Line'} ${d.features.length + 1}`, type: S.tool === 'polygon' ? 'polygon' : 'line', coords: S.drawing.slice(), props: {} }) }
		S.drawing = []; render()
	}
	// Pinch zoom (two pointers) — coarse but smooth enough for a sketch.
	const touches = new Map()
	cv.addEventListener('pointerdown', (e) => { if (!ml && e.pointerType === 'touch') touches.set(e.pointerId, [e.clientX, e.clientY]) })
	cv.addEventListener('pointermove', (e) => {
		if (ml || e.pointerType !== 'touch' || !touches.has(e.pointerId)) return
		const prev = Array.from(touches.values())
		touches.set(e.pointerId, [e.clientX, e.clientY])
		if (touches.size === 2) {
			drag = null
			const cur = Array.from(touches.values())
			const d0 = Math.hypot(prev[0][0] - prev[1][0], prev[0][1] - prev[1][1]), d1 = Math.hypot(cur[0][0] - cur[1][0], cur[0][1] - cur[1][1])
			if (d0 > 0) { const r = canvasRect(); zoomBy(d1 / d0, (cur[0][0] + cur[1][0]) / 2 - r.left, (cur[0][1] + cur[1][1]) / 2 - r.top) }
		}
	})
	cv.addEventListener('pointerup', (e) => touches.delete(e.pointerId))
	cv.addEventListener('pointercancel', (e) => touches.delete(e.pointerId))

	// Mobile sheet drag
	const margin = $('#margin')
	let sheetDrag = null
	margin.addEventListener('pointerdown', (e) => {
		if (!isMobile()) return
		if (!e.target.closest('.handle,.margin-head .nav,.margin-head .title')) return
		sheetDrag = { y: e.clientY, h: margin.getBoundingClientRect().height, moved: false }
		margin.setPointerCapture(e.pointerId)
	})
	margin.addEventListener('pointermove', (e) => {
		if (!sheetDrag) return
		const dy = sheetDrag.y - e.clientY
		if (Math.abs(dy) > 6) { sheetDrag.moved = true; margin.classList.add('dragging'); margin.style.setProperty('--sheet-h', Math.max(80, Math.min(innerHeight - 64, sheetDrag.h + dy)) + 'px') }
	})
	margin.addEventListener('pointerup', (e) => {
		if (!sheetDrag) return
		margin.classList.remove('dragging')
		if (sheetDrag.moved) {
			const h = margin.getBoundingClientRect().height
			S.detent = h < innerHeight * 0.3 ? 'peek' : h < innerHeight * 0.72 ? 'half' : 'full'
			sheetDrag = null; render(); return
		}
		sheetDrag = null
	})

	// About panel
	A.about = () => { S.aboutOpen = !S.aboutOpen; renderAbout() }
	function renderAbout() {
		let p = $('#aboutpanel')
		if (!S.aboutOpen) { if (p) p.remove(); return }
		if (!p) { p = document.createElement('div'); p.id = 'aboutpanel'; p.className = 'about-panel'; document.body.appendChild(p) }
		p.innerHTML = `<h3>What is clickable</h3><ul>
			<li><b>Search</b> anything, or end with <kbd>?</kbd> to ask. Press <kbd>/</kbd> to focus.</li>
			<li><b>Open</b> a card, chip, or search result. <b>Back</b> is browser back.</li>
			<li><b>Edit</b> a map you own; <b>Fork</b> one you don’t. Only one thing is in Edit.</li>
			<li><b>Thread</b> tab: try the suggested prompts. Proposals appear as amber ghosts (maps) or amber paragraphs (stories, atlases).</li>
			<li><b>Canvas</b>: drag to pan, wheel or pinch to zoom, hover a feature to light its chip, click a feature for a popup, click features while editing to select them.</li>
			<li><b>Tool pill</b> while editing: point, line (double-click to finish), polygon, label; <kbd>⌘Z</kbd> undo, <kbd>⌫</kbd> deletes selection.</li>
			<li><b>Belongs to</b> chips on a map; <b>Atlas</b> pages with Pinned / Added / Waiting.</li>
			<li><b>Publish ▾</b> for audience and “as new map”; <b>Drafts</b> and <b>Me</b> at top right.</li>
			<li>Narrow the window under 760px for the phone shell.</li></ul>
			<p class="muted" style="margin:0">Local state only. Reload to reset.</p>`
	}

	window.addEventListener('hashchange', onRoute)
	window.addEventListener('resize', () => render())

	// ------------------------------------------------------------------ boot
	try { const t = localStorage.getItem('sketch-theme'); if (t && t !== 'system') document.documentElement.dataset.theme = t } catch {}
	window.__sketch = { S, D, flyToMaps, bbox, render, canvasRect }
	try { const g = localStorage.getItem('sketch-glass'); S.glass = g === null ? isMobile() : g === '1' } catch { S.glass = isMobile() }
	S.view = { x: 0, y: 0, k: 1 }
	initBasemap()
	onRoute()
	setTimeout(() => { if (!S.route.kind && !ml) A.fit() }, 30)
})()
