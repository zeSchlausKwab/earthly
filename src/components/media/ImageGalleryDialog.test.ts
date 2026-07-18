import { describe, expect, test } from 'bun:test'
import { usableGalleryImages } from './ImageGalleryDialog'

describe('usableGalleryImages', () => {
	test('keeps the first image as primary and preserves attachment order', () => {
		expect(
			usableGalleryImages([
				{ url: 'https://blossom.example/primary.jpg', alt: 'Primary' },
				{ url: 'https://blossom.example/detail.jpg', alt: 'Detail' },
			]),
		).toEqual([
			{ url: 'https://blossom.example/primary.jpg', alt: 'Primary' },
			{ url: 'https://blossom.example/detail.jpg', alt: 'Detail' },
		])
	})

	test('drops blank and duplicate attachment URLs', () => {
		expect(
			usableGalleryImages([
				{ url: '  ' },
				{ url: ' https://blossom.example/photo.jpg ', alt: 'First label wins' },
				{ url: 'https://blossom.example/photo.jpg', alt: 'Duplicate' },
				{},
			]),
		).toEqual([{ url: 'https://blossom.example/photo.jpg', alt: 'First label wins' }])
	})
})
