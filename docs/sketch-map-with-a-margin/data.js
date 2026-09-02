/* Sketch data. Objects are modelled on what is actually on earthly.city.
   Coordinates are real [lon, lat] so the OpenFreeMap basemap lines up. */
(function () {
	let seed = 7
	function rnd() {
		seed = (seed * 16807) % 2147483647
		return (seed - 1) / 2147483646
	}
	function jitter(a) {
		return (rnd() - 0.5) * a
	}
	const r3 = (v) => Math.round(v * 1000) / 1000
	// A gently curved line between two [lon,lat] points with n vertices; bend is in degrees of latitude.
	function curve(from, to, n, bend, wobble) {
		const pts = []
		for (let i = 0; i <= n; i++) {
			const t = i / n
			const x = from[0] + (to[0] - from[0]) * t
			const y = from[1] + (to[1] - from[1]) * t + Math.sin(t * Math.PI) * bend
			const inner = i > 0 && i < n
			pts.push([r3(x + (inner ? jitter(wobble) : 0)), r3(y + (inner ? jitter(wobble) : 0))])
		}
		return pts
	}
	const pt = (id, name, lon, lat, props) => ({ id, name, type: 'point', coords: [lon, lat], props: props || {} })
	const ln = (id, name, pts, props) => ({ id, name, type: 'line', coords: pts, props: props || {} })
	const pg = (id, name, pts, props) => ({ id, name, type: 'polygon', coords: pts, props: props || {} })

	const people = {
		me: { id: 'me', name: 'You', handle: 'you@earthly.city', initials: 'YO' },
		schlaus: { id: 'schlaus', name: 'Schlaus Kwab', handle: 'schlaus@earthly.city', initials: 'SK' },
		earthly: { id: 'earthly', name: 'earthly.city', handle: 'earthly.city', initials: 'EC' },
		mafrend: { id: 'mafrend', name: 'Mafrend', handle: 'mafrend@nostr.example', initials: 'MA' },
		aria: { id: 'aria', name: 'Aria Voss', handle: 'aria@nostr.example', initials: 'AV' },
	}

	const C = {
		Istanbul: [28.98, 41.01], Ankara: [32.86, 39.93], Tabriz: [46.29, 38.08], Tehran: [51.39, 35.69], Mashhad: [59.61, 36.3],
		Herat: [62.2, 34.35], Kandahar: [65.71, 31.62], Kabul: [69.17, 34.53], Peshawar: [71.52, 34.01], Lahore: [74.35, 31.55],
		Delhi: [77.21, 28.61], Kathmandu: [85.32, 27.72],
		'Xi’an': [108.94, 34.34], Lanzhou: [103.83, 36.06], Urumqi: [87.62, 43.83], Almaty: [76.89, 43.24], Tashkent: [69.24, 41.3],
		Moscow: [37.62, 55.75], Duisburg: [6.76, 51.43], Rotterdam: [4.48, 51.92], Gwadar: [62.32, 25.13], Colombo: [79.86, 6.93],
		Djibouti: [43.15, 11.59], Piraeus: [23.65, 37.94], Venice: [12.32, 45.44], 'Kuala Lumpur': [101.69, 3.14], Jakarta: [106.85, -6.21],
		Mombasa: [39.67, -4.04], Hanoi: [105.85, 21.03], Yiwu: [120.07, 29.31],
	}
	const trailStops = ['Istanbul', 'Ankara', 'Tabriz', 'Tehran', 'Mashhad', 'Herat', 'Kandahar', 'Kabul', 'Peshawar', 'Lahore', 'Delhi', 'Kathmandu']
	const trail = []
	trailStops.forEach((s, i) => { if (i === 0) trail.push(C[s]); else trail.push(...curve(C[trailStops[i - 1]], C[s], 3, 0.6, 0.25).slice(1)) })

	const maps = {}
	const addMap = (m) => (maps[m.id] = m)

	addMap({
		id: 'hippie-trail', kind: 'map', title: 'The Hippie Trail', author: 'me', published: '2026-09-01', version: 3,
		summary: 'The overland route from Istanbul to Kathmandu as travelled 1957–1978, with the towns that became stops.',
		topics: ['overland', 'history', 'travel'], belongsTo: ['cool-historical'], size: '27 KB', props: { period: '1957–1978' },
		features: [ln('trail', 'Overland route', trail, { period: '1957–1978' }), ...trailStops.map((s, i) => pt('stop-' + i, s, C[s][0], C[s][1], { kind: 'stop' }))],
	})
	const corridors = [
		['New Eurasian Land Bridge', 'Xi’an', 'Duisburg', 12, 9],
		['China–Central Asia–West Asia', 'Xi’an', 'Tehran', 10, 4],
		['China–Indochina Peninsula', 'Xi’an', 'Kuala Lumpur', 8, -2],
		['China–Pakistan Economic Corridor', 'Urumqi', 'Gwadar', 8, 0],
		['Maritime Silk Road', 'Yiwu', 'Piraeus', 16, -22],
		['Bangladesh–China–India–Myanmar', 'Lanzhou', 'Colombo', 6, 3],
	]
	const nodes = ['Xi’an', 'Lanzhou', 'Urumqi', 'Almaty', 'Tashkent', 'Tehran', 'Istanbul', 'Moscow', 'Duisburg', 'Rotterdam', 'Gwadar', 'Colombo', 'Djibouti', 'Piraeus', 'Venice', 'Kuala Lumpur', 'Jakarta', 'Mombasa', 'Hanoi', 'Yiwu']
	addMap({
		id: 'bri', kind: 'map', title: 'China’s Belt and Road Initiative', author: 'me', published: '2026-07-13', version: 2,
		summary: 'Six overland and maritime corridors with the ports, rail hubs and financing nodes that connect them.',
		topics: ['infrastructure', 'geopolitics'], belongsTo: [], size: '25 KB', props: {},
		features: [...corridors.map((c, i) => ln('corr-' + i, c[0], curve(C[c[1]], C[c[2]], c[3], c[4], 1.2), { kind: 'corridor' })), ...nodes.map((n, i) => pt('node-' + i, n, C[n][0], C[n][1], { kind: 'node' }))],
	})
	const VB = [-75.98, 36.85], BIL = [-2.93, 43.26], BUDE = [-4.54, 50.83], FOR = [-38.54, -3.72], SIN = [-8.87, 37.96], NJ = [-74.0, 40.4], LIS = [-9.4, 38.7]
	addMap({
		id: 'cables-atlantic', kind: 'map', title: 'Submarine Cables — Atlantic Ocean', author: 'earthly', published: '2026-07-17', version: 1,
		summary: 'Transatlantic cable systems with landing stations on both shores.',
		topics: ['submarine-cables', 'internet-infrastructure', 'atlantic'], belongsTo: ['sea-cables'], size: '50 KB', props: { operator: 'various' },
		features: [
			ln('c1', 'MAREA', curve(VB, BIL, 10, 3, 0.8)), ln('c2', 'Dunant', curve(VB, [-1.2, 44.6], 10, 6, 0.8)), ln('c3', 'Grace Hopper', curve([-73.5, 40.8], BUDE, 10, 5, 0.8)),
			ln('c4', 'Amitié', curve([-70.5, 42.0], [-4.5, 48.4], 10, 4, 0.8)), ln('c5', 'EllaLink', curve(FOR, SIN, 8, -4, 0.6)), ln('c6', 'SACS', curve(FOR, [13.2, -8.8], 8, -6, 0.6)), ln('c7', 'TAT-14', curve(NJ, BUDE, 10, 7, 0.8)),
			pt('ls1', 'Bilbao landing', BIL[0], BIL[1]), pt('ls2', 'Virginia Beach', VB[0], VB[1]), pt('ls3', 'Bude', BUDE[0], BUDE[1]), pt('ls4', 'Fortaleza', FOR[0], FOR[1]), pt('ls5', 'Sines', SIN[0], SIN[1]),
		],
	})
	addMap({
		id: 'enclaves', kind: 'map', title: 'World Enclaves & Exclaves', author: 'schlaus', published: '2026-07-21', version: 1,
		summary: 'Eighty-seven pockets of territory surrounded by someone else.',
		topics: ['borders'], belongsTo: ['cool-historical'], size: '62 KB', props: { period: 'current' },
		features: [
			pt('e1', 'Baarle-Nassau', 4.93, 51.44), pt('e2', 'Kaliningrad', 20.45, 54.71), pt('e3', 'Nakhchivan', 45.41, 39.21), pt('e4', 'Ceuta', -5.32, 35.89),
			pt('e5', 'Llívia', 1.98, 42.46), pt('e6', 'Point Roberts', -123.07, 48.99), pt('e7', 'Campione d’Italia', 8.97, 45.97), pt('e8', 'Cabinda', 12.2, -5.55),
			pt('e9', 'Musandam', 56.25, 26.2), pt('e10', 'Oecusse', 124.37, -9.2), pt('e11', 'Temburong', 115.15, 4.64), pt('e12', 'Dahagram', 88.97, 26.22),
		],
	})
	const BER = [13.4, 52.52]
	addMap({
		id: 'west-berlin', kind: 'map', title: 'West Berlin Transit Corridors (1949–1990)', author: 'aria', published: '2026-08-12', version: 1,
		summary: 'Road, rail and air corridors that kept West Berlin connected across the GDR.',
		topics: ['history', 'cold-war'], belongsTo: [], size: '332 KB', props: { period: '1949–1990' },
		features: [
			ln('t1', 'Helmstedt–Berlin autobahn', curve([11.01, 52.23], BER, 6, -0.15, 0.05)), ln('t2', 'Hamburg–Berlin', curve([9.99, 53.55], BER, 5, 0.1, 0.05)), ln('t3', 'Munich–Berlin', curve([11.58, 48.14], BER, 6, 0.3, 0.05)),
			pt('b1', 'Checkpoint Alpha', 11.01, 52.23), pt('b2', 'Checkpoint Bravo', 13.13, 52.4), pt('b3', 'Tempelhof', 13.4, 52.47), pt('b4', 'Tegel', 13.29, 52.56), pt('b5', 'Gatow', 13.14, 52.47),
		],
	})
	addMap({
		id: 'ice-free', kind: 'map', title: 'Ice-Free Northern Passages: Status Quo vs 2050', author: 'mafrend', published: '2026-07-12', version: 1,
		summary: 'The Northern Sea Route and the Northwest Passage as they are and as models expect them.',
		topics: ['arctic', 'shipping', 'climate'], belongsTo: [], size: '38 KB', props: {},
		features: [
			ln('nsr', 'Northern Sea Route', curve([33.08, 68.97], [170.3, 69.7], 14, 6, 0.4), { status: 'seasonal' }),
			ln('nwp', 'Northwest Passage', curve([-165.4, 64.5], [-60.0, 66.0], 12, 10, 0.4), { status: 'seasonal' }),
			ln('tsr', 'Transpolar Sea Route (2050)', curve([-20, 79], [160, 76], 12, 7, 0.3), { status: 'projected' }),
			pt('p1', 'Murmansk', 33.08, 68.97), pt('p2', 'Sabetta', 72.05, 71.27), pt('p3', 'Churchill', -94.16, 58.77), pt('p4', 'Nome', -165.4, 64.5),
		],
	})
	addMap({
		id: 'carinthia-villas', kind: 'map', title: 'Roman villas of the Zollfeld', author: 'aria', published: '2026-08-20', version: 1,
		summary: 'Excavated villae rusticae around Virunum.', topics: ['roman', 'archaeology'], belongsTo: ['roman-ruins'], size: '9 KB', props: { period: 'Roman' },
		features: [pt('v1', 'Virunum forum', 14.364, 46.702), pt('v2', 'Villa Töltschach', 14.372, 46.727), pt('v3', 'Magdalensberg', 14.433, 46.72), pg('zf', 'Zollfeld', [[14.34, 46.69], [14.4, 46.688], [14.405, 46.735], [14.345, 46.738]])],
	})
	addMap({
		id: 'noricum-roads', kind: 'map', title: 'Roads of Noricum', author: 'mafrend', published: '2026-08-25', version: 1,
		summary: 'Roman roads through the Alps: Virunum to Iuvavum and Aguntum.', topics: ['roman', 'roads'], belongsTo: ['roman-ruins'], size: '14 KB', props: {},
		features: [ln('r1', 'Virunum–Iuvavum', curve([14.364, 46.702], [13.05, 47.8], 6, 0.1, 0.03)), ln('r2', 'Virunum–Aguntum', curve([14.364, 46.702], [12.8, 46.83], 6, -0.1, 0.03)), pt('m1', 'Milestone at Tanzenberg', 14.37, 46.72)],
	})
	// Niche-community atlas: skate spots. Each map is one city's spots.
	addMap({
		id: 'bcn-spots', kind: 'map', title: 'Barcelona skate spots', author: 'mafrend', published: '2026-08-02', version: 4,
		summary: 'Plazas and ledges, mostly marble. Security notes per spot.', topics: ['skate', 'barcelona'], belongsTo: ['skate-spots'], size: '6 KB', props: { surface: 'marble', type: 'plaza' },
		features: [pt('s1', 'MACBA', 2.1668, 41.3834, { surface: 'marble', type: 'plaza' }), pt('s2', 'Sants station', 2.14, 41.379, { surface: 'marble', type: 'plaza' }), pt('s3', 'Fòrum', 2.223, 41.411, { surface: 'concrete', type: 'plaza' }), pt('s4', 'Paral·lel', 2.164, 41.375, { surface: 'concrete', type: 'street' })],
	})
	addMap({
		id: 'berlin-spots', kind: 'map', title: 'Berlin skate spots', author: 'aria', published: '2026-08-20', version: 2,
		summary: 'Kulturforum ledges, Warschauer banks, and the DIY under the bridge.', topics: ['skate', 'berlin'], belongsTo: ['skate-spots'], size: '5 KB', props: { surface: 'concrete', type: 'street' },
		features: [pt('k1', 'Kulturforum', 13.3676, 52.5084, { surface: 'granite', type: 'plaza' }), pt('k2', 'Warschauer Straße', 13.449, 52.5057, { surface: 'concrete', type: 'street' }), pt('k3', 'Dog Shit Spot', 13.4211, 52.4879, { surface: 'concrete', type: 'plaza' }), pt('k4', 'Gleisdreieck DIY', 13.374, 52.498, { surface: 'concrete', type: 'DIY' })],
	})
	addMap({
		id: 'vienna-spots', kind: 'map', title: 'Vienna skate spots', author: 'me', published: '2026-08-28', version: 1,
		summary: 'Museumsquartier and the island. Missing the type field, so it waits.', topics: ['skate', 'vienna'], belongsTo: ['skate-spots'], size: '3 KB', props: { surface: 'granite' },
		features: [pt('w1', 'Museumsquartier', 16.359, 48.203, { surface: 'granite' }), pt('w2', 'Donauinsel', 16.41, 48.23, { surface: 'concrete' }), pt('w3', 'Karlsplatz', 16.37, 48.2, { surface: 'granite' })],
	})

	const stories = {
		'bri-story': {
			id: 'bri-story', kind: 'story', title: 'China’s Belt and Road Initiative: Remapping Global Trade', author: 'me', published: '2026-07-12',
			summary: 'What the BRI is, how it is organised, where the money goes, and why it matters.', maps: ['bri', 'ice-free'],
			body: [
				{ type: 'h', text: 'Introduction' },
				{ type: 'p', text: 'In September 2013, standing in a lecture hall in Kazakhstan, Xi Jinping proposed an “economic belt along the Silk Road.” A month later in Indonesia he called for a “21st Century Maritime Silk Road.” Together those two speeches launched the largest infrastructure programme of the century.', refs: [{ map: 'bri', feature: 'node-3', label: 'Almaty' }, { map: 'bri', feature: 'corr-4', label: 'Maritime Silk Road' }] },
				{ type: 'h', text: 'Six corridors' },
				{ type: 'p', text: 'The land bridge runs from Xi’an through Almaty and Moscow to Duisburg, where a rail terminal now handles thirty trains a week. The China–Pakistan corridor ends at Gwadar, a deep-water port financed almost entirely by Chinese lenders.', refs: [{ map: 'bri', feature: 'corr-0', label: 'New Eurasian Land Bridge' }, { map: 'bri', feature: 'node-8', label: 'Duisburg' }, { map: 'bri', feature: 'node-10', label: 'Gwadar' }] },
				{ type: 'h', text: 'A northern wildcard' },
				{ type: 'p', text: 'If the Northern Sea Route becomes reliably ice-free, the maritime leg shortens by a third and the whole geometry of the programme tilts north.', refs: [{ map: 'ice-free', feature: 'nsr', label: 'Northern Sea Route' }] },
			],
		},
		'trail-story': {
			id: 'trail-story', kind: 'story', title: 'Twelve Towns on the Hippie Trail', author: 'me', published: null, draft: true,
			summary: 'Draft. Why the route ran where it did, one stop at a time.', maps: ['hippie-trail'],
			body: [{ type: 'p', text: 'The trail was never one road. It was a habit: leave Istanbul on a Magic Bus, cross Anatolia, wait a week in Tehran for a visa, and arrive in Kabul with a rucksack lighter than when you left.', refs: [{ map: 'hippie-trail', feature: 'stop-0', label: 'Istanbul' }, { map: 'hippie-trail', feature: 'stop-7', label: 'Kabul' }] }],
		},
		'cables-story': {
			id: 'cables-story', kind: 'story', title: 'Where the Internet Touches the Sea', author: 'earthly', published: '2026-07-17',
			summary: 'Landing stations, the quiet buildings where continents plug in.', maps: ['cables-atlantic'],
			body: [{ type: 'p', text: 'Every transatlantic cable ends in a beach manhole and a windowless building. Bilbao’s is behind a car park.', refs: [{ map: 'cables-atlantic', feature: 'ls1', label: 'Bilbao landing' }] }],
		},
		'macba-story': {
			id: 'macba-story', kind: 'story', title: 'Why MACBA Never Dies', author: 'mafrend', published: '2026-08-05',
			summary: 'Thirty years of a museum forecourt as the world’s plaza.', maps: ['bcn-spots'],
			body: [{ type: 'p', text: 'The ledges were rebuilt in 2009 and skaters were back the same week. The museum gave up. The marble did not.', refs: [{ map: 'bcn-spots', feature: 's1', label: 'MACBA' }] }],
		},
	}

	// Atlases. `noun` and `color` let an atlas lightly skin the app when entered as a lens.
	const atlases = {
		'skate-spots': {
			id: 'skate-spots', kind: 'atlas', title: 'Global skate spots', author: 'schlaus', policy: 'schema', published: '2026-07-30', version: 6,
			noun: 'spot', color: '#B8442F', emblem: '◇',
			schemaFields: [{ key: 'surface', label: 'Surface', options: ['concrete', 'marble', 'granite', 'asphalt', 'wood'] }, { key: 'type', label: 'Type', options: ['plaza', 'street', 'park', 'DIY'] }],
			description: 'Every skate spot anyone cares to map, one city per map. Maps need **surface** and **type** so the filters work.',
			pinned: ['bcn-spots', 'berlin-spots'],
		},
		'roman-ruins': {
			id: 'roman-ruins', kind: 'atlas', title: 'Roman ruins in Carinthia', author: 'me', policy: 'schema', published: '2026-08-19', version: 2,
			noun: 'site', color: '#7A5C2E', emblem: '⌂',
			schemaFields: [{ key: 'period', label: 'Period', options: ['Roman', 'Late Roman', 'Norican'] }],
			description: 'Everything Roman between the Drau and the Tauern. Maps need a **period** property so the timeline works.',
			pinned: ['carinthia-villas'],
		},
		'cool-historical': {
			id: 'cool-historical', kind: 'atlas', title: 'Cool historical maps', author: 'schlaus', policy: 'open', published: '2026-07-21', version: 1,
			noun: 'map', color: '#3E6B8A', emblem: '⌛',
			description: 'Anything that shows how a place used to be. Add yours.', pinned: ['enclaves'],
		},
		'sea-cables': {
			id: 'sea-cables', kind: 'atlas', title: 'Submarine Cable Map', author: 'earthly', policy: 'closed', published: '2026-07-17', version: 1,
			noun: 'map', color: '#2F6F6D', emblem: '≋',
			description: 'The regional cable maps curated by earthly.city.', pinned: ['cables-atlantic'],
		},
	}

	const sightings = [
		{ id: 'palmer', kind: 'sighting', title: 'Amanda Palmer concert', author: 'schlaus', when: '2026-08-30 20:15', expires: 'in 3 days', coords: [14.312, 46.624], note: 'Small venue, no ticket needed after 21:00.' },
		{ id: 'moment', kind: 'sighting', title: 'Cool Moment', author: 'mafrend', when: '2026-07-17 09:02', expires: 'in 1 day', coords: [14.13, 46.62], note: 'Fog lifting off the lake.' },
		{ id: 'tavira', kind: 'sighting', title: 'Tavira', author: 'aria', when: '2026-07-26 18:40', expires: 'in 6 hours', coords: [-7.65, 37.13], note: 'Storks on every chimney.' },
	]
	const live = [{ id: 'saturday', title: 'Aria · Saturday survey', coords: [14.36, 46.71], since: '12 min' }]

	window.SKETCH_DATA = {
		people, maps, stories, atlases, sightings, live,
		circles: [{ id: 'alpine', name: 'Alpine rescue', members: 6 }],
		nearby: [{ id: 'saturday', name: 'Saturday survey', host: 'aria', peers: 3 }],
		places: { Vienna: [16.37, 48.21], Istanbul: [28.98, 41.01], Kabul: [69.17, 34.53], Bilbao: [-2.93, 43.26], Klagenfurt: [14.31, 46.62], Barcelona: [2.17, 41.39], Berlin: [13.4, 52.52] },
	}
})()
