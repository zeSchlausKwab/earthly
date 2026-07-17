import { describe, expect, test } from 'bun:test'
import {
	instrumentationSucceeded,
	parseAndroidE2EOptions,
	shouldUseCleanInstall,
} from './android-e2e'

describe('Android E2E runner', () => {
	test('defaults to a clean emulator smoke run', () => {
		expect(parseAndroidE2EOptions([])).toMatchObject({
			command: 'smoke',
			build: true,
			preserveData: false,
			allowPhysical: false,
			headless: false,
			format: 'markdown',
		})
	})

	test('parses explicit runner controls', () => {
		expect(
			parseAndroidE2EOptions([
				'smoke',
				'--serial=emulator-5554',
				'--avd',
				'Earthly_API_36',
				'--no-build',
				'--preserve-data',
			]),
		).toMatchObject({
			command: 'smoke',
			serial: 'emulator-5554',
			avd: 'Earthly_API_36',
			build: false,
			preserveData: true,
		})
	})

	test('rejects malformed options and multiple commands', () => {
		expect(() => parseAndroidE2EOptions(['list', 'smoke'])).toThrow('Multiple commands')
		expect(() => parseAndroidE2EOptions(['--format', 'xml'])).toThrow(
			'--format must be markdown or json',
		)
		expect(() => parseAndroidE2EOptions(['--serial'])).toThrow('--serial requires a value')
	})

	test('recognizes successful and failed instrumentation output', () => {
		expect(instrumentationSucceeded('Time: 12.5\n\nOK (2 tests)\n')).toBe(true)
		expect(instrumentationSucceeded('FAILURES!!!\nTests run: 2, Failures: 1')).toBe(false)
		expect(instrumentationSucceeded('INSTRUMENTATION_FAILED')).toBe(false)
	})

	test('uses destructive clean installs only for disposable emulator builds', () => {
		const defaults = parseAndroidE2EOptions([])
		expect(shouldUseCleanInstall(defaults, 'emulator-5554')).toBe(true)
		expect(shouldUseCleanInstall(defaults, 'physical-phone')).toBe(false)
		expect(
			shouldUseCleanInstall(parseAndroidE2EOptions(['--preserve-data']), 'emulator-5554'),
		).toBe(false)
		expect(shouldUseCleanInstall(parseAndroidE2EOptions(['--no-build']), 'emulator-5554')).toBe(
			false,
		)
	})
})
