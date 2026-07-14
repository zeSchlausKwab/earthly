#!/usr/bin/env bun
import plugin from "bun-plugin-tailwind";
import { existsSync } from "fs";
import { cp, mkdir, rm } from "fs/promises";
import path from "path";
import {
	FRONTEND_ENV_KEYS,
	type FrontendEnvKey,
	safeParseEnv,
} from "./src/config/env.schema";
import { buildWorkerSource } from "./src/lib/workers/buildWorker";
import {
	WORKER_ASSETS,
	type WorkerId,
} from "./src/lib/workers/workerAssets";
import { ensureHtmlEntrypoint } from "./scripts/ensure-html-entrypoint";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
	console.log(`
🏗️  Bun Build Script

Usage: bun run build.ts [options]

Common Options:
  --outdir <path>          Output directory (default: "dist")
  --minify                 Enable minification (or --minify.whitespace, --minify.syntax, etc)
  --sourcemap <type>      Sourcemap type: none|linked|inline|external
  --target <target>        Build target: browser|bun|node
  --format <format>        Output format: esm|cjs|iife
  --splitting              Enable code splitting
  --packages <type>        Package handling: bundle|external
  --public-path <path>     Public path for assets
  --env <mode>             Environment handling: inline|disable|prefix*
  --conditions <list>      Package.json export conditions (comma separated)
  --external <list>        External packages (comma separated)
  --banner <text>          Add banner text to output
  --footer <text>          Add footer text to output
  --define <obj>           Define global constants (e.g. --define.VERSION=1.0.0)
  --help, -h               Show this help message

Example:
  bun run build.ts --outdir=dist --minify --sourcemap=linked --external=react,react-dom
`);
	process.exit(0);
}

const toCamelCase = (str: string): string =>
	str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());

const parseValue = (value: string): any => {
	if (value === "true") return true;
	if (value === "false") return false;

	if (/^\d+$/.test(value)) return parseInt(value, 10);
	if (/^\d*\.\d+$/.test(value)) return parseFloat(value);

	if (value.includes(",")) return value.split(",").map((v) => v.trim());

	return value;
};

function parseArgs(): Partial<Bun.BuildConfig> {
	const config: Partial<Bun.BuildConfig> = {};
	const args = process.argv.slice(2);

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (!arg.startsWith("--")) continue;

		if (arg.startsWith("--no-")) {
			const key = toCamelCase(arg.slice(5));
			config[key] = false;
			continue;
		}

		if (
			!arg.includes("=") &&
			(i === args.length - 1 || args[i + 1]?.startsWith("--"))
		) {
			const key = toCamelCase(arg.slice(2));
			config[key] = true;
			continue;
		}

		let key: string;
		let value: string;

		if (arg.includes("=")) {
			[key, value] = arg.slice(2).split("=", 2) as [string, string];
		} else {
			key = arg.slice(2);
			value = args[++i] ?? "";
		}

		key = toCamelCase(key);

		if (key.includes(".")) {
			const [parentKey, childKey] = key.split(".");
			config[parentKey] = config[parentKey] || {};
			config[parentKey][childKey] = parseValue(value);
		} else {
			config[key] = parseValue(value);
		}
	}

	return config;
}

