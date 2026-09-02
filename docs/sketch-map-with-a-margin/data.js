/* Sketch data: an abstract world and a handful of objects modelled on what is
   actually on earthly.city. Coordinates live in a 2000×1200 "world" space. */
(function () {
	// Deterministic pseudo-random so the sketch looks the same every load.
	let seed = 7
	function rnd() {
		seed = (seed * 16807) % 2147483647
		return (seed - 1) / 2147483646
	}
	function jitter(a) {
		return (rnd() - 0.5) * a
	}
	// A gently curved line between two points with n vertices.
	function curve(from, to, n, bend, wobble) {
		const pts = []
		for (let i = 0; i <= n; i++) {
			const t = i / n
			const x = from[0] + (to[0] - from[0]) * t
			const y = from[1] + (to[1] - from[1]) * t + Math.sin(t * Math.PI) * bend
			pts.push([Math.round(x + (i === 0 || i === n ? 0 : jitter(wobble))), Math.round(y + (i === 0 || i === n ? 0 : jitter(wobble)))])
		}
		return pts
	}
	function pt(id, name, x, y, props) {
		return { id, name, type: 'point', coords: [x, y], props: props || {} }
	}
	function ln(id, name, pts, props) {
		return { id, name, type: 'line', coords: pts, props: props || {} }
	}
	function pg(id, name, pts, props) {
		return { id, name, type: 'polygon', coords: pts, props: props || {} }
	}

	// Rough continents. Abstract on purpose: this is a sketch, not a basemap.
	const world = [
		'M120 250 C 200 180, 330 160, 430 200 S 560 300, 520 400 S 430 520, 380 600 S 300 720, 330 820 S 420 900, 470 980 S 380 1040, 300 980 S 200 860, 190 740 S 120 600, 100 480 S 60 320, 120 250 Z',
		'M880 210 C 980 150, 1140 140, 1250 190 S 1500 210, 1620 260 S 1800 300, 1840 400 S 1700 480, 1600 520 S 1480 560, 1400 620 S 1300 660, 1220 620 S 1120 640, 1040 600 S 940 560, 900 500 S 840 420, 850 340 S 820 250, 880 210 Z',
		'M900 560 C 980 540, 1060 600, 1080 690 S 1060 820, 1010 900 S 930 960, 880 900 S 840 780, 850 700 S 850 590, 900 560 Z',
		'M1480 760 C 1560 730, 1660 760, 1690 830 S 1640 940, 1560 950 S 1450 900, 1450 840 S 1430 780, 1480 760 Z',
		'M1000 90 C 1080 60, 1180 80, 1200 130 S 1120 190, 1040 170 S 960 130, 1000 90 Z',
		'M640 140 C 700 110, 780 130, 790 180 S 730 230, 680 210 S 610 180, 640 140 Z',
	]

	const people = {
		me: { id: 'me', name: 'You', handle: 'you@earthly.city', initials: 'YO' },
		schlaus: { id: 'schlaus', name: 'Schlaus Kwab', handle: 'schlaus@earthly.city', initials: 'SK' },
		earthly: { id: 'earthly', name: 'earthly.city', handle: 'earthly.city', initials: 'EC' },
		mafrend: { id: 'mafrend', name: 'Mafrend', handle: 'mafrend@nostr.example', initials: 'MA' },
		aria: { id: 'aria', name: 'Aria Voss', handle: 'aria@nostr.example', initials: 'AV' },
	}

	// Hippie Trail: Istanbul → Tehran → Kabul → Delhi → Kathmandu
	const trail = curve([1080, 470], [1440, 500], 18, -30, 12)
	const trailStops = [
		['Istanbul', 1080, 470], ['Ankara', 1120, 462], ['Tabriz', 1180, 455], ['Tehran', 1230, 452],
		['Mashhad', 1290, 445], ['Herat', 1330, 458], ['Kandahar', 1360, 480], ['Kabul', 1385, 466],
		['Peshawar', 1405, 472], ['Lahore', 1420, 486], ['Delhi', 1440, 500], ['Kathmandu', 1490, 480],
	]
	const bri = {
		corridors: [
			['New Eurasian Land Bridge', [1560, 380], [1010, 300], 12, -60],
			['China–Central Asia–West Asia', [1560, 400], [1180, 450], 10, -20],
			['China–Indochina Peninsula', [1560, 440], [1520, 600], 8, 30],
			['China–Pakistan Economic Corridor', [1520, 440], [1380, 520], 8, 20],
			['Maritime Silk Road', [1600, 560], [960, 520], 14, 140],
			['Bangladesh–China–India–Myanmar', [1540, 470], [1470, 520], 6, 10],
		],
		nodes: [
			['Xi’an', 1560, 400], ['Lanzhou', 1520, 390], ['Urumqi', 1450, 360], ['Almaty', 1400, 350], ['Tashkent', 1340, 380],
			['Tehran', 1230, 452], ['Istanbul', 1080, 470], ['Moscow', 1160, 300], ['Duisburg', 1010, 300], ['Rotterdam', 990, 290],
			['Gwadar', 1340, 540], ['Colombo', 1470, 620], ['Djibouti', 1180, 590], ['Piraeus', 1090, 500], ['Venice', 1040, 440],
			['Kuala Lumpur', 1580, 640], ['Jakarta', 1590, 700], ['Mombasa', 1210, 700], ['Hanoi', 1580, 520], ['Yiwu', 1620, 440],
		],
	}

	const maps = {}
	function addMap(m) {
		maps[m.id] = m
		return m
	}

	addMap({
		id: 'hippie-trail', kind: 'map', title: 'The Hippie Trail', author: 'me', published: '2026-09-01', version: 3,
		summary: 'The overland route from Istanbul to Kathmandu as travelled 1957–1978, with the towns that became stops.',
		topics: ['overland', 'history', 'travel'], belongsTo: ['cool-historical'], size: '27 KB', props: { period: '1957–1978' },
		features: [
			ln('trail', 'Overland route', trail, { period: '1957–1978' }),
			...trailStops.map((s, i) => pt('stop-' + i, s[0], s[1], s[2], { kind: 'stop' })),
		],
	})
	addMap({
		id: 'bri', kind: 'map', title: 'China’s Belt and Road Initiative', author: 'me', published: '2026-07-13', version: 2,
		summary: 'Eight overland and maritime corridors with the ports, rail hubs and financing nodes that connect them.',
		topics: ['infrastructure', 'geopolitics'], belongsTo: [], size: '25 KB', props: {},
		features: [
			...bri.corridors.map((c, i) => ln('corr-' + i, c[0], curve(c[1], c[2], c[3], c[4], 8), { kind: 'corridor' })),
			...bri.nodes.map((n, i) => pt('node-' + i, n[0], n[1], n[2], { kind: 'node' })),
		],
	})
	addMap({
		id: 'cables-atlantic', kind: 'map', title: 'Submarine Cables — Atlantic Ocean', author: 'earthly', published: '2026-07-17', version: 1,
		summary: 'Transatlantic cable systems with landing stations on both shores.',
		topics: ['submarine-cables', 'internet-infrastructure', 'atlantic'], belongsTo: ['sea-cables'], size: '50 KB', props: { operator: 'various' },
		features: [
			ln('c1', 'MAREA', curve([470, 430], [860, 440], 10, -40, 14)), ln('c2', 'Dunant', curve([480, 400], [850, 420], 10, -70, 14)),
			ln('c3', 'Grace Hopper', curve([460, 460], [870, 470], 10, 20, 14)), ln('c4', 'Amitié', curve([500, 380], [900, 390], 10, -90, 14)),
			ln('c5', 'EllaLink', curve([720, 720], [880, 520], 8, -60, 12)), ln('c6', 'SACS', curve([700, 760], [900, 720], 8, 40, 12)),
			ln('c7', 'TAT-14', curve([470, 380], [880, 350], 10, -110, 14)),
			pt('ls1', 'Bilbao landing', 862, 442), pt('ls2', 'Virginia Beach', 468, 432), pt('ls3', 'Bude', 878, 352), pt('ls4', 'Fortaleza', 718, 722), pt('ls5', 'Sines', 880, 522),
		],
	})
	addMap({
		id: 'enclaves', kind: 'map', title: 'World Enclaves & Exclaves', author: 'schlaus', published: '2026-07-21', version: 1,
		summary: 'Eighty-seven pockets of territory surrounded by someone else.',
		topics: ['borders'], belongsTo: ['cool-historical'], size: '62 KB', props: { period: 'current' },
		features: [
			pt('e1', 'Baarle-Nassau', 1000, 300), pt('e2', 'Kaliningrad', 1090, 280), pt('e3', 'Nakhchivan', 1200, 440), pt('e4', 'Ceuta', 960, 500),
			pt('e5', 'Llívia', 1000, 470), pt('e6', 'Point Roberts', 250, 300), pt('e7', 'Campione', 1030, 430), pt('e8', 'Cabinda', 1040, 720),
			pt('e9', 'Musandam', 1290, 560), pt('e10', 'Oecusse', 1620, 720), pt('e11', 'Temburong', 1590, 620), pt('e12', 'Dahagram', 1470, 505),
		],
	})
	addMap({
		id: 'west-berlin', kind: 'map', title: 'West Berlin Transit Corridors (1949–1990)', author: 'aria', published: '2026-08-12', version: 1,
		summary: 'Road, rail and air corridors that kept West Berlin connected across the GDR.',
		topics: ['history', 'cold-war'], belongsTo: [], size: '332 KB', props: { period: '1949–1990' },
		features: [
			ln('t1', 'Helmstedt–Berlin autobahn', curve([1020, 330], [1075, 322], 6, -6, 3)), ln('t2', 'Hamburg–Berlin', curve([1040, 300], [1075, 322], 5, 6, 3)),
			ln('t3', 'Munich–Berlin', curve([1050, 380], [1075, 322], 6, 10, 3)), pt('b1', 'Checkpoint Alpha', 1022, 330), pt('b2', 'Checkpoint Bravo', 1070, 326),
			pt('b3', 'Tempelhof', 1078, 320), pt('b4', 'Tegel', 1073, 316), pt('b5', 'Gatow', 1069, 322),
		],
	})
	addMap({
		id: 'ice-free', kind: 'map', title: 'Ice-Free Northern Passages: Status Quo vs 2050', author: 'mafrend', published: '2026-07-12', version: 1,
		summary: 'The Northern Sea Route and the Northwest Passage as they are and as models expect them.',
		topics: ['arctic', 'shipping', 'climate'], belongsTo: [], size: '38 KB', props: {},
		features: [
			ln('nsr', 'Northern Sea Route', curve([1000, 210], [1700, 230], 14, -110, 10), { status: 'seasonal' }),
			ln('nwp', 'Northwest Passage', curve([260, 200], [700, 150], 12, -70, 10), { status: 'seasonal' }),
			ln('tsr', 'Transpolar Sea Route (2050)', curve([700, 120], [1500, 130], 12, -80, 8), { status: 'projected' }),
			pt('p1', 'Murmansk', 1100, 240), pt('p2', 'Sabetta', 1250, 190), pt('p3', 'Churchill', 420, 250), pt('p4', 'Nome', 120, 210),
		],
	})
	addMap({
		id: 'carinthia-villas', kind: 'map', title: 'Roman villas of the Zollfeld', author: 'aria', published: '2026-08-20', version: 1,
		summary: 'Excavated villae rusticae around Virunum.', topics: ['roman', 'archaeology'], belongsTo: ['roman-ruins'], size: '9 KB', props: { period: 'Roman' },
		features: [pt('v1', 'Virunum forum', 1046, 438), pt('v2', 'Villa Töltschach', 1049, 436), pt('v3', 'Magdalensberg', 1052, 434), pg('zf', 'Zollfeld', [[1040, 432], [1058, 430], [1060, 444], [1042, 446]])],
	})
	addMap({
		id: 'noricum-roads', kind: 'map', title: 'Roads of Noricum', author: 'mafrend', published: '2026-08-25', version: 1,
		summary: 'Roman roads through the Alps: Virunum to Iuvavum and Aguntum.', topics: ['roman', 'roads'], belongsTo: ['roman-ruins'], size: '14 KB', props: {},
		features: [ln('r1', 'Virunum–Iuvavum', curve([1046, 438], [1030, 415], 6, 4, 2)), ln('r2', 'Virunum–Aguntum', curve([1046, 438], [1020, 440], 6, -4, 2)), pt('m1', 'Milestone at Tanzenberg', 1044, 434)],
	})

	const stories = {
		'bri-story': {
			id: 'bri-story', kind: 'story', title: 'China’s Belt and Road Initiative: Remapping Global Trade', author: 'me', published: '2026-07-12',
			summary: 'What the BRI is, how it is organised, where the money goes, and why it matters.',
			maps: ['bri', 'ice-free'],
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
			summary: 'Draft. Why the route ran where it did, one stop at a time.',
			maps: ['hippie-trail'],
			body: [
				{ type: 'p', text: 'The trail was never one road. It was a habit: leave Istanbul on a Magic Bus, cross Anatolia, wait a week in Tehran for a visa, and arrive in Kabul with a rucksack lighter than when you left.', refs: [{ map: 'hippie-trail', feature: 'stop-0', label: 'Istanbul' }, { map: 'hippie-trail', feature: 'stop-7', label: 'Kabul' }] },
			],
		},
		'cables-story': {
			id: 'cables-story', kind: 'story', title: 'Where the Internet Touches the Sea', author: 'earthly', published: '2026-07-17',
			summary: 'Landing stations, the quiet buildings where continents plug in.', maps: ['cables-atlantic'],
			body: [{ type: 'p', text: 'Every transatlantic cable ends in a beach manhole and a windowless building. Bilbao’s is behind a car park.', refs: [{ map: 'cables-atlantic', feature: 'ls1', label: 'Bilbao landing' }] }],
		},
	}

	const atlases = {
		'roman-ruins': {
			id: 'roman-ruins', kind: 'atlas', title: 'Roman ruins in Carinthia', author: 'me', policy: 'schema', schemaField: 'period', published: '2026-08-19', version: 2,
			description: 'Everything Roman between the Drau and the Tauern. Maps need a **period** property so the timeline works.',
			pinned: ['carinthia-villas'], waitingHint: 'noricum-roads',
		},
		'cool-historical': {
			id: 'cool-historical', kind: 'atlas', title: 'Cool historical maps', author: 'schlaus', policy: 'open', published: '2026-07-21', version: 1,
			description: 'Anything that shows how a place used to be. Add yours.', pinned: ['enclaves'],
		},
		'sea-cables': {
			id: 'sea-cables', kind: 'atlas', title: 'Submarine Cable Map', author: 'earthly', policy: 'closed', published: '2026-07-17', version: 1,
			description: 'The regional cable maps curated by earthly.city.', pinned: ['cables-atlantic'],
		},
	}

	const sightings = [
		{ id: 'palmer', kind: 'sighting', title: 'Amanda Palmer concert', author: 'schlaus', when: '2026-08-30 20:15', expires: 'in 3 days', coords: [1036, 448], note: 'Small venue, no ticket needed after 21:00.' },
		{ id: 'moment', kind: 'sighting', title: 'Cool Moment', author: 'mafrend', when: '2026-07-17 09:02', expires: 'in 1 day', coords: [1046, 460], note: 'Fog lifting off the lake.' },
		{ id: 'tavira', kind: 'sighting', title: 'Tavira', author: 'aria', when: '2026-07-26 18:40', expires: 'in 6 hours', coords: [950, 520], note: 'Storks on every chimney.' },
	]
	const live = [{ id: 'saturday', title: 'Aria · Saturday survey', coords: [1044, 436], since: '12 min' }]

	window.SKETCH_DATA = {
		world, people, maps, stories, atlases, sightings, live,
		circles: [{ id: 'alpine', name: 'Alpine rescue', members: 6 }],
		nearby: [{ id: 'saturday', name: 'Saturday survey', host: 'aria', peers: 3 }],
	}
})()
