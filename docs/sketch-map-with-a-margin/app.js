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
		liked: new Set(),
		faved: new Set(),
		annot: null,
		replyTo: null,
		previewProposal: null,
		commentSort: 'new',
		moveMode: false,
		sheetHidden: false,
		liveMine: null,
		followLive: null,
		refPick: null,
		presentScene: null,
		sceneIndex: -1,
		activeBlock: -1,
		followText: true,
		followMuteUntil: 0,
		emphasis: new Set(),
		featFilter: '',
		featType: null,
		featExpanded: new Set(),
		featAll: false,
		tick: 0,
		tickPaused: false,
		basemap: 'svg',
		ask: { msgs: [] },
		counter: 1,
	}

	// ---------------------------------------------------------------- objects
	const KINDS = { map: D.maps, story: D.stories, atlas: D.atlases }
	function obj(kind, id) {
		if (kind === 'sighting') return D.sightings.find((s) => s.id === id)
		if (kind === 'circle') return D.circles.find((c) => c.id === id)
		if (kind === 'nearby') return D.nearby.find((n) => n.id === id)
		if (kind === 'live') return D.live.find((l) => l.id === id)
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
		return S.threadSide && !isMobile() && innerWidth >= 1100 && ['map', 'story', 'atlas'].includes(S.route.kind)
	}
	const audienceOf = (m) => m.audience || 'everyone'
	const audienceLabelOf = (a) => a === 'everyone' ? 'Everyone' : a.startsWith('circle:') ? `Circle: ${(D.circles.find((c) => c.id === a.slice(7)) || { title: a }).title}` : `Nearby: ${(D.nearby.find((n) => n.id === a.slice(7)) || { title: a }).title}`
	const isPrivate = (m) => audienceOf(m) !== 'everyone'
	const canSee = (m) => { const a = audienceOf(m); if (a === 'everyone') return true; if (a.startsWith('circle:')) { const c = D.circles.find((x) => x.id === a.slice(7)); return !!c && c.members.some((mm) => mm.id === 'me') } const n = D.nearby.find((x) => x.id === a.slice(7)); return !!n && n.peers.some((p) => p.id === 'me') }
	const unread = () => D.notifications.filter((n) => !n.read).length
	const social = (k) => D.social[k] || (D.social[k] = { likes: 0, zaps: 0, favs: 0 })
	const commentsOn = (k) => D.comments.filter((c) => c.on === k)
	const proposalsOn = (k) => D.proposals.filter((p) => p.target === k)
	const pendingOn = (k) => proposalsOn(k).filter((p) => p.status === 'pending')
	function diffDraft(orig, draft) {
		const byId = new Map(orig.features.map((f) => [f.id, f]))
		const add = [], modify = [], remove = []
		draft.features.forEach((f) => { const o = byId.get(f.id); if (!o) add.push(f); else if (JSON.stringify(o) !== JSON.stringify(f)) modify.push(f) })
		orig.features.forEach((f) => { if (!draft.features.some((x) => x.id === f.id)) remove.push(f.id) })
		return { add, modify, remove }
	}
	function beginPropose(kind, id) {
		const o = obj(kind, id); if (!o) return
		if (!S.drafts[id]) S.drafts[id] = Object.assign(clone(o), { kind, base: o.version || 1, audience: 'everyone', isDraft: true, mode: 'propose' })
		S.editing = { kind, id, mode: 'propose' }
		S.undo = []; S.redo = []; S.selection.clear()
		if (kind === 'map') addToShelf(id, { silent: true })
		syncHash()
	}
	const proposing = () => !!(S.editing && S.editing.mode === 'propose')
	function sendProposal(message) {
		const { kind, id } = S.editing
		const d = S.drafts[id], o = obj(kind, id)
		const diff = kind === 'map' ? diffDraft(o, d) : { add: [], modify: [], remove: [], body: d.body }
		const p = { id: `prop-${Date.now()}`, target: key(kind, id), author: 'me', created: today, status: 'pending', message: message || '(no message)', add: diff.add, modify: diff.modify.map((f) => ({ id: f.id, name: f.name, props: f.props, coords: f.coords })), remove: diff.remove, body: diff.body }
		D.proposals.unshift(p)
		delete S.drafts[id]; S.editing = null; S.proposal = null; S.selection.clear(); closeTool()
		S.tab = 'details'
		toast(`Proposal sent to ${person(o.author).name}. You will see its status on the ${kind}.`)
		location.hash = hashFor({ kind, id, edit: false })
	}
	function acceptProposal(pid) {
		const p = D.proposals.find((x) => x.id === pid); if (!p) return
		const [kind, id] = p.target.split(':'); const o = obj(kind, id)
		if (kind === 'map') {
			p.add.forEach((f) => { if (!o.features.some((x) => x.id === f.id)) o.features.push(clone(f)) })
			p.modify.forEach((m) => { const f = o.features.find((x) => x.id === m.id); if (f) { if (m.name) f.name = m.name; if (m.props) f.props = Object.assign({}, f.props, m.props); if (m.coords) f.coords = m.coords } })
			p.remove.forEach((rid) => { o.features = o.features.filter((f) => f.id !== rid) })
		} else if (p.body) o.body = p.body
		o.version = (o.version || 0) + 1; o.published = today
		p.status = 'accepted'; p.acceptedAs = o.version
		S.previewProposal = null
		toast(`Accepted. Published as v${o.version}; ${person(p.author).name} is credited.`)
		render()
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
	// MapPresentationV1: an embedded value, never an entity. The Shelf + camera is the live form of it.
	function capturePresentation(mapIds) {
		const ids = mapIds || S.shelf.map((e) => e.id)
		const view = ml ? { center: [r3(ml.getCenter().lng), r3(ml.getCenter().lat)], zoom: Math.round(ml.getZoom() * 10) / 10 } : null
		const layers = {}
		ids.forEach((id) => { const e = S.shelf.find((x) => x.id === id); layers[id] = { visible: e ? e.visible : true } })
		return { version: 1, initialView: view, layerOrder: S.shelf.filter((e) => ids.includes(e.id)).map((e) => e.id), layers }
	}
	function applyPresentation(p, allowed) {
		if (!p) return
		const order = (p.layerOrder || []).filter((id) => !allowed || allowed.includes(id))
		if (order.length) {
			const rest = S.shelf.filter((e) => !order.includes(e.id))
			S.shelf = [...order.map((id) => S.shelf.find((e) => e.id === id) || { id, visible: true }), ...rest]
		}
		Object.entries(p.layers || {}).forEach(([id, l]) => { if (allowed && !allowed.includes(id)) return; const e = S.shelf.find((x) => x.id === id); if (e && typeof l.visible === 'boolean') e.visible = l.visible })
		if (p.initialView && p.initialView.center) flyToView(p.initialView)
		else if (order.length) flyToMaps(order)
		syncHash()
	}
	function flyToView(v) {
		if (ml) { ml.flyTo({ center: v.center, zoom: v.zoom || 4, duration: 800 }); return }
		flyTo([v.center[0] - 4, v.center[1] - 2, v.center[0] + 4, v.center[1] + 2])
	}
	// Per-paragraph map state: base presentation, then every scene delta up to and including this block.
	const sceneFor = (story, i) => (story.presentation && story.presentation.scenes ? story.presentation.scenes.find((sc) => sc.anchor === i) : null)
	function effectiveState(story, i) {
		const p = story.presentation || {}
		const layers = {}
		story.maps.forEach((id) => { layers[id] = !(p.layers && p.layers[id] && p.layers[id].visible === false) })
		let view = p.initialView || null
		const scenes = (p.scenes || []).filter((sc) => sc.anchor <= i).sort((a, b) => a.anchor - b.anchor)
		scenes.forEach((sc) => { Object.entries(sc.layers || {}).forEach(([id, l]) => { if (typeof l.visible === 'boolean' && id in layers) layers[id] = l.visible }); if (sc.view) view = sc.view })
		const b = story.body[i]
		const refs = new Set((b && b.refs ? b.refs : []).map((r) => `${r.map}:${r.feature}`))
		return { layers, view, refs, scene: sceneFor(story, i) }
	}
	function applyBlockState(story, i, opts = {}) {
		const st = effectiveState(story, i)
		Object.entries(st.layers).forEach(([id, vis]) => { const e = S.shelf.find((x) => x.id === id); if (e) e.visible = vis })
		S.activeBlock = i
		S.emphasis = st.refs
		S.followMuteUntil = Date.now() + 1200
		if (st.view && opts.fly !== false) flyToView(st.view)
		syncHash()
		if (opts.render !== false) render()
	}
	function blockSummary(story, i) {
		const sc = sceneFor(story, i); if (!sc) return ''
		const shows = Object.entries(sc.layers || {}).filter(([, l]) => l.visible === true).map(([id]) => (D.maps[id] || { title: id }).title)
		const hides = Object.entries(sc.layers || {}).filter(([, l]) => l.visible === false).map(([id]) => (D.maps[id] || { title: id }).title)
		return [shows.length ? 'shows ' + shows.join(', ') : '', hides.length ? 'hides ' + hides.join(', ') : '', sc.view ? '⌖ moves the camera' : ''].filter(Boolean).join(' · ')
	}
	function goScene(story, i) {
		const sc = story.presentation && story.presentation.scenes ? story.presentation.scenes[i] : null
		if (!sc) return
		S.sceneIndex = i
		applyBlockState(story, sc.anchor)
		setTimeout(() => { const el = $(`.blk[data-blk="${sc.anchor}"]`); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, 30)
	}
	// Live sharing: the banner is the only place that owns the state.
	function startLive() {
		if (S.liveMine) return
		const c = screenToWorld(innerWidth / 2, innerHeight / 2)
		D.live.push({ id: 'me-live', author: 'me', title: 'You', coords: c, since: 'now', lastSeen: 0, discovery: 'link', watching: 0, audience: 'everyone', startedAt: Date.now() })
		S.liveMine = 'me-live'; S.liveOn = true
		render(); toast('You are live. Only people with the link can see you until you change that.')
	}
	function stopLive() {
		D.live = D.live.filter((l) => l.id !== 'me-live')
		S.liveMine = null; if (S.followLive === 'me-live') S.followLive = null
		if (S.route.kind === 'live' && S.route.id === 'me-live') location.hash = '#/'
		render(); toast('Stopped sharing. The last position is gone from the map.')
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
		if (r.kind && !['shelf', 'browse', 'ask', 'in', 'inbox', 'me'].includes(r.kind) && !obj(r.kind, r.id)) {
			toast('That link points at nothing here.')
			location.hash = '#/'
			return
		}
		S.route = { kind: r.kind, id: r.id, edit: r.edit }
		if (r.kind) S.sheetHidden = false
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
			if (prev.id !== r.id) { if (st.presentation) applyPresentation(st.presentation, st.maps); else flyToMaps(st.maps); if (st.presentation && (st.presentation.scenes || []).length) { applyBlockState(st, 0, { render: false }); S.sceneIndex = st.presentation.scenes.findIndex((sc) => sc.anchor === 0) } else S.sceneIndex = -1 } 
		} else if (r.kind === 'sighting') {
			S.liveOn = true
			flyTo(bbox([{ type: 'point', coords: obj('sighting', r.id).coords }]), true)
		} else if (r.kind === 'live') {
			S.liveOn = true
			flyTo(bbox([{ type: 'point', coords: obj('live', r.id).coords }]), true)
		} else if (r.kind === 'circle' || r.kind === 'nearby') {
			const aud = `${r.kind}:${r.id}`
			const ids = Object.values(D.maps).filter((m) => audienceOf(m) === aud).map((m) => m.id)
			ids.forEach((id) => addToShelf(id, { silent: true }))
			if (prev.id !== r.id && ids.length) flyToMaps(ids)
		}
		if (r.kind === 'inbox') D.notifications.forEach((n) => { n.seen = true })
		// Edit is a state of exactly one object.
		if (r.edit && (r.kind === 'map' || r.kind === 'story' || r.kind === 'atlas')) {
			if (S.editing && S.editing.id !== r.id && !pendingEditPrompt) {
				pendingEditPrompt = true
				S.route.edit = false
				S.dialog = { type: 'finish-first', next: { kind: r.kind, id: r.id } }
			} else if (!S.editing || S.editing.id !== r.id) {
				if (mine(obj(r.kind, r.id))) beginEdit(r.kind, r.id); else beginPropose(r.kind, r.id)
			}
		}
		if (!['map', 'story', 'atlas', 'sighting', 'circle', 'nearby'].includes(r.kind)) S.tab = 'details'
		if ((r.kind === 'circle' || r.kind === 'nearby') && S.tab === 'thread') S.tab = 'details'
		if (r.kind !== 'story') { S.presentScene = null; S.refPick = null; S.activeBlock = -1; S.emphasis = new Set() }
		if (r.kind === 'story' && prev.id !== r.id) { S.activeBlock = -1; S.emphasis = new Set() }
		if (r.kind === 'sighting' && S.tab === 'thread') S.tab = 'details'
		if (prev.id !== r.id) { S.annot = null; S.replyTo = null; S.previewProposal = null }
		if (!r.edit) { S.selection.clear() }
		if (isMobile() && r.kind && r.kind !== 'browse') S.detent = r.edit && r.kind === 'map' ? 'peek' : 'half'
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
		if (!S.drafts[id]) S.drafts[id] = Object.assign(clone(o), { kind, base: o.version || 1, audience: o.audience && o.audience.startsWith('circle:') ? 'circle' : o.audience && o.audience.startsWith('nearby:') ? 'nearby' : 'everyone', isDraft: true })
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
		if (proposing()) { S.dialog = { type: 'send-proposal' }; render(); return }
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
		const patch = clone(d); delete patch.kind; delete patch.base; delete patch.isDraft; patch.audience = d.audience === 'circle' ? 'circle:alpine' : d.audience === 'nearby' ? 'nearby:saturday' : 'everyone'
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
			if (!mine(o)) { beginPropose(kind, id); location.hash = hashFor({ kind, id, edit: true }) } else { beginEdit(kind, id); location.hash = hashFor({ kind, id, edit: true }) }
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
		renderTopbar(); renderTicker(); renderMargin(); renderCanvas(); renderShelf(); renderToolpill(); renderDiffbar(); renderMenus(); renderDialog(); renderMobile(); renderStatus()
		document.body.classList.toggle('glass', !!S.glass)
		renderLensBar()
		renderLiveBar()
		const stage = $('#stage')
		stage.classList.toggle('margin-open', isMobile() ? !S.sheetHidden : !!S.route.kind || !!landingOpen())
		stage.classList.toggle('thread-side', sideThreadActive())
		$('#margin').dataset.detent = S.detent
		if (isMobile()) {
			const peekPx = mobileEditing() ? 62 : 96
			const h = S.detent === 'peek' ? peekPx + 'px' : S.detent === 'half' ? '50%' : 'calc(100% - 64px)'
			$('#margin').style.setProperty('--sheet-h', h)
			const px = S.detent === 'peek' ? peekPx : S.detent === 'half' ? innerHeight * 0.5 : innerHeight - 64
			document.documentElement.style.setProperty('--sheet-peek', (S.sheetHidden ? 0 : px) + 'px')
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
		const bars = (a ? 1 : 0) + (S.liveMine ? 1 : 0)
		document.documentElement.style.setProperty('--bars-h', (isMobile() ? bars * 38 : bars * 38) + 'px')
		document.documentElement.style.setProperty('--lens-h', bars ? bars * 38 + 'px' : '0px')
	}
	function renderLiveBar() {
		const bar = $('#livebar'); const l = S.liveMine ? obj('live', S.liveMine) : null
		bar.hidden = !l
		if (!l) return
		const mins = Math.max(0, Math.round((Date.now() - (l.startedAt || Date.now())) / 60000))
		bar.innerHTML = `<span class="dot"></span><b>You are live</b><span class="ls">${mins} min · ${l.watching} watching · ${l.discovery === 'public' ? 'anyone can find you' : 'link only'}</span><span class="sp"></span><button class="btn sm quiet" data-act="menu" data-menu="live-discovery">${l.discovery === 'public' ? 'Public' : 'Link only'} ▾</button><button class="btn sm quiet" data-act="toast-copied">Share link</button><button class="btn sm quiet" data-act="open" data-kind="live" data-id="me-live">Details</button><button class="btn sm stop" data-act="stop-live">Stop</button>`
	}

	function renderTopbar() {
		$('#search').innerHTML = searchHtml()
		const drafts = Object.keys(S.drafts).length
		document.body.classList.toggle('thread-side', sideThreadActive())
		$('#topright').innerHTML = `
			<button class="btn quiet ${S.route.kind === 'browse' || !S.route.kind ? 'on' : ''}" data-act="open" data-kind="browse" data-id="${S.browse.kind}">Browse</button>
			<button class="btn quiet" data-act="menu" data-menu="drafts">Drafts ${drafts ? `<span class="badge">${drafts}</span>` : ''}</button>
			<button class="btn quiet ${S.route.kind === 'inbox' ? 'on' : ''}" data-act="open" data-kind="inbox" data-id="now" title="Inbox">Inbox ${unread() ? `<span class="badge warn">${unread()}</span>` : ''}</button>
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
		else if (kind === 'inbox') html = inboxHtml()
		else if (kind === 'me') html = meListHtml(id)
		else if (kind === 'circle') html = circleHtml(id)
		else if (kind === 'nearby') html = nearbyHtml(id)
		else if (kind === 'live') html = liveHtml(id)
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
		const peek = mobileEditing() ? `<div class="mpeek" data-act="detent"><span class="state-pill edit">✎</span><b>${esc(S.drafts[S.editing.id].title)}</b><span class="muted">${S.drafts[S.editing.id].features.length} features</span><span style="flex:1"></span><span class="split" onclick="event.stopPropagation()"><button class="btn sm primary" data-act="publish" data-mode="${D.maps[S.editing.id].published ? 'update' : 'new'}">${D.maps[S.editing.id].published ? 'Publish update' : 'Publish'}</button><button class="btn sm primary" data-act="menu" data-menu="publish">▾</button></span></div>` : ''
		m.innerHTML = `<div class="handle" data-act="detent" aria-hidden="true" style="height:14px;flex:none;cursor:grab"></div>${peek}${html}`
		m.classList.toggle('enter', changed)
		if ($('.margin-body', m) && !changed) $('.margin-body', m).scrollTop = prevScroll
		const tc = $('#threadcol')
		tc.hidden = !sideThread
		if (sideThread) tc.innerHTML = `<div class="margin-head" style="padding-bottom:.35rem"><div class="nav"><span class="eyebrow">Thread · ${esc(kind)}</span><span style="flex:1"></span><button class="btn sm quiet" data-act="thread-dock" title="Show the Thread as a tab of the margin instead">⇤ Dock</button></div></div>${threadHtml(kind, id)}`
		const ta = $('#composer-text'); if (ta) autoGrow(ta)
		observeBlocks()
	}
	// One header grammar for every object panel:
	//   nav:   ◂ Back · KIND · state                       ◐
	//   title
	//   meta:  avatar author · counts            [primary actions]
	//   social row
	function head(o, kind, opts = {}) {
		const p = person(o.author)
		const inEdit = S.editing && S.editing.id === o.id
		const editable = inEdit ? ' contenteditable="true" data-bind="title" spellcheck="false"' : ''
		const priv = o.audience && o.audience !== 'everyone' ? `<span class="state-pill lock">🔒 ${esc(audienceLabelOf(o.audience))}</span>` : ''
		const state = priv + (inEdit && proposing() ? `<span class="state-pill warn">✎ proposing to ${esc(person(o.author).name)}</span>` : inEdit ? `<span class="state-pill edit">✎ editing${o.forkOf ? ' · fork' : ''}</span>` : o.draft || o.published === null ? '<span class="state-pill draft">draft · unpublished</span>' : `<span class="state-pill">v${o.version || 1} · ${esc(o.published)}</span>`)
		return `<div class="margin-head">
			<div class="nav"><button class="btn sm quiet" data-act="back">◂ Back</button><span class="kindline"><span class="eyebrow">${esc(kind)}</span>${state}</span><span style="flex:1"></span>${opts.nav || ''}<button class="btn sm quiet glassbtn" data-act="glass" data-v="${S.glass ? '0' : '1'}" title="${S.glass ? 'Solid panels' : 'See the map through the panels'}">◐</button><button class="btn sm quiet mclose" data-act="m-close" title="Close and show just the map" aria-label="Close">×</button></div>
			<div class="title"${editable}>${esc(o.title)}</div>
			<div class="metarow"><span class="meta"><span class="avatar sm">${p.initials}</span><button class="who" data-act="open" data-kind="person" data-id="${p.id}">${esc(p.name)}</button>${opts.sub || ''}</span><span class="acts">${opts.actions || ''}</span></div>
			${opts.social === false ? '' : socialRow(kind, o.id)}
		</div>`
	}
	function socialRow(kind, id) {
		const k = key(kind, id); const sc = social(k); const n = commentsOn(k).length; const pend = pendingOn(k).length
		const liked = S.liked.has(k), faved = S.faved.has(k)
		return `<div class="social">
			<button class="sb ${liked ? 'on' : ''}" data-act="like" data-k="${k}" title="React">${liked ? '♥' : '♡'}<span>${sc.likes + (liked ? 1 : 0)}</span></button>
			<button class="sb" data-act="zap" data-k="${k}" title="Zap">⚡<span>${sc.zaps}</span></button>
			<button class="sb ${S.tab === 'comments' ? 'on' : ''}" data-act="tab" data-tab="comments" title="Comments">💬<span>${n}</span></button>
			<button class="sb ${faved ? 'on' : ''}" data-act="fav" data-k="${k}" title="Favourite">${faved ? '★' : '☆'}<span>${sc.favs + (faved ? 1 : 0)}</span></button>
			<button class="sb" data-act="menu" data-menu="share" title="Share">↗<span>Share</span></button>
			${pend ? `<button class="sb warn" data-act="tab" data-tab="details" title="Proposals waiting">✎<span>${pend} proposal${pend === 1 ? '' : 's'}</span></button>` : ''}
			<span class="sp"></span><button class="sb quiet" data-act="menu" data-menu="more-object" title="More">⋯</button>
		</div>`
	}
	function tabsHtml(kind, id, sideThread) {
		if (sideThread) { const nc0 = commentsOn(key(kind, id)).length; if (S.tab === 'thread') S.tab = 'details'; return `<div class="tabs" role="tablist"><button role="tab" class="${S.tab === 'details' ? 'on' : ''}" data-act="tab" data-tab="details">Details</button><button role="tab" class="${S.tab === 'comments' ? 'on' : ''}" data-act="tab" data-tab="comments">Comments${nc0 ? ` <span class="n">${nc0}</span>` : ''}</button><span class="spacer"></span><span class="muted" style="font-size:.72rem;align-self:center">Thread is on the right</span></div>` }
		const running = S.run && S.run.id === id
		const nc = commentsOn(key(kind, id)).length
		return `<div class="tabs" role="tablist">
			<button role="tab" class="${S.tab === 'details' ? 'on' : ''}" data-act="tab" data-tab="details">Details</button>
			<button role="tab" class="${S.tab === 'comments' ? 'on' : ''}" data-act="tab" data-tab="comments">Comments${nc ? ` <span class="n">${nc}</span>` : ''}</button>
			<button role="tab" class="${S.tab === 'thread' ? 'on' : ''}" data-act="tab" data-tab="thread">Thread${running ? '<span class="run"></span>' : ''}</button>
			<span class="spacer"></span>
			${S.tab === 'thread' && !isMobile() && innerWidth >= 1100 ? '<button class="btn sm quiet" data-act="thread-side" title="Pull the thread out to the right">⇥ Pull out</button>' : ''}
		</div>`
	}
	const BROWSE_KINDS = [['maps', 'Maps'], ['stories', 'Stories'], ['atlases', 'Atlases'], ['sightings', 'Sightings'], ['people', 'People']]
	function browseItems(kind) {
		const q = S.browse.q.trim().toLowerCase()
		const hit = (...xs) => !q || xs.some((x) => String(x || '').toLowerCase().includes(q))
		const inFilter = (m) => !S.filter || (S.filter.type === 'atlas' ? m.belongsTo.includes(S.filter.id) || D.atlases[S.filter.id].pinned.includes(m.id) : S.filter.type === 'tag' ? m.topics.includes(S.filter.id) : true)
		let items = []
		const L = lensAtlas()
		if (kind === 'maps') items = Object.values(D.maps).filter((m) => (m.published || mine(m)) && canSee(m) && (!L || inAtlas(m, L)) && inFilter(m) && hit(m.title, person(m.author).name, m.topics.join(' '))).map((m) => ({ kind: 'map', id: m.id, title: m.title, author: m.author, date: m.published || 'draft', meta: `${isPrivate(m) ? '🔒 ' + audienceLabelOf(m.audience) + ' · ' : ''}${m.features.length} features · ${m.size}${m.topics.length ? ' · #' + m.topics.slice(0, 2).join(' #') : ''}`, feats: m.features, onShelf: S.shelf.some((e) => e.id === m.id) }))
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
			const k = key(it.kind, it.id); const sc = it.kind === 'person' ? null : social(k); const nc = it.kind === 'person' ? 0 : commentsOn(k).length; const pend = it.kind === 'person' ? 0 : pendingOn(k).length
			const likes = sc ? sc.likes + (S.liked.has(k) ? 1 : 0) : 0
			const counts = sc ? `<span class="cnt">${[likes ? `♥ ${likes}` : '', nc ? `💬 ${nc}` : '', sc.zaps ? `⚡ ${sc.zaps}` : '', pend ? `<span class="pend">✎ ${pend} proposal${pend === 1 ? '' : 's'}</span>` : ''].filter(Boolean).join(' · ')}</span>` : ''
			const primary = it.kind === 'map'
				? `<button data-act="${it.onShelf ? 'remove-shelf' : 'add-shelf'}" data-id="${it.id}" class="${it.onShelf ? 'on' : ''}" title="${it.onShelf ? 'Remove from map' : 'Show on map'}">${it.onShelf ? '◉' : '○'}</button>`
				: it.kind === 'story' ? `<button data-act="fly-story" data-id="${it.id}" title="Show its maps">⌖</button>` : it.kind === 'atlas' ? `<button data-act="show-all" data-id="${it.id}" title="Show all on map">⌖</button>` : ''
			const socialActs = it.kind === 'person' ? '' : `<span class="hov"><button data-act="like" data-k="${k}" class="${S.liked.has(k) ? 'on' : ''}" title="React">${S.liked.has(k) ? '♥' : '♡'}</button><button data-act="open-comments" data-kind="${it.kind}" data-id="${esc(it.id)}" title="Comments">💬</button><button data-act="fav" data-k="${k}" class="${S.faved.has(k) ? 'on' : ''}" title="Favourite">${S.faved.has(k) ? '★' : '☆'}</button></span><button data-act="menu" data-menu="row-more" data-kind="${it.kind}" data-id="${esc(it.id)}" title="More">⋯</button>`
			return `<div class="lrow ${on ? 'on' : ''}" data-hover-map="${it.kind === 'map' ? it.id : ''}"><div class="thumb">${it.feats.length ? thumb(it.feats, 40, 28) : ''}</div><button class="lmain" data-act="open" data-kind="${it.kind}" data-id="${esc(it.id)}"><div class="t">${esc(it.title)}</div><div class="s">${it.kind === 'person' ? esc(it.meta) : `${esc(person(it.author).name)} · ${esc(it.date)} · ${esc(it.meta)}`}</div>${counts}</button><div class="act">${primary}${socialActs}</div></div>`
		}).join('')
	}
	function browseKinds() { const L = lensAtlas(); return L ? [['maps', noun(L, 2)[0].toUpperCase() + noun(L, 2).slice(1)], ['stories', 'Stories'], ['people', 'People']] : BROWSE_KINDS }
	function browseHtml() {
		const L = lensAtlas()
		if (L && !browseKinds().some((x) => x[0] === S.browse.kind)) S.browse.kind = 'maps'
		const k = S.browse.kind
		const label = browseKinds().find((x) => x[0] === k)[1]
		const plus = { maps: ['new-map', L ? `New ${noun(L, 1)} map` : 'New map'], stories: ['new-story', 'New story'], atlases: ['new-atlas', 'New atlas'], sightings: ['new-sighting', 'New sighting'] }[k]
		return `<div class="margin-head compact"><div class="nav"><span class="eyebrow">${L ? `<span class="emblem" style="color:var(--accent)">${esc(L.emblem || '◈')}</span> ${esc(L.title)}` : 'Browse'}</span>${S.filter ? `<span class="chip">in ${esc(S.filter.label)} <button class="x" data-act="clear-filter">×</button></span>` : ''}<span style="flex:1"></span><button class="btn sm quiet" data-act="open" data-kind="shelf" data-id="now" title="What is drawn right now">On the map · ${S.shelf.length}</button><button class="btn sm quiet glassbtn" data-act="glass" data-v="${S.glass ? '0' : '1'}" title="Toggle glass panels">◐</button><button class="btn sm quiet mclose" data-act="m-close" title="Close and show just the map" aria-label="Close">×</button></div></div>
		<div class="ktabs" role="tablist">${browseKinds().map(([id, name]) => `<button role="tab" class="${k === id ? 'on' : ''}" data-act="browse-kind" data-k="${id}">${name}<span class="n">${browseItems(id).length}</span></button>`).join('')}${plus ? `<button class="btn sm primary plus" data-act="${plus[0]}" title="${esc(plus[1])}">+<span class="tl"> ${esc(plus[1])}</span></button>` : ''}</div>
		${L && k === 'maps' ? `<div class="lhint">${L.schemaFields ? 'Each ' + esc(noun(L, 1)) + ' map carries ' + L.schemaFields.map((f) => '<b>' + esc(f.label.toLowerCase()) + '</b>').join(' and ') + '.' : 'Anything that says it belongs here.'}</div>` : ''}
		<div class="ltools"><input id="bq" type="search" placeholder="Filter ${label.toLowerCase()}…" value="${esc(S.browse.q)}"><select id="bsort" aria-label="Sort"><option value="new" ${S.browse.sort === 'new' ? 'selected' : ''}>Newest</option><option value="title" ${S.browse.sort === 'title' ? 'selected' : ''}>Title</option><option value="author" ${S.browse.sort === 'author' ? 'selected' : ''}>Author</option></select></div>
		<div class="lhead"><span>${browseItems(k).length} ${label.toLowerCase()}</span><span class="sp"></span><span>${k === 'maps' ? '○ show on map · ♡ 💬 ☆ on hover · ⋯ more' : k === 'stories' || k === 'atlases' ? '⌖ frame on map · ⋯ more' : ''}</span></div>
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
		return `<div class="margin-head"><div class="nav"><button class="btn sm quiet" data-act="back">◂ Back</button><span class="kindline"><span class="eyebrow">ask</span><span class="state-pill">read-only · concierge</span></span><span style="flex:1"></span><button class="btn sm quiet glassbtn" data-act="glass" data-v="${S.glass ? '0' : '1'}">◐</button></div><div class="title">Ask Earthly</div><div class="metarow"><span class="meta muted">Find, measure, geocode, explain. Nothing is drawn or changed from here.</span></div></div>
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
		return `<div class="margin-head"><div class="nav"><button class="btn sm quiet" data-act="back">◂ Back</button><span class="kindline"><span class="eyebrow">shelf</span></span><span style="flex:1"></span><button class="btn sm quiet glassbtn" data-act="glass" data-v="${S.glass ? '0' : '1'}">◐</button></div><div class="title">On the map</div><div class="metarow"><span class="meta muted">${S.shelf.length} map${S.shelf.length === 1 ? '' : 's'} drawn right now</span><span class="acts"><button class="btn sm keep" data-act="save-view">Save as atlas</button></span></div></div>
		<div class="margin-body"><div class="list">${S.shelf.map((e) => { const m = D.maps[e.id]; return `<div class="item"><div class="thumb">${thumb(m.features)}</div><button style="text-align:left" data-act="open" data-kind="map" data-id="${m.id}"><div class="t">${esc(m.title)}</div><div class="s">${esc(person(m.author).name)} · ${m.features.length} features</div></button><div class="act"><button class="btn sm quiet" data-act="toggle-vis" data-id="${m.id}">${e.visible ? '◉' : '○'}</button><button class="btn sm quiet" data-act="remove-shelf" data-id="${m.id}">×</button></div></div>` }).join('') || '<div class="empty">Nothing on the map. Open a Map or Story.</div>'}</div></div>`
	}
	function mapHtml(id, edit, sideThread) {
		const m = view('map', id)
		const pub = D.maps[id]
		const inEdit = S.editing && S.editing.id === id
		const onShelf = S.shelf.some((e) => e.id === id)
		const actions = inEdit && proposing()
			? `<button class="btn sm primary keep" data-act="dialog" data-dialog="send-proposal">Send proposal to ${esc(person(pub.author).name)}</button><button class="btn sm keep" data-act="done">Keep for later</button><button class="btn sm quiet danger" data-act="dialog" data-dialog="discard">Discard</button>`
			: inEdit
			? `<span class="split"><button class="btn sm primary keep" data-act="publish" data-mode="${pub.published ? 'update' : 'new'}">${pub.published ? 'Publish update' : 'Publish'}</button><button class="btn sm primary keep" data-act="menu" data-menu="publish" aria-label="Publish options">▾</button></span><button class="btn sm keep" data-act="done">Done</button>`
			: `${mine(pub) ? `<button class="btn sm primary keep" data-act="edit">Edit</button>` : `<span class="split"><button class="btn sm primary keep" data-act="propose" title="Offer changes to ${esc(person(pub.author).name)}; they decide, nothing forks">Propose changes</button><button class="btn sm primary keep" data-act="menu" data-menu="edit-other" aria-label="Other ways to edit">▾</button></span>`}<button class="btn" data-act="${onShelf ? 'remove-shelf' : 'add-shelf'}" data-id="${id}">${onShelf ? 'Remove from map' : 'Show on map'}</button>`
		const stories = storiesReferencing(id)
		const glance = `<div class="section"><h4>At a glance</h4><dl class="kv two"><dt>Features</dt><dd>${m.features.length}</dd><dt>Size</dt><dd>${esc(m.size)}</dd><dt>Version</dt><dd>${pub.version || 0}${inEdit ? ' → ' + ((pub.version || 0) + 1) : ''}</dd><dt>Audience</dt><dd>${inEdit ? esc(audienceLabel(S.drafts[id].audience)) : 'Everyone'}</dd><dt>Published</dt><dd>${pub.published ? esc(pub.published) : 'not yet'}</dd><dt>Author</dt><dd>${esc(person(pub.author).name)}</dd>${pub.forkOf ? `<dt>Forked from</dt><dd><button class="btn sm quiet" data-act="open" data-kind="map" data-id="${pub.forkOf}">${esc(D.maps[pub.forkOf].title)}</button></dd>` : ''}</dl></div>`
		const GLYPH = { point: '●', line: '╱', polygon: '⬠' }
		const featuresSection = (() => {
			const all = m.features
			const q = S.featFilter.trim().toLowerCase()
			const list = all.filter((f) => (!S.featType || f.type === S.featType) && (!q || f.name.toLowerCase().includes(q) || Object.values(f.props || {}).some((v) => String(v).toLowerCase().includes(q))))
			const counts = { point: 0, line: 0, polygon: 0 }
			all.forEach((f) => { counts[f.type] = (counts[f.type] || 0) + 1 })
			const cap = 12
			const shown = S.featAll ? list : list.slice(0, cap)
			const selCount = inEdit ? all.filter((f) => S.selection.has(f.id)).length : 0
			const chip = (t, label) => `<button class="fchip ${S.featType === t ? 'on' : ''}" data-act="feat-type" data-t="${t || ''}">${label}</button>`
			const row = (f) => {
				const on = inEdit ? S.selection.has(f.id) : S.emphasis.has(`${id}:${f.id}`)
				const open = S.featExpanded.has(f.id)
				const props = Object.entries(f.props || {}).filter(([k]) => k !== 'label')
				const size = f.type === 'point' ? '1 point' : `${f.coords.length} points`
				return `<div class="frow ${on ? 'on' : ''}" data-hover-uid="${id}:${f.id}">
					<button class="fx" data-act="feat-expand" data-id="${f.id}" aria-label="${open ? 'Collapse' : 'Properties'}">${open ? '▾' : '▸'}</button>
					<span class="fg ${f.type}" title="${f.type}">${GLYPH[f.type] || '◆'}</span>
					<button class="fmain" data-act="${inEdit ? 'feat-select' : 'feat-focus'}" data-id="${f.id}"><span class="fn">${esc(f.props && f.props.label ? f.props.label : f.name)}</span><span class="fs">${size}${props.length ? ` · ${props.length} propert${props.length === 1 ? 'y' : 'ies'}` : ''}</span></button>
					<span class="fa">
						<button data-act="feat-zoom" data-id="${f.id}" title="Zoom to">⌖</button>
						${inEdit ? `<button data-act="feat-rename" data-id="${f.id}" title="Rename">✎</button><button data-act="feat-duplicate" data-id="${f.id}" title="Duplicate">⧉</button><button data-act="feat-delete" data-id="${f.id}" title="Delete" class="danger">⌫</button><button data-act="feat-up" data-id="${f.id}" title="Move up">↑</button><button data-act="feat-down" data-id="${f.id}" title="Move down">↓</button>` : `<button data-act="feat-copy" data-id="${f.id}" title="Copy GeoJSON">⧉</button><button data-act="feat-comment" data-id="${f.id}" title="Comment on this feature">💬</button>`}
					</span>
					${open ? `<div class="fprops">${props.length ? props.map(([k, v]) => `<span class="fp"><b>${esc(k)}</b>${inEdit ? `<input type="text" value="${esc(String(v))}" data-feat-prop="${f.id}" data-key="${esc(k)}">` : `<span>${esc(String(v))}</span>`}</span>`).join('') : '<span class="muted" style="font-size:.8rem">No properties.</span>'}${inEdit ? `<button class="chip add" data-act="feat-prop-add" data-id="${f.id}">+ property</button>` : ''}<div class="fcoords mono">${f.type === 'point' ? `${f.coords[1]}, ${f.coords[0]}` : `${f.coords.length} vertices · first ${f.coords[0][1]}, ${f.coords[0][0]}`}</div></div>` : ''}
				</div>`
			}
			return `<div class="section" id="features">
				<h4>Features <span class="n">${all.length}</span><span class="sp"></span>${inEdit ? `<button class="hint" data-act="select-all">Select all</button>` : ''}</h4>
				<div class="ftools"><input type="text" id="featq" placeholder="Filter features…" value="${esc(S.featFilter)}"><span class="fchips">${chip(null, `All ${all.length}`)}${counts.point ? chip('point', `● ${counts.point}`) : ''}${counts.line ? chip('line', `╱ ${counts.line}`) : ''}${counts.polygon ? chip('polygon', `⬠ ${counts.polygon}`) : ''}</span></div>
				${selCount ? `<div class="fbulk"><span class="cnt">${selCount} selected</span><button class="btn sm" data-act="feat-zoom-sel">Zoom to</button><button class="btn sm" data-act="tool-action" data-k="duplicate">Duplicate</button><button class="btn sm danger" data-act="delete-sel">Delete</button><span class="sp"></span><button class="btn sm quiet" data-act="clear-selection">×</button></div>` : ''}
				<div class="frows">${shown.map(row).join('') || `<div class="empty">${all.length ? 'No feature matches.' : 'Nothing drawn yet.'}</div>`}</div>
				${list.length > cap ? `<button class="chip add" data-act="feat-all">${S.featAll ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}
			</div>`
		})()
		const belonging = `<div class="section"><h4>Belonging <span class="sp"></span>${inEdit ? '' : `<span class="hint">edit the map to change</span>`}</h4>
			<div class="sub">Atlases</div>
			<div class="chips">${m.belongsTo.map((aid) => { const a = D.atlases[aid]; if (!a) return ''; const f = fitState(m, a); return `<span class="chip ${f.cls}" title="${esc(policyText(a.policy))}"><button style="display:contents" data-act="open" data-kind="atlas" data-id="${aid}">${esc(f.text)}</button>${inEdit ? `<button class="x" data-act="belong-remove" data-id="${aid}" aria-label="Remove">×</button>` : ''}</span>` }).join('')}${inEdit ? `<button class="chip add" data-act="dialog" data-dialog="add-to-atlas">+ Add to atlas…</button>` : m.belongsTo.length ? '' : '<span class="empty">Not in any atlas.</span>'}</div>
			<div class="sub">Topics</div>
			<div class="chips">${m.topics.map((t) => `<button class="chip" data-act="filter-tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}${inEdit ? `<button class="chip add" data-act="add-topic">+ topic</button>` : m.topics.length ? '' : '<span class="empty">No topics.</span>'}</div></div>`
		const props = schemaFor(m).length ? `<div class="section"><h4>Properties <span class="sp"></span><span class="hint">from ${esc([...new Set(schemaFor(m).map((f) => f.atlas))].join(', '))}</span></h4><dl class="kv">${schemaFor(m).map((f) => `<dt>${esc(f.label)}</dt><dd>${inEdit ? `<select data-bind-prop="${esc(f.key)}"><option value="">—</option>${f.options.map((o) => `<option ${m.props[f.key] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : esc(m.props[f.key] || '') || '<span style="color:var(--amber)">missing</span>'}</dd>`).join('')}</dl></div>` : ''
		const appears = `<div class="section"><h4>Appears in <span class="n">${stories.length}</span></h4>${stories.length ? `<div class="list">${stories.map((s) => `<button class="item" data-act="open" data-kind="story" data-id="${s.id}"><span class="kicon story">sto</span><span style="text-align:left"><div class="t">${esc(s.title)}</div><div class="s">${esc(person(s.author).name)}</div></span><span></span></button>`).join('')}</div>` : '<div class="empty">No story references this map yet.</div>'}</div>`
		const details = `<div class="margin-body">
			<div class="lead">${inEdit ? `<textarea data-bind="summary" rows="3" placeholder="What is this map?">${esc(m.summary)}</textarea>` : `<p>${esc(m.summary) || '<span class="muted">No description.</span>'}</p>`}</div>
			${glance}
			${featuresSection}
			${belonging}
			${props}
			${appears}
			${proposalsHtml('map', id)}
			${inEdit ? `<div class="section quiet"><button class="btn sm danger" data-act="dialog" data-dialog="discard">Discard this draft</button></div>` : mine(pub) ? `<div class="section quiet"><button class="btn sm danger" data-act="dialog" data-dialog="delete">Delete map…</button></div>` : ''}
		</div>`
		return head(m, 'map', { actions, sub: `<span class="muted">· ${m.features.length} features${stories.length ? ` · in ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'}` : ''}</span>` }) + tabsHtml('map', id, sideThread) + (S.tab === 'thread' && !sideThread ? threadHtml('map', id) : S.tab === 'comments' ? commentsHtml('map', id) : details)
	}
	function audienceLabel(a) { return a === 'circle' ? 'Circle: Alpine rescue' : a === 'nearby' ? 'Nearby: Saturday survey' : 'Everyone' }
	function storyHtml(id, edit, sideThread) {
		const s = view('story', id)
		const pub = D.stories[id]
		const inEdit = S.editing && S.editing.id === id
		const pres = s.presentation
		const scenes = pres && pres.scenes ? pres.scenes : []
		const actions = inEdit && proposing()
			? `<button class="btn sm primary keep" data-act="dialog" data-dialog="send-proposal">Send proposal to ${esc(person(pub.author).name)}</button><button class="btn sm keep" data-act="done">Keep for later</button>`
			: inEdit
			? `<span class="split"><button class="btn sm primary keep" data-act="publish" data-mode="update">${pub.published ? 'Publish update' : 'Publish'}</button><button class="btn sm primary keep" data-act="menu" data-menu="publish">▾</button></span><button class="btn sm keep" data-act="done">Done</button>`
			: `${mine(pub) ? `<button class="btn sm primary keep" data-act="edit">Edit</button>` : `<button class="btn sm primary keep" data-act="propose" title="Offer text changes to ${esc(person(pub.author).name)}">Propose an edit</button>`}${scenes.length ? `<button class="btn sm keep ${S.sceneIndex >= 0 ? 'primary' : ''}" data-act="present" title="Step through the story's scenes">▶ Present${S.sceneIndex >= 0 ? ` ${S.sceneIndex + 1}/${scenes.length}` : ''}</button><button class="btn sm ${S.followText ? 'primary' : ''}" data-act="follow-text" title="The map follows the paragraph you are reading">${S.followText ? '◎ Following text' : '◎ Follow text'}</button>` : ''}`
		const p = S.proposal && S.proposal.kind === 'story' && S.proposal.storyId === id ? S.proposal : null
		const sceneAt = (i) => scenes.findIndex((sc) => sc.anchor === i)
		const sceneChip = (i) => { const si = sceneAt(i); return si >= 0 ? `<button class="scene ${S.activeBlock === i ? 'on' : ''}" data-act="go-block" data-i="${i}" title="${esc(blockSummary(s, i))}">⌖ ${esc(scenes[si].title)}</button>` : '' }
		const stripFor = (i) => { const sc = sceneAt(i) >= 0 ? scenes[sceneAt(i)] : null; const eff = effectiveState(s, i); return `<div class="lstrip">${s.maps.map((mid) => { const m = D.maps[mid]; if (!m) return ''; const d = sc && sc.layers && sc.layers[mid]; const mode = d && typeof d.visible === 'boolean' ? (d.visible ? 'show' : 'hide') : 'inherit'; return `<button class="lc ${mode} ${eff.layers[mid] ? 'vis' : 'hid'}" data-act="blk-layer" data-i="${i}" data-id="${mid}" title="${esc(m.title)} · ${mode === 'inherit' ? 'inherits: ' + (eff.layers[mid] ? 'shown' : 'hidden') : mode === 'show' ? 'shown from here' : 'hidden from here'} · click to cycle">${mode === 'show' ? '◉' : mode === 'hide' ? '○' : '◌'} ${esc(m.title.replace(/^Western Front · /, ''))}</button>` }).join('')}<button class="lc cam ${sc && sc.view ? 'show' : 'inherit'}" data-act="blk-view" data-i="${i}" title="${sc && sc.view ? 'Camera set for this paragraph · click to recapture, ⇧click to clear' : 'Capture the current camera for this paragraph'}">⌖ ${sc && sc.view ? 'camera set' : 'set camera'}</button></div>` }
		const block = (b, i) => {
			const refs = (b.refs || []).map((r) => refChip(r)).join(' ')
			const active = S.activeBlock === i
			const summary = !inEdit && sceneAt(i) >= 0 ? `<div class="bsum">${esc(blockSummary(s, i))}</div>` : ''
			const editTools = inEdit ? `${stripFor(i)}<div class="btools"><button data-act="ref-pick" data-i="${i}" class="${S.refPick === i ? 'on' : ''}" title="Click a feature on the map to reference it here">${S.refPick === i ? '⌖ click a feature…' : '⌖ reference'}</button>${sceneAt(i) >= 0 ? `<button data-act="scene-rename" data-i="${sceneAt(i)}">✎ ${esc(scenes[sceneAt(i)].title)}</button><button data-act="scene-remove" data-i="${sceneAt(i)}" title="Remove this paragraph's map changes">× clear</button>` : ''}<button data-act="block-add" data-i="${i}">+ ¶</button><button data-act="block-del" data-i="${i}">− ¶</button></div>` : ''
			const attrs = `class="blk ${active ? 'active' : ''} ${sceneAt(i) >= 0 ? 'has-scene' : ''}" data-blk="${i}"${inEdit ? '' : ` data-act="go-block" data-i="${i}"`}`
			const kindTag = inEdit && !['p', 'h'].includes(b.type) ? `<span class="btype">${esc(b.type)}</span>` : ''
			return `<div ${attrs}>${kindTag}${blockBody(b, i, inEdit)}${refs || sceneChip(i) ? `<div class="refline">${refs} ${sceneChip(i)}</div>` : ''}${summary}${editTools}</div>`
		}
		const body = s.body.map((b, i) => block(b, i) + (p && p.insertAfter === i ? `<p class="ins">${esc(p.para.text)} ${p.para.refs.map((r) => refChip(r)).join(' ')}</p>` : '')).join('')
		const presSection = `<div class="section"><h4>Map presentation <span class="sp"></span><span class="hint">${pres ? 'v1 · embedded in the story' : 'none · readers see the maps as they are'}</span></h4>
			<div class="sub">Opening view</div>
			<p style="font-size:.86rem">${pres && pres.initialView ? `<span class="mono">${pres.initialView.center[1]}, ${pres.initialView.center[0]} · z${pres.initialView.zoom}</span>` : '<span class="muted">not set · readers start framed on all referenced maps</span>'}${inEdit ? ` <button class="btn sm" data-act="pres-set-view">Set from current view</button>${pres && pres.initialView ? '<button class="btn sm quiet" data-act="pres-clear-view">Clear</button>' : ''}` : pres && pres.initialView ? ' <button class="btn sm quiet" data-act="pres-fly">⌖ Go</button>' : ''}</p>
			<div class="sub">Layers, in order</div>
			<div class="list">${(pres && pres.layerOrder && pres.layerOrder.length ? pres.layerOrder : s.maps).map((mid, i, arr) => { const m = D.maps[mid]; if (!m) return ''; const vis = !(pres && pres.layers && pres.layers[mid] && pres.layers[mid].visible === false); return `<div class="item"><div class="thumb">${thumb(m.features, 40, 28)}</div><button style="text-align:left" data-act="open" data-kind="map" data-id="${mid}"><div class="t">${esc(m.title)}</div><div class="s">${esc(person(m.author).name)} · ${vis ? 'shown' : 'hidden at open'}</div></button><div class="act" style="opacity:1">${inEdit ? `<button data-act="pres-vis" data-id="${mid}" title="${vis ? 'Hide at open' : 'Show at open'}">${vis ? '◉' : '○'}</button><button data-act="pres-up" data-id="${mid}" ${i === 0 ? 'disabled' : ''}>↑</button><button data-act="pres-down" data-id="${mid}" ${i === arr.length - 1 ? 'disabled' : ''}>↓</button>` : `<button data-act="fly-map" data-id="${mid}">⌖</button>`}</div></div>` }).join('')}${inEdit ? `<button class="chip add" data-act="dialog" data-dialog="pick-map" data-for="story">+ Reference a map</button>` : ''}</div>
			${inEdit ? '<p class="muted" style="font-size:.76rem;margin:.4rem 0 0">This is how the story opens. Paragraphs then change layers and camera as the reader goes. Only maps this story references can appear here; older clients simply see the maps.</p>' : ''}</div>`
		const scenesSection = scenes.length || inEdit ? `<div class="section"><h4>Scenes <span class="n">${scenes.length}</span><span class="sp"></span>${scenes.length ? `<button class="btn sm ${S.sceneIndex >= 0 ? 'primary' : ''}" data-act="present">▶ Present</button>` : ''}</h4>${scenes.length ? `<div class="list">${scenes.map((sc, i) => `<div class="item ${S.sceneIndex === i ? 'on' : ''}"><span class="kicon">${i + 1}</span><button style="text-align:left" data-act="go-block" data-i="${sc.anchor}"><div class="t">${esc(sc.title)}</div><div class="s">¶${sc.anchor + 1} · ${esc(blockSummary(s, sc.anchor)) || 'no changes'}</div></button><div class="act" style="opacity:1">${inEdit ? `<button data-act="scene-rename" data-i="${i}">✎</button><button data-act="scene-remove" data-i="${i}">×</button>` : `<button data-act="go-scene" data-i="${i}">⌖</button>`}</div></div>`).join('')}</div>` : '<div class="empty">No scenes. Use “+ scene from view” under a paragraph.</div>'}${inEdit ? '<p class="muted" style="font-size:.76rem;margin:.4rem 0 0">Each paragraph can show or hide layers and move the camera. Changes accumulate down the page: a layer stays as the last paragraph left it. Under a paragraph, ◉ shows a layer from here on, ○ hides it, ◌ inherits.</p>' : ''}</div>` : ''
		const details = `<div class="margin-body">
			${S.presentScene !== null && S.sceneIndex >= 0 ? `<div class="diffbar-margin" style="border-style:solid;border-color:var(--accent);background:var(--accent-soft)"><span class="grow">Scene ${S.sceneIndex + 1} of ${scenes.length}: ${esc(scenes[S.sceneIndex].title)}</span><button class="btn sm" data-act="scene-prev" ${S.sceneIndex === 0 ? 'disabled' : ''}>‹</button><button class="btn sm primary" data-act="scene-next">${S.sceneIndex === scenes.length - 1 ? 'Finish' : 'Next ›'}</button></div>` : ''}
			${p ? `<div class="diffbar-margin"><span class="grow">+1 paragraph · ${p.para.refs.length} references</span><button class="btn sm primary" data-act="apply">Apply</button><button class="btn sm" data-act="discard">Discard</button></div>` : ''}
			<div class="lead prose ${inEdit ? 'editing' : ''}">${body}${inEdit && !s.body.length ? '<button class="chip add" data-act="block-add" data-i="-1">+ paragraph</button>' : ''}</div>
			${inEdit ? `<div class="btools top"><button data-act="block-add" data-i="${s.body.length - 1}">+ paragraph</button><button data-act="heading-add" data-i="${s.body.length - 1}">+ heading</button><button data-act="menu" data-menu="block-insert">+ block ▾</button><span class="muted" style="font-size:.74rem;align-self:center">Type in the text. Under each paragraph: reference a feature, capture a scene.</span></div>` : ''}
			${proposalsHtml('story', id)}
			${presSection}
			${scenesSection}
		</div>`
		return head(s, 'story', { actions, sub: `<span class="muted">· ${s.maps.length} map${s.maps.length === 1 ? '' : 's'}${scenes.length ? ` · ${scenes.length} scenes` : ''}</span>` }) + tabsHtml('story', id, sideThread) + (S.tab === 'thread' && !sideThread ? threadHtml('story', id) : S.tab === 'comments' ? commentsHtml('story', id) : details)
	}
	// A small inline subset: **bold**, *italic*, `code`, [text](href). Escaped first, so content stays inert.
	function mdInline(t) {
		return esc(t)
			.replace(/`([^`]+)`/g, '<code>$1</code>')
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
			.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
	}
	function blockBody(b, i, inEdit) {
		const ed = inEdit ? ` contenteditable="true" data-bind-block="${i}"` : ''
		switch (b.type) {
			case 'h': return `<h${b.level === 3 ? 6 : 5}${ed}>${esc(b.text)}</h${b.level === 3 ? 6 : 5}>`
			case 'img': return `<figure class="fig"><img src="${D.photo(b.src, b.palette)}" alt="${esc(b.alt || '')}" loading="lazy"><figcaption>${mdInline(b.caption || '')}${b.credit ? `<span class="cr">${esc(b.credit)}</span>` : ''}</figcaption></figure>`
			case 'table': return `<figure class="tbl-wrap"><div class="tbl-scroll"><table class="ptbl"><thead><tr>${b.head.map((h, n) => `<th class="a-${(b.align || [])[n] || 'left'}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c, n) => `<td class="a-${(b.align || [])[n] || 'left'}">${mdInline(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`
			case 'quote': return `<blockquote>${mdInline(b.text)}${b.by ? `<cite>${esc(b.by)}</cite>` : ''}</blockquote>`
			case 'list': return `<${b.ordered ? 'ol' : 'ul'} class="plist">${b.items.map((it) => `<li>${mdInline(it)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`
			case 'code': return `<pre class="pcode"${b.lang ? ` data-lang="${esc(b.lang)}"` : ''}><code>${esc(b.text)}</code></pre>`
			case 'note': return `<div class="pnote ${esc(b.tone || 'info')}">${mdInline(b.text)}</div>`
			case 'hr': return '<hr class="prule">'
			default: return `<p class="${b.lead ? 'plead' : ''}"${ed}>${mdInline(b.text)}</p>`
		}
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
			? `<span class="split"><button class="btn sm primary keep" data-act="publish" data-mode="update">Publish update</button><button class="btn sm primary keep" data-act="menu" data-menu="publish">▾</button></span><button class="btn sm keep" data-act="done">Done</button>`
			: `${mine(pub) ? `<button class="btn sm primary keep" data-act="edit">Edit</button>` : ''}<span class="split"><button class="btn sm keep" data-act="menu" data-menu="add-map">Add a map</button><button class="btn sm keep" data-act="menu" data-menu="add-map">▾</button></span><button class="btn" data-act="show-all" data-id="${id}">Show all on map</button>${S.lens === id ? `<button class="btn sm keep" data-act="leave-lens">Leave atlas</button>` : `<button class="btn sm keep" data-act="enter-lens" data-id="${id}" title="Only this atlas in lists and search; new maps belong here">Enter atlas ▸</button>`}`
		const row = (m, acts) => `<div class="item"><div class="thumb">${thumb(m.features)}</div><button style="text-align:left" data-act="open" data-kind="map" data-id="${m.id}"><div class="t">${esc(m.title)}</div><div class="s">${esc(person(m.author).name)} · ${m.features.length} features${p && p.pins && p.pins.includes(m.id) ? ' · <span style="color:var(--amber)">will be pinned</span>' : ''}</div></button><div class="act">${acts}</div></div>`
		const details = `<div class="margin-body">
			${p ? `<div class="diffbar-margin"><span class="grow">${p.pins ? `pin ${p.pins.length}` : 'new description'}</span><button class="btn sm primary" data-act="apply">Apply</button><button class="btn sm" data-act="discard">Discard</button></div>` : ''}
			<div class="lead">${inEdit ? `<textarea data-bind="description" rows="3">${esc(a.description)}</textarea>` : `<p>${esc(p && p.description ? p.description : a.description)}</p>`}${p && p.description ? '<p class="ins" style="font-size:.85rem">Proposed description shown above.</p>' : ''}</div>
			<div class="section"><h4>Default view <span class="sp"></span><span class="hint">${a.presentation ? 'v1 · pinned maps only' : 'none'}</span></h4><p style="font-size:.86rem">${a.presentation && a.presentation.initialView ? `<span class="mono">${a.presentation.initialView.center[1]}, ${a.presentation.initialView.center[0]} · z${a.presentation.initialView.zoom}</span> · ${(a.presentation.layerOrder || []).length} layers in order` : '<span class="muted">Show all on map frames the pinned and added maps</span>'}${inEdit ? ` <button class="btn sm" data-act="atlas-pres-set">Set from current view</button>${a.presentation ? '<button class="btn sm quiet" data-act="atlas-pres-clear">Clear</button>' : ''}` : a.presentation ? ' <button class="btn sm quiet" data-act="atlas-pres-go">⌖ Go</button>' : ''}</p>${inEdit ? '<p class="muted" style="font-size:.76rem;margin:.3rem 0 0">Only maps you pinned can be part of the default view. Maps others added stay discoverable but never enter it automatically.</p>' : ''}</div>
			<div class="section"><h4>Who can add maps here</h4>${inEdit ? `<div class="policy">${[['open', 'Anyone', 'Maps appear as soon as they say they belong.'], ['schema', 'Anyone, if the map fits the schema', `Requires ${(a.schemaFields || []).map((f) => '“' + esc(f.key) + '”').join(' and ') || 'the schema fields'}. Others wait until they fit.`], ['closed', 'Only me', 'Maps that ask to belong wait until I pin them.']].map(([v, t, s]) => `<label class="${a.policy === v ? 'on' : ''}"><input type="radio" name="policy" value="${v}" ${a.policy === v ? 'checked' : ''} data-bind="policy"><span>${t}<small>${s}</small></span></label>`).join('')}</div>` : `<p>${esc(policyText(a.policy))}${a.policy === 'schema' && a.schemaFields ? ` · needs ${a.schemaFields.map((f) => `<code class="mono">${esc(f.key)}</code>`).join(', ')}` : ''}.</p>`}</div>
			<div class="section"><h4>Pinned by ${mine(pub) ? 'me' : esc(person(pub.author).name)} <span class="n">${mem.pinned.length}</span></h4><div class="list">${mem.pinned.map((m) => row(m, inEdit ? `<button class="btn sm quiet" data-act="unpin" data-id="${m.id}" title="Unpin">⊘</button>` : `<button class="btn sm quiet" data-act="fly-map" data-id="${m.id}">⌖</button>`)).join('') || '<div class="empty">Nothing pinned yet.</div>'}</div></div>
			<div class="section"><h4>Added by others <span class="n">${mem.added.length}</span></h4><div class="list">${mem.added.map((m) => row(m, `${inEdit || mine(pub) ? `<button class="btn sm quiet" data-act="pin" data-id="${m.id}" title="Pin">⊕</button>` : ''}<button class="btn sm quiet" data-act="fly-map" data-id="${m.id}">⌖</button>`)).join('') || '<div class="empty">No one has added a map yet.</div>'}</div></div>
			${mine(pub) ? `<div class="section warn"><h4>Waiting for me <span class="n">${mem.waiting.length}</span></h4><div class="list">${mem.waiting.map((m) => row(m, `<button class="btn sm" data-act="pin" data-id="${m.id}">Pin · accept</button>`)).join('') || '<div class="empty">Nothing waiting.</div>'}</div><p class="muted" style="font-size:.8rem;margin:.4rem 0 0">Maps that say they belong here but don’t fit the policy yet. Pinning accepts them.</p></div>` : ''}
		</div>`
		return head(a, 'atlas', { actions, sub: `<span class="muted">· ${mem.pinned.length + mem.added.length} map${mem.pinned.length + mem.added.length === 1 ? '' : 's'}</span>` }) + tabsHtml('atlas', id, sideThread) + (S.tab === 'thread' && !sideThread ? threadHtml('atlas', id) : S.tab === 'comments' ? commentsHtml('atlas', id) : details)
	}
	function sightingHtml(id) {
		const s = obj('sighting', id)
		return head(s, 'sighting', { actions: ``, sub: `<span class="muted">· ${esc(s.when)} · expires ${esc(s.expires)}</span>` }) + `<div class="tabs" role="tablist"><button role="tab" class="${S.tab !== 'comments' ? 'on' : ''}" data-act="tab" data-tab="details">Details</button><button role="tab" class="${S.tab === 'comments' ? 'on' : ''}" data-act="tab" data-tab="comments">Comments${commentsOn(key('sighting', id)).length ? ` <span class="n">${commentsOn(key('sighting', id)).length}</span>` : ''}</button></div>` + (S.tab === 'comments' ? commentsHtml('sighting', id) : `<div class="margin-body"><div class="lead"><div style="height:120px;background:linear-gradient(135deg,var(--surface-2),var(--surface-3));display:grid;place-items:center;color:var(--muted);margin-bottom:.5rem">photo</div><p>${esc(s.note)}</p></div><div class="section"><h4>When &amp; where</h4><dl class="kv two"><dt>Seen</dt><dd>${esc(s.when)}</dd><dt>Expires</dt><dd>${esc(s.expires)}</dd><dt>Position</dt><dd class="mono">${s.coords[1]}, ${s.coords[0]}</dd><dt>By</dt><dd>${esc(person(s.author).name)}</dd></dl></div></div>`)
	}
	function personHtml(id) {
		const p = person(id)
		const list = (arr, kind) => arr.length ? `<div class="list">${arr.map((o) => `<button class="item" data-act="open" data-kind="${kind}" data-id="${o.id}"><span class="kicon ${kind}">${kind.slice(0, 3)}</span><span style="text-align:left"><div class="t">${esc(o.title)}</div><div class="s">${kind === 'map' ? o.features.length + ' features' : kind === 'atlas' ? esc(policyText(o.policy)) : esc(o.summary || '')}</div></span><span></span></button>`).join('')}</div>` : '<div class="empty">None yet.</div>'
		return `<div class="margin-head"><div class="nav"><button class="btn sm quiet" data-act="back">◂ Back</button><span class="kindline"><span class="eyebrow">person</span></span><span style="flex:1"></span><button class="btn sm quiet glassbtn" data-act="glass" data-v="${S.glass ? '0' : '1'}">◐</button></div><div class="title">${esc(p.name)}</div><div class="metarow"><span class="meta"><span class="avatar sm">${p.initials}</span><span class="mono muted">${esc(p.handle)}</span></span><span class="acts"><button class="btn sm primary keep">Follow</button><button class="btn sm" data-act="menu" data-menu="share">Share</button></span></div></div>
		<div class="margin-body"><div class="section"><h4>Maps</h4>${list(Object.values(D.maps).filter((m) => m.author === id && m.published), 'map')}</div><div class="section"><h4>Stories</h4>${list(Object.values(D.stories).filter((s) => s.author === id && !s.draft), 'story')}</div><div class="section"><h4>Atlases</h4>${list(Object.values(D.atlases).filter((a) => a.author === id), 'atlas')}</div></div>`
	}

	// ---- Inbox
	function inboxHtml() {
		const items = D.notifications.slice().sort((a, b) => b.when.localeCompare(a.when))
		const glyph = { proposal: '✎', reply: '💬', mention: '@', waiting: '◈', join: '👤', accepted: '✓', follow: '+' }
		const row = (n) => `<button class="nrow ${n.read ? '' : 'unread'}" data-act="open-notification" data-id="${n.id}"><span class="ng">${glyph[n.kind] || '•'}</span><span class="avatar sm">${person(n.from).initials}</span><span class="nt"><b>${esc(person(n.from).name)}</b> ${esc(n.text)}<span class="nw">${esc(n.when)}</span></span>${n.read ? '' : '<span class="ndot"></span>'}</button>`
		return `<div class="margin-head"><div class="nav"><button class="btn sm quiet" data-act="back">◂ Back</button><span class="kindline"><span class="eyebrow">inbox</span>${unread() ? `<span class="state-pill warn">${unread()} unread</span>` : ''}</span><span style="flex:1"></span><button class="btn sm quiet glassbtn" data-act="glass" data-v="${S.glass ? '0' : '1'}">◐</button><button class="btn sm quiet mclose" data-act="m-close">×</button></div><div class="title">Inbox</div><div class="metarow"><span class="meta muted">Proposals, replies, mentions, atlas arrivals, circle requests.</span><span class="acts"><button class="btn sm" data-act="mark-all-read">Mark all read</button></span></div></div>
		<div class="margin-body" style="padding:0"><div class="section quiet" style="margin:0"><div class="nrows">${items.map(row).join('') || '<div class="empty" style="padding:.6rem .7rem">Nothing yet.</div>'}</div></div></div>`
	}
	// ---- Me › Circles / Nearby lists
	function meListHtml(which) {
		const isC = which === 'circles'
		const rows = isC ? D.circles.map((c) => `<button class="item" data-act="open" data-kind="circle" data-id="${c.id}"><span class="kicon circle">🔒</span><span style="text-align:left"><div class="t">${esc(c.title)}</div><div class="s">${c.members.length} members · ${Object.values(D.maps).filter((m) => audienceOf(m) === 'circle:' + c.id).length} maps${c.pending.length ? ` · <span style="color:var(--amber)">${c.pending.length} waiting to join</span>` : ''}</div></span><span></span></button>`).join('')
			: D.nearby.map((n) => `<button class="item" data-act="open" data-kind="nearby" data-id="${n.id}"><span class="kicon nearby">⇄</span><span style="text-align:left"><div class="t">${esc(n.title)}</div><div class="s">${n.peers.filter((p) => p.status === 'connected').length}/${n.peers.length} connected · host ${esc(person(n.author).name)}</div></span><span></span></button>`).join('')
		return `<div class="margin-head"><div class="nav"><button class="btn sm quiet" data-act="back">◂ Back</button><span class="kindline"><span class="eyebrow">me</span></span><span style="flex:1"></span><button class="btn sm quiet glassbtn" data-act="glass" data-v="${S.glass ? '0' : '1'}">◐</button><button class="btn sm quiet mclose" data-act="m-close">×</button></div><div class="title">${isC ? 'Circles' : 'Nearby sessions'}</div><div class="metarow"><span class="meta muted">${isC ? 'Encrypted groups. A circle is an audience you can publish to.' : 'Phones on the same Wi-Fi share records without the internet.'}</span><span class="acts">${isC ? '<button class="btn sm primary keep" data-act="toast">New circle</button><button class="btn sm" data-act="toast">Join with invite</button>' : '<button class="btn sm primary keep" data-act="toast">Host a session</button><button class="btn sm" data-act="toast">Scan to join</button>'}</span></div></div>
		<div class="margin-body"><div class="section"><h4>${isC ? 'Your circles' : 'Sessions'} <span class="n">${rows ? (isC ? D.circles.length : D.nearby.length) : 0}</span></h4><div class="list">${rows || '<div class="empty">None yet.</div>'}</div></div></div>`
	}
	// ---- Circle: an audience with members, a chat, and the things shared into it
	function circleHtml(id) {
		const c = obj('circle', id); const admin = c.members.some((m) => m.id === 'me' && m.role === 'admin')
		const shared = [...Object.values(D.maps).filter((m) => audienceOf(m) === 'circle:' + id).map((m) => ({ kind: 'map', o: m })), ...Object.values(D.stories).filter((st) => st.audience === 'circle:' + id).map((st) => ({ kind: 'story', o: st }))]
		const tabs = `<div class="tabs" role="tablist"><button role="tab" class="${S.tab !== 'chat' ? 'on' : ''}" data-act="tab" data-tab="details">Details</button><button role="tab" class="${S.tab === 'chat' ? 'on' : ''}" data-act="tab" data-tab="chat">Chat <span class="n">${c.chat.length}</span></button></div>`
		const details = `<div class="margin-body">
			<div class="lead"><p>${esc(c.description)}</p></div>
			<div class="section"><h4>At a glance</h4><dl class="kv two"><dt>Members</dt><dd>${c.members.length}</dd><dt>Encryption</dt><dd>MLS, end to end</dd><dt>Since</dt><dd>${esc(c.created)}</dd><dt>Your role</dt><dd>${admin ? 'admin' : 'member'}</dd></dl></div>
			<div class="section"><h4>Shared in this circle <span class="n">${shared.length}</span></h4><div class="list">${shared.map(({ kind, o }) => `<div class="item"><div class="thumb">${kind === 'map' ? thumb(o.features, 40, 28) : ''}</div><button style="text-align:left" data-act="open" data-kind="${kind}" data-id="${o.id}"><div class="t">🔒 ${esc(o.title)}</div><div class="s">${esc(person(o.author).name)} · ${kind === 'map' ? o.features.length + ' features' : 'story'}</div></button><button class="btn sm quiet" data-act="fly-map" data-id="${o.id}">⌖</button></div>`).join('') || '<div class="empty">Nothing shared yet. Publish a map with audience “Circle: ' + esc(c.title) + '”.</div>'}</div></div>
			${admin && c.pending.length ? `<div class="section warn"><h4>Waiting to join <span class="n">${c.pending.length}</span></h4><div class="list">${c.pending.map((p) => `<div class="item"><span class="avatar sm">${person(p.id).initials}</span><span style="text-align:left"><div class="t">${esc(person(p.id).name)}</div><div class="s">asked ${esc(p.when)}</div></span><span class="act" style="opacity:1"><button class="btn sm primary" data-act="circle-approve" data-id="${p.id}">Approve</button><button class="btn sm" data-act="circle-deny" data-id="${p.id}">Deny</button></span></div>`).join('')}</div><p class="muted" style="font-size:.78rem">Approving adds them to the group and rotates the key; they see everything shared from now on.</p></div>` : ''}
			<div class="section"><h4>Members <span class="n">${c.members.length}</span></h4><div class="list">${c.members.map((m) => `<div class="item"><span class="avatar sm">${person(m.id).initials}</span><span style="text-align:left"><div class="t">${esc(person(m.id).name)}</div><div class="s">${m.role}</div></span><span class="act">${admin && m.id !== 'me' ? `<button class="btn sm quiet danger" data-act="circle-remove" data-id="${m.id}">Remove</button>` : ''}</span></div>`).join('')}</div></div>
			<div class="section"><h4>Invite</h4><p class="mono" style="font-size:.8rem">${esc(c.invite)}</p><div class="chips"><button class="btn sm" data-act="toast-copied">Copy invite link</button><button class="btn sm" data-act="toast">Show QR</button><button class="btn sm quiet" data-act="toast">Rotate link</button></div><p class="muted" style="font-size:.78rem;margin-top:.4rem">An invite lets someone ask. ${admin ? 'You' : 'An admin'} still approve${admin ? '' : 's'} each join.</p></div>
			<div class="section quiet"><button class="btn sm danger" data-act="toast">Leave circle</button></div>
		</div>`
		const chat = `<div class="thread"><div class="msgs">${c.chat.map((m) => `<div class="msg ${m.author === 'me' ? 'user' : 'ai'}"><div class="muted" style="font-size:.72rem">${esc(person(m.author).name)} · ${esc(m.when)}</div>${esc(m.text)}${m.ref ? `<div class="refs"><button class="chip" style="height:22px" data-act="open" data-kind="${m.ref.kind}" data-id="${m.ref.id}">🔒 ${esc(obj(m.ref.kind, m.ref.id).title)}</button></div>` : ''}</div>`).join('')}</div><div class="composer"><div class="box"><textarea rows="1" placeholder="Message the circle… (encrypted)"></textarea><button class="btn sm primary" data-act="toast">Send</button></div><div class="hint"><button data-act="toast">Attach a map from the Shelf</button><button data-act="toast">Share my live location here</button></div></div></div>`
		return head(Object.assign({}, c, { author: c.author }), 'circle', { social: false, sub: `<span class="muted">· ${c.members.length} members · encrypted</span>`, actions: `<button class="btn sm primary keep" data-act="menu" data-menu="share">Invite</button><button class="btn sm" data-act="new-map-audience" data-a="circle:${id}">New map here</button>` }) + tabs + (S.tab === 'chat' ? chat : details)
	}
	// ---- Nearby session: an audience made of phones on the same network
	function nearbyHtml(id) {
		const n = obj('nearby', id); const host = n.author === 'me'
		const shared = Object.values(D.maps).filter((m) => audienceOf(m) === 'nearby:' + id)
		const details = `<div class="margin-body">
			<div class="lead"><p>${esc(n.description)}</p></div>
			<div class="section"><h4>At a glance</h4><dl class="kv two"><dt>Host</dt><dd>${esc(person(n.author).name)}</dd><dt>Started</dt><dd>${esc(n.created)}</dd><dt>Transport</dt><dd>${esc(n.interface)}</dd><dt>Sharing</dt><dd>${n.sharing ? '<span style="color:var(--green)">on</span>' : 'off'}</dd></dl></div>
			<div class="section"><h4>Peers <span class="n">${n.peers.length}</span></h4><div class="list">${n.peers.map((p) => `<div class="item"><span class="avatar sm">${person(p.id).initials}</span><span style="text-align:left"><div class="t">${esc(person(p.id).name)} ${p.role === 'host' ? '<span class="state-pill" style="height:18px">host</span>' : ''}</div><div class="s">${p.status === 'connected' ? '<span style="color:var(--green)">● connected</span>' : esc(p.status)}</div></span><span class="act">${host && p.id !== 'me' ? '<button class="btn sm quiet danger" data-act="toast">Revoke</button>' : ''}</span></div>`).join('')}</div></div>
			<div class="section"><h4>Shared in this session <span class="n">${shared.length}</span></h4><div class="list">${shared.map((m) => `<div class="item"><div class="thumb">${thumb(m.features, 40, 28)}</div><button style="text-align:left" data-act="open" data-kind="map" data-id="${m.id}"><div class="t">⇄ ${esc(m.title)}</div><div class="s">${esc(person(m.author).name)} · ${m.features.length} features · v${m.version}</div></button><button class="btn sm quiet" data-act="fly-map" data-id="${m.id}">⌖</button></div>`).join('') || '<div class="empty">Nothing yet.</div>'}</div><p class="muted" style="font-size:.78rem;margin-top:.4rem">Records stay on the phones in this session. When one of them is back online, they go to the relays under each author's key.</p></div>
			<div class="section"><h4>Invite a phone</h4><p class="mono" style="font-size:.8rem">${esc(n.invite)}</p><div class="chips"><button class="btn sm" data-act="toast">Show QR</button><button class="btn sm" data-act="toast-copied">Copy link</button></div></div>
			<div class="section quiet">${host ? '<button class="btn sm danger" data-act="toast">End session</button>' : '<button class="btn sm danger" data-act="toast">Leave session</button>'}</div>
		</div>`
		return head(n, 'nearby', { social: false, sub: `<span class="muted">· ${n.peers.filter((p) => p.status === 'connected').length}/${n.peers.length} connected</span>`, actions: `<button class="btn sm primary keep" data-act="menu" data-menu="share">Invite</button><button class="btn sm" data-act="new-map-audience" data-a="nearby:${id}">New map here</button>` }) + `<div class="tabs"><button class="on">Details</button></div>` + details
	}
	// ---- Live: one beacon
	function liveHtml(id) {
		const l = obj('live', id); const own = l.author === 'me'
		const stale = l.lastSeen > 120
		const following = S.followLive === id
		return head(Object.assign({}, l, { title: own ? 'You are live' : l.title, published: '2026-09-03', version: 1 }), 'live', { social: false, sub: `<span class="muted">· since ${esc(l.since)}</span>`, actions: `<button class="btn sm ${following ? 'primary' : ''} keep" data-act="follow-live" data-id="${id}">${following ? 'Following' : 'Follow'}</button>${own ? '<button class="btn sm keep danger" data-act="stop-live">Stop</button>' : ''}<button class="btn sm" data-act="menu" data-menu="share">Share</button>` }) + `<div class="tabs"><button class="on">Details</button></div>
		<div class="margin-body">
			<div class="lead"><p>${stale ? `<span class="state-pill">stale</span> Last position ${Math.round(l.lastSeen / 60)} min ago. Their phone has stopped sending; the dot stays where it was.` : `<span class="state-pill ok">● live</span> Updated ${l.lastSeen} s ago. The dot moves as they do.`}</p></div>
			<div class="section"><h4>At a glance</h4><dl class="kv two"><dt>Who</dt><dd>${esc(person(l.author).name)}</dd><dt>Since</dt><dd>${esc(l.since)}</dd><dt>Position</dt><dd class="mono">${l.coords[1]}, ${l.coords[0]}</dd><dt>Watching</dt><dd>${l.watching}</dd><dt>Discovery</dt><dd>${l.discovery === 'public' ? 'anyone can find it' : 'link only'}</dd><dt>Audience</dt><dd>${esc(audienceLabelOf(l.audience || 'everyone'))}</dd></dl></div>
			${own ? `<div class="section"><h4>While you are live</h4><p style="font-size:.88rem">The banner at the top stays until you press Stop. Positions are sent every few seconds and expire; nothing is kept after you stop.</p><div class="chips"><button class="btn sm" data-act="menu" data-menu="live-discovery">Discovery: ${l.discovery === 'public' ? 'Public' : 'Link only'} ▾</button><button class="btn sm" data-act="toast-copied">Copy share link</button></div></div>` : `<div class="section"><h4>Follow</h4><p style="font-size:.88rem">Follow keeps the map centred on them as they move. Pan the map to stop following.</p></div>`}
		</div>`
	}
	// ---- Comments (NIP-22) with optional annotation geometry
	function commentsHtml(kind, id) {
		const k = key(kind, id)
		const all = commentsOn(k)
		const roots = all.filter((c) => !c.parent).sort((a, b) => (S.commentSort === 'top' ? (b.likes || 0) - (a.likes || 0) : b.when.localeCompare(a.when)))
		const replies = (cid) => all.filter((c) => c.parent === cid).sort((a, b) => a.when.localeCompare(b.when))
		const one = (c, depth) => `<div class="cmt ${depth ? 'reply' : ''}" data-hover-uid="comments:comment:${c.id}">
			<span class="avatar sm">${person(c.author).initials}</span>
			<div class="cb"><div class="ch"><b>${esc(person(c.author).name)}</b><span class="muted">${esc(c.when)}</span>${c.geom ? `<button class="chip ok" style="height:20px" data-act="fly-comment" data-id="${c.id}" title="Show on the map">⌖ ${c.geom.type === 'point' ? 'pin' : 'line'}</button>` : ''}</div>
			<div class="ct">${esc(c.text)}</div>
			<div class="ca"><button data-act="like-comment" data-id="${c.id}" class="${S.liked.has('c:' + c.id) ? 'on' : ''}">${S.liked.has('c:' + c.id) ? '♥' : '♡'} ${(c.likes || 0) + (S.liked.has('c:' + c.id) ? 1 : 0)}</button><button data-act="reply-to" data-id="${c.id}">Reply</button>${c.author === 'me' ? `<button data-act="delete-comment" data-id="${c.id}">Delete</button>` : `<button data-act="toast">Report</button>`}</div>
			${S.replyTo === c.id ? composer(k, c) : ''}
			</div></div>${replies(c.id).map((r) => one(r, 1)).join('')}`
		return `<div class="comments">
			<div class="lhead"><span>${all.length} comment${all.length === 1 ? '' : 's'} · NIP-22, visible to any Nostr client</span><span class="sp"></span><select id="csort" aria-label="Sort comments"><option value="new" ${S.commentSort === 'new' ? 'selected' : ''}>Newest</option><option value="top" ${S.commentSort === 'top' ? 'selected' : ''}>Most liked</option></select></div>
			<div class="margin-body" style="padding:.3rem .7rem .6rem">${roots.length ? roots.map((c) => one(c, 0)).join('') : '<div class="empty">No comments yet.</div>'}</div>
			${S.replyTo ? '' : composer(k, null)}
		</div>`
	}
	function composer(k, parent) {
		const a = S.annot
		const attached = a && a.geom
		return `<div class="ccomp ${parent ? 'inline' : ''}">
			${parent ? `<div class="muted" style="font-size:.78rem">Replying to ${esc(person(parent.author).name)} <button class="btn sm quiet" data-act="reply-cancel">cancel</button></div>` : ''}
			<div class="box"><textarea id="ctext" rows="1" placeholder="${parent ? 'Write a reply…' : 'Comment on this ' + esc(k.split(':')[0]) + '…'}"></textarea></div>
			<div class="crow">
				${attached ? `<span class="chip ok">⌖ ${a.geom.type === 'point' ? 'Pin' : 'Line, ' + a.geom.coords.length + ' points'} attached <button class="x" data-act="annot-clear" aria-label="Remove">×</button></span>` : a && a.mode ? `<span class="chip warn">${a.mode === 'point' ? 'Click the map to drop the pin' : 'Click points on the map, double-click to finish'} <button class="x" data-act="annot-clear">×</button></span>` : `<button class="btn sm" data-act="menu" data-menu="annot">⌖ Attach a place ▾</button>`}
				<span class="sp"></span><button class="btn sm primary" data-act="post-comment" data-parent="${parent ? parent.id : ''}">Post</button>
			</div>
		</div>`
	}
	function proposalsHtml(kind, id) {
		const k = key(kind, id); const list = proposalsOn(k); if (!list.length) return ''
		const o = obj(kind, id); const owner = mine(o)
		return `<div class="section warn"><h4>Proposals <span class="n">${list.filter((p) => p.status === 'pending').length} waiting</span></h4>
			<div class="list">${list.map((p) => `<div class="prop ${p.status}">
				<div class="ph"><span class="avatar sm">${person(p.author).initials}</span><b>${esc(person(p.author).name)}</b><span class="muted">${esc(p.created)}</span><span class="state-pill ${p.status === 'pending' ? 'warn' : p.status === 'accepted' ? 'ok' : ''}">${p.status}${p.acceptedAs ? ' · v' + p.acceptedAs : ''}</span></div>
				<div class="pm">${esc(p.message)}</div>
				<div class="pc mono">${kind === 'map' ? `<span class="add">+${p.add.length}</span> <span class="mod">~${p.modify.length}</span> <span class="del">−${p.remove.length}</span>` : 'text changes'}</div>
				<div class="pa">${kind === 'map' ? `<button class="btn sm ${S.previewProposal === p.id ? 'primary' : ''}" data-act="preview-proposal" data-id="${p.id}">${S.previewProposal === p.id ? 'Hide preview' : 'Preview on map'}</button>` : ''}${p.status === 'pending' && owner ? `<button class="btn sm primary" data-act="accept-proposal" data-id="${p.id}">Accept &amp; publish</button><button class="btn sm" data-act="decline-proposal" data-id="${p.id}">Decline</button>` : ''}${p.status === 'pending' && p.author === 'me' ? `<button class="btn sm quiet danger" data-act="withdraw-proposal" data-id="${p.id}">Withdraw</button>` : ''}<button class="btn sm quiet" data-act="tab" data-tab="comments">Discuss</button></div>
			</div>`).join('')}</div>
			<p class="muted" style="font-size:.78rem;margin:.4rem 0 0">${owner ? 'Accepting publishes a new version with these changes and credits the proposer. Nothing forks.' : 'The author decides. If accepted, the changes land in their map; your name stays on the proposal.'}</p></div>`
	}
	// ---- Thread
	function threadHtml(kind, id) {
		const o = obj(kind, id)
		const k = key(kind, id)
		const inEdit = S.editing && S.editing.id === id
		const msgs = thread(k)
		const state = inEdit && proposing() ? `proposing to ${person(o.author).name}` : inEdit ? 'editing' : kind === 'atlas' && !mine(o) ? 'read-only · concierge' : 'read-only'
		const sendLabel = inEdit ? 'Send' : kind === 'atlas' && !mine(o) ? 'Ask' : mine(o) ? 'Edit & send' : 'Propose & send'
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
	let ml = null, mlReady = false, liveMarkers = [], hoverUid = null, pendingFit = null
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
		ml.on('dblclick', (e) => { if (S.annot && S.annot.drawing.length) { e.preventDefault(); finishAnnot(); return } if (S.drawing.length) { e.preventDefault(); finishDrawing() } })
		ml.on('error', () => {})
		// Keep the WebGL canvas in step with the animating grid, then finish any pending fit.
		if ('ResizeObserver' in window) new ResizeObserver(() => { if (ml) ml.resize() }).observe($('#canvas'))
		$('#stage').addEventListener('transitionend', (e) => { if (e.propertyName !== 'grid-template-columns' || !ml) return; ml.resize(); if (pendingFit) { const f = pendingFit; pendingFit = null; ml.fitBounds([[f.b[0], f.b[1]], [f.b[2], f.b[3]]], Object.assign({}, f.opts, { duration: 350 })) } })
		ml.on('dragstart', () => { pendingFit = null; if (S.followLive) { S.followLive = null; toast('Stopped following.'); render() } })
	}
	const ML_HIT = ['f-pt', 'f-pt-prop', 'f-line', 'f-line-prop', 'f-fill']
	function mlColors() { return { published: cssVar('--published'), working: cssVar('--working'), proposed: cssVar('--proposed'), comment: cssVar('--green'), live: cssVar('--live'), surface: cssVar('--surface'), ink: cssVar('--ink-2'), amber: cssVar('--amber') } }
	function colorExpr(c) { return ['match', ['get', 'state'], 'working', c.working, 'proposed', c.proposed, 'comment', c.comment, c.published] }
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
			const isPropose = isEdit && S.editing.mode === 'propose'
			const m = isEdit && !isPropose ? S.drafts[e.id] : D.maps[e.id]
			if (!m) return
			if (isPropose) {
				// My proposal on someone else's map: their map stays grey, my changes are ghosts.
				const diff = diffDraft(D.maps[e.id], S.drafts[e.id])
				m.features.forEach((f) => out.push({ f, map: e.id, state: 'published', removed: diff.remove.includes(f.id), dim: diff.modify.some((x) => x.id === f.id), lbl: true }))
				diff.add.concat(diff.modify).forEach((f) => out.push({ f, map: e.id, state: 'proposed', sel: S.selection.has(f.id), lbl: true }))
				return
			}
			const p = isEdit && S.proposal && S.proposal.kind === 'map' && S.proposal.mapId === e.id ? S.proposal : null
			const incoming = S.previewProposal ? D.proposals.find((x) => x.id === S.previewProposal && x.target === 'map:' + e.id) : null
			m.features.forEach((f) => out.push({ f, map: e.id, state: isEdit ? 'working' : 'published', removed: !!(p && p.remove.includes(f.id)) || !!(incoming && incoming.remove.includes(f.id)), modified: !!(p && p.modify.some((x) => x.id === f.id)), dim: !!(S.onlyChanges && S.proposal) || !!(incoming && incoming.modify.some((x) => x.id === f.id)), sel: S.selection.has(f.id) || S.emphasis.has(`${e.id}:${f.id}`), lbl: focus === e.id || isEdit || S.emphasis.has(`${e.id}:${f.id}`) }))
			if (incoming) { incoming.add.forEach((f) => out.push({ f, map: e.id, state: 'proposed', lbl: true })); incoming.modify.forEach((mm) => { const base = m.features.find((x) => x.id === mm.id); if (base) out.push({ f: Object.assign({}, base, { id: 'prop:' + mm.id, name: mm.name || base.name, coords: mm.coords || base.coords }), map: e.id, state: 'proposed', lbl: true }) }) }
		})
		// Comment annotations for the open object, plus the one being drawn.
		if (S.tab === 'comments' && S.route.kind && ['map', 'story', 'atlas', 'sighting'].includes(S.route.kind)) {
			commentsOn(key(S.route.kind, S.route.id)).filter((c) => c.geom).forEach((c) => out.push({ f: { id: 'comment:' + c.id, name: person(c.author).name, type: c.geom.type, coords: c.geom.coords }, map: 'comments', state: 'comment', lbl: true }))
		}
		if (S.annot && S.annot.geom) out.push({ f: { id: 'annot', name: 'your note', type: S.annot.geom.type, coords: S.annot.geom.coords }, map: 'comments', state: 'comment', lbl: true })
		if (S.annot && S.annot.drawing && S.annot.drawing.length) { out.push({ f: { id: 'annot-draw', name: '', type: S.annot.drawing.length > 1 ? 'line' : 'point', coords: S.annot.drawing.length > 1 ? S.annot.drawing : S.annot.drawing[0] }, map: 'comments', state: 'comment' }) }
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
			if (S.liveOn) D.live.filter((l) => l.discovery === 'public' || l.author === 'me' || canSee({ audience: l.audience }) || l.audience === 'everyone').forEach((l) => { const d = document.createElement('div'); d.className = 'livedot' + (l.lastSeen > 120 ? ' stale' : '') + (l.author === 'me' ? ' mine' : ''); d.title = l.title; d.addEventListener('click', (ev) => { ev.stopPropagation(); go('live', l.id) }); liveMarkers.push(new maplibregl.Marker({ element: d }).setLngLat(l.coords).addTo(ml)) })
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
		ml.getCanvas().style.cursor = S.tool || (S.annot && S.annot.mode) ? 'crosshair' : hit || ml.queryRenderedFeatures(e.point, { layers: ['sight'] }).length ? 'pointer' : ''
	}
	function onMlClick(e) {
		if (S.moveMode) { moveSelectionTo([r3(e.lngLat.lng), r3(e.lngLat.lat)]); return }
		if (S.annot && S.annot.mode) { annotAt([r3(e.lngLat.lng), r3(e.lngLat.lat)]); return }
		if (S.tool && S.editing && S.editing.kind === 'map') { placeAt([r3(e.lngLat.lng), r3(e.lngLat.lat)]); return }
		const sight = ml.queryRenderedFeatures(e.point, { layers: ['sight'] })[0]
		if (sight) { A.open({ kind: 'sighting', id: sight.properties.id }); return }
		const hit = ml.queryRenderedFeatures(e.point, { layers: ML_HIT })[0]
		if (hit) { featureClicked(hit.properties.map, hit.properties.fid, e.originalEvent); return }
		if (S.popup) { S.popup = null; render() }
	}
	function moveSelectionTo(p) {
		const d = S.drafts[S.editing.id]
		const sel = d.features.filter((f) => S.selection.has(f.id))
		if (!sel.length) { S.moveMode = false; render(); return }
		pushUndo()
		const b = bbox(sel); const c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; const dx = p[0] - c[0], dy = p[1] - c[1]
		sel.forEach((f) => { if (f.type === 'point') f.coords = [r3(f.coords[0] + dx), r3(f.coords[1] + dy)]; else f.coords = f.coords.map((q) => [r3(q[0] + dx), r3(q[1] + dy)]) })
		S.moveMode = false
		render(); toast(`Moved ${sel.length} feature${sel.length === 1 ? '' : 's'}.`, { label: 'Undo', fn: undo })
	}
	function annotAt(p) {
		if (S.annot.mode === 'point') { S.annot.geom = { type: 'point', coords: p }; S.annot.mode = null; render(); toast('Pin attached to your comment.'); return }
		S.annot.drawing.push(p); renderCanvas()
	}
	function finishAnnot() {
		if (S.annot && S.annot.drawing.length >= 2) { S.annot.geom = { type: 'line', coords: S.annot.drawing.slice() } }
		if (S.annot) { S.annot.drawing = []; S.annot.mode = null }
		render()
	}
	function placeAt(p) {
		if (S.tool === 'point') { pushUndo(); S.drafts[S.editing.id].features.push({ id: `p-${Date.now()}`, name: `Point ${S.drafts[S.editing.id].features.length + 1}`, type: 'point', coords: p, props: {} }); render(); return }
		if (S.tool === 'label') { S.dialog = { type: 'label', at: p }; render(); return }
		S.drawing.push(p); renderCanvas(); renderMobileEdit()
	}
	function featureClicked(mapId, fid, ev) {
		if (S.refPick !== null && S.editing && S.editing.kind === 'story') { const d = S.drafts[S.editing.id]; const m = D.maps[mapId]; const f = m && m.features.find((x) => x.id === fid); if (f) { const b = d.body[S.refPick]; b.refs = b.refs || []; b.refs.push({ map: mapId, feature: fid, label: f.name }); if (!d.maps.includes(mapId)) d.maps.push(mapId); S.refPick = null; render(); toast(`Referenced “${f.name}” in paragraph ${S.refPick === null ? '' : ''}`.trim() + '.') } return }
		if (S.editing && S.editing.id === mapId && S.route.id === mapId) {
			if (!(ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) && !isMobile()) S.selection.clear()
			if (S.selection.has(fid)) S.selection.delete(fid); else S.selection.add(fid)
			S.popup = null; render(); return
		}
		S.popup = { mapId, fid }; render()
		if (S.route.kind === 'map' && S.route.id === mapId && S.tab === 'details') { const el = $(`.frow[data-hover-uid="${mapId}:${fid}"]`); if (el) el.scrollIntoView({ block: 'nearest' }) }
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
		// Margins are viewport fractions: 30vw alone, 28vw each when the Thread is pulled out.
		const side = sideThreadActive()
		const mw = isMobile() ? 0 : innerWidth * (side ? 0.28 : 0.3)
		return { top: 70, bottom: isMobile() ? innerHeight * 0.5 + 60 : 90, left: mw + 40, right: (side ? mw : 0) + 40 }
	}
	// b = [w, s, e, n] in lon/lat. close = zoom in on a single feature.
	function flyTo(b, close) {
		if (ml) {
			// The map container is the canvas column itself, so margins need no padding here.
			const pad = { top: 60, bottom: isMobile() ? innerHeight * 0.5 + 50 : 80, left: 40, right: 40 }
			const r = canvasRect()
			if (pad.top + pad.bottom > r.height - 60) { pad.top = 30; pad.bottom = 40 }
			const opts = { padding: pad, maxZoom: close ? 14 : 9, duration: 650 }
			ml.fitBounds([[b[0], b[1]], [b[2], b[3]]], opts)
			// The stage columns animate; refit once the canvas has its final size.
			pendingFit = { b, opts }
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
			return `<span class="schip ${pen ? 'pen' : ''} ${running ? 'running' : ''} ${on ? 'on' : ''} ${e.visible ? '' : 'off'}" data-map="${e.id}"><span class="sw"></span>${isPrivate(m) ? '<span title="' + esc(audienceLabelOf(m.audience)) + '">🔒</span>' : ''}${pen ? '<span class="pencil">✎</span>' : ''}<button class="name" style="width:auto;height:auto;border-radius:0;padding:0" data-act="open" data-kind="map" data-id="${e.id}">${esc(pen ? S.drafts[e.id].title : m.title)}</button><button data-act="toggle-vis" data-id="${e.id}" aria-label="${e.visible ? 'Hide' : 'Show'}" title="${e.visible ? 'Hide' : 'Show'}">${e.visible ? '◉' : '○'}</button><button data-act="remove-shelf" data-id="${e.id}" aria-label="Remove from map">×</button></span>`
		}).join('')
		const liveCount = D.sightings.length + D.live.filter((l) => l.discovery === 'public' || l.author === 'me' || l.audience === 'everyone' || canSee({ audience: l.audience })).length
		return chips + `<span class="schip live ${S.liveOn ? 'on' : 'off'}"><span class="sw"></span><button class="name" style="width:auto;height:auto;border-radius:0;padding:0" data-act="toggle-live">Live · ${liveCount}</button></span>`
	}

	// ---- The toolbar catalogue. One definition drives the desktop pill, its menus,
	// the overflow menu and the phone dock, so every surface shows the same inventory.
	// "Live mood": the newest things across every kind, newest first.
	const NOW = new Date('2026-09-03T12:00:00Z').getTime()
	function ago(when) {
		if (!when) return ''
		const t = new Date(when.length <= 10 ? `${when}T12:00:00Z` : when.replace(' ', 'T') + 'Z').getTime()
		const m = Math.max(1, Math.round((NOW - t) / 60000))
		if (m < 60) return `${m}m`
		const h = Math.round(m / 60)
		if (h < 24) return `${h}h`
		const d = Math.round(h / 24)
		return d < 7 ? `${d}d` : `${Math.round(d / 7)}w`
	}
	function activityFeed() {
		const out = []
		Object.values(D.maps).forEach((m) => { if (m.published && canSee(m)) out.push({ when: m.published, who: m.author, verb: m.version > 1 ? 'updated' : 'published', kind: 'map', id: m.id, title: m.title, g: '◉' }) })
		Object.values(D.stories).forEach((st) => { if (st.published) out.push({ when: st.published, who: st.author, verb: 'wrote', kind: 'story', id: st.id, title: st.title, g: '¶' }) })
		Object.values(D.atlases).forEach((a) => { if (a.published) out.push({ when: a.published, who: a.author, verb: 'opened the atlas', kind: 'atlas', id: a.id, title: a.title, g: a.emblem || '◈' }) })
		D.sightings.forEach((x) => out.push({ when: x.when, who: x.author, verb: 'spotted', kind: 'sighting', id: x.id, title: x.title, g: '◆' }))
		D.comments.forEach((c) => { const [k, i] = c.on.split(':'); const o = obj(k, i); if (o) out.push({ when: c.when, who: c.author, verb: 'commented on', kind: k, id: i, title: o.title, g: '💬', tab: 'comments' }) })
		D.proposals.forEach((p) => { const [k, i] = p.target.split(':'); const o = obj(k, i); if (o) out.push({ when: p.created, who: p.author, verb: p.status === 'accepted' ? 'had a proposal accepted on' : 'proposed changes to', kind: k, id: i, title: o.title, g: '✎' }) })
		D.live.filter((l) => l.discovery === 'public' || l.author === 'me').forEach((l) => out.push({ when: null, live: true, who: l.author, verb: 'is live', kind: 'live', id: l.id, title: l.title, g: '●' }))
		return out.sort((a, b) => (a.live ? 1 : 0) - (b.live ? 1 : 0) === 0 ? String(b.when || '').localeCompare(String(a.when || '')) : (b.live ? 1 : 0) - (a.live ? 1 : 0)).slice(0, 8)
	}
	function renderTicker() {
		const host = $('#ticker'); if (!host) return
		const items = activityFeed()
		if (!items.length) { host.innerHTML = ''; return }
		const i = ((S.tick % items.length) + items.length) % items.length
		const it = items[i]
		// Only touch the DOM when the item changes, so an ordinary re-render never restarts the slide.
		const key = `${i}/${items.length}/${it.kind}:${it.id}/${it.verb}`
		if (renderTicker.key === key && host.firstChild) return
		renderTicker.key = key
		host.innerHTML = `<span class="pulse" aria-hidden="true"></span><button class="titem" data-act="open-activity" data-kind="${it.kind}" data-id="${esc(it.id)}" data-tab="${it.tab || ''}" title="${esc(person(it.who).name)} ${esc(it.verb)} ${esc(it.title)}"><span class="tg">${it.g}</span><span class="tw">${esc(person(it.who).name)}</span><span class="tv">${esc(it.verb)}</span><span class="tt">${esc(it.title)}</span><span class="ta">${it.live ? 'now' : ago(it.when)}</span></button><span class="tdots">${items.map((_, n) => `<i class="${n === i ? 'on' : ''}"></i>`).join('')}</span>`
		host.setAttribute('aria-label', `Latest: ${person(it.who).name} ${it.verb} ${it.title}`)
	}
	let tickTimer = null
	function startTicker() {
		if (tickTimer) clearInterval(tickTimer)
		tickTimer = setInterval(() => {
			if (S.tickPaused || document.hidden || isMobile()) return
			S.tick++
			renderTicker()
		}, 4200)
	}
	function toolbarWidth() {
		if (isMobile()) return innerWidth
		return innerWidth - innerWidth * (sideThreadActive() ? 0.56 : 0.3)
	}
	function toolContext() {
		const d = S.editing ? S.drafts[S.editing.id] : null
		const sel = d ? d.features.filter((f) => S.selection.has(f.id)) : []
		const t = (kind) => sel.filter((f) => f.type === kind).length
		return { n: sel.length, poly: t('polygon'), line: t('line'), point: t('point'), any: !!d && d.features.length > 0, sel }
	}
	const TOOL_GROUPS = [
		{ id: 'draw', label: 'Draw', items: [
			{ k: 'point', g: '●', l: 'Point', key: '1', tool: true },
			{ k: 'line', g: '╱', l: 'Line', key: '2', tool: true },
			{ k: 'polygon', g: '⬠', l: 'Area', key: '3', tool: true },
			{ k: 'label', g: 'T', l: 'Label', key: '4', tool: true },
			{ k: 'arrow', g: '↗', l: 'Arrow', key: '5', tool: true },
			{ k: 'shapes', g: '◆', l: 'Shape', menu: 'tp-shapes', caret: true },
		] },
		{ id: 'select', label: 'Select', items: [
			{ k: 'select', g: '➤', l: 'Select', key: 'V', tool: true },
			{ k: 'box', g: '⬚', l: 'Box select', key: 'B', tool: true },
			{ k: 'vertices', g: '⬦', l: 'Edit vertices', key: 'E', tool: true, need: (c) => c.n > 0, why: 'Select a feature first' },
			{ k: 'isolate', g: '⊙', l: 'Edit in isolation', need: (c) => c.n > 0, why: 'Select a feature first' },
		] },
		{ id: 'modify', label: 'Change', items: [
			{ k: 'duplicate', g: '⧉', l: 'Duplicate', key: '⌘D', need: (c) => c.n > 0, why: 'Nothing selected' },
			{ k: 'delete', g: '⌫', l: 'Delete', key: '⌫', danger: true, need: (c) => c.n > 0, why: 'Nothing selected' },
		] },
		{ id: 'history', label: 'History', items: [
			{ k: 'undo', g: '↶', l: 'Undo', key: '⌘Z', need: () => S.undo.length > 0, why: 'Nothing to undo' },
			{ k: 'redo', g: '↷', l: 'Redo', key: '⇧⌘Z', need: () => S.redo.length > 0, why: 'Nothing to redo' },
		] },
		{ id: 'geometry', label: 'Geometry', items: [{ k: 'geometry', g: '⬡', l: 'Geometry', menu: 'tp-geometry', caret: true }] },
		{ id: 'snap', label: 'Snap', items: [{ k: 'snap', g: '⌗', l: 'Snapping', toggle: true }] },
		{ id: 'file', label: 'File', items: [{ k: 'file', g: '⇅', l: 'File', menu: 'tp-file', caret: true }] },
		{ id: 'more', label: 'More', items: [{ k: 'more', g: '⋯', l: 'More', menu: 'tp-more', caret: true }] },
	]
	const GEOMETRY_MENU = [
		{ h: 'Combine' },
		{ k: 'union', l: 'Boolean union', need: (c) => c.poly >= 2, why: 'Select two or more areas' },
		{ k: 'difference', l: 'Boolean difference', need: (c) => c.poly >= 2, why: 'Select two areas' },
		{ k: 'connect', l: 'Connect lines', need: (c) => c.line >= 2, why: 'Select two or more lines' },
		{ k: 'dissolve', l: 'Dissolve lines', need: (c) => c.line >= 2, why: 'Select two or more lines' },
		{ k: 'merge-multi', l: 'Merge to multi-part', need: (c) => c.n >= 2, why: 'Select two or more features of one type' },
		{ k: 'explode', l: 'Explode multi-part', need: (c) => c.n === 1, why: 'Select one multi-part feature' },
		{ h: 'Reshape' },
		{ k: 'simplify', l: 'Simplify selection…', sub: 'tolerance, with a size estimate', need: (c) => c.n > 0, why: 'Nothing selected' },
		{ k: 'split', l: 'Split by drawn line', need: (c) => c.n === 1, why: 'Select one feature' },
		{ k: 'offset', l: 'Offset area by distance…', need: (c) => c.poly === 1, why: 'Select one area' },
		{ k: 'parallel', l: 'Parallel line…', need: (c) => c.line === 1, why: 'Select one line' },
		{ k: 'corridor', l: 'Line corridor…', need: (c) => c.line === 1, why: 'Select one line' },
		{ h: 'Derive' },
		{ k: 'poly-from-line', l: 'Area from drawn line' },
		{ k: 'line-at-point', l: 'Line at placed point' },
		{ k: 'line-from-line', l: 'Line by drawn line' },
	]
	const FILE_MENU = [
		{ h: 'Bring in' },
		{ k: 'import', l: 'Import GeoJSON / Shapefile…', sub: '.geojson · .zip · .gpx · .kml' },
		{ k: 'osm', l: 'Import from OpenStreetMap…', sub: 'query the current view by feature type' },
		{ k: 'paste', l: 'Paste GeoJSON' },
		{ k: 'csv', l: 'Import a table…', sub: 'CSV or Excel, columns to coordinates' },
		{ h: 'Take out' },
		{ k: 'export-geojson', l: 'Export GeoJSON', need: (c) => c.any, why: 'The map is empty' },
		{ k: 'export-shp', l: 'Export Shapefile', need: (c) => c.any, why: 'The map is empty' },
		{ k: 'save-region', l: 'Save this region offline', sub: 'tiles and records for the current view' },
	]
	const MORE_MENU = [
		{ h: 'On the map' },
		{ k: 'measure', l: 'Measure distance and area', key: 'M' },
		{ k: 'callouts', l: 'Map callouts', toggle: true, sub: 'author cards pinned to geometry' },
		{ k: 'lookup', l: 'Look up a place by click', key: 'I' },
		{ h: 'This map' },
		{ k: 'map-settings', l: 'Map settings…', sub: 'basemap, projection, labels' },
		{ k: 'styling', l: 'Style by attribute…', sub: 'classes, ramp, legend' },
		{ k: 'properties', l: 'Feature properties…', need: (c) => c.n === 1, why: 'Select one feature' },
		{ h: 'Help' },
		{ k: 'shortcuts', l: 'Keyboard shortcuts' },
	]
	const SHAPES_MENU = [
		{ k: 'circle', l: 'Circle', sub: 'drag from the centre' },
		{ k: 'square', l: 'Square' },
		{ k: 'rectangle', l: 'Rectangle' },
		{ k: 'triangle', l: 'Triangle' },
		{ k: 'diamond', l: 'Diamond' },
	]
	const MENU_DEFS = { 'tp-shapes': SHAPES_MENU, 'tp-geometry': GEOMETRY_MENU, 'tp-file': FILE_MENU, 'tp-more': MORE_MENU }
	function toolbarMenuHtml(defs) {
		const c = toolContext()
		return defs.map((it) => {
			if (it.h) return `<div class="mh eyebrow">${esc(it.h)}</div>`
			const ok = !it.need || it.need(c)
			const on = it.toggle && (it.k === 'callouts' ? S.calloutsOn !== false : false)
			return `<button class="mi ${ok ? '' : 'off'} ${it.danger ? 'danger' : ''} ${on ? 'on' : ''}" ${ok ? `data-act="tool-action" data-k="${it.k}"` : 'disabled'}><span>${esc(it.l)}${it.sub || (!ok && it.why) ? `<small>${esc(ok ? it.sub : it.why)}</small>` : ''}</span>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}</button>`
		}).join('')
	}
	// ---- Tool pill / diff bar
	function renderToolpill() {
		const tp = $('#toolpill')
		const on = S.editing && S.editing.kind === 'map' && S.route.kind === 'map' && S.route.id === S.editing.id
		tp.classList.toggle('on', !!on)
		if (!on) { tp.innerHTML = ''; return }
		const c = toolContext()
		// Derive the canvas width from the layout, not from a measurement mid-transition.
		const w = toolbarWidth()
		const size = w >= 940 ? 'xl' : w >= 660 ? 'lg' : 'md'
		const shown = size === 'xl' ? TOOL_GROUPS : size === 'lg' ? TOOL_GROUPS.filter((g) => ['draw', 'history', 'geometry', 'more'].includes(g.id)) : TOOL_GROUPS.filter((g) => ['draw', 'history'].includes(g.id))
		const hidden = TOOL_GROUPS.filter((g) => !shown.includes(g))
		const btn = (it) => {
			const ok = !it.need || it.need(c)
			const active = (it.tool && S.tool === it.k) || (it.toggle && it.k === 'snap' && S.snap !== false)
			const menuOpen = it.menu && S.menu && S.menu.type === it.menu
			return `<button class="${active || menuOpen ? 'on' : ''} ${it.danger ? 'danger' : ''}" ${ok ? (it.menu ? `data-act="menu" data-menu="${it.menu}"` : it.tool ? `data-act="tool" data-tool="${it.k}"` : `data-act="tool-action" data-k="${it.k}"`) : 'disabled'} title="${esc(it.l)}${it.key ? ' · ' + it.key : ''}${ok ? '' : ' · ' + it.why}" aria-label="${esc(it.l)}">${it.g}${it.caret ? '<i>▾</i>' : ''}<span class="tl">${esc(it.l)}</span></button>`
		}
		tp.className = `overlay toolpill on tp-${size}`
		tp.innerHTML = `<span class="tg" title="${esc(S.drafts[S.editing.id].title)}">${proposing() ? '✎ proposing' : '✎ ' + esc(S.drafts[S.editing.id].title).slice(0, 20)}</span>` +
			shown.map((g) => `<span class="grp" data-g="${g.id}">${g.items.map(btn).join('')}</span>`).join('<span class="sep"></span>') +
			(hidden.length ? `<span class="sep"></span><button class="${S.menu && S.menu.type === 'tp-overflow' ? 'on' : ''}" data-act="menu" data-menu="tp-overflow" title="More tools">⋯<i>▾</i><span class="tl">More</span></button>` : '')
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
		if (m.type === 'me') body = `<div class="mh"><b>You</b><br><span class="mono muted">you@earthly.city</span></div><hr>${mi('Profile', 'open-me')}${mi('Drafts', 'menu-drafts')}${mi(`Inbox${unread() ? ' <small>' + unread() + ' unread</small>' : ''}`, 'open-inbox')}${mi(`Circles <small>${D.circles.map((c) => c.title).join(', ')}</small>`, 'open-me-circles')}${mi(`Nearby sessions <small>${D.nearby.map((n) => n.title + ' · ' + n.peers.length + ' peers').join(', ')}</small>`, 'open-me-nearby')}${mi(S.liveMine ? 'You are live <small>tap to stop</small>' : 'Share live location', S.liveMine ? 'stop-live' : 'start-live')}${mi('Outbox <small>2 delivered · 0 waiting</small>', 'toast')}${mi('Wallet', 'toast')}<hr>${mi('Settings', 'toast')}${mi('Help & tour', 'toast')}<div class="mrow"><span class="muted" style="align-self:center;font-size:.8rem;padding:0 .3rem">Theme</span>${['system', 'light', 'dark'].map((t) => `<button class="btn sm ${theme() === t ? 'primary' : ''}" data-act="theme" data-theme="${t}">${t}</button>`).join('')}</div><div class="mrow"><span class="muted" style="align-self:center;font-size:.8rem;padding:0 .3rem">Panels</span><button class="btn sm ${S.glass ? '' : 'primary'}" data-act="glass" data-v="0">Solid</button><button class="btn sm ${S.glass ? 'primary' : ''}" data-act="glass" data-v="1">Glass</button></div><hr>${mi('Sign out', 'toast', 'danger')}`
		if (m.type === 'drafts') { const ds = Object.values(S.drafts); body = `<div class="mh"><b>Drafts</b> <span class="muted">· saved on this device</span></div>${ds.length ? ds.map((d) => `<div class="mi" style="grid-template-columns:1fr auto auto"><span><span class="kicon ${d.kind}" style="display:inline-grid;width:20px;height:20px;font-size:.55rem;vertical-align:middle">${d.kind.slice(0, 3)}</span> ${esc(d.title)}<small>${esc(d.kind)}${d.mode === 'propose' ? ' · proposal to ' + esc(person(obj(d.kind, d.id).author).name) : ''} · ${S.editing && S.editing.id === d.id ? 'editing now' : 'kept'}</small></span><button class="btn sm" data-act="resume" data-kind="${d.kind}" data-id="${d.id}">Resume</button><button class="btn sm quiet danger" data-act="discard-draft" data-id="${d.id}">Discard</button></div>`).join('') : '<div class="empty" style="padding:.5rem .7rem">No unfinished work. Press Edit on something.</div>'}` }
		if (m.type === 'publish') { const d = S.drafts[S.editing.id]; const isMap = S.editing.kind === 'map'; const pub = obj(S.editing.kind, S.editing.id); body = `${pub.published ? mi(`Publish update<small>same address, becomes v${(pub.version || 0) + 1}</small>`, 'publish-update') : mi('Publish<small>first version</small>', 'publish-update')}${isMap ? mi('Publish as new map<small>new address, keeps this one as it is</small>', 'publish-new') : ''}<hr><div class="mh eyebrow">Who can see it</div>${[['everyone', 'Everyone', 'public relays'], ['circle', 'Circle: Alpine rescue', 'encrypted, 6 members'], ['nearby', 'Nearby: Saturday survey', 'this session only']].map(([v, t, s]) => `<button class="mi ${d.audience === v ? 'on' : ''}" data-act="audience" data-a="${v}"><span>${t}<small>${s}</small></span></button>`).join('')}` }
		if (m.type === 'share') body = `${mi('Copy link', 'toast-copied')}${mi('Copy link with what’s on the map', 'toast-copied')}${mi('Show QR code', 'toast')}${mi('Share to…', 'toast')}`
		if (m.type === 'safety') body = `<div class="mh eyebrow">When the AI changes something</div>${[['auto', 'Apply automatically', 'changes land, undo is one click'], ['ask', 'Ask before changing', 'show the proposal, then Apply'], ['every', 'Ask before every change', 'review each item']].map(([v, t, s]) => `<button class="mi ${S.safety === v ? 'on' : ''}" data-act="safety" data-v="${v}"><span>${t}<small>${s}</small></span></button>`).join('')}`
		if (m.type === 'more-tools') body = `<div class="mh eyebrow">Select</div>${mi('Select all', 'select-all')}${mi('Clear selection', 'clear-selection')}<hr><div class="mh eyebrow">Geometry</div>${toolbarMenuHtml(GEOMETRY_MENU.filter((x) => !x.h))}<hr><div class="mh eyebrow">File</div>${toolbarMenuHtml(FILE_MENU.filter((x) => !x.h))}<hr>${toolbarMenuHtml(MORE_MENU)}`
		if (m.type === 'add-map') body = `<div class="mh eyebrow">Add a map to this atlas</div>${mi('One of my maps…<small>republishes it with Belongs to</small>', 'dialog-pick-my-map')}${mi('New map in this atlas<small>opens a working copy with Belongs to set</small>', 'new-in-atlas')}`
		if (m.type === 'plus') body = `<div class="mh eyebrow">Add</div>${mi('Sighting here<small>something seen, expires on its own</small>', 'new-sighting')}${mi(S.liveMine ? 'Stop sharing live location' : 'Share live location<small>until you stop</small>', S.liveMine ? 'stop-live' : 'start-live')}${mi(`New ${lensAtlas() ? esc(noun(lensAtlas(), 1)) + ' map in ' + esc(lensAtlas().title) : 'map'}${!lensAtlas() && S.filter && S.filter.type === 'atlas' ? ` in ${esc(S.filter.label)}` : ''}<small>points, lines, and the Thread</small>`, 'new-map')}${mi('Import file…', 'toast')}`
		if (m.type === 'edit-other') { const o = obj(S.route.kind, S.route.id); body = `<div class="mh eyebrow">This ${esc(S.route.kind)} is by ${esc(person(o.author).name)}</div>${mi(`Propose changes<small>you edit a copy, they accept, it becomes their next version. Nothing forks.</small>`, 'propose')}${mi('Fork<small>your own copy at a new address, linked to the original</small>', 'fork-now')}` }
		if (m.type === 'annot') body = `<div class="mh eyebrow">Attach a place to your comment</div>${mi('Drop a pin<small>click once on the map</small>', 'annot-point')}${mi('Draw a line<small>click points, double-click to finish</small>', 'annot-line')}${S.selection.size === 1 ? mi('Use the selected feature', 'annot-selection') : ''}`
		if (m.type === 'row-more' || m.type === 'more-object') { const kind = m.data.kind || S.route.kind, id = m.data.id || S.route.id; const o = obj(kind, id); const k = key(kind, id); body = `${mi('Share…', 'menu-share-from')}${mi('Zap ⚡<small>21 sats</small>', 'zap-k')}${kind === 'map' ? mi(S.shelf.some((e) => e.id === id) ? 'Remove from map' : 'Show on map', 'row-shelf') : ''}${o && mine(o) ? mi(kind === 'map' || kind === 'story' || kind === 'atlas' ? 'Edit' : 'Open', 'row-edit') : kind === 'map' || kind === 'story' ? mi('Propose changes', 'row-propose') + (kind === 'map' ? mi('Fork', 'row-fork') : '') : ''}<hr>${o && mine(o) ? mi('Delete…', 'row-delete', 'danger') : mi('Report', 'toast', 'danger')}`; m.data.kind = kind; m.data.id = id; m.data.k = k }
		if (m.type === 'block-insert') body = `<div class="mh eyebrow">Add to the story</div>${[['p', 'Paragraph'], ['h', 'Heading'], ['img', 'Image'], ['table', 'Table'], ['quote', 'Quote'], ['list', 'List'], ['code', 'Code'], ['note', 'Callout'], ['hr', 'Divider']].map(([k, l]) => `<button class="mi" data-act="block-insert" data-t="${k}"><span>${l}</span></button>`).join('')}`
		if (MENU_DEFS[m.type]) body = toolbarMenuHtml(MENU_DEFS[m.type])
		if (m.type === 'tp-overflow') {
			const c = toolContext()
			const w = toolbarWidth()
			const hidden = TOOL_GROUPS.filter((g) => !(w >= 940 ? TOOL_GROUPS : w >= 660 ? TOOL_GROUPS.filter((x) => ['draw', 'history', 'geometry', 'more'].includes(x.id)) : TOOL_GROUPS.filter((x) => ['draw', 'history'].includes(x.id))).includes(g))
			body = hidden.map((g) => `<div class="mh eyebrow">${esc(g.label)}</div>` + g.items.map((it) => {
				const ok = !it.need || it.need(c)
				const active = (it.tool && S.tool === it.k) || (it.toggle && it.k === 'snap' && S.snap !== false)
				return `<button class="mi ${ok ? '' : 'off'} ${active ? 'on' : ''} ${it.danger ? 'danger' : ''}" ${ok ? (it.menu ? `data-act="menu" data-menu="${it.menu}"` : it.tool ? `data-act="tool" data-tool="${it.k}"` : `data-act="tool-action" data-k="${it.k}"`) : 'disabled'}><span>${it.g} ${esc(it.l)}${!ok && it.why ? `<small>${esc(it.why)}</small>` : ''}</span>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}</button>`
			}).join('')).join('<hr>')
		}
		if (m.type === 'live-discovery') { const l = S.liveMine ? obj('live', S.liveMine) : null; body = `<div class="mh eyebrow">Who can find you</div>${[['link', 'Link only', 'only people you send the link to'], ['public', 'Public', 'shows on the Live layer for everyone']].map(([v, t, sm]) => `<button class="mi ${l && l.discovery === v ? 'on' : ''}" data-act="live-discovery" data-v="${v}"><span>${t}<small>${sm}</small></span></button>`).join('')}` }
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
		if (d.type === 'send-proposal') { const o = obj(S.editing.kind, S.editing.id); const diff = S.editing.kind === 'map' ? diffDraft(o, S.drafts[S.editing.id]) : null; body = `<h3>Send proposal to ${esc(person(o.author).name)}</h3><p>${diff ? `<span class="mono"><span style="color:var(--green)">+${diff.add.length}</span> <span style="color:var(--amber)">~${diff.modify.length}</span> <span style="color:var(--red)">−${diff.remove.length}</span></span> · ` : 'Text changes · '}They see your changes as ghosts on their ${esc(S.editing.kind)} and can accept, decline, or discuss. Accepting publishes their next version with your name on the proposal.</p><textarea id="dlg-msg" rows="3" placeholder="Why these changes? (optional)" style="width:100%;border:1px solid var(--rule-2);background:var(--ground);padding:.5rem .6rem;margin-bottom:.8rem"></textarea><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button><button class="btn primary" data-act="send-proposal-go">Send proposal</button></div>` }
		if (d.type === 'geometry-op') {
			const c = toolContext()
			const titles = { simplify: 'Simplify selection', offset: 'Offset area by distance', parallel: 'Parallel line', corridor: 'Line corridor' }
			const isSimplify = d.op === 'simplify'
			body = `<h3>${esc(titles[d.op])}</h3><p>${c.n} feature${c.n === 1 ? '' : 's'} selected · ${c.sel.reduce((n, f) => n + (f.type === 'point' ? 1 : f.coords.length), 0)} coordinate points</p>
			<label class="fld"><span>${isSimplify ? 'Tolerance' : 'Distance'}</span><input type="range" min="0" max="100" value="${isSimplify ? 30 : 50}"><span class="mono">${isSimplify ? 'fine detail ←→ aggressive' : '250 m'}</span></label>
			${isSimplify ? '' : `<label class="fld"><span>Units</span><select><option>Meters</option><option>Kilometers</option><option>Miles</option></select></label>${d.op === 'parallel' ? '<label class="fld"><span>Side</span><select><option>Left of line direction</option><option>Right of line direction</option></select></label>' : ''}`}
			<label class="fld"><span>Result</span><select><option>Replace selected feature</option><option>Create derived copy</option></select></label>
			<dl class="kv two" style="margin:.6rem 0"><dt>Dataset size now</dt><dd>27 KB</dd><dt>After</dt><dd>${isSimplify ? '19 KB' : '31 KB'}</dd></dl>
			<div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button><button class="btn primary" data-act="dialog-cancel">Apply</button></div>`
		}
		if (d.type === 'label') body = `<h3>Label</h3><input type="text" id="dlg-name" placeholder="Text on the map" autofocus><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button><button class="btn primary" data-act="label-go">Place</button></div>`
		if (d.type === 'discard') body = `<h3>Discard this draft?</h3><p>The published version stays as it is. Unpublished changes on this device are lost.</p><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button><button class="btn danger" data-act="discard-go">Discard</button></div>`
		if (d.type === 'delete') body = `<h3>Delete this map?</h3><p>Earthly publishes a deletion request and hides it here. Relays and other people may keep copies.</p><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button><button class="btn danger" data-act="delete-go">Delete</button></div>`
		if (d.type === 'new-sighting') body = `<h3>Sighting here</h3><p>What did you see? It will show as a diamond at your position and fade after a day.</p><input type="text" id="dlg-name" placeholder="A few words"><div class="acts"><button class="btn quiet" data-act="dialog-cancel">Cancel</button><button class="btn primary" data-act="sighting-go">Post sighting</button></div>`
		host.innerHTML = `<div class="dialog-wrap" data-act="dialog-backdrop"><div class="dialog" role="dialog" aria-modal="true">${body}</div></div>`
		const inp = $('#dlg-name'); if (inp) setTimeout(() => { inp.focus(); inp.select() }, 30)
	}

	// ---- Mobile edit composition: dock at the thumb, status at the top, contextual strip for selection
	const mobileEditing = () => isMobile() && !!S.editing && S.editing.kind === 'map' && S.route.kind === 'map' && S.route.id === S.editing.id
	function renderMobileEdit() {
		const on = mobileEditing()
		document.body.classList.toggle('m-edit', on)
		const dock = $('#editdock'), strip = $('#ctxstrip'), status = $('#mstatus')
		dock.hidden = !on; strip.hidden = !on; status.hidden = !on
		if (!on) { S.moveMode = false; return }
		const d = S.drafts[S.editing.id]
		const drawing = S.drawing.length > 0
		const t = (k, glyph, label) => `<button class="dk ${S.tool === k ? 'on' : ''}" data-act="tool" data-tool="${k}" aria-label="${label}">${glyph}<span>${label}</span></button>`
		dock.innerHTML = drawing
			? `<button class="dk primary" data-act="finish-draw">✓<span>Finish · ${S.drawing.length}</span></button><button class="dk" data-act="undo-vertex">↶<span>Undo point</span></button><span class="sp"></span><button class="dk" data-act="cancel-draw">×<span>Cancel</span></button>`
			: `${t('point', '●', 'Point')}${t('line', '╱', 'Line')}${t('polygon', '⬠', 'Area')}${t('label', 'T', 'Label')}<span class="sep"></span><button class="dk" data-act="undo" ${S.undo.length ? '' : 'disabled'}>↶<span>Undo</span></button><button class="dk" data-act="menu" data-menu="more-tools">⋯<span>More</span></button><button class="dk" data-act="m-ask">✦<span>Ask</span></button><button class="dk done" data-act="done">Done<span>keeps draft</span></button>`
		const n = S.selection.size
		strip.hidden = !n || drawing
		if (n && !drawing) strip.innerHTML = `<span class="cnt">${n} selected</span><button class="btn sm ${S.moveMode ? 'primary' : ''}" data-act="move-mode">${S.moveMode ? 'Tap the new place' : 'Move'}</button>${n === 1 ? '<button class="btn sm" data-act="rename-sel">Rename</button>' : ''}<button class="btn sm danger" data-act="delete-sel">Delete</button><span class="sp"></span><button class="btn sm quiet" data-act="clear-selection">×</button>`
		const hint = S.moveMode ? 'Tap where the selection should go' : drawing ? (S.tool === 'polygon' ? 'Tap corners, then Finish' : 'Tap points along the line, then Finish') : S.tool === 'point' ? 'Tap the map to add a point' : S.tool === 'label' ? 'Tap the map to place a label' : S.tool ? 'Tap the map to start' : n ? 'Drag to pan · tap another feature to switch' : 'Tap a feature to select it, or pick a tool'
		status.innerHTML = `<span class="pen">✎</span><b>${esc(d.title)}</b><span class="hint">${hint}</span><button class="btn sm quiet" data-act="done" aria-label="Exit editing">Exit</button>`
	}
	// ---- Mobile nav
	function renderMobile() {
		renderMobileEdit()
		const nav = $('#mnav')
		const tab = S.menu && S.menu.type === 'me' ? 'me' : S.route.kind === 'browse' && !S.sheetHidden ? 'search' : S.sheetHidden ? 'map' : 'sheet'
		nav.innerHTML = `<button class="${tab === 'map' ? 'on' : ''}" data-act="m-map" title="${S.sheetHidden ? 'Frame what is on the map' : 'Close the sheet, just the map'}">${S.sheetHidden ? '🗺' : '⌄'}<span>${S.sheetHidden ? 'Map' : 'Just map'}</span></button><button class="${tab === 'search' ? 'on' : ''}" data-act="m-search">⌕<span>Search</span></button><button data-act="menu" data-menu="plus" aria-label="Add"><span class="plus">+</span></button><button class="${tab === 'me' ? 'on' : ''}" data-act="menu" data-menu="me"><span class="avatar sm">YO</span><span>Me</span></button>`
	}

	// ---------------------------------------------------------------- actions
	const A = {
		back() { if (history.length > 1) history.back(); else location.hash = '#/' },
		open(d) { if (d.kind === 'place') { flyToPlace(d.id); S.resultsOpen = false; S.query = ''; render(); return } S.resultsOpen = false; S.query = ''; if (d.kind === 'shelf') { location.hash = '#/shelf/now'; return } if (S.route.kind === d.kind && S.route.id === d.id) { S.menu = null; render(); return } go(d.kind, d.id, false) },
		tab(d) { S.tab = d.tab; if (isMobile() && S.detent === 'peek') S.detent = 'half'; render() },
		'thread-side'() { S.threadSide = true; S.tab = 'details'; render() },
		'thread-dock'() { S.threadSide = false; S.tab = 'thread'; render() },
		edit(d, el) { const { kind, id } = S.route; if (!mine(obj(kind, id))) { openMenu('edit-other', el); return } if (S.editing && S.editing.id !== id) { S.dialog = { type: 'finish-first', next: { kind, id } }; render(); return } beginEdit(kind, id); location.hash = hashFor({ kind, id, edit: true }) },
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
		'start-live'() { S.menu = null; startLive() },
		'stop-live'() { S.menu = null; stopLive() },
		'live-discovery'(d) { const l = S.liveMine ? obj('live', S.liveMine) : null; if (l) l.discovery = d.v; S.menu = null; render(); toast(d.v === 'public' ? 'Anyone can find you on the Live layer now.' : 'Only people with the link can see you.') },
		'follow-live'(d) { S.followLive = S.followLive === d.id ? null : d.id; if (S.followLive) flyTo(bbox([{ type: 'point', coords: obj('live', d.id).coords }]), true); render() },
		'open-inbox'() { S.menu = null; go('inbox', 'now') },
		'open-activity'(d) { if (d.tab) S.tab = d.tab; go(d.kind, d.id) },
		'tick-nudge'(d) { S.tick += +d.d; renderTicker() },
		'open-me-circles'() { S.menu = null; go('me', 'circles') },
		'open-me-nearby'() { S.menu = null; go('me', 'nearby') },
		'open-notification'(d) { const n = D.notifications.find((x) => x.id === d.id); if (!n) return; n.read = true; if (n.target.tab) S.tab = n.target.tab; go(n.target.kind, n.target.id) },
		'mark-all-read'() { D.notifications.forEach((n) => { n.read = true }); render() },
		'circle-approve'(d) { const c = obj('circle', S.route.id); c.pending = c.pending.filter((p) => p.id !== d.id); c.members.push({ id: d.id, role: 'member' }); render(); toast(`${person(d.id).name} joined. Group key rotated.`) },
		'circle-deny'(d) { const c = obj('circle', S.route.id); c.pending = c.pending.filter((p) => p.id !== d.id); render() },
		'circle-remove'(d) { const c = obj('circle', S.route.id); c.members = c.members.filter((m) => m.id !== d.id); render(); toast(`${person(d.id).name} removed. Group key rotated; they cannot read new records.`) },
		'new-map-audience'(d) { const aud = d.a; if (S.editing) { S.dialog = { type: 'finish-first', next: { kind: 'map', id: '__new__', atlas: null, audience: aud } }; render(); return } newMap(null, aud) },
		'ref-pick'(d) { S.refPick = S.refPick === +d.i ? null : +d.i; render(); if (S.refPick !== null) toast('Click a feature on the map to reference it.') },
		'scene-set'(d) { const dr = S.drafts[S.editing.id]; dr.presentation = dr.presentation || { version: 1, layerOrder: dr.maps.slice(), layers: {} }; dr.presentation.scenes = dr.presentation.scenes || []; const cap = capturePresentation(dr.maps); const i = +d.i; const existing = dr.presentation.scenes.find((sc) => sc.anchor === i); const b = dr.body[i]; const title = b && b.type === 'h' ? b.text : `Scene at ¶${i + 1}`; if (existing) { existing.view = cap.initialView; existing.layers = cap.layers } else dr.presentation.scenes.push({ id: `sc-${Date.now()}`, title, anchor: i, view: cap.initialView, layers: cap.layers }); dr.presentation.scenes.sort((x, y) => x.anchor - y.anchor); render(); toast('Scene captured from the current view.') },
		'scene-remove'(d) { const dr = S.drafts[S.editing.id]; if (dr.presentation && dr.presentation.scenes) dr.presentation.scenes.splice(+d.i, 1); render() },
		'scene-rename'(d) { const dr = S.drafts[S.editing.id]; const sc = dr.presentation.scenes[+d.i]; const t = prompt('Scene title', sc.title); if (t !== null && t.trim()) { sc.title = t.trim(); render() } },
		'go-scene'(d) { goScene(view('story', S.route.id), +d.i) },
		'feat-type'(d) { S.featType = d.t || null; S.featAll = false; render() },
		'feat-all'() { S.featAll = !S.featAll; render() },
		'feat-expand'(d) { if (S.featExpanded.has(d.id)) S.featExpanded.delete(d.id); else S.featExpanded.add(d.id); render() },
		'feat-select'(d) { if (S.selection.has(d.id)) S.selection.delete(d.id); else S.selection.add(d.id); render() },
		'feat-focus'(d) { const k = `${S.route.id}:${d.id}`; S.emphasis = S.emphasis.has(k) ? new Set() : new Set([k]); render(); if (S.emphasis.size) A['feat-zoom'](d) },
		'feat-zoom'(d) { const f = view('map', S.route.id).features.find((x) => x.id === d.id); if (f) flyTo(bbox([f]), true) },
		'feat-zoom-sel'() { const m = view('map', S.route.id); const sel = m.features.filter((f) => S.selection.has(f.id)); if (sel.length) flyTo(bbox(sel), sel.length === 1) },
		'feat-copy'() { toast('Feature GeoJSON copied.') },
		'feat-comment'(d) { const f = view('map', S.route.id).features.find((x) => x.id === d.id); if (!f) return; S.annot = { mode: null, geom: { type: f.type === 'polygon' ? 'line' : f.type, coords: f.coords }, drawing: [] }; S.tab = 'comments'; render(); toast(`“${f.name}” attached to your comment.`) },
		'feat-rename'(d) { const dr = S.drafts[S.editing.id]; const f = dr.features.find((x) => x.id === d.id); if (!f) return; const t = prompt('Feature name', f.name); if (t !== null && t.trim()) { pushUndo(); f.name = t.trim(); render() } },
		'feat-duplicate'(d) { const dr = S.drafts[S.editing.id]; const f = dr.features.find((x) => x.id === d.id); if (!f) return; pushUndo(); const i = dr.features.indexOf(f); dr.features.splice(i + 1, 0, Object.assign(clone(f), { id: `${f.id}-copy-${Date.now()}`, name: `${f.name} copy` })); render(); toast('Duplicated.', { label: 'Undo', fn: undo }) },
		'feat-delete'(d) { const dr = S.drafts[S.editing.id]; const f = dr.features.find((x) => x.id === d.id); if (!f) return; pushUndo(); dr.features = dr.features.filter((x) => x.id !== d.id); S.selection.delete(d.id); render(); toast(`Deleted “${f.name}”.`, { label: 'Undo', fn: undo }) },
		'feat-up'(d) { const dr = S.drafts[S.editing.id]; const i = dr.features.findIndex((x) => x.id === d.id); if (i > 0) { pushUndo(); const [f] = dr.features.splice(i, 1); dr.features.splice(i - 1, 0, f); render() } },
		'feat-down'(d) { const dr = S.drafts[S.editing.id]; const i = dr.features.findIndex((x) => x.id === d.id); if (i >= 0 && i < dr.features.length - 1) { pushUndo(); const [f] = dr.features.splice(i, 1); dr.features.splice(i + 1, 0, f); render() } },
		'feat-prop-add'(d) { const dr = S.drafts[S.editing.id]; const f = dr.features.find((x) => x.id === d.id); if (!f) return; const k = prompt('Property name'); if (!k || !k.trim()) return; pushUndo(); f.props = f.props || {}; f.props[k.trim()] = ''; S.featExpanded.add(d.id); render() },
		'go-block'(d) { const st = view('story', S.route.id); const i = +d.i; const scenes = st.presentation && st.presentation.scenes ? st.presentation.scenes : []; S.sceneIndex = scenes.findIndex((sc) => sc.anchor === i); applyBlockState(st, i) },
		'follow-text'() { S.followText = !S.followText; render(); toast(S.followText ? 'The map now follows the paragraph you read.' : 'The map stays where you put it.') },
		'blk-layer'(d) { const dr = S.drafts[S.editing.id]; const i = +d.i; dr.presentation = dr.presentation || { version: 1, layerOrder: dr.maps.slice(), layers: {}, scenes: [] }; dr.presentation.scenes = dr.presentation.scenes || []; let sc = dr.presentation.scenes.find((x) => x.anchor === i); if (!sc) { const b = dr.body[i]; sc = { id: `sc-${Date.now()}`, title: b && b.type === 'h' ? b.text : `¶${i + 1}`, anchor: i, layers: {} }; dr.presentation.scenes.push(sc); dr.presentation.scenes.sort((x, y) => x.anchor - y.anchor) } sc.layers = sc.layers || {}; const cur = sc.layers[d.id]; if (!cur) sc.layers[d.id] = { visible: true }; else if (cur.visible) sc.layers[d.id] = { visible: false }; else delete sc.layers[d.id]; if (!Object.keys(sc.layers).length && !sc.view) dr.presentation.scenes = dr.presentation.scenes.filter((x) => x !== sc); applyBlockState(dr, i, { fly: false }) },
		'blk-view'(d, el, ev) { const dr = S.drafts[S.editing.id]; const i = +d.i; dr.presentation = dr.presentation || { version: 1, layerOrder: dr.maps.slice(), layers: {}, scenes: [] }; dr.presentation.scenes = dr.presentation.scenes || []; let sc = dr.presentation.scenes.find((x) => x.anchor === i); const shift = window.event && window.event.shiftKey; if (shift && sc) { delete sc.view; if (!Object.keys(sc.layers || {}).length) dr.presentation.scenes = dr.presentation.scenes.filter((x) => x !== sc); render(); return } if (!sc) { const b = dr.body[i]; sc = { id: `sc-${Date.now()}`, title: b && b.type === 'h' ? b.text : `¶${i + 1}`, anchor: i, layers: {} }; dr.presentation.scenes.push(sc); dr.presentation.scenes.sort((x, y) => x.anchor - y.anchor) } sc.view = capturePresentation(dr.maps).initialView; S.activeBlock = i; render(); toast('Camera captured for this paragraph.') },
		present() { const st = view('story', S.route.id); if (S.presentScene !== null) { S.presentScene = null; S.sceneIndex = -1; render(); return } S.presentScene = st.id; goScene(st, 0) },
		'scene-next'() { const st = view('story', S.route.id); const n = st.presentation.scenes.length; if (S.sceneIndex >= n - 1) { S.presentScene = null; S.sceneIndex = -1; render(); toast('End of the story.'); return } goScene(st, S.sceneIndex + 1) },
		'scene-prev'() { const st = view('story', S.route.id); if (S.sceneIndex > 0) goScene(st, S.sceneIndex - 1) },
		'pres-set-view'() { const dr = S.drafts[S.editing.id]; const cap = capturePresentation(dr.maps); dr.presentation = Object.assign({ version: 1, layers: {}, scenes: [] }, dr.presentation || {}, { initialView: cap.initialView, layerOrder: dr.presentation && dr.presentation.layerOrder ? dr.presentation.layerOrder : cap.layerOrder }); render(); toast('Opening view set.') },
		'pres-clear-view'() { const dr = S.drafts[S.editing.id]; if (dr.presentation) delete dr.presentation.initialView; render() },
		'pres-fly'() { const st = view('story', S.route.id); if (st.presentation) applyPresentation(st.presentation, st.maps) },
		'pres-vis'(d) { const dr = S.drafts[S.editing.id]; dr.presentation = dr.presentation || { version: 1, layerOrder: dr.maps.slice(), layers: {} }; dr.presentation.layers = dr.presentation.layers || {}; const cur = dr.presentation.layers[d.id]; dr.presentation.layers[d.id] = { visible: !(cur && cur.visible !== false) }; const e = S.shelf.find((x) => x.id === d.id); if (e) e.visible = dr.presentation.layers[d.id].visible; render() },
		'pres-up'(d) { const dr = S.drafts[S.editing.id]; dr.presentation = dr.presentation || { version: 1, layerOrder: dr.maps.slice(), layers: {} }; const o = dr.presentation.layerOrder = dr.presentation.layerOrder && dr.presentation.layerOrder.length ? dr.presentation.layerOrder : dr.maps.slice(); const i = o.indexOf(d.id); if (i > 0) { [o[i - 1], o[i]] = [o[i], o[i - 1]] } applyPresentation({ layerOrder: o }, dr.maps); render() },
		'pres-down'(d) { const dr = S.drafts[S.editing.id]; dr.presentation = dr.presentation || { version: 1, layerOrder: dr.maps.slice(), layers: {} }; const o = dr.presentation.layerOrder = dr.presentation.layerOrder && dr.presentation.layerOrder.length ? dr.presentation.layerOrder : dr.maps.slice(); const i = o.indexOf(d.id); if (i >= 0 && i < o.length - 1) { [o[i + 1], o[i]] = [o[i], o[i + 1]] } applyPresentation({ layerOrder: o }, dr.maps); render() },
		'atlas-pres-set'() { const dr = S.drafts[S.editing.id]; dr.presentation = capturePresentation(dr.pinned); render(); toast('Default view set from the pinned maps and the current camera.') },
		'atlas-pres-clear'() { const dr = S.drafts[S.editing.id]; delete dr.presentation; render() },
		'atlas-pres-go'() { const a = view('atlas', S.route.id); a.pinned.forEach((id) => addToShelf(id, { silent: true })); applyPresentation(a.presentation, a.pinned); render() },
		'block-insert'(d) {
			S.menu = null
			const dr = S.drafts[S.editing.id]
			const proto = { p: { type: 'p', text: 'New paragraph.', refs: [] }, h: { type: 'h', level: 2, text: 'New section' }, img: { type: 'img', src: `img-${Date.now()}`, palette: 'cold', alt: 'Image', caption: 'Caption for the image.', credit: 'Illustration' }, table: { type: 'table', align: ['left', 'right'], head: ['Column', 'Value'], rows: [['First', '1'], ['Second', '2']] }, quote: { type: 'quote', text: 'A line worth pulling out.', by: 'Attribution' }, list: { type: 'list', ordered: false, items: ['First item', 'Second item'] }, code: { type: 'code', lang: 'json', text: '{ "type": "Feature" }' }, note: { type: 'note', tone: 'info', text: 'Something the reader should know.' }, hr: { type: 'hr' } }[d.t]
			dr.body.push(clone(proto))
			render()
			toast(`${d.t === 'hr' ? 'Divider' : d.t[0].toUpperCase() + d.t.slice(1)} added at the end.`)
		},
		'block-add'(d) { const dr = S.drafts[S.editing.id]; const i = +d.i; dr.body.splice(i + 1, 0, { type: 'p', text: 'New paragraph.', refs: [] }); if (dr.presentation && dr.presentation.scenes) dr.presentation.scenes.forEach((sc) => { if (sc.anchor > i) sc.anchor++ }); render() },
		'heading-add'(d) { const dr = S.drafts[S.editing.id]; const i = +d.i; dr.body.splice(i + 1, 0, { type: 'h', text: 'New section' }); if (dr.presentation && dr.presentation.scenes) dr.presentation.scenes.forEach((sc) => { if (sc.anchor > i) sc.anchor++ }); render() },
		'block-del'(d) { const dr = S.drafts[S.editing.id]; const i = +d.i; dr.body.splice(i, 1); if (dr.presentation && dr.presentation.scenes) { dr.presentation.scenes = dr.presentation.scenes.filter((sc) => sc.anchor !== i); dr.presentation.scenes.forEach((sc) => { if (sc.anchor > i) sc.anchor-- }) } render() },
		theme(d) { if (d.theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = d.theme; try { localStorage.setItem('sketch-theme', d.theme) } catch {} render(); setTimeout(applyMlColors, 30) },
		'open-me'() { S.menu = null; go('person', 'me') },
		resume(d) { S.menu = null; const pr = S.drafts[d.id] && S.drafts[d.id].mode === 'propose'; if (S.editing && S.editing.id !== d.id) { S.dialog = { type: 'finish-first', next: { kind: d.kind, id: d.id, propose: pr } }; render(); return } if (pr) beginPropose(d.kind, d.id); location.hash = hashFor({ kind: d.kind, id: d.id, edit: true }) },
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
		'save-view-go'() { const name = $('#dlg-name').value.trim() || 'My view'; const id = `atlas-${++S.counter}`; D.atlases[id] = { id, kind: 'atlas', title: name, author: 'me', policy: 'closed', published: today, version: 1, noun: 'map', emblem: '◈', description: `Saved from the map on ${today}.`, pinned: S.shelf.map((e) => e.id), presentation: capturePresentation() }; S.dialog = null; toast('Atlas saved with this view as its default. Share it like anything else.'); go('atlas', id) },
		'show-all'(d) { const a = D.atlases[d.id]; const mem = atlasMembers(a); const ids = [...mem.pinned, ...mem.added].map((m) => m.id); ids.forEach((id) => addToShelf(id, { silent: true })); if (a.presentation) applyPresentation(a.presentation, mem.pinned.map((m) => m.id)); else flyToMaps(ids); syncHash(); render() },
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
		tool(d) {
			S.menu = null
			// Only the four primitives actually draw in the sketch; the rest show their state and say so.
			if (['point', 'line', 'polygon', 'label'].includes(d.tool)) { S.tool = S.tool === d.tool ? null : d.tool; S.drawing = []; S.popup = null; render(); return }
			const item = TOOL_GROUPS.flatMap((g) => g.items).find((i) => i.k === d.tool) || SHAPES_MENU.find((i) => i.k === d.tool)
			S.tool = S.tool === d.tool ? null : d.tool
			S.drawing = []
			render()
			toast(`${item ? item.l : d.tool}: shown for the layout, not wired in this sketch.`)
		},
		'tool-action'(d) {
			S.menu = null
			if (d.k === 'undo') { undo(); return }
			if (d.k === 'redo') { redo(); return }
			if (d.k === 'delete') { A['delete-sel'](); return }
			if (d.k === 'snap') { S.snap = S.snap === false; render(); toast(`Snapping ${S.snap === false ? 'off' : 'on'}.`); return }
			if (d.k === 'callouts') { S.calloutsOn = S.calloutsOn === false; render(); toast(`Map callouts ${S.calloutsOn === false ? 'hidden' : 'shown'}.`); return }
			if (d.k === 'duplicate' && S.editing) { pushUndo(); const dr = S.drafts[S.editing.id]; const copies = dr.features.filter((f) => S.selection.has(f.id)).map((f) => Object.assign(clone(f), { id: `${f.id}-copy-${Date.now()}`, name: `${f.name} copy` })); dr.features.push(...copies); render(); toast(`Duplicated ${copies.length}.`, { label: 'Undo', fn: undo }); return }
			if (d.k === 'simplify' || d.k === 'offset' || d.k === 'parallel' || d.k === 'corridor') { S.dialog = { type: 'geometry-op', op: d.k }; render(); return }
			const all = [...GEOMETRY_MENU, ...FILE_MENU, ...MORE_MENU, ...TOOL_GROUPS.flatMap((g) => g.items)]
			const item = all.find((i) => i.k === d.k)
			render()
			toast(`${item ? item.l.replace('…', '') : d.k}: shown for the layout, not wired in this sketch.`)
		},
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
		'm-close'() { S.menu = null; S.resultsOpen = false; S.sheetHidden = true; S.tab = 'details'; if (S.editing && S.route.kind === 'map' && S.route.id === S.editing.id) endEdit(true); if (S.route.kind) location.hash = hashFor({ kind: null, id: null, edit: false }); else render() },
		'm-map'() { S.resultsOpen = false; S.menu = null; if (!S.sheetHidden) { A['m-close'](); return } A.fit() },
		'm-search'() { S.menu = null; S.sheetHidden = false; S.detent = 'full'; if (S.route.kind === 'browse') { render(); return } location.hash = `#/browse/${S.browse.kind}`; setTimeout(() => { const q = $('#bq'); if (q) q.focus() }, 80) },
		detent() { S.detent = S.detent === 'peek' ? 'half' : S.detent === 'half' ? 'full' : 'peek'; render() },
		react() { toast('♥ Reacted. Kind 7, like everywhere else on Nostr.') },
		'edit-id'(d) { if (S.editing && S.editing.id !== d.id) { S.dialog = { type: 'finish-first', next: { kind: d.kind, id: d.id } }; render(); return } beginEdit(d.kind, d.id); location.hash = hashFor({ kind: d.kind, id: d.id, edit: true }) },
		'fly-story'(d) { const st = D.stories[d.id]; st.maps.forEach((m) => addToShelf(m, { silent: true })); flyToMaps(st.maps); syncHash(); render() },
		like(d) { const k = d.k; if (S.liked.has(k)) S.liked.delete(k); else S.liked.add(k); render() },
		fav(d) { const k = d.k; if (S.faved.has(k)) { S.faved.delete(k); toast('Removed from favourites.') } else { S.faved.add(k); toast('Favourited. Find it under Me → Favourites.') } render() },
		zap() { S.menu = null; toast('⚡ 21 sats zapped. Kind 9735, like everywhere on Nostr.'); render() },
		'zap-k'() { A.zap() },
		'menu-share-from'() { S.menu = null; render(); toast('Link copied.') },
		'row-shelf'() { const id = S.menu.data.id; S.menu = null; if (S.shelf.some((e) => e.id === id)) removeFromShelf(id); else { addToShelf(id, { fly: true }); render() } },
		'row-edit'() { const { kind, id } = S.menu.data; S.menu = null; if (['map', 'story', 'atlas'].includes(kind)) A['edit-id']({ kind, id }); else go(kind, id) },
		'row-propose'() { const { kind, id } = S.menu.data; S.menu = null; if (S.editing && S.editing.id !== id) { S.dialog = { type: 'finish-first', next: { kind, id, propose: true } }; render(); return } beginPropose(kind, id); location.hash = hashFor({ kind, id, edit: true }) },
		'row-fork'() { const { id } = S.menu.data; S.menu = null; fork(id) },
		'row-delete'() { const { kind, id } = S.menu.data; S.menu = null; if (S.route.id !== id) go(kind, id); setTimeout(() => { S.dialog = { type: 'delete' }; render() }, 80) },
		'open-comments'(d) { S.tab = 'comments'; if (S.route.kind === d.kind && S.route.id === d.id) render(); else go(d.kind, d.id) },
		'fork-now'() { S.menu = null; fork(S.route.id) },
		'annot-point'() { S.menu = null; S.annot = { mode: 'point', geom: null, drawing: [] }; render(); toast('Click the map where the comment applies.') },
		'annot-line'() { S.menu = null; S.annot = { mode: 'line', geom: null, drawing: [] }; render(); toast('Click points on the map. Double-click to finish.') },
		'annot-selection'() { S.menu = null; const id = Array.from(S.selection)[0]; const m = view('map', S.route.id); const f = m && m.features.find((x) => x.id === id); if (f) S.annot = { mode: null, geom: { type: f.type === 'polygon' ? 'line' : f.type, coords: f.coords }, drawing: [] }; render() },
		'annot-clear'() { S.annot = null; render() },
		'reply-to'(d) { S.replyTo = d.id; S.annot = null; render(); setTimeout(() => { const t = $('#ctext'); if (t) t.focus() }, 30) },
		'reply-cancel'() { S.replyTo = null; render() },
		'post-comment'(d) { const ta = $('#ctext'); const text = ta && ta.value.trim(); if (!text) { toast('Write something first.'); return } const k = key(S.route.kind, S.route.id); const c = { id: `c-${Date.now()}`, on: k, author: 'me', when: today + ' ' + new Date().toTimeString().slice(0, 5), text, likes: 0 }; if (d.parent) c.parent = d.parent; if (S.annot && S.annot.geom && !d.parent) c.geom = S.annot.geom; D.comments.push(c); S.annot = null; S.replyTo = null; render(); toast(c.geom ? 'Comment posted with a place attached.' : 'Comment posted.') },
		'like-comment'(d) { const k = 'c:' + d.id; if (S.liked.has(k)) S.liked.delete(k); else S.liked.add(k); render() },
		'delete-comment'(d) { D.comments = D.comments.filter((c) => c.id !== d.id && c.parent !== d.id); render(); toast('Comment deleted (kind 5 deletion request).') },
		'fly-comment'(d) { const c = D.comments.find((x) => x.id === d.id); if (!c || !c.geom) return; flyTo(bbox([{ type: c.geom.type, coords: c.geom.coords }]), true) },
		propose() { const { kind, id } = S.route; S.menu = null; if (S.editing && S.editing.id !== id) { S.dialog = { type: 'finish-first', next: { kind, id, propose: true } }; render(); return } beginPropose(kind, id); location.hash = hashFor({ kind, id, edit: true }) },
		'send-proposal-go'() { const msg = $('#dlg-msg') ? $('#dlg-msg').value.trim() : ''; S.dialog = null; sendProposal(msg) },
		'preview-proposal'(d) { S.previewProposal = S.previewProposal === d.id ? null : d.id; const p = D.proposals.find((x) => x.id === d.id); if (S.previewProposal && p) { const m = obj('map', p.target.split(':')[1]); const feats = [...p.add, ...p.modify.map((mm) => m.features.find((f) => f.id === mm.id)).filter(Boolean)]; if (feats.length) flyTo(bbox(feats)) } render() },
		'accept-proposal'(d) { acceptProposal(d.id) },
		'decline-proposal'(d) { const p = D.proposals.find((x) => x.id === d.id); if (p) p.status = 'declined'; S.previewProposal = null; render(); toast('Declined. The proposer keeps their copy of the changes.') },
		'withdraw-proposal'(d) { D.proposals = D.proposals.filter((x) => x.id !== d.id); S.previewProposal = null; render(); toast('Proposal withdrawn.') },
		'new-story'() { S.menu = null; const id = `story-${++S.counter}`; D.stories[id] = { id, kind: 'story', title: 'Untitled story', author: 'me', published: null, draft: true, summary: '', maps: S.shelf.slice(0, 2).map((e) => e.id), body: [{ type: 'p', text: 'Start writing. Reference maps and features from the Shelf.', refs: [] }] }; if (S.editing) { S.dialog = { type: 'finish-first', next: { kind: 'story', id } }; render(); return } beginEdit('story', id); location.hash = hashFor({ kind: 'story', id, edit: true }) },
		'new-atlas'() { S.menu = null; const id = `atlas-${++S.counter}`; D.atlases[id] = { id, kind: 'atlas', title: 'Untitled atlas', author: 'me', policy: 'open', published: null, version: 0, noun: 'map', emblem: '◈', description: 'What belongs here?', pinned: [] }; if (S.editing) { S.dialog = { type: 'finish-first', next: { kind: 'atlas', id } }; render(); return } beginEdit('atlas', id); location.hash = hashFor({ kind: 'atlas', id, edit: true }) },
		'move-mode'() { S.moveMode = !S.moveMode; render() },
		'rename-sel'() { const d = S.drafts[S.editing.id]; const f = d.features.find((x) => S.selection.has(x.id)); if (!f) return; const t = prompt('Name', f.name); if (t !== null && t.trim()) { pushUndo(); f.name = t.trim(); render() } },
		'delete-sel'() { pushUndo(); const d = S.drafts[S.editing.id]; const n = S.selection.size; d.features = d.features.filter((f) => !S.selection.has(f.id)); S.selection.clear(); render(); toast(`Deleted ${n}.`, { label: 'Undo', fn: undo }) },
		'finish-draw'() { finishDrawing() },
		'undo-vertex'() { S.drawing.pop(); renderCanvas(); renderMobileEdit() },
		'cancel-draw'() { S.drawing = []; render() },
		'm-ask'() { S.tab = 'thread'; S.detent = 'half'; S.tool = null; render() },
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
		if (next.id === '__new__') { newMap(next.atlas, next.audience); return }
		if (next.propose) beginPropose(next.kind, next.id); else beginEdit(next.kind, next.id)
		location.hash = hashFor({ kind: next.kind, id: next.id, edit: true })
		if (d.thenSend) setTimeout(() => send(d.thenSend), 50)
	}
	function newMap(atlasId, audience) {
		const id = `map-${++S.counter}`
		const c = screenToWorld(innerWidth / 2, innerHeight / 2)
		const a = atlasId ? D.atlases[atlasId] : null
		D.maps[id] = { id, kind: 'map', title: a ? `Untitled ${noun(a, 1)} map` : 'Untitled map', author: 'me', published: null, version: 0, summary: '', topics: a ? [a.noun || 'map'] : [], belongsTo: atlasId ? [atlasId] : [], size: '0 KB', props: {}, features: [], audience: audience || 'everyone' }
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
		if (e.target.dataset.bindBlock !== undefined && S.editing) { const d = S.drafts[S.editing.id]; const i = +e.target.dataset.bindBlock; if (d.body[i]) d.body[i].text = e.target.textContent; return }
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
		if (e.target.id === 'csort') { S.commentSort = e.target.value; render() }
		if (e.target.id === 'featq') { S.featFilter = e.target.value; S.featAll = false; const host = $('#features'); const scroll = $('.margin-body') ? $('.margin-body').scrollTop : 0; render(); const q = $('#featq'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length) } if ($('.margin-body')) $('.margin-body').scrollTop = scroll }
		if (e.target.dataset.featProp && S.editing) { const dr = S.drafts[S.editing.id]; const f = dr.features.find((x) => x.id === e.target.dataset.featProp); if (f) { f.props = f.props || {}; f.props[e.target.dataset.key] = e.target.value } return }
		if (e.target.id === 'ctext') autoGrow(e.target)
	})
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') { if (S.menu || S.dialog || S.resultsOpen || S.popup || S.tool || (S.annot && S.annot.mode)) { S.menu = null; S.dialog = null; S.resultsOpen = false; S.popup = null; closeTool(); if (S.annot && S.annot.mode) S.annot = null; pendingEditPrompt = false; render() } return }
		if (e.target.id === 'composer-text' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); A.send(); return }
		if (e.target.id === 'q' && e.key === 'Enter') { const first = $('#results .row'); const t = S.query.trim().toLowerCase(); if (/\?$/.test(t) || /^(how|what|where|which|why|who|when)\b/.test(t)) askFrom(S.query); else if (first) first.click(); return }
		if (e.target.id === 'askq' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); A['ask-send'](); return }
		if (e.target.id === 'ctext' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); const b = $('[data-act="post-comment"]'); if (b) b.click(); return }
		if (e.target.id === 'dlg-name' && e.key === 'Enter') { const go = $('.dialog .btn.primary'); if (go) go.click(); return }
		if (e.target.matches('input,textarea,[contenteditable]')) return
		if (e.key === '/') { e.preventDefault(); const q = $('#q'); if (q) q.focus() }
		if (S.editing && S.editing.kind === 'map' && ['1', '2', '3', '4'].includes(e.key)) { A.tool({ tool: ['point', 'line', 'polygon', 'label'][+e.key - 1] }) }
		if (S.editing && S.editing.kind === 'map') {
			if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
			if (e.key === 'Enter' && S.drawing.length) finishDrawing()
		}
		if (S.annot && S.annot.drawing.length && e.key === 'Enter') { finishAnnot()
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
	let listHoverUid = null
	document.addEventListener('pointerover', (e) => { const r = e.target.closest('[data-hover-map]'); const id = r ? r.dataset.hoverMap : ''; $$('.schip').forEach((c) => c.classList.toggle('hover', !!id && c.dataset.map === id)); $$('.lyr').forEach((l) => l.classList.toggle('hover', !!id && l.dataset.map === id)); const u = e.target.closest('[data-hover-uid]'); const uid = u ? u.dataset.hoverUid : null; if (ml && mlReady && uid !== listHoverUid) { if (listHoverUid) ml.setFeatureState({ source: 'feats', id: listHoverUid }, { hov: false }); if (uid) ml.setFeatureState({ source: 'feats', id: uid }, { hov: true }); listHoverUid = uid } })
	cv.addEventListener('pointerleave', () => { $$('.schip.hover,.lyr.hover').forEach((c) => c.classList.remove('hover')) })
	cv.addEventListener('pointerup', (e) => {
		if (ml || !drag) return
		const wasDrag = drag.moved; const target = drag.target; drag = null; cv.classList.remove('panning')
		if (wasDrag) return
		if (target.closest('.overlay,.shelf,.mtop,#popup')) return
		const hit = target.closest('[data-fid]')
		const sight = target.closest('[data-act="open"]')
		if (sight && !hit) { A.open(sight.dataset); return }
		if (S.moveMode) { moveSelectionTo(screenToWorld(e.clientX, e.clientY)); return }
		if (S.annot && S.annot.mode) { annotAt(screenToWorld(e.clientX, e.clientY)); return }
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
		sheetDrag = { y: e.clientY, h: margin.getBoundingClientRect().height, moved: false, startDetent: S.detent }
		margin.setPointerCapture(e.pointerId)
	})
	margin.addEventListener('pointermove', (e) => {
		if (!sheetDrag) return
		const dy = sheetDrag.y - e.clientY
		if (Math.abs(dy) > 6) { sheetDrag.moved = true; margin.classList.add('dragging'); margin.style.setProperty('--sheet-h', Math.max(30, Math.min(innerHeight - 64, sheetDrag.h + dy)) + 'px') }
	})
	margin.addEventListener('pointerup', (e) => {
		if (!sheetDrag) return
		margin.classList.remove('dragging')
		if (sheetDrag.moved) {
			const h = margin.getBoundingClientRect().height
			if (h < 58 || (sheetDrag.startDetent === 'peek' && h < sheetDrag.h - 24)) { sheetDrag = null; A['m-close'](); return }
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

	// Reading a story: the map follows the topmost paragraph in view.
	let blockObserver = null, followTimer = null
	function observeBlocks() {
		if (blockObserver) { blockObserver.disconnect(); blockObserver = null }
		if (S.route.kind !== 'story' || !S.followText || (S.editing && S.editing.id === S.route.id)) return
		const st = view('story', S.route.id)
		if (!st.presentation || !(st.presentation.scenes || []).length) return
		const root = $('.margin-body') || null
		const visible = new Map()
		let lastScrollAt = 0
		if (root) root.addEventListener('scroll', () => { lastScrollAt = Date.now() }, { passive: true })
		blockObserver = new IntersectionObserver((entries) => {
			entries.forEach((en) => { const i = +en.target.dataset.blk; if (en.isIntersecting) visible.set(i, en.boundingClientRect.top); else visible.delete(i) })
			if (!visible.size) return
			if (Date.now() < S.followMuteUntil || lastScrollAt < S.followMuteUntil) return
			const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0][0]
			// The map state of a paragraph without its own scene is whatever the last scene left; apply only when the effective state changes.
			clearTimeout(followTimer)
			followTimer = setTimeout(() => { if (S.activeBlock === top) return; const cur = effectiveState(st, top); const prev = S.activeBlock >= 0 ? effectiveState(st, S.activeBlock) : null; const same = prev && JSON.stringify(prev.layers) === JSON.stringify(cur.layers) && JSON.stringify(prev.view) === JSON.stringify(cur.view); S.activeBlock = top; S.emphasis = cur.refs; if (!same) applyBlockState(st, top, { render: false }); const scenes = st.presentation.scenes; S.sceneIndex = scenes.findIndex((sc) => sc.anchor === top); $$('.blk').forEach((b) => b.classList.toggle('active', +b.dataset.blk === top)); renderCanvas() }, 120)
		}, { root, threshold: 0.4 })
		$$('.blk[data-blk]').forEach((b) => blockObserver.observe(b))
	}
	document.addEventListener('pointerenter', (e) => { if (e.target.closest && e.target.closest('#ticker')) S.tickPaused = true }, true)
	document.addEventListener('pointerleave', (e) => { if (e.target.closest && e.target.closest('#ticker')) S.tickPaused = false }, true)
	window.addEventListener('hashchange', onRoute)
	window.addEventListener('resize', () => render())

	// ------------------------------------------------------------------ boot
	try { const t = localStorage.getItem('sketch-theme'); if (t && t !== 'system') document.documentElement.dataset.theme = t } catch {}
	window.__sketch = { S, D, flyToMaps, bbox, render, canvasRect }
	try { const g = localStorage.getItem('sketch-glass'); S.glass = g === null ? isMobile() : g === '1' } catch { S.glass = isMobile() }
	S.view = { x: 0, y: 0, k: 1 }
	S.sheetHidden = isMobile() && !parseHash().kind
	initBasemap()
	onRoute()
	startTicker()
	setTimeout(() => { if (!S.route.kind && !ml) A.fit() }, 30)
})()