const formatFileSize = (bytes: number): string => {
	const units = ["B", "KB", "MB", "GB"];
	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(2)} ${units[unitIndex]}`;
};

console.log("\n🚀 Starting build process...\n");

// ─────────────────────────────────────────────────────────────────────────────
// Validate Environment Variables
// ─────────────────────────────────────────────────────────────────────────────

const envResult = safeParseEnv({
	...process.env,
	NODE_ENV: "production", // Always production for builds
});

if (!envResult.success) {
	console.error("❌ Environment validation failed:\n");
	for (const issue of envResult.error.issues) {
		console.error(`   ${issue.path.join(".")}: ${issue.message}`);
	}
	console.error("\n💡 Check your .env file or environment variables.\n");
	process.exit(1);
}

const env = envResult.data;

// Show which environment values are being used
console.log("📋 Environment configuration:");
console.log(`   RELAY_URL: ${env.RELAY_URL}`);
console.log(`   SERVER_PUBKEY: ${env.SERVER_PUBKEY.slice(0, 16)}...`);
console.log(
	`   CORDN_SERVER_PUBKEY: ${env.CORDN_SERVER_PUBKEY ? `${env.CORDN_SERVER_PUBKEY.slice(0, 16)}...` : "disabled"}`,
);
console.log();

// Build define object for frontend env injection
const define: Record<string, string> = {};
for (const key of FRONTEND_ENV_KEYS) {
	define[`process.env.${key}`] = JSON.stringify(env[key as FrontendEnvKey]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

const cliConfig = parseArgs();
const outdir = cliConfig.outdir || path.join(process.cwd(), "dist");

if (existsSync(outdir)) {
	console.log(`🗑️ Cleaning previous build at ${outdir}`);
	await rm(outdir, { recursive: true, force: true });
}

const start = performance.now();

const entrypoints = [...new Bun.Glob("**.html").scanSync("src")]
	.map((a) => path.resolve("src", a))
	.filter((dir) => !dir.includes("node_modules"));
console.log(
	`📄 Found ${entrypoints.length} HTML ${
		entrypoints.length === 1 ? "file" : "files"
	} to process\n`,
);

const result = await Bun.build({
	entrypoints,
	outdir,
	plugins: [plugin],
	minify: true,
	target: "browser",
	sourcemap: "none", // Disable for production (saves 17MB)
	splitting: true,   // Enable code splitting
	// Absolute asset URLs: with relative "./chunk-x.js" refs, a nested SPA
	// route like /datasets/geoevent/<naddr> resolves chunks under the route
	// path, misses, and the SPA fallback serves index.html as a module script
	// ("Expected a JavaScript-or-Wasm module script but ... text/html").
	publicPath: "/",
	define,
	...cliConfig,
});

const end = performance.now();

const htmlEntrypoint = await ensureHtmlEntrypoint(result.outputs, "/");
if (htmlEntrypoint.corrected) {
	console.warn(
		`⚠️ Corrected Bun HTML module entry to ${htmlEntrypoint.scriptPath}`,
	);
}

const outputTable = result.outputs.map((output) => ({
	File: path.relative(process.cwd(), output.path),
	Type: output.kind,
	Size: formatFileSize(output.size),
}));

console.table(outputTable);

// Copy .well-known directory to dist
const wellKnownSrc = path.join(process.cwd(), "src", ".well-known");
const wellKnownDest = path.join(outdir, ".well-known");

if (existsSync(wellKnownSrc)) {
	console.log(`\n📋 Copying .well-known directory to ${wellKnownDest}`);
	await mkdir(wellKnownDest, { recursive: true });
	await cp(wellKnownSrc, wellKnownDest, { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Emit the QuickJS WASM asset (Phase 4 criterion c)
// ─────────────────────────────────────────────────────────────────────────────
//
// The code-interpreter sandbox worker loads the `@jitl/quickjs-wasmfile-release-sync`
// emscripten variant, whose glue fetches a SEPARATE `.wasm` at runtime. Bun.build()
// does NOT trace/copy that asset, so without this step the production worker fetches
// `/emscripten-module.wasm` → 404 → "failed to instantiate WebAssembly". We copy it
// to a stable served path (`dist/emscripten-module.wasm`) that sandbox.worker.ts
// points its loader at via `wasmLocation`. Fail LOUDLY if the source is missing so a
// dependency move can never silently regress in-browser code execution.
const QUICKJS_WASM_FILENAME = "emscripten-module.wasm";
let quickjsWasmSrc: string;
try {
	// Resolve via the package's own export so this tracks the installed version.
	quickjsWasmSrc = Bun.fileURLToPath(
		import.meta.resolve(
			`@jitl/quickjs-wasmfile-release-sync/${QUICKJS_WASM_FILENAME}`,
		),
	);
} catch {
	// Fall back to the canonical node_modules path if the export map omits it.
	quickjsWasmSrc = path.join(
		process.cwd(),
		"node_modules",
		"@jitl",
		"quickjs-wasmfile-release-sync",
		"dist",
		QUICKJS_WASM_FILENAME,
	);
}

const quickjsWasmSource = Bun.file(quickjsWasmSrc);
if (!(await quickjsWasmSource.exists())) {
	console.error(
		`\n❌ QuickJS WASM asset not found at ${quickjsWasmSrc}\n` +
			"   The code-interpreter sandbox cannot run in the browser without it.\n" +
			"   Did @jitl/quickjs-wasmfile-release-sync move or fail to install?\n",
	);
	process.exit(1);
}

const quickjsWasmDest = path.join(outdir, QUICKJS_WASM_FILENAME);
console.log(`\n📋 Copying QuickJS WASM asset to ${quickjsWasmDest}`);
await Bun.write(quickjsWasmDest, quickjsWasmSource);

// ─────────────────────────────────────────────────────────────────────────────
// Emit Web Worker bundles (sandbox / ingest / geoJsonParse)
// ─────────────────────────────────────────────────────────────────────────────
//
// Bun's bundler does NOT auto-emit a worker chunk from the `new Worker(new URL(...))`
// form (Bun #7534/#7901/#16869), so the main `Bun.build` above leaves the worker
// sources referenced but unbuilt. We bundle each worker explicitly as its own
// self-contained entrypoint and write it to a stable served path (`dist/workers/<name>`)
// that spawn sites request via `workerUrl(...)`. Without this, `run_code` (and the
// ingest/geo parse workers) fail to construct a Worker in production.
const workersOutDir = path.join(outdir, "workers");
await mkdir(workersOutDir, { recursive: true });
for (const id of Object.keys(WORKER_ASSETS) as WorkerId[]) {
	const { servedName, sourcePath } = WORKER_ASSETS[id];
	const dest = path.join(workersOutDir, servedName);
	console.log(`📋 Building worker ${id} → ${path.relative(process.cwd(), dest)}`);
	const js = await buildWorkerSource(sourcePath, true);
	await Bun.write(dest, js);
}

const buildTime = (end - start).toFixed(2);

console.log(`\n✅ Build completed in ${buildTime}ms\n`);
