/**
 * Maximum serialized public dataset content kept inline.
 *
 * The production relay's storage codec rejects event content at 65,535 bytes,
 * so 60 KiB leaves headroom for safe inline storage. Larger datasets use
 * external Blossom storage.
 */
export const MAX_INLINE_DATASET_CONTENT_BYTES = 60 * 1024
