/**
 * Maximum serialized public dataset content kept inline.
 *
 * Earthly's relay accepts and advertises event content up to 1 MiB. Larger
 * datasets use external Blossom storage.
 */
export const MAX_INLINE_DATASET_CONTENT_BYTES = 1024 * 1024
