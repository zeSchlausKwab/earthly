/**
 * Configuration Module
 *
 * Re-exports frontend configuration for convenient imports.
 *
 * Usage:
 *   import { config } from "@/config";
 *   import { config } from "./config";
 *
 * For backend code, import directly:
 *   import { serverConfig } from "@/config/env.server";
 *
 * For platform detection:
 *   import { isTauri, getPlatform } from "@/config/platform";
 */

export { type ClientConfig, config } from './env.client'
export {
	getLocalhostAddress,
	getPlatform,
	isMobile,
	isTauri,
	type Platform
} from './platform'
