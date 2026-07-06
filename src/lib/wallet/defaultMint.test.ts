import { describe, expect, test } from 'bun:test'
import { normalizeDefaultMint, resolveWalletPaymentMint } from './defaultMint'

const snapshot = {
	mints: ['https://mint-a.example', 'https://mint-b.example', 'https://mint-c.example'],
	balance: {
		'https://mint-a.example': 0,
		'https://mint-b.example': 25,
		'https://mint-c.example': 100,
	},
}

describe('normalizeDefaultMint', () => {
	test('treats blank values as unset', () => {
		expect(normalizeDefaultMint(null)).toBeNull()
		expect(normalizeDefaultMint('   ')).toBeNull()
		expect(normalizeDefaultMint(' https://mint.example ')).toBe('https://mint.example')
	})
})

describe('resolveWalletPaymentMint', () => {
	test('uses the configured default mint when it belongs to the wallet', () => {
		expect(
			resolveWalletPaymentMint(snapshot, {
				defaultMint: 'https://mint-b.example',
				amountSats: 50,
			}),
		).toEqual({
			mint: 'https://mint-b.example',
			balance: 25,
			defaultMint: 'https://mint-b.example',
			source: 'default',
		})
	})

	test('falls back to a mint that can cover the amount when no default is selected', () => {
		expect(resolveWalletPaymentMint(snapshot, { amountSats: 50 })).toEqual({
			mint: 'https://mint-c.example',
			balance: 100,
			defaultMint: null,
			source: 'fallback',
		})
	})

	test('ignores a stale default mint that is no longer configured on the wallet', () => {
		expect(
			resolveWalletPaymentMint(snapshot, {
				defaultMint: 'https://stale.example',
				amountSats: 50,
			}),
		).toEqual({
			mint: 'https://mint-c.example',
			balance: 100,
			defaultMint: 'https://stale.example',
			source: 'fallback',
		})
	})
})
