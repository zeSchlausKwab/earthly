/**
 * safetyAccess — a tiny injectable accessor for the persisted safety level
 * (SAFE-04) that the run_code gate reads WITHOUT statically importing the chat
 * store.
 *
 * WHY the indirection: `runCode.ts` is pulled into the registry bootstrap
 * (registry.ts imports it), and `store.ts` imports `./tools` (→ registry). A
 * static `import { useChatStore } from '@/features/chat/store'` inside `runCode.ts`
 * would close the `runCode → store → tools → registry → runCode` loop, which the
 * dev HMR bundler resolves to a null reference and crashes at bootstrap (the same
 * circular-import hazard the run_code module header documents for `register`).
 *
 * The chat store installs the real getter once at module init via
 * `setSafetyLevelProvider`; until then the getter defaults to Level 2 (the
 * persisted default), so the gate is never weaker than the default if a read
 * races startup.
 */

import type { SafetyLevel } from './AuthoringGate'

let provider: () => SafetyLevel = () => 2

/** Install the real safety-level getter (called once by the chat store). */
export function setSafetyLevelProvider(getter: () => SafetyLevel): void {
	provider = getter
}

/** Read the current persisted safety level (SAFE-04). Defaults to 2 pre-init. */
export function getSafetyLevel(): SafetyLevel {
	return provider()
}
