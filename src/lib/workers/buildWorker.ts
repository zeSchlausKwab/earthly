/**
 * Shared worker-bundling helper used by BOTH serving paths so they can never diverge:
 *
 *  - the dev server route (`src/index.ts`) builds a worker on demand per request;
 *  - the production build (`build.ts`) builds every worker once into `dist/workers/`.
 *
 * Both produce a SINGLE-FILE browser ESM bundle (no code-splitting — a worker is its own
 * top-level entry and must be self-contained at a stable URL). Frontend env vars are injected
 * via the same `define` map the main build uses, so a worker sees the same `process.env.*`
 * the rest of the client does.
 *
 * Runs under the Bun (server) runtime only — never imported into client code.
 */

import { FRONTEND_ENV_KEYS, type FrontendEnvKey, parseEnv } from '../../config/env.schema'

/** Build the `process.env.*` → JSON define map for frontend-injected env vars. */
function buildDefine(): Record<string, string> {
	const env = parseEnv({ ...process.env })
	const define: Record<string, string> = {}
	for (const key of FRONTEND_ENV_KEYS) {
		define[`process.env.${key}`] = JSON.stringify(env[key as FrontendEnvKey])
	}
	return define
}

/**
 * Bundle a single worker source entrypoint into a self-contained browser ESM module and
 * return its JS as a string. Throws if the build fails (logs are surfaced by the caller).
 *
 * @param sourcePath repo-relative path to the worker `.ts` entrypoint (from WORKER_ASSETS).
 * @param minify     minify output (prod build passes true; dev passes false for readability).
 */
export async function buildWorkerSource(sourcePath: string, minify = false): Promise<string> {
	const result = await Bun.build({
		entrypoints: [sourcePath],
		target: 'browser',
		format: 'esm',
		minify,
		sourcemap: 'none',
		// No splitting: a worker entry must be one self-contained file at its served URL.
		splitting: false,
		define: buildDefine(),
	})

	const [artifact] = result.outputs
	if (!result.success || !artifact) {
		const logs = result.logs.map((l) => String(l)).join('\n')
		throw new Error(`Worker build failed for ${sourcePath}:\n${logs}`)
	}

	return await artifact.text()
}
