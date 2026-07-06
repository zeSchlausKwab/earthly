/**
 * Bun bundler plugin that replaces `process.env.<KEY>` at bundle time for the
 * keys listed in `FRONTEND_ENV_KEYS`. The production build (`build.ts`) does
 * this via the `define` option, but Bun.serve's dev bundler doesn't support
 * `define`, so we patch `src/config/env.client.ts` on load instead.
 *
 * Bun's `bunfig.toml` `[serve.static].env` glob doesn't reliably substitute
 * comma-separated patterns into the dev bundle, which is why this exists.
 */

import type { BunPlugin } from "bun";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	FRONTEND_ENV_KEYS,
	type FrontendEnvKey,
	safeParseEnv,
} from "../src/config/env.schema";

const TARGET_FILE = resolve(import.meta.dir, "..", "src/config/env.client.ts");

const envPlugin: BunPlugin = {
	name: "earthly-env-inject",
	setup(build) {
		build.onLoad({ filter: /env\.client\.ts$/ }, async (args) => {
			if (resolve(args.path) !== TARGET_FILE) return undefined;
			let source = readFileSync(args.path, "utf8");
			const result = safeParseEnv({
				...process.env,
				NODE_ENV: process.env.NODE_ENV ?? "development",
			});
			const env = result.success
				? result.data
				: ({ NODE_ENV: process.env.NODE_ENV ?? "development" } as Record<
					FrontendEnvKey,
					string
				>);
			for (const key of FRONTEND_ENV_KEYS) {
				const value = (env as Record<string, unknown>)[key];
				const literal = JSON.stringify(value ?? "");
				const pattern = new RegExp(`process\\.env\\.${key}\\b`, "g");
				source = source.replace(pattern, literal);
			}
			return {
				contents: source,
				loader: "ts",
			};
		});
	},
};

export default envPlugin;
