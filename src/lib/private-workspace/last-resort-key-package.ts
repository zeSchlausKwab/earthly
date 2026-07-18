import {
	defaultCapabilities,
	makeCustomExtension,
	type Capabilities,
	type CustomExtension,
	type KeyPackage,
} from 'ts-mls'

/**
 * Cordn follows the MLS App Data Dictionary profile for last-resort
 * KeyPackages. These packages are returned non-destructively by `kp_take`.
 */
export const APP_DATA_DICTIONARY_EXTENSION_TYPE = 0x0006
export const LAST_RESORT_KEY_PACKAGE_COMPONENT_ID = 0x0004

function encodeUint16(value: number): Uint8Array {
	return Uint8Array.from([(value >> 8) & 0xff, value & 0xff])
}

function decodeUint16(bytes: Uint8Array, offset: number): number {
	if (offset + 2 > bytes.length) throw new Error('Unexpected end of app data dictionary')
	const high = bytes[offset]
	const low = bytes[offset + 1]
	if (high === undefined || low === undefined) {
		throw new Error('Unexpected end of app data dictionary')
	}
	return (high << 8) | low
}

function encodeVarBytes(bytes: Uint8Array): Uint8Array {
	if (bytes.length < 64) return Uint8Array.from([bytes.length, ...bytes])
	if (bytes.length < 16_384) {
		return Uint8Array.from([0x40 | ((bytes.length >> 8) & 0x3f), bytes.length & 0xff, ...bytes])
	}
	throw new Error('App data dictionary entry is too large')
}

function decodeVarBytes(bytes: Uint8Array, offset: number): [Uint8Array, number] {
	if (offset >= bytes.length) throw new Error('Unexpected end of app data dictionary')
	const firstByte = bytes[offset]
	if (firstByte === undefined) throw new Error('Unexpected end of app data dictionary')
	const lengthFieldSize = 1 << ((firstByte & 0xc0) >> 6)
	if (offset + lengthFieldSize > bytes.length) {
		throw new Error('Unexpected end of app data dictionary length')
	}

	let length = firstByte & 0x3f
	for (let index = 1; index < lengthFieldSize; index += 1) {
		const byte = bytes[offset + index]
		if (byte === undefined) throw new Error('Unexpected end of app data dictionary length')
		length = (length << 8) | byte
	}
	const start = offset + lengthFieldSize
	const end = start + length
	if (end > bytes.length) throw new Error('Unexpected end of app data dictionary component')
	return [bytes.slice(start, end), end]
}

function createLastResortExtension(): CustomExtension {
	const dictionary = new Uint8Array([
		...encodeUint16(LAST_RESORT_KEY_PACKAGE_COMPONENT_ID),
		...encodeVarBytes(new Uint8Array()),
	])
	return makeCustomExtension({
		extensionType: APP_DATA_DICTIONARY_EXTENSION_TYPE,
		extensionData: encodeVarBytes(dictionary),
	})
}

export function createCordnLastResortKeyPackageOptions(): {
	capabilities: Capabilities
	extensions: CustomExtension[]
} {
	const capabilities = defaultCapabilities()
	return {
		capabilities: {
			...capabilities,
			extensions: [...new Set([...capabilities.extensions, APP_DATA_DICTIONARY_EXTENSION_TYPE])],
		},
		extensions: [createLastResortExtension()],
	}
}

export function isCordnLastResortKeyPackage(keyPackage: KeyPackage): boolean {
	return keyPackage.extensions.some((extension) => {
		if (extension.extensionType !== APP_DATA_DICTIONARY_EXTENSION_TYPE) return false
		try {
			const [dictionary, dictionaryEnd] = decodeVarBytes(extension.extensionData, 0)
			if (dictionaryEnd !== extension.extensionData.length) return false
			let offset = 0
			while (offset < dictionary.length) {
				const componentId = decodeUint16(dictionary, offset)
				const [componentData, nextOffset] = decodeVarBytes(dictionary, offset + 2)
				if (componentId === LAST_RESORT_KEY_PACKAGE_COMPONENT_ID && componentData.length === 0) {
					return true
				}
				offset = nextOffset
			}
			return false
		} catch {
			return false
		}
	})
}
