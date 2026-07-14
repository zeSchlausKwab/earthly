import { describe, expect, test } from 'bun:test'
import type { KeyPackage } from 'ts-mls'
import {
	APP_DATA_DICTIONARY_EXTENSION_TYPE,
	createCordnLastResortKeyPackageOptions,
	isCordnLastResortKeyPackage,
} from './last-resort-key-package'

describe('Cordn last-resort KeyPackage profile', () => {
	test('advertises and encodes the App Data Dictionary component', () => {
		const options = createCordnLastResortKeyPackageOptions()

		expect(options.capabilities.extensions).toContain(APP_DATA_DICTIONARY_EXTENSION_TYPE)
		expect(options.extensions).toHaveLength(1)
		expect(options.extensions[0]?.extensionType).toBe(APP_DATA_DICTIONARY_EXTENSION_TYPE)
		expect([...new Uint8Array(options.extensions[0]?.extensionData ?? [])]).toEqual([3, 0, 4, 0])
		expect(isCordnLastResortKeyPackage({ extensions: options.extensions } as KeyPackage)).toBe(true)
	})

	test('does not mistake another app dictionary component for last-resort', () => {
		const options = createCordnLastResortKeyPackageOptions()
		const extension = options.extensions[0]
		expect(extension).toBeDefined()
		if (!extension) return

		expect(
			isCordnLastResortKeyPackage({
				extensions: [{ ...extension, extensionData: Uint8Array.from([3, 0, 5, 0]) }],
			} as KeyPackage),
		).toBe(false)
	})
})
