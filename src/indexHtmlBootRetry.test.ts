import { describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'

interface BootCoordinator {
	captureTemplate(): unknown
	clearReloadGuard(): void
	entryModuleFailed(): void
	reloadOnce(): boolean
	showFailure(title: string, detail: string): void
}

interface BootHarness {
	boot: {
		state: string | null
	}
	coordinator: BootCoordinator
	clearRoot(): void
	dispatchEntryModuleError(): void
	dispatchNonEntryResourceError(): void
	getReloadCount(): number
	hasBootElement(): boolean
	hasEntryErrorGuard(): boolean
	getStoredRetry(): string | null
	retry: {
		focusCount: number
		hidden: boolean
		onclick: (() => void) | null
	}
	title: { textContent: string }
}

const indexHtml = await Bun.file(new URL('./index.html', import.meta.url)).text()
const parsed = parseHTML(indexHtml).document
const guardElement = parsed.querySelector<HTMLScriptElement>('script[data-earthly-boot-guard]')
const guardSource = guardElement?.textContent

function createHarness(initialRetry: string | null = null, storageThrows = false): BootHarness {
	let storedRetry = initialRetry
	let reloadCount = 0
	const title = { textContent: '' }
	const detail = { textContent: '' }
	const retry = {
		focusCount: 0,
		hidden: true,
		onclick: null as (() => void) | null,
		focus() {
			this.focusCount += 1
		},
	}
	const boot = {
		state: null as string | null,
		cloneNode() {
			return this
		},
		querySelector(selector: string) {
			if (selector === '[data-earthly-boot-title]') return title
			if (selector === '[data-earthly-boot-detail]') return detail
			if (selector === '[data-earthly-boot-retry]') return retry
			return null
		},
		setAttribute(name: string, value: string) {
			if (name === 'data-state') this.state = value
		},
	}
	let mountedBoot: typeof boot | null = boot
	const root = {
		replaceChildren(nextBoot: typeof boot) {
			mountedBoot = nextBoot
		},
	}
	const document = {
		readyState: 'complete',
		addEventListener() {},
		getElementById() {
			return root
		},
		querySelector(selector: string) {
			return selector === '[data-earthly-boot]' ? mountedBoot : null
		},
	}
	const window = {
		entryErrorHandler: null as ((event: { target: unknown }) => void) | null,
		addEventListener(
			type: string,
			handler: (event: { target: unknown }) => void,
			capture: boolean,
		) {
			if (type === 'error' && capture) this.entryErrorHandler = handler
		},
		location: {
			reload() {
				reloadCount += 1
			},
		},
		removeEventListener(
			type: string,
			handler: (event: { target: unknown }) => void,
			capture: boolean,
		) {
			if (type === 'error' && capture && this.entryErrorHandler === handler) {
				this.entryErrorHandler = null
			}
		},
		sessionStorage: {
			getItem() {
				if (storageThrows) throw new Error('storage unavailable')
				return storedRetry
			},
			removeItem() {
				if (storageThrows) throw new Error('storage unavailable')
				storedRetry = null
			},
			setItem(_key: string, value: string) {
				if (storageThrows) throw new Error('storage unavailable')
				storedRetry = value
			},
		},
		__earthlyBoot: undefined as BootCoordinator | undefined,
	}

	if (!guardSource) throw new Error('index.html boot guard was not found')
	new Function('window', 'document', guardSource)(window, document)
	if (!window.__earthlyBoot) throw new Error('index.html boot coordinator was not installed')

	return {
		boot,
		coordinator: window.__earthlyBoot,
		clearRoot: () => {
			mountedBoot = null
		},
		dispatchEntryModuleError: () => {
			window.entryErrorHandler?.({
				target: { src: 'https://earthly.test/chunk-entry.js', tagName: 'SCRIPT', type: 'module' },
			})
		},
		dispatchNonEntryResourceError: () => {
			window.entryErrorHandler?.({
				target: { src: 'https://earthly.test/missing.png', tagName: 'IMG' },
			})
		},
		getReloadCount: () => reloadCount,
		getStoredRetry: () => storedRetry,
		hasBootElement: () => mountedBoot !== null,
		hasEntryErrorGuard: () => window.entryErrorHandler !== null,
		retry,
		title,
	}
}

describe('index.html entry-module retry guard', () => {
	test('installs the guard before a deferred entry module', () => {
		const entry = parsed.querySelector<HTMLScriptElement>(
			'script[type="module"][src="./frontend.tsx"]',
		)
		const scripts = Array.from(parsed.querySelectorAll<HTMLScriptElement>('script'))
		expect(entry).not.toBeNull()
		expect(scripts.indexOf(guardElement as HTMLScriptElement)).toBeLessThan(
			scripts.indexOf(entry as HTMLScriptElement),
		)
		expect(entry?.hasAttribute('async')).toBe(false)
		expect(entry?.hasAttribute('onerror')).toBe(false)
		expect(createHarness().hasEntryErrorGuard()).toBe(true)
	})

	test('ignores resource failures that are not module entry scripts', () => {
		const harness = createHarness()

		harness.dispatchNonEntryResourceError()

		expect(harness.getReloadCount()).toBe(0)
		expect(harness.getStoredRetry()).toBeNull()
		expect(harness.boot.state).toBeNull()
	})

	test('fails closed to the visible retry when session storage is unavailable', () => {
		const harness = createHarness(null, true)

		harness.coordinator.entryModuleFailed()

		expect(harness.getReloadCount()).toBe(0)
		expect(harness.boot.state).toBe('error')
		expect(harness.retry.hidden).toBe(false)
	})

	test('restores the boot shell after React clears the root on a fatal render', () => {
		const harness = createHarness()
		harness.coordinator.captureTemplate()
		harness.clearRoot()

		harness.coordinator.showFailure('Render failed', 'Retry safely')

		expect(harness.hasBootElement()).toBe(true)
		expect(harness.boot.state).toBe('error')
		expect(harness.title.textContent).toBe('Render failed')
		expect(harness.retry.hidden).toBe(false)
	})

	test('automatically reloads the same URL only once per boot', () => {
		const firstFailure = createHarness()
		firstFailure.dispatchEntryModuleError()

		expect(firstFailure.getStoredRetry()).toBe('1')
		expect(firstFailure.getReloadCount()).toBe(1)
		expect(firstFailure.boot.state).toBeNull()

		const secondFailure = createHarness(firstFailure.getStoredRetry())
		secondFailure.dispatchEntryModuleError()

		expect(secondFailure.getReloadCount()).toBe(0)
		expect(secondFailure.boot.state).toBe('error')
		expect(secondFailure.title.textContent).toBe('Earthly could not load the app file')
		expect(secondFailure.retry.hidden).toBe(false)

		secondFailure.retry.onclick?.()
		expect(secondFailure.getReloadCount()).toBe(1)
	})

	test('allows a completed boot to reset the shared retry budget', () => {
		const harness = createHarness('1')
		harness.coordinator.clearReloadGuard()

		expect(harness.getStoredRetry()).toBeNull()
		expect(harness.hasEntryErrorGuard()).toBe(false)
		expect(harness.coordinator.reloadOnce()).toBe(true)
		expect(harness.getReloadCount()).toBe(1)
	})
})
