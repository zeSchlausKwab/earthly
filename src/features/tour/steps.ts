import type { DriveStep } from "driver.js";

function mediaBlock(opts: {
  screenshot?: string;
  video?: string;
  alt?: string;
}): string {
  if (opts.video) {
    // Hidden by default; shown only when video can play (i.e. file exists)
    return `
			<div class="tour-media" style="display:none" data-tour-media>
				<video
					src="${opts.video}"
					controls
					playsinline
					muted
					class="tour-video"
					oncanplay="this.closest('[data-tour-media]').style.display='block'"
					onerror="this.closest('[data-tour-media]').style.display='none'"
				></video>
			</div>`;
  }
  if (opts.screenshot) {
    return `
			<div class="tour-media" data-tour-media>
				<img
					src="${opts.screenshot}"
					alt="${opts.alt ?? "Screenshot"}"
					style="width:100%;border-radius:8px;margin-top:10px;border:1px solid rgba(0,0,0,.1)"
					onerror="this.closest('[data-tour-media]').style.display='none'"
				/>
			</div>`;
  }
  return "";
}

export const tourSteps: DriveStep[] = [
  // ── 1. Welcome ──────────────────────────────────────────────────────────
  {
    popover: {
      title: "🌍 Welcome to Earthly",
      description: `
				<p style="margin:0 0 10px">
					<strong>Earthly</strong> is a decentralized collaborative mapping app built on
					<a href="https://nostr.com" target="_blank" rel="noreferrer">Nostr</a>.
					Create, publish, and explore geographic datasets without any central server.
				</p>
				<ul style="margin:0 0 10px;padding-left:1.2em;line-height:1.8">
					<li>✏️ Draw points, lines, and polygons on the map</li>
					<li>📡 Publish datasets as Nostr events — censorship-resistant by design</li>
					<li>💬 Comment, react, and collaborate with others</li>
					<li>🗂️ Organize data into <em>Map Contexts</em> — curated views of your region</li>
				</ul>
				<p style="margin:12px 0 8px;padding:10px 14px;background:rgba(0,0,0,.06);border-left:3px solid currentColor;border-radius:4px;font-size:.9em;line-height:1.6">
					<strong>Always remember:</strong><br/>
					<em>Datasets carry geometry. Contexts organize and validate it. Comments discuss it. Proposals change it.</em>
				</p>
				<p style="margin:0;font-size:.85em;opacity:.7">
					This short tour takes about 2 minutes. Press <strong>Next</strong> to begin, or
					<strong>Done</strong> to skip.
				</p>
				${mediaBlock({ video: "/tour/videos/intro.mp4" })}
			`,
      side: "over",
      align: "center",
    },
  },

  // ── 2. Nostr Identity (first interactive step) ───────────────────────────
  {
    element: '[data-tour="sidebar-login"]',
    popover: {
      title: "🔑 Your Nostr Identity",
      description: `
				<p style="margin:0 0 8px">
					Earthly uses <strong>Nostr</strong> for identity — no email, no password, no sign-up form.
					Your identity is a cryptographic key pair you control entirely.
				</p>
				<ul style="margin:0 0 8px;padding-left:1.2em;line-height:1.8">
					<li>🆕 <strong>New user?</strong> Use the guided wizard to generate a key and save a printable backup PDF</li>
					<li>🗝️ <strong>Have a Nostr key?</strong> Import your <code style="font-size:.8em;background:rgba(0,0,0,.08);padding:1px 4px;border-radius:3px">nsec</code> or use a browser extension (NIP-07)</li>
					<li>⚡ <strong>Advanced:</strong> Connect via NIP-46 remote signing from another device</li>
				</ul>
				<p style="margin:0;font-size:.85em;opacity:.7">
					Your key is never sent to any server. You are your own account.
				</p>
				${mediaBlock({ video: "/tour/videos/login.mp4" })}
			`,
      side: "right",
      align: "center",
    },
  },

  // ── 3. The Map ────────────────────────────────────────────────────────────
  {
    element: '[data-tour="map-canvas"]',
    popover: {
      title: "🗺️ The Interactive Map",
      description: `
				<p style="margin:0 0 8px">
					The map is powered by <strong>MapLibre GL</strong> with
					<a href="https://openfreemap.org" target="_blank" rel="noreferrer"><strong>OpenFreeMap</strong></a>
					— a fully open, free basemap. Tiles are served as
					<strong>PMTiles</strong>, either loaded locally from a Blossom blob server
					or fetched online depending on your connectivity.
				</p>
				<ul style="margin:0 0 8px;padding-left:1.2em;line-height:1.8">
					<li><strong>Scroll</strong> or pinch to zoom</li>
					<li><strong>Drag</strong> to pan</li>
					<li><strong>Click</strong> a feature to inspect it</li>
					<li>The <strong>map source</strong> (style, tile server) can be changed in <em>Settings</em></li>
				</ul>
				<p style="margin:0;font-size:.85em;opacity:.7">
					All geographic data is stored as GeoJSON inside Nostr events (kind 37515) — you own your data.
				</p>
				${mediaBlock({ screenshot: "/tour/screenshots/map.png", alt: "Map canvas overview" })}
			`,
      side: "right",
      align: "start",
    },
  },

  // ── 4. Drawing & Editing Tools ────────────────────────────────────────────
  {
    element: '[data-tour="toolbar"]',
    popover: {
      title: "✏️ Drawing & Editing Tools",
      description: `
				<p style="margin:0 0 8px">
					The toolbar holds all editing and data tools.
				</p>
				<ul style="margin:0 0 6px;padding-left:1.2em;line-height:1.8">
					<li><strong>Draw</strong> — point, linestring, polygon with snapping &amp; undo/redo</li>
					<li><strong>Boolean ops</strong> — union, intersect, difference, and split geometries</li>
					<li><strong>Simplify</strong> — reduce vertex count with Douglas-Peucker</li>
					<li><strong>Import / Export</strong> — load or save GeoJSON, Shapefile (.shp/.zip), and OSM data</li>
					<li><strong>Map Excerpt</strong> — crop a region of interest from the map view</li>
					<li><strong>Image Share</strong> — export a styled PNG snapshot of any feature or dataset</li>
					<li><strong>Search</strong> — jump to any location by name</li>
				</ul>
				<p style="margin:0;font-size:.85em;opacity:.7">
					All edits are local until you press <strong>Publish</strong> — nothing is sent to the network until you're ready.
				</p>
				${mediaBlock({ video: "/tour/videos/drawing.mp4" })}
			`,
      side: "bottom",
      align: "start",
    },
  },

  // ── 5. Sidebar Navigation ─────────────────────────────────────────────────
  {
    element: '[data-tour="sidebar-nav"]',
    popover: {
      title: "📋 Sidebar Navigation",
      description: `
				<p style="margin:0 0 8px">
					The icon strip on the left opens different workspaces inside the sidebar panel.
				</p>
				<ul style="margin:0 0 8px;padding-left:1.2em;line-height:1.8">
					<li><strong>Geometry</strong> — inspect &amp; edit a selected feature's properties</li>
					<li><strong>Datasets</strong> — browse and load published datasets</li>
					<li><strong>Contexts</strong> — explore curated map views</li>
					<li><strong>AI Chat</strong> — ask questions and manipulate your data with AI</li>
					<li><strong>My Entities</strong> — your published datasets and contexts</li>
				</ul>
				<p style="margin:0;font-size:.85em;opacity:.7">
					The sidebar can be collapsed to give you more map space.
				</p>
				${mediaBlock({ screenshot: "/tour/screenshots/sidebar.png", alt: "Sidebar navigation" })}
			`,
      side: "right",
      align: "start",
    },
  },

  // ── 6. Datasets ───────────────────────────────────────────────────────────
  {
    element: '[data-tour="sidebar-datasets"]',
    popover: {
      title: "🗄️ Datasets",
      description: `
				<p style="margin:0 0 8px">
					A <strong>Dataset</strong> is a GeoJSON FeatureCollection published as a Nostr event
					(kind 37515). Anyone can browse and load datasets from the relay.
				</p>
				<ul style="margin:0 0 8px;padding-left:1.2em;line-height:1.8">
					<li>Toggle visibility with the eye icon</li>
					<li>Load a dataset into the editor to start editing</li>
					<li>Large datasets are stored on Blossom blob servers and referenced by hash</li>
				</ul>
				<p style="margin:0;font-size:.85em;opacity:.7">
					All datasets are signed by the author's Nostr key — you can always verify who created them.
				</p>
				${mediaBlock({ screenshot: "/tour/screenshots/datasets.png", alt: "Datasets panel" })}
			`,
      side: "right",
      align: "start",
    },
  },

  // ── 7. Map Contexts ───────────────────────────────────────────────────────
  {
    element: '[data-tour="sidebar-contexts"]',
    popover: {
      title: "🌐 Map Contexts",
      description: `
				<p style="margin:0 0 8px">
					A <strong>Map Context</strong> (kind 37518) is a curated lens over a region — like
					"bicycle routes in Berlin" or "public art in Tokyo."
				</p>
				<ul style="margin:0 0 8px;padding-left:1.2em;line-height:1.8">
					<li>Contexts define which datasets belong to a geographic area</li>
					<li>They can enforce schema rules: required properties, allowed geometry types</li>
					<li>Contexts act as taxonomies, grouping related datasets by theme</li>
					<li>Attach your dataset to a context to contribute to its map</li>
				</ul>
				<p style="margin:0;font-size:.85em;opacity:.7">
					Think of contexts as community-curated map layers that anyone can contribute to.
				</p>
				${mediaBlock({ screenshot: "/tour/screenshots/contexts.png", alt: "Map contexts panel" })}
			`,
      side: "right",
      align: "start",
    },
  },

  // ── 8. AI Chat ────────────────────────────────────────────────────────────
  {
    element: '[data-tour="sidebar-chat"]',
    popover: {
      title: "🤖 AI Chat",
      description: `
				<p style="margin:0 0 8px">
					The built-in AI assistant can answer questions about your data
					<em>and directly manipulate the map</em> — no copy-pasting coordinates.
				</p>
				<ul style="margin:0 0 8px;padding-left:1.2em;line-height:1.8">
					<li><strong>Ask questions</strong> — "What features are in this dataset?"</li>
					<li><strong>Generate geometry</strong> — "Draw a 500m buffer around this point"</li>
					<li><strong>Edit properties</strong> — "Set the name of all parks to uppercase"</li>
					<li><strong>Flexible AI backend</strong> — use Groq, OpenRouter, any OpenAI-compatible endpoint, or a local LLM via Ollama</li>
				</ul>
				<p style="margin:0;font-size:.85em;opacity:.7">
					Configure your AI provider and API key in the chat settings panel.
				</p>
				${mediaBlock({ video: "/tour/videos/chat.mp4" })}
			`,
      side: "right",
      align: "start",
    },
  },

  // ── 9. My Entities ────────────────────────────────────────────────────────
  {
    element: '[data-tour="sidebar-my-entities"]',
    popover: {
      title: "🏷️ My Entities",
      description: `
				<p style="margin:0 0 8px">
					<strong>My Entities</strong> is your personal workspace — everything you've published to the network in one place.
				</p>
				<ul style="margin:0 0 8px;padding-left:1.2em;line-height:1.8">
					<li>See all your published datasets and map contexts</li>
					<li>Quickly load, inspect, or delete your own data</li>
					<li>Track which of your datasets are attached to which contexts</li>
					<li>Manage drafts and workspaces before publishing</li>
				</ul>
				<p style="margin:0;font-size:.85em;opacity:.7">
					Only events signed with your Nostr key appear here.
				</p>
				${mediaBlock({ screenshot: "/tour/screenshots/my-entities.png", alt: "My Entities panel" })}
			`,
      side: "right",
      align: "start",
    },
  },

  // ── 10. Comments & Social ─────────────────────────────────────────────────
  {
    element: '[data-tour="sidebar-help"]',
    popover: {
      title: "💬 Comments & Collaboration",
      description: `
				<p style="margin:0 0 8px">
					Earthly is social. Every dataset supports threaded discussion and engagement.
				</p>
				<ul style="margin:0 0 8px;padding-left:1.2em;line-height:1.8">
					<li><strong>Comments</strong> — discuss datasets, mention features by drawing geometry inline</li>
					<li><strong>Reactions</strong> — react with emoji or zap sats via Lightning</li>
					<li><strong>Edit Proposals</strong> — suggest geometry edits; the dataset owner accepts or rejects</li>
					<li><strong>City Posts</strong> — short-form posts visible to people in the same area</li>
				</ul>
				<p style="margin:0;font-size:.85em;opacity:.7">
					All social data is stored as Nostr events — portable across any compatible client.
				</p>
				${mediaBlock({ screenshot: "/tour/screenshots/social.png", alt: "Social features" })}
			`,
      side: "right",
      align: "start",
    },
  },

  // ── 11. Done ──────────────────────────────────────────────────────────────
  {
    popover: {
      title: "🚀 You're ready!",
      description: `
				<p style="margin:0 0 10px">
					Here's how to get started:
				</p>
				<ol style="margin:0 0 10px;padding-left:1.4em;line-height:2">
					<li>Log in with your Nostr key (or create one)</li>
					<li>Browse the <strong>Contexts</strong> panel — there may already be a
					    <em>global context</em> for your region you can attach geometry to</li>
					<li>Or click <strong>New Dataset</strong> in the toolbar, draw some features,
					    and hit <strong>Publish</strong></li>
					<li>Create your own <strong>Map Context</strong> to curate datasets for a
					    place or theme you care about</li>
				</ol>
				<p style="margin:0;font-size:.85em;opacity:.7">
					You can restart this tour anytime from the <strong>Help</strong> panel in the sidebar.
				</p>
			`,
      side: "over",
      align: "center",
    },
  },
];
