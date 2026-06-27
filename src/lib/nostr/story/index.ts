/**
 * Story (kind 37520) data-layer barrel.
 *
 * The Story service wraps the Phase-8 `ArticleFactory` cast/factory: `lifecycle`
 * owns the publish/edit path that re-derives `a` tags from the Markdown body's
 * `nostr:naddr…` refs (STORY-03) and preserves the `d`-tag lineage on edit
 * (STORY-04); `draft` owns local-first draft persistence (Task 2). Panels in
 * Plans 02–03 import from here.
 */

export * from './lifecycle'
