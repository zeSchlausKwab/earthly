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
console.log(`   CLIENT_KEY: ${env.CLIENT_KEY.slice(0, 16)}...`);
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
	sourcemap: "linked",
	define,
	...cliConfig,
});

const end = performance.now();

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

const buildTime = (end - start).toFixed(2);

console.log(`\n✅ Build completed in ${buildTime}ms\n`);
