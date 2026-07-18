#!/usr/bin/env bun

import { hexToBytes } from '@noble/hashes/utils.js'
import { getPublicKey } from 'nostr-tools/pure'
import { safeParseEnv } from '../src/config/env.schema'

const HEX_64 = /^[0-9a-f]{64}$/u
const DEVELOPMENT_PRIVATE_KEYS = new Set(['0'.repeat(64), `${'0'.repeat(63)}1`])

export interface ProductionEnvironmentValidation {
	errors: string[]
	cordnPubkey?: string
	relayCount: number
}

function relayUrls(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((url) => url.trim())
		.filter(Boolean)
}

function requireHexPrivateKey(
	env: Record<string, string | undefined>,
	name: string,
	errors: string[],
): string | undefined {
	const value = env[name]
	if (!value || !HEX_64.test(value)) {
		errors.push(`${name} must be a 64-character lowercase hexadecimal private key`)
		return
	}
	if (DEVELOPMENT_PRIVATE_KEYS.has(value)) {
		errors.push(`${name} must not use Earthly's public development key`)
		return
	}
	return value
}

function requireMatchingPubkey(
	privateKey: string | undefined,
	publicKey: string | undefined,
	publicName: string,
	errors: string[],
): string | undefined {
	if (!publicKey || !HEX_64.test(publicKey)) {
		errors.push(`${publicName} must be a 64-character lowercase hexadecimal public key`)
		return
	}
	if (!privateKey) return
	try {
		const derived = getPublicKey(hexToBytes(privateKey))
		if (derived !== publicKey) {
			errors.push(`${publicName} does not match its configured private key`)
		}
		return derived
	} catch {
		errors.push(`The private key for ${publicName} is not a valid secp256k1 scalar`)
	}
}

function requireSecureUrls(name: string, urls: string[], errors: string[]): void {
	if (urls.length === 0) {
		errors.push(`${name} must contain at least one relay URL`)
		return
	}
	for (const value of urls) {
		try {
			const url = new URL(value)
			if (url.protocol !== 'wss:') errors.push(`${name} must use wss:// in production: ${value}`)
			if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
				errors.push(`${name} must not use a loopback relay in production: ${value}`)
			}
		} catch {
			errors.push(`${name} contains an invalid relay URL: ${value}`)
		}
	}
}

function requirePositiveInteger(
	env: Record<string, string | undefined>,
	name: string,
	errors: string[],
): void {
	const value = env[name]
	if (!value || !/^\d+$/u.test(value) || Number(value) <= 0) {
		errors.push(`${name} must be a positive integer`)
	}
}

export function validateProductionEnv(
	env: Record<string, string | undefined>,
): ProductionEnvironmentValidation {
	const errors: string[] = []
	const parsed = safeParseEnv({ ...env, NODE_ENV: 'production' })
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			errors.push(`${issue.path.join('.')}: ${issue.message}`)
		}
	}

	const publicRelays = relayUrls(env.RELAY_URL)
	const cordnRelays = relayUrls(env.CORDN_RELAY_URLS)
	requireSecureUrls('RELAY_URL', publicRelays, errors)
	requireSecureUrls('CORDN_RELAY_URLS', cordnRelays, errors)

	const serverKey = requireHexPrivateKey(env, 'SERVER_KEY', errors)
	requireMatchingPubkey(serverKey, env.SERVER_PUBKEY, 'SERVER_PUBKEY', errors)
	const cordnKey = requireHexPrivateKey(env, 'CORDN_SERVER_PRIVATE_KEY', errors)
	const cordnPubkey = requireMatchingPubkey(
		cordnKey,
		env.CORDN_SERVER_PUBKEY,
		'CORDN_SERVER_PUBKEY',
		errors,
	)

	if (env.CORDN_STORAGE_BACKEND !== 'sqlite') {
		errors.push('CORDN_STORAGE_BACKEND must be sqlite in production')
	}
	if (
		env.CORDN_NATIVE_SQLITE_PATH &&
		env.CORDN_NATIVE_SQLITE_PATH !== 'data/cordn/cordn.sqlite'
	) {
		errors.push('CORDN_NATIVE_SQLITE_PATH must be data/cordn/cordn.sqlite for VPS deployment')
	}
	if (env.CORDN_SQLITE_SYNCHRONOUS && env.CORDN_SQLITE_SYNCHRONOUS !== 'full') {
		errors.push('CORDN_SQLITE_SYNCHRONOUS must be full for durable production writes')
	}
	if (env.BLOSSOM_SERVER) {
		try {
			if (new URL(env.BLOSSOM_SERVER).protocol !== 'https:') {
				errors.push('BLOSSOM_SERVER must use https:// in production')
			}
		} catch {
			errors.push('BLOSSOM_SERVER must be a valid URL')
		}
	}
	const trustedMapnoliaPubkeys = relayUrls(env.MAPNOLIA_TRUSTED_PUBKEYS)
	if (trustedMapnoliaPubkeys.length === 0) {
		errors.push('MAPNOLIA_TRUSTED_PUBKEYS must contain at least one public key')
	} else {
		for (const pubkey of trustedMapnoliaPubkeys) {
			if (!HEX_64.test(pubkey)) {
				errors.push(
					'MAPNOLIA_TRUSTED_PUBKEYS must contain comma-separated lowercase hexadecimal public keys',
				)
				break
			}
		}
	}
	for (const name of [
		'CORDN_MAX_AGE_DAYS',
		'CORDN_RATE_LIMIT_REFILL_PER_MINUTE',
		'CORDN_RATE_LIMIT_BURST',
		'CORDN_RATE_LIMIT_IDLE_TTL_SECONDS',
		'CORDN_MAX_KEY_PACKAGES_PER_IDENTITY',
		'CORDN_MAX_LAST_RESORT_KEY_PACKAGES_PER_IDENTITY',
	]) {
		requirePositiveInteger(env, name, errors)
	}

	return { errors, cordnPubkey, relayCount: cordnRelays.length }
}

if (import.meta.main) {
	const result = validateProductionEnv(process.env)
	if (result.errors.length > 0) {
		console.error('Production environment validation failed:')
		for (const error of result.errors) console.error(`- ${error}`)
		process.exit(1)
	}
	console.log(
		`Production environment valid: Cordn ${result.cordnPubkey?.slice(0, 16)}… over ${result.relayCount} relay${result.relayCount === 1 ? '' : 's'} with SQLite persistence.`,
	)
}
