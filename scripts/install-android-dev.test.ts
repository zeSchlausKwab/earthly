import { describe, expect, test } from 'bun:test'
import { parseAdbDevices, tauriTargetForAbi } from './install-android-dev'

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
})
