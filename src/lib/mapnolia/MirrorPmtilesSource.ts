import { FetchSource, type RangeResponse, type Source } from 'pmtiles'

/**
 * Range source that keeps one PMTiles archive addressable across ordered
 * Blossom mirrors. A successful fallback becomes preferred until it fails.
 */
export class MirrorPmtilesSource implements Source {
	private preferredIndex = 0
	private readonly sources: FetchSource[]
	private readonly key: string

	constructor(
		readonly file: string,
		readonly mirrors: readonly string[],
	) {
		if (mirrors.length === 0) throw new Error('At least one PMTiles mirror is required')
		this.sources = mirrors.map((mirror) => new FetchSource(`${mirror.replace(/\/$/u, '')}/${file}`))
		this.key = `mirror-pmtiles://${mirrors.join('|')}/${file}`
	}

	getKey(): string {
		return this.key
	}

	async getBytes(
		offset: number,
		length: number,
		signal?: AbortSignal,
		_etag?: string,
	): Promise<RangeResponse> {
		const errors: string[] = []
		for (let step = 0; step < this.sources.length; step += 1) {
			if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
			const index = (this.preferredIndex + step) % this.sources.length
			const source = this.sources[index]
			if (!source) continue
			try {
				const response = await source.getBytes(offset, length, signal)
				this.preferredIndex = index
				// Mirror ETags are provider-specific. The content hash in the file name
				// is the cross-mirror identity, so do not leak one provider's ETag into
				// a later request to another provider.
				return { ...response, etag: undefined }
			} catch (error) {
				if (signal?.aborted) throw error
				errors.push(error instanceof Error ? error.message : String(error))
			}
		}
		throw new Error(
			`Every PMTiles mirror failed for ${this.file}${errors.length ? `: ${errors.join('; ')}` : ''}`,
		)
	}
}
