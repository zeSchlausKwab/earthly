import { FetchSource, type RangeResponse, type Source } from 'pmtiles'

export interface LocalPmtilesAccess {
	url: string
	authorization: string
	expiresAt: number
}

export type LocalPmtilesAccessProvider = () => Promise<LocalPmtilesAccess | null>

class AuthenticatedLocalPmtilesSource implements Source {
	private access: LocalPmtilesAccess | null = null
	private unavailableUntil = 0

	constructor(
		private readonly key: string,
		private readonly provider: LocalPmtilesAccessProvider,
	) {}

	getKey(): string {
		return this.key
	}

	private async source(forceRefresh: boolean): Promise<FetchSource> {
		if (
			forceRefresh ||
			!this.access ||
			this.access.expiresAt <= Math.floor(Date.now() / 1_000) + 30
		) {
			this.access = await this.provider()
		}
		if (!this.access) throw new Error('The local Blossom node is not ready')
		return new FetchSource(
			this.access.url,
			new Headers({ authorization: this.access.authorization }),
		)
	}

	async getBytes(
		offset: number,
		length: number,
		signal?: AbortSignal,
		etag?: string,
	): Promise<RangeResponse> {
		if (Date.now() < this.unavailableUntil) {
			throw new Error('The PMTiles archive is not present in local Blossom yet')
		}
		try {
			const response = await (await this.source(false)).getBytes(offset, length, signal, etag)
			this.unavailableUntil = 0
			return response
		} catch (error) {
			if (signal?.aborted) throw error
			const previousUrl = this.access?.url
			this.access = null
			const refreshed = await this.source(true)
			if (this.access?.url === previousUrl) {
				this.unavailableUntil = Date.now() + 5_000
				throw error
			}
			return refreshed.getBytes(offset, length, signal, etag)
		}
	}
}

/**
 * Range source that keeps one PMTiles archive addressable across ordered
 * Blossom mirrors. A successful fallback becomes preferred until it fails.
 */
export class MirrorPmtilesSource implements Source {
	private preferredMirrorIndex = 0
	private readonly localSource?: Source
	private readonly mirrorSources: FetchSource[]
	private readonly key: string

	constructor(
		readonly file: string,
		readonly mirrors: readonly string[],
		readonly preferredLocal?: string | LocalPmtilesAccessProvider,
	) {
		if (mirrors.length === 0) throw new Error('At least one PMTiles mirror is required')
		this.localSource =
			typeof preferredLocal === 'string'
				? new FetchSource(preferredLocal)
				: preferredLocal
					? new AuthenticatedLocalPmtilesSource(`local-pmtiles://${file}`, preferredLocal)
					: undefined
		this.mirrorSources = mirrors.map(
			(mirror) => new FetchSource(`${mirror.replace(/\/$/u, '')}/${file}`),
		)
		this.key = `mirror-pmtiles://${this.localSource?.getKey() ?? ''}|${mirrors.join('|')}/${file}`
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
		if (this.localSource) {
			try {
				const response = await this.localSource.getBytes(offset, length, signal)
				return { ...response, etag: undefined }
			} catch (error) {
				if (signal?.aborted) throw error
				errors.push(error instanceof Error ? error.message : String(error))
			}
		}

		for (let step = 0; step < this.mirrorSources.length; step += 1) {
			if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
			const index = (this.preferredMirrorIndex + step) % this.mirrorSources.length
			const source = this.mirrorSources[index]
			if (!source) continue
			try {
				const response = await source.getBytes(offset, length, signal)
				this.preferredMirrorIndex = index
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
