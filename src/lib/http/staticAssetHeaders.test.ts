import { describe, expect, test } from 'bun:test'
import {
	getBuiltFileHeaders,
	getMissingAssetHeaders,
	isBrowserAssetPath,
	isContentHashedAsset,
} from './staticAssetHeaders'

describe('static browser asset headers', () => {
	test('recognizes Bun content-hashed assets', () => {
		expect(isContentHashedAsset('/chunk-qg227y2w.js')).toBe(true)
		expect(isContentHashedAsset('/assets/favicon-47nf3r86.ico')).toBe(true)
		expect(isContentHashedAsset('/assets/site-emrv2d2s.webmanifest')).toBe(true)
		expect(isContentHashedAsset('/workers/geo-json-parse.worker.js')).toBe(false)
		expect(isContentHashedAsset('/index.html')).toBe(false)
	})

	test('keeps hashed chunks immutable and correctly typed', () => {
		expect(getBuiltFileHeaders('/chunk-qg227y2w.js')).toEqual({
			'X-Content-Type-Options': 'nosniff',
			'Content-Type': 'text/javascript; charset=utf-8',
			'Cache-Control': 'public, max-age=31536000, immutable',
		})
	})

	test('never caches the SPA entry document', () => {
		expect(getBuiltFileHeaders('/index.html')).toEqual({
			'X-Content-Type-Options': 'nosniff',
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
		})
	})

	test('requires stable worker URLs to revalidate', () => {
		expect(getBuiltFileHeaders('/workers/sandbox.worker.js')['Cache-Control']).toBe('no-cache')
		expect(getBuiltFileHeaders('/emscripten-module.wasm')['Cache-Control']).toBe('no-cache')
	})

	test('applies the same revalidation and nosniff policy to stable public assets', () => {
		expect(getBuiltFileHeaders('/static/og-default.png')).toEqual({
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'no-cache',
		})
		expect(getBuiltFileHeaders('/static/preview-deadbeef.png')['Cache-Control']).toBe('no-cache')
	})

	test('marks asset misses as no-store without classifying deep links as assets', () => {
		expect(getMissingAssetHeaders()).toEqual({
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
		})
		expect(isBrowserAssetPath('/assets/chunk-qg227y2w.js')).toBe(true)
		expect(isBrowserAssetPath('/workers/geo-json-parse.worker.js')).toBe(true)
		expect(isBrowserAssetPath('/story/naddr1example')).toBe(false)
		expect(isBrowserAssetPath('/datasets')).toBe(false)
		expect(isBrowserAssetPath('/datasets?ms=example')).toBe(false)
		expect(isBrowserAssetPath('/tour')).toBe(false)
	})
})
