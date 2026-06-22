/**
 * Single source of truth for the app's Web Worker assets.
 *
 * WHY THIS EXISTS (root cause, Phase 4 UAT blocker):
 * The idiomatic `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`
 * form does NOT work in this app's serving setup, in EITHER mode:
 *
 *  - DEV (Bun HTML-import / fullstack dev server, Bun issue #17705): the dev bundler
 *    substitutes `import.meta.url` with the module's absolute SOURCE `file://` path, so the
 *    worker URL becomes `file:///…/x.worker.ts`. The browser refuses to construct a Worker
 *    from a `file://` script when the page origin is `http://localhost` → cross-origin error.
 *    The dev server also has no route serving the transpiled worker, so the `.ts` path falls
 *    through to the SPA `index.html` (Content-Type text/html).
 *
 *  - PROD (`build.ts` via `Bun.build`): the bundler does NOT auto-emit the worker as a
 *    separate chunk from the `new Worker(new URL(...))` form (Bun issues #7534/#7901/#16869).
 *    `import.meta.url` is preserved and resolves at runtime to the host chunk URL, so the
 *    worker URL becomes `https://host/x.worker.ts` — a path that does not exist in `dist/`
 *    and is served as `index.html` by the SPA catch-all.
 *
 * THE FIX: each worker is bundled as its OWN entrypoint and served at a STABLE, origin-rooted
 * URL (`/workers/<name>.js`). Spawn sites construct the Worker from that stable string URL,
 * which the browser resolves against the document origin (same-origin, http(s), constructible):
 *
 *  - DEV: `src/index.ts` adds a `/workers/:name` route that runs `Bun.build()` on the worker
 *    source on demand and returns the artifact with a JS content-type.
 *  - PROD: `build.ts` adds the worker sources as explicit entrypoints and copies the emitted
 *    artifacts to `dist/workers/<name>.js`; the prod server serves them from `dist/`.
 *
 * Adding a new worker = add one entry here; dev route + prod build both read from this map.
 */

/** A registered worker asset: its logical served name and its source entrypoint. */
export interface WorkerAsset {
	/** Stable file name served under `/workers/` (e.g. `sandbox.worker.js`). */
	readonly servedName: string
	/** Source entrypoint, repo-relative (used by the dev route and the prod build). */
	readonly sourcePath: string
}

/**
 * Every Web Worker the app spawns. The KEY is a stable logical id used by spawn sites;
 * `servedName` is the URL path segment; `sourcePath` is what the bundler compiles.
 */
export const WORKER_ASSETS = {
	sandbox: {
		servedName: 'sandbox.worker.js',
		sourcePath: 'src/features/chat/sandbox/transport/sandbox.worker.ts',
	},
	ingest: {
		servedName: 'ingest.worker.js',
		sourcePath: 'src/features/chat/ingest/ingest.worker.ts',
	},
	geoJsonParse: {
		servedName: 'geoJsonParse.worker.js',
		sourcePath: 'src/lib/geo/geoJsonParseWorker.ts',
	},
	optimize: {
		servedName: 'optimize.worker.js',
		sourcePath: 'src/features/chat/geometry/optimize.worker.ts',
	},
} as const satisfies Record<string, WorkerAsset>

/** Logical worker ids (keys of {@link WORKER_ASSETS}). */
export type WorkerId = keyof typeof WORKER_ASSETS

/** Root URL prefix the worker artifacts are served under (origin-rooted, same-origin). */
export const WORKER_URL_PREFIX = '/workers'

/**
 * The stable, origin-rooted URL a worker is served at (e.g. `/workers/sandbox.worker.js`).
 * Pass this string straight to `new Worker(...)`: the browser resolves it against the
 * document origin, yielding a same-origin http(s) URL that constructs in dev AND prod.
 */
export function workerUrl(id: WorkerId): string {
	return `${WORKER_URL_PREFIX}/${WORKER_ASSETS[id].servedName}`
}
