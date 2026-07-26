import { describe, expect, test } from 'bun:test'
import {
	assertPublicHttpUrl,
	isBlockedPublicRemoteIPv4,
	isBlockedPublicRemoteIPv6,
} from './publicRemote'

describe('public OG remote URL validation', () => {
	test('rejects local, private, metadata, and authenticated URLs', async () => {
		expect(await assertPublicHttpUrl('http://127.0.0.1/blob')).toBeNull()
		expect(await assertPublicHttpUrl('http://10.0.0.2/blob')).toBeNull()
		expect(await assertPublicHttpUrl('http://169.254.169.254/latest/meta-data')).toBeNull()
		expect(await assertPublicHttpUrl('http://[::ffff:7f00:1]/blob')).toBeNull()
		expect(await assertPublicHttpUrl('http://user:password@example.com/blob')).toBeNull()
		expect(await assertPublicHttpUrl('file:///etc/passwd')).toBeNull()
	})

	test('classifies reserved IPv4 and IPv6 address ranges', () => {
		expect(isBlockedPublicRemoteIPv4('192.168.1.10')).toBe(true)
		expect(isBlockedPublicRemoteIPv4('8.8.8.8')).toBe(false)
		expect(isBlockedPublicRemoteIPv6('::1')).toBe(true)
		expect(isBlockedPublicRemoteIPv6('fd00::1')).toBe(true)
		expect(isBlockedPublicRemoteIPv6('::ffff:7f00:1')).toBe(true)
		expect(isBlockedPublicRemoteIPv6('::ffff:127.0.0.1')).toBe(true)
		expect(isBlockedPublicRemoteIPv6('2606:4700:4700::1111')).toBe(false)
	})
})
