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

export { config, type ClientConfig } from "./env.client";
export {
  isTauri,
  getPlatform,
  isMobile,
  getLocalhostAddress,
  type Platform,
} from "./platform";
