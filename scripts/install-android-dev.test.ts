import { describe, expect, test } from 'bun:test'
import {
	needsOptimizedFallback,
	parseAdbDevices,
	parseInstallOptions,
	tauriTargetForAbi,
} from './install-android-dev'

describe('Android development installer', () => {
	test('parses USB, Wi-Fi, offline, and unauthorized ADB entries', () => {
		const devices = parseAdbDevices(`
List of devices attached
2449fb0240017ece device usb:0-1 product:star2ltexx model:SM_G965F transport_id:17
adb-Pixel._adb-tls-connect._tcp device product:husky model:Pixel_8 transport_id:18
192.168.1.20:5555 offline transport_id:19
emulator-5554 unauthorized transport_id:20
`)

		expect(devices.map(({ serial, state }) => ({ serial, state }))).toEqual([
			{ serial: '2449fb0240017ece', state: 'device' },
			{ serial: 'adb-Pixel._adb-tls-connect._tcp', state: 'device' },
			{ serial: '192.168.1.20:5555', state: 'offline' },
			{ serial: 'emulator-5554', state: 'unauthorized' },
		])
	})

	test('maps Android ABIs to Tauri Rust targets', () => {
		expect(tauriTargetForAbi('arm64-v8a\n')).toBe('aarch64')
		expect(tauriTargetForAbi('armeabi-v7a')).toBe('armv7')
		expect(tauriTargetForAbi('x86')).toBe('i686')
		expect(tauriTargetForAbi('x86_64')).toBe('x86_64')
		expect(tauriTargetForAbi('riscv64')).toBeUndefined()
	})

	test('parses optimized and debug-only modes and rejects conflicts', () => {
		expect(parseInstallOptions([])).toEqual({
			optimized: false,
			debugOnly: false,
			help: false,
			serials: [],
		})
		expect(parseInstallOptions(['--optimized'])).toEqual({
			optimized: true,
			debugOnly: false,
			help: false,
			serials: [],
		})
		expect(parseInstallOptions(['--debug-only'])).toEqual({
			optimized: false,
			debugOnly: true,
			help: false,
			serials: [],
		})
		expect(() => parseInstallOptions(['--optimized', '--debug-only'])).toThrow()
		expect(() => parseInstallOptions(['--mystery'])).toThrow('Unknown option')
	})

	test('targets one or more explicit ADB serials', () => {
		expect(
			parseInstallOptions([
				'--serial',
				'emulator-5554',
				'--serial=adb-Pixel._adb-tls-connect._tcp',
			]),
		).toEqual({
			optimized: false,
			debugOnly: false,
			help: false,
			serials: ['emulator-5554', 'adb-Pixel._adb-tls-connect._tcp'],
		})
		expect(() => parseInstallOptions(['--serial'])).toThrow(
			'--serial requires an ADB device serial',
		)
		expect(() => parseInstallOptions(['--serial='])).toThrow(
			'--serial requires an ADB device serial',
		)
	})

	test('retries only Android installer storage failures with an optimized APK', () => {
		expect(needsOptimizedFallback('Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]')).toBe(true)
		expect(needsOptimizedFallback('Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]')).toBe(false)
	})
})
