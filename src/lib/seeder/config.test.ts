import { describe, expect, it } from 'bun:test'
import { devUser1 } from '@/lib/fixtures'
import {
	DEFAULT_RELAY_URL,
	isLoopbackRelayURL,
	parseSeederArgs,
	SeederConfigError,
	validateRelayURL,
} from './config'

describe('validateRelayURL (structural leak guard)', () => {
	it('accepts loopback relays without --allow-remote', () => {
		expect(validateRelayURL('ws://localhost:3334', false)).toBe('ws://localhost:3334')
		expect(validateRelayURL('ws://127.0.0.1:3334', false)).toBe('ws://127.0.0.1:3334')
		expect(validateRelayURL('ws://[::1]:3334', false)).toBe('ws://[::1]:3334')
		expect(validateRelayURL('ws://0.0.0.0:3334', false)).toBe('ws://0.0.0.0:3334')
		expect(validateRelayURL('ws://relay.localhost:3334', false)).toBe('ws://relay.localhost:3334')
	})

	it('HARD ERRORS on non-loopback relays without --allow-remote', () => {
		expect(() => validateRelayURL('wss://example.com', false)).toThrow(SeederConfigError)
		expect(() => validateRelayURL('wss://relay.damus.io', false)).toThrow(/allow-remote/)
		expect(() => validateRelayURL('ws://192.168.1.20:3334', false)).toThrow(/allow-remote/)
		// lookalike host must not pass the suffix check
		expect(() => validateRelayURL('ws://evillocalhost.example.com:3334', false)).toThrow()
	})

	it('allows remote relays only with --allow-remote', () => {
		expect(validateRelayURL('wss://relay.example.com', true)).toBe('wss://relay.example.com')
	})

	it('rejects malformed URLs and non-websocket schemes', () => {
		expect(() => validateRelayURL('not a url', true)).toThrow(SeederConfigError)
		expect(() => validateRelayURL('https://localhost:3334', true)).toThrow(/ws:\/\//)
	})
})

describe('isLoopbackRelayURL', () => {
	it('classifies hosts', () => {
		expect(isLoopbackRelayURL('ws://localhost:3334')).toBe(true)
		expect(isLoopbackRelayURL('wss://relay.damus.io')).toBe(false)
		expect(isLoopbackRelayURL('garbage')).toBe(false)
	})
})

describe('parseSeederArgs', () => {
	it('parses a plain command with defaults', () => {
		const config = parseSeederArgs(['full'], {})
		expect(config.command).toBe('full')
		expect(config.relay).toBe(DEFAULT_RELAY_URL)
		expect(config.dryRun).toBe(false)
		expect(config.keyHex).toBe(devUser1.sk)
		expect(config.keySource).toBe('devUser1')
	})

	it('parses flags', () => {
		const config = parseSeederArgs(
			['canonical', '--dry-run', '--verbose', '--only', 'sea-cables'],
			{},
		)
		expect(config.dryRun).toBe(true)
		expect(config.verbose).toBe(true)
		expect(config.only).toBe('sea-cables')
	})

	it('rejects unknown commands and flags', () => {
		expect(() => parseSeederArgs(['everything'], {})).toThrow(/Unknown command/)
		expect(() => parseSeederArgs(['full', '--yolo'], {})).toThrow(/Unknown flag/)
	})

	it('enforces the guard: remote relay without --allow-remote exits the parse', () => {
		expect(() => parseSeederArgs(['full', '--relay', 'wss://example.com'], {})).toThrow(
			/allow-remote/,
		)
		const config = parseSeederArgs(['full', '--relay', 'wss://example.com', '--allow-remote'], {})
		expect(config.relay).toBe('wss://example.com')
		expect(config.allowRemote).toBe(true)
	})

	it('resolves keys: --key > SEED_KEY > devUser1', () => {
		const hexA = 'a'.repeat(64)
		const hexB = 'b'.repeat(64)
		expect(parseSeederArgs(['full', '--key', hexA], { SEED_KEY: hexB }).keyHex).toBe(hexA)
		expect(parseSeederArgs(['full'], { SEED_KEY: hexB }).keySource).toBe('SEED_KEY')
		expect(parseSeederArgs(['full'], {}).keySource).toBe('devUser1')
	})

	it('honours APP_PRIVATE_KEY for canonical/purge only (back-compat)', () => {
		const hexC = 'c'.repeat(64)
		const env = { APP_PRIVATE_KEY: hexC }
		expect(parseSeederArgs(['canonical'], env).keyHex).toBe(hexC)
		expect(parseSeederArgs(['purge'], env).keySource).toBe('APP_PRIVATE_KEY')
		expect(parseSeederArgs(['full'], env).keySource).toBe('devUser1')
	})

	it('rejects non-hex keys', () => {
		expect(() => parseSeederArgs(['full', '--key', 'nsec1abc'], {})).toThrow(/hex/)
	})
})
