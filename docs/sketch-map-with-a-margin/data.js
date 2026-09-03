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
	// Placeholder imagery, generated inline so the sketch needs no network and no binaries.
	function photo(seed, palette) {
		const P = { sepia: ['#e8dcc8', '#c9b28c', '#8d7454', '#4a3b2a'], cold: ['#dfe6ea', '#a9bcc6', '#6d8794', '#33454f'], warm: ['#f0e2d4', '#d9b79a', '#a97b5b', '#5b3d2b'] }[palette || 'sepia']
		let n = 0
		for (let i = 0; i < seed.length; i++) n = (n * 31 + seed.charCodeAt(i)) % 9973
		const r = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648)
		const hills = [0, 1, 2].map((i) => {
			const y = 150 + i * 55 + r() * 40
			const pts = [0, 1, 2, 3, 4, 5, 6].map((k) => `${k * 133},${Math.round(y + Math.sin(k * (1 + r())) * (28 - i * 7))}`).join(' L')
			return `<path d="M${pts} L800,450 L0,450 Z" fill="${P[i + 1]}" opacity="${0.9 - i * 0.12}"/>`
		}).join('')
		const marks = [0, 1, 2, 3, 4].map(() => `<circle cx="${Math.round(r() * 800)}" cy="${Math.round(120 + r() * 260)}" r="${Math.round(2 + r() * 5)}" fill="${P[3]}" opacity=".45"/>`).join('')
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="${P[0]}"/><circle cx="${Math.round(120 + r() * 560)}" cy="${Math.round(60 + r() * 50)}" r="${Math.round(26 + r() * 22)}" fill="${P[1]}"/>${hills}${marks}<rect width="800" height="450" fill="none" stroke="${P[3]}" stroke-opacity=".25" stroke-width="6"/></svg>`
		return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
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
		history: [
			{ v: 1, at: '2026-08-14', by: 'me', kind: 'create', note: 'First version: the twelve towns.', add: ['trail', 'stop-0', 'stop-1', 'stop-2', 'stop-3', 'stop-4', 'stop-5', 'stop-6', 'stop-7', 'stop-8', 'stop-9', 'stop-10', 'stop-11'] },
			{ v: 2, at: '2026-08-22', by: 'me', kind: 'publish', note: 'Straightened the Anatolian leg; dropped two duplicate stops.', modify: ['trail'], remove: [{ id: 'stop-dup-a', name: 'Erzincan (duplicate)', type: 'point', coords: [39.49, 39.75], props: {} }, { id: 'stop-dup-b', name: 'Zahedan (duplicate)', type: 'point', coords: [60.86, 29.5], props: {} }], unavailable: true },
			{ v: 3, at: '2026-09-01', by: 'me', kind: 'publish', note: 'Added the period property and a summary.', modify: ['trail'] },
		],
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
		history: [
			{ v: 1, at: '2026-07-12', by: 'me', kind: 'create', note: 'Drawn from the Thread in one run.', add: ['corr-0', 'corr-1', 'corr-2', 'corr-3', 'corr-4'] },
			{ v: 2, at: '2026-07-13', by: 'me', kind: 'publish', note: 'Added the sixth corridor and twenty nodes.', add: ['corr-5', 'node-0', 'node-1', 'node-2', 'node-3', 'node-4', 'node-5', 'node-6', 'node-7', 'node-8', 'node-9', 'node-10', 'node-11', 'node-12', 'node-13', 'node-14', 'node-15', 'node-16', 'node-17', 'node-18', 'node-19'] },
		],
		summary: 'Six overland and maritime corridors with the ports, rail hubs and financing nodes that connect them.',
		topics: ['infrastructure', 'geopolitics'], belongsTo: [], size: '25 KB', props: {},
		features: [...corridors.map((c, i) => ln('corr-' + i, c[0], curve(C[c[1]], C[c[2]], c[3], c[4], 1.2), { kind: 'corridor' })), ...nodes.map((n, i) => pt('node-' + i, n, C[n][0], C[n][1], { kind: 'node' }))],
	})
	const VB = [-75.98, 36.85], BIL = [-2.93, 43.26], BUDE = [-4.54, 50.83], FOR = [-38.54, -3.72], SIN = [-8.87, 37.96], NJ = [-74.0, 40.4], LIS = [-9.4, 38.7]
	addMap({
		id: 'cables-atlantic', kind: 'map', title: 'Submarine Cables — Atlantic Ocean', author: 'earthly', published: '2026-07-17', version: 1, blob: { url: 'https://blossom.earthly.city/9f2c…c1.geojson', size: '2.4 MB', sha: '9f2c…c1' },
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
	addMap({
		id: 'crew-gate', kind: 'map', title: 'Crew gate and muster points', author: 'me', published: '2026-09-01', version: 2, audience: 'circle:alpine',
		summary: 'Where the crew meets if the valley road closes. Circle only.', topics: ['rescue'], belongsTo: [], size: '4 KB', props: {},
		features: [pt('g1', 'Crew gate', 14.342, 46.71), pt('g2', 'Muster A · car park', 14.35, 46.716), pt('g3', 'Muster B · chapel', 14.336, 46.704), ln('rt', 'Fallback route', curve([14.342, 46.71], [14.31, 46.69], 5, 0.004, 0.002))],
	})
	addMap({
		id: 'survey-points', kind: 'map', title: 'Saturday survey points', author: 'aria', published: '2026-09-03', version: 3, audience: 'nearby:saturday',
		summary: 'Collected on the hill this morning. Nearby session only until we are back online.', topics: ['survey'], belongsTo: [], size: '2 KB', props: {},
		features: [pt('sp1', 'Wall corner', 14.364, 46.703), pt('sp2', 'Hypocaust', 14.366, 46.7045), pt('sp3', 'Well', 14.362, 46.7052)],
	})
	// Historical snapshots: one dataset per front line, one for battles. A story shows them paragraph by paragraph.
	const front = (id, title, date, pts, extra) => addMap(Object.assign({
		id, kind: 'map', title, author: 'mafrend', published: '2026-08-30', version: 1, topics: ['ww1', 'western-front', 'history'], belongsTo: ['cool-historical'], size: '11 KB', props: { period: date },
		summary: `The Western Front as it stood in ${date}.`, features: [ln('line', `Front line, ${date}`, pts, { date })],
	}, extra || {}))
	front('front-1914', 'Western Front · November 1914', 'November 1914', [[2.75, 51.13], [2.89, 50.85], [2.78, 50.4], [2.78, 50.29], [2.85, 49.9], [3.0, 49.58], [3.32, 49.38], [4.03, 49.25], [4.9, 49.3], [5.38, 49.16], [5.55, 48.9], [6.2, 48.75], [6.5, 48.7], [7.0, 48.3], [6.86, 47.64]])
	front('front-1916', 'Western Front · December 1916', 'December 1916', [[2.75, 51.13], [2.89, 50.85], [2.78, 50.4], [2.78, 50.29], [2.95, 50.05], [2.92, 49.95], [3.0, 49.58], [3.32, 49.38], [4.03, 49.25], [4.9, 49.3], [5.4, 49.2], [5.55, 48.9], [6.2, 48.75], [6.5, 48.7], [7.0, 48.3], [6.86, 47.64]])
	front('front-1918-spring', 'Western Front · April 1918', 'April 1918', [[2.75, 51.13], [2.89, 50.85], [2.65, 50.6], [2.78, 50.29], [2.45, 49.95], [2.55, 49.7], [3.1, 49.45], [3.4, 49.04], [4.03, 49.25], [4.9, 49.3], [5.38, 49.16], [5.55, 48.9], [6.2, 48.75], [6.5, 48.7], [7.0, 48.3], [6.86, 47.64]])
	front('front-1918-armistice', 'Western Front · 11 November 1918', '11 November 1918', [[3.72, 51.05], [3.95, 50.45], [4.4, 50.2], [4.94, 49.7], [5.2, 49.45], [5.6, 49.3], [6.18, 49.12], [6.5, 48.7], [7.0, 48.3], [6.86, 47.64]])
	addMap({
		id: 'ww1-battles', kind: 'map', title: 'Major battles of the Western Front', author: 'mafrend', published: '2026-08-30', version: 2,
		summary: 'The named battles, with dates.', topics: ['ww1', 'western-front'], belongsTo: ['cool-historical'], size: '3 KB', props: { period: '1914–1918' },
		features: [pt('marne', 'First Marne · Sep 1914', 3.5, 48.95, { date: '1914-09' }), pt('ypres', 'Ypres · 1914, 1915, 1917', 2.89, 50.85, { date: '1914-10' }), pt('verdun', 'Verdun · Feb–Dec 1916', 5.38, 49.16, { date: '1916-02' }), pt('somme', 'Somme · Jul–Nov 1916', 2.7, 50.0, { date: '1916-07' }), pt('cambrai', 'Cambrai · Nov 1917', 3.23, 50.17, { date: '1917-11' }), pt('amiens', 'Amiens · Aug 1918', 2.3, 49.9, { date: '1918-08' }), pt('argonne', 'Meuse–Argonne · Sep–Nov 1918', 5.0, 49.3, { date: '1918-09' })],
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
			history: [
				{ v: 1, at: '2026-07-12', by: 'me', kind: 'create', note: 'First draft, four sections.' },
				{ v: 2, at: '2026-07-14', by: 'me', kind: 'publish', note: 'Added the corridor table and the Arctic view.' },
				{ v: 3, at: '2026-08-02', by: 'me', kind: 'proposal', from: 'aria', note: 'Accepted Aria Voss’s correction to the Duisburg figure.', unavailable: true },
			],
			// Only the opening state lives here. Everything that happens as you read is a view block in the body.
			presentation: { version: 1, initialView: { center: [70, 35], zoom: 2.6 }, layerOrder: ['bri', 'ice-free'], layers: { bri: { visible: true }, 'ice-free': { visible: false } } },
			body: [
				{ type: 'note', tone: 'info', text: 'Made with help from this map’s Thread. Figures are illustrative; every place named below is a reference you can follow.' },
				{ type: 'h', level: 2, text: 'Introduction' },
				{ type: 'view', id: 'v-almaty', title: 'Almaty, 2013', display: 'cue', camera: { center: [76.89, 43.24], zoom: 5 }, layers: { bri: { visible: true }, 'ice-free': { visible: false } } },
				{ type: 'p', text: 'In September 2013, standing in a lecture hall in [Almaty](nostr:bri#node-3), Xi Jinping proposed an *economic belt along the Silk Road*. A month later in Indonesia he called for a **21st Century [Maritime Silk Road](nostr:bri#corr-4)**. Together those two speeches launched the largest infrastructure programme of the century.' },
				{ type: 'img', src: 'bri-hall', palette: 'warm', alt: 'A lecture hall in Astana', caption: 'Nazarbayev University, September 2013. The speech that named the belt.', credit: 'Illustration' },
				{ type: 'quote', text: 'We should take an innovative approach and jointly build an economic belt along the Silk Road.', by: 'Xi Jinping, Astana, 7 September 2013' },
				{ type: 'p', text: 'Thirteen years later the programme covers more than 150 countries. What began as two speeches is now a balance sheet, a construction schedule, and a map that this story tries to hold still for a moment.' },
				{ type: 'hr' },
				{ type: 'h', level: 2, text: 'Six corridors' },
				{ type: 'view', id: 'v-corridors', title: 'All six corridors', display: 'both', caption: 'The six corridors as drawn, with the Arctic layer still off.', camera: { center: [75, 35], zoom: 3 }, layers: { bri: { visible: true }, 'ice-free': { visible: false } } },
				{ type: 'p', text: 'The land bridge runs from Xi’an through Almaty and Moscow to [Duisburg](nostr:bri#node-8), where a rail terminal now handles thirty trains a week. The [China–Pakistan corridor](nostr:bri#corr-3) ends at [Gwadar](nostr:bri#node-10), a deep-water port financed almost entirely by Chinese lenders. Its harbour entrance is at [25.12, 62.32](geo:25.121,62.322).' },
				{ type: 'table', caption: 'The six overland and maritime corridors, as drawn on the map', align: ['left', 'left', 'right', 'left'], head: ['Corridor', 'From → to', 'Length', 'Status'],
					rows: [['New Eurasian Land Bridge', 'Xi’an → Duisburg', '11,000 km', 'operating'], ['China–Central Asia–West Asia', 'Xi’an → Tehran', '6,400 km', 'partial'], ['China–Pakistan (CPEC)', 'Urumqi → Gwadar', '3,000 km', 'operating'], ['China–Indochina Peninsula', 'Xi’an → Kuala Lumpur', '5,500 km', 'under way'], ['Bangladesh–China–India–Myanmar', 'Lanzhou → Colombo', '4,200 km', 'stalled'], ['Maritime Silk Road', 'Yiwu → Piraeus', '19,000 km', 'operating']] },
				{ type: 'list', ordered: false, items: ['**Rail** carries the value: electronics, machinery, vehicles.', '**Sea** still carries the volume, at roughly a twentieth of the cost per tonne.', '**Ports** are the pinch points, and the reason [Gwadar](nostr:bri#node-10) and [Piraeus](nostr:bri#node-13) appear on every version of this map.'] },
				{ type: 'img', src: 'bri-terminal', palette: 'cold', alt: 'A container terminal at dusk', caption: 'Duisburg. Thirty trains a week, and a customs shed that had to be doubled twice.', credit: 'Illustration' },
				{ type: 'h', level: 3, text: 'Where the money goes' },
				{ type: 'p', text: 'Roughly two thirds of committed capital is lent, not granted, and most of it flows through two policy banks. The line between investment and leverage is exactly where the argument about the programme sits.' },
				{ type: 'table', align: ['left', 'right', 'right'], head: ['Sector', 'Share', 'Trend'], rows: [['Transport', '43%', '↑'], ['Energy', '38%', '→'], ['Digital', '11%', '↑↑'], ['Other', '8%', '↓']] },
				{ type: 'hr' },
				{ type: 'h', level: 2, text: 'A northern wildcard' },
				{ type: 'view', id: 'v-arctic', title: 'The northern wildcard', display: 'cue', camera: { center: [90, 68], zoom: 2.4 }, layers: { 'ice-free': { visible: true } } },
				{ type: 'p', text: 'If the [Northern Sea Route](nostr:ice-free#nsr) becomes reliably ice-free, the maritime leg shortens by a third and the whole geometry of the programme tilts north. The [Ice-Free Northern Passages](nostr:ice-free) map is now on; watch how much of the Indian Ocean simply stops mattering.' },
				{ type: 'note', tone: 'warn', text: 'The 2050 transpolar line is a projection, not an observation. It is drawn dashed on the map for that reason.' },
				{ type: 'p', text: 'You can query the same corridors yourself. The dataset is plain GeoJSON and every corridor carries a `kind` property:' },
				{ type: 'code', lang: 'json', text: '{\n  "type": "Feature",\n  "properties": { "kind": "corridor", "name": "New Eurasian Land Bridge" },\n  "geometry": { "type": "LineString", "coordinates": [[108.94, 34.34], …] }\n}' },
				{ type: 'p', text: 'One reference below points at a feature that no longer exists, so you can see how an unresolved pointer reads: [the old Chongqing spur](nostr:bri#corr-9).' },
				{ type: 'h', level: 2, text: 'Sources' },
				{ type: 'list', ordered: true, items: ['Speech transcript, Astana, September 2013.', 'Duisburger Hafen AG, annual report, 2025.', 'Corridor geometry: [China’s Belt and Road Initiative](nostr:bri) on Earthly, v2.', 'The terminal itself on OpenStreetMap: [Duisburg Intermodal Terminal](https://www.openstreetmap.org/way/28353161).'] },
			],
		},
		'western-front': {
			id: 'western-front', kind: 'story', title: 'Four Years on the Western Front', author: 'mafrend', published: '2026-08-31',
			summary: 'The front line as four snapshots, in the order you read them.', maps: ['front-1914', 'front-1916', 'front-1918-spring', 'front-1918-armistice', 'ww1-battles'],
			presentation: { version: 1, initialView: { center: [4.2, 49.6], zoom: 6.2 }, layerOrder: ['ww1-battles', 'front-1914', 'front-1916', 'front-1918-spring', 'front-1918-armistice'],
				layers: { 'front-1914': { visible: false }, 'front-1916': { visible: false }, 'front-1918-spring': { visible: false }, 'front-1918-armistice': { visible: false }, 'ww1-battles': { visible: true } } },
			body: [
				{ type: 'p', lead: true, text: 'The front line as four snapshots. Each section switches the map to the line as it stood, so the story does the work a slider usually does badly.' },
				{ type: 'h', level: 2, text: 'November 1914' },
				{ type: 'view', id: 'w1', title: 'The line freezes', display: 'both', caption: 'From Nieuwpoort to the Swiss border, November 1914.', camera: { center: [4.4, 49.6], zoom: 6.2 }, layers: { 'front-1914': { visible: true } } },
				{ type: 'p', text: 'After the [First Marne](nostr:ww1-battles#marne) and the Race to the Sea the line stopped moving. From Nieuwpoort on the coast to the Swiss border it would barely shift for three years, and [Ypres](nostr:ww1-battles#ypres) would be fought over three times.' },
				{ type: 'img', src: 'wf-trench', palette: 'sepia', alt: 'A communication trench in winter', caption: 'A communication trench near Ypres, winter 1914–15.', credit: 'Illustration' },
				{ type: 'h', level: 2, text: '1916' },
				{ type: 'view', id: 'w2', title: 'Verdun and the Somme', display: 'cue', camera: { center: [3.9, 49.7], zoom: 6.6 }, layers: { 'front-1916': { visible: true }, 'front-1914': { visible: false } } },
				{ type: 'p', text: '[Verdun](nostr:ww1-battles#verdun) from February, the [Somme](nostr:ww1-battles#somme) from July. Ten months of the largest battles in history moved the front by a handful of kilometres.' },
				{ type: 'table', caption: 'What the map is showing you, snapshot by snapshot', align: ['left', 'left', 'right', 'right'], head: ['Snapshot', 'Date', 'Front length', 'Net change'],
					rows: [['Nieuwpoort → Switzerland', 'Nov 1914', '765 km', '—'], ['After Verdun and the Somme', 'Dec 1916', '761 km', '≈ 4 km'], ['Spring Offensive', 'Apr 1918', '790 km', '+ 29 km'], ['Armistice line', '11 Nov 1918', '520 km', '− 270 km']] },
				{ type: 'quote', text: 'We were not fighting for a village. We were fighting for the ridge behind it, and then for the ridge behind that.', by: 'A sapper’s letter, Somme, October 1916' },
				{ type: 'h', level: 2, text: 'Spring 1918' },
				{ type: 'view', id: 'w3', title: 'The Spring Offensive', display: 'both', caption: 'The deepest advance since 1914, and the last.', camera: { center: [3.0, 49.7], zoom: 6.8 }, layers: { 'front-1918-spring': { visible: true }, 'front-1916': { visible: false } } },
				{ type: 'p', text: 'With Russia out of the war, Germany attacked in March. The bulge toward [Amiens](nostr:ww1-battles#amiens) and Château-Thierry was the deepest advance since 1914, and the last.' },
				{ type: 'list', ordered: true, items: ['**Michael**, 21 March: 60 km in eight days, then supply ran out.', '**Georgette**, April: the Lys, and the loss of the Messines ridge.', '**Blücher-Yorck**, May: the Marne again, within artillery range of Paris.'] },
				{ type: 'h', level: 2, text: '11 November 1918' },
				{ type: 'view', id: 'w4', title: 'Armistice', display: 'cue', camera: { center: [5.0, 49.6], zoom: 6.2 }, layers: { 'front-1918-armistice': { visible: true }, 'front-1918-spring': { visible: false } } },
				{ type: 'p', text: 'The Hundred Days pushed the line back through [Cambrai](nostr:ww1-battles#cambrai) to Ghent and Mons, with the Americans in the [Meuse–Argonne](nostr:ww1-battles#argonne). When the guns stopped at [49.42, 2.90](geo:49.425,2.905), the front lay well inside Belgium.' },
				{ type: 'note', tone: 'info', text: 'Each snapshot is its own dataset, published separately, so anyone can reuse a single year without taking the whole story with them.' },
				{ type: 'h', level: 2, text: 'Sources' },
				{ type: 'list', ordered: false, items: ['Front-line geometry digitised from staff maps, 1914–1918.', 'Snapshots on Earthly: [Nov 1914](nostr:front-1914), [Dec 1916](nostr:front-1916), [Apr 1918](nostr:front-1918-spring), [Armistice](nostr:front-1918-armistice).'] },
			],
		},
		'macba-story': {
			id: 'macba-story', kind: 'story', title: 'Why MACBA Never Dies', author: 'mafrend', published: '2026-08-05',
			summary: 'Thirty years of a museum forecourt as the world’s plaza.', maps: ['bcn-spots'],
			body: [
				{ type: 'p', text: 'The ledges at [MACBA](nostr:bcn-spots#s1) were rebuilt in 2009 and skaters were back the same week. The museum gave up. The marble did not.' },
				{ type: 'img', src: 'macba', palette: 'warm', alt: 'A wide marble forecourt', caption: 'The forecourt at nine in the morning, before the queue for the museum.', credit: 'Illustration' },
				{ type: 'table', align: ['left', 'left', 'left'], head: ['Spot', 'Surface', 'Best hours'], rows: [['MACBA', 'marble', '07:00–10:00'], ['Sants', 'marble', 'evenings'], ['Fòrum', 'concrete', 'all day'], ['Paral·lel', 'concrete', 'after 21:00']] },
				{ type: 'quote', text: 'Thirty years and it is still the first place anyone lands.', by: 'Mafrend' },
			],
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
	const live = [
		{ id: 'aria-live', author: 'aria', title: 'Aria on the survey', coords: [14.361, 46.708], since: '12 min', lastSeen: 3, discovery: 'link', watching: 2, audience: 'nearby:saturday' },
		{ id: 'schlaus-live', author: 'schlaus', title: 'Schlaus · MACBA session', coords: [2.1668, 41.3834], since: '48 min', lastSeen: 640, discovery: 'public', watching: 5, audience: 'everyone' },
	]
	const circles = [
		{ id: 'alpine', kind: 'circle', title: 'Alpine rescue', author: 'me', created: '2026-07-20', members: [{ id: 'me', role: 'admin' }, { id: 'aria', role: 'member' }, { id: 'mafrend', role: 'member' }, { id: 'schlaus', role: 'member' }], pending: [{ id: 'earthly', when: '2026-09-02 09:14' }], invite: 'earthly.city/join/alpine-7f3a', description: 'Coordination for the valley rescue crew. Everything here is encrypted end to end.',
			chat: [{ author: 'aria', when: '2026-09-02 07:40', text: 'Road at the bridge is closed again. Crew gate at 08:30?' }, { author: 'me', when: '2026-09-02 07:42', text: 'Yes. I updated the muster points.', ref: { kind: 'map', id: 'crew-gate' } }, { author: 'mafrend', when: '2026-09-02 07:50', text: 'On my way.' }] },
	]
	const nearby = [
		{ id: 'saturday', kind: 'nearby', title: 'Saturday survey', author: 'aria', created: '2026-09-03 08:10', sharing: true, interface: 'Wi-Fi · earthly-field', peers: [{ id: 'aria', role: 'host', status: 'connected' }, { id: 'me', role: 'peer', status: 'connected' }, { id: 'mafrend', role: 'peer', status: 'last seen 4 min' }], invite: 'earthly-field://join/saturday-2c9', description: 'Zollfeld dig, no signal in the trench. Records sync between phones and go online when someone gets back to the car.' },
	]
	const notifications = [
		{ id: 'n1', kind: 'proposal', when: '2026-09-01 18:30', read: false, from: 'mafrend', text: 'proposed changes to The Hippie Trail', target: { kind: 'map', id: 'hippie-trail' } },
		{ id: 'n2', kind: 'reply', when: '2026-09-02 07:05', read: false, from: 'aria', text: 'commented on The Hippie Trail', target: { kind: 'map', id: 'hippie-trail', tab: 'comments' } },
		{ id: 'n3', kind: 'waiting', when: '2026-08-25 12:00', read: false, from: 'mafrend', text: 'Roads of Noricum is waiting in Roman ruins in Carinthia', target: { kind: 'atlas', id: 'roman-ruins' } },
		{ id: 'n4', kind: 'join', when: '2026-09-02 09:14', read: false, from: 'earthly', text: 'asked to join Alpine rescue', target: { kind: 'circle', id: 'alpine' } },
		{ id: 'n5', kind: 'mention', when: '2026-09-02 07:42', read: true, from: 'aria', text: 'mentioned you in Alpine rescue', target: { kind: 'circle', id: 'alpine', tab: 'chat' } },
		{ id: 'n6', kind: 'accepted', when: '2026-08-21 17:10', read: true, from: 'schlaus', text: 'accepted your proposal on Global skate spots', target: { kind: 'atlas', id: 'skate-spots' } },
		{ id: 'n7', kind: 'follow', when: '2026-08-20 10:00', read: true, from: 'aria', text: 'started following you', target: { kind: 'person', id: 'aria' } },
	]

	// Comments are NIP-22 replies. A comment may carry a small geometry: the "comment with annotation" flow.
	const comments = [
		{ id: 'c1', on: 'map:hippie-trail', author: 'mafrend', when: '2026-09-01 18:12', text: 'Erzurum is missing. Every Magic Bus stopped there for the night before the Iranian border.', likes: 3, geom: { type: 'point', coords: [41.27, 39.9] } },
		{ id: 'c2', on: 'map:hippie-trail', author: 'me', when: '2026-09-01 19:40', parent: 'c1', text: 'Good call. Adding it in the next version.', likes: 1 },
		{ id: 'c3', on: 'map:hippie-trail', author: 'aria', when: '2026-09-02 07:05', text: 'The stretch between Herat and Kandahar was usually done by shared taxi, not bus. Worth a note on the line.', likes: 2, geom: { type: 'line', coords: [[62.2, 34.35], [63.9, 33.0], [65.71, 31.62]] } },
		{ id: 'c4', on: 'map:hippie-trail', author: 'schlaus', when: '2026-09-02 08:30', text: 'Lovely map. Would love a Story to go with it.', likes: 0 },
		{ id: 'c5', on: 'story:bri-story', author: 'aria', when: '2026-07-13 10:02', text: 'The Duisburg terminal number is from 2019; it is closer to sixty trains a week now.', likes: 4 },
		{ id: 'c6', on: 'story:bri-story', author: 'me', when: '2026-07-13 11:20', parent: 'c5', text: 'Thanks, will update with a source.', likes: 0 },
		{ id: 'c7', on: 'atlas:skate-spots', author: 'aria', when: '2026-08-21 16:44', text: 'Can we add a “security” field? Half the value of a spot is knowing when the guards leave.', likes: 5 },
		{ id: 'c8', on: 'atlas:skate-spots', author: 'schlaus', when: '2026-08-21 17:10', parent: 'c7', text: 'Yes. Next schema version. Keep it optional so old maps still fit.', likes: 2 },
		{ id: 'c9', on: 'map:bcn-spots', author: 'me', when: '2026-08-10 21:00', text: 'Sants ledges got knobbed in July.', likes: 1, geom: { type: 'point', coords: [2.14, 41.379] } },
		{ id: 'c10', on: 'sighting:palmer', author: 'mafrend', when: '2026-08-30 21:00', text: 'On my way.', likes: 0 },
	]
	// A proposal (kind 37519) is a set of changes someone offers to the author instead of forking.
	const proposals = [
		{ id: 'prop-1', target: 'map:hippie-trail', author: 'mafrend', created: '2026-09-01', status: 'pending', message: 'Added Erzurum as a stop and renamed Tabriz to mention the bazaar, which is where the buses actually stopped.',
			add: [pt('erzurum', 'Erzurum', 41.27, 39.9, { kind: 'stop' })], modify: [{ id: 'stop-2', name: 'Tabriz (bazaar)', props: { kind: 'stop', note: 'buses stopped at the bazaar gate' } }], remove: [] },
	]
	const social = {
		'map:hippie-trail': { likes: 4, zaps: 2, favs: 3 }, 'map:bri': { likes: 9, zaps: 5, favs: 6 }, 'map:cables-atlantic': { likes: 3, zaps: 0, favs: 2 }, 'map:bcn-spots': { likes: 12, zaps: 3, favs: 8 },
		'story:bri-story': { likes: 7, zaps: 4, favs: 5 }, 'story:macba-story': { likes: 6, zaps: 1, favs: 2 }, 'atlas:skate-spots': { likes: 15, zaps: 6, favs: 11 }, 'sighting:palmer': { likes: 2, zaps: 0, favs: 0 },
	}

	window.SKETCH_DATA = {
		photo,
		people, maps, stories, atlases, sightings, live, comments, proposals, social, circles, nearby, notifications,
		places: { Vienna: [16.37, 48.21], Istanbul: [28.98, 41.01], Kabul: [69.17, 34.53], Bilbao: [-2.93, 43.26], Klagenfurt: [14.31, 46.62], Barcelona: [2.17, 41.39], Berlin: [13.4, 52.52] },
	}
})()
