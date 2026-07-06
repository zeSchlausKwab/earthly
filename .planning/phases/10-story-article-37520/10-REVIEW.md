---
phase: 10-story-article-37520
reviewed: 2026-06-27T00:00:00Z
depth: standard
files_reviewed: 35
files_reviewed_list:
  - src/components/AppSidebar.tsx
  - src/components/GeoEditorInfoPanel.tsx
  - src/components/StoriesPanel.tsx
  - src/components/info-panel/StoryEditorPanel.tsx
  - src/components/info-panel/StoryViewPanel.tsx
  - src/components/info-panel/index.ts
  - src/features/geo-editor/GeoEditorView.tsx
  - src/features/geo-editor/components/MobilePanel.tsx
  - src/features/geo-editor/hooks/index.ts
  - src/features/geo-editor/hooks/useRouting.ts
  - src/features/geo-editor/hooks/useStoryEditor.ts
  - src/features/geo-editor/store/types.ts
  - src/features/geo-editor/store/viewModeSlice.ts
  - src/features/social/comments/CommentsPanel.tsx
  - src/features/social/comments/GeoSocialActions.tsx
  - src/features/social/hooks/acceptStoryProposal.ts
  - src/features/social/hooks/useGeoComments.ts
  - src/features/social/hooks/useStoryProposals.ts
  - src/features/social/proposals/StoryProposalsPanel.tsx
  - src/features/social/proposals/StoryProposeEditDialog.tsx
  - src/features/social/proposals/index.ts
  - src/index.ts
  - src/lib/hooks/useStories.ts
  - src/lib/nostr/geo-proposal/factory.ts
  - src/lib/nostr/geo-proposal/helpers.ts
  - src/lib/nostr/geo-proposal/storyProposal.test.ts
  - src/lib/nostr/story/draft.ts
  - src/lib/nostr/story/index.ts
  - src/lib/nostr/story/lifecycle.test.ts
  - src/lib/nostr/story/lifecycle.ts
  - src/lib/og/cache.ts
  - src/lib/og/fetchEvent.ts
  - src/lib/og/index.ts
  - src/lib/og/template.ts
findings:
  critical: 2
  warning: 5
  info: 4
  total: 11
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-06-27
**Depth:** standard
**Files Reviewed:** 35
**Status:** issues_found

## Summary

Phase 10 ships the Story (kind 37520) author/read/propose feature on top of the
Phase-8 `ArticleFactory`. The body→`a`-tag re-derivation (`story/lifecycle.ts`),
the proposal accept path, and the in-app render surfaces are well-defended: the
narrative renders ONLY through the sanitized `RichContentRenderer` (no
`dangerouslySetInnerHTML`), covers render as plain `<img src>`, and the lifecycle
service re-derives `a` tags destructively on every publish with malformed refs
silently excluded. The unit tests pin those behaviours.

The defect concentration is in the **server-side OG card path** (`src/lib/og/*`,
`src/index.ts`), which the in-app sanitization does NOT cover. The new
`fetchStoryOGData` extracts the attacker-controlled `image`/`title`/`summary`
fields from untrusted Story event content and threads `image` into two sinks that
do not defend against it: the HTML `generateOGHtml` template interpolates `image`
(and `url`) into attributes WITHOUT escaping (CR-01), and the same `image` URL is
server-side `fetch`ed with no allowlist when composing the PNG card (CR-02, SSRF).
Both are reachable by an unauthenticated crawler hitting `/story/:naddr` or
`/og/image/story/:naddr` for any published Story. The remaining findings are
robustness/quality issues.

Note: CR-01 and CR-02 are not strictly new to Phase 10 — the geoevent/context OG
paths already routed an untrusted `image`/`url` through the same template and
`fetchImageAsBase64`. But Phase 10 newly funnels Story `content.image` (the most
directly attacker-authored field of the new entity) into both sinks, and the
`generateStoryOGHtml` doc comment explicitly claims the escaping path is
"audited" — so the defect is in-scope for this review and should be fixed here.

## Critical Issues

### CR-01: OG HTML template interpolates `image` and `url` WITHOUT escaping — attribute/script injection for crawlers

**File:** `src/lib/og/template.ts:43-66` (sinks); reached via `src/lib/og/fetchEvent.ts:213-216` + `src/index.ts:155-167`

**Issue:** `generateOGHtml` escapes only `title` and `description`. The `image`
and `url` fields are interpolated raw:

```
<meta property="og:image" content="${image}">          // line 47, raw
<meta property="twitter:image" content="${image}">     // line 55, raw
<meta http-equiv="refresh" content="0;url=${url}">     // line 58, raw
<script>window.location.href = "${url}";</script>      // line 66, raw — JS context
```

For a Story, `image` comes straight from untrusted event content
(`fetchStoryOGData` reads `content.image` / the `image` tag, `fetchEvent.ts:200`
and `:213-216`) and is passed through `generateStoryOGHtml(..., data?.image)`
(`index.ts:162`) into the template with no validation. A Story author can set
`image` to e.g. `"><script>…</script>` or `x" onerror=…` to break out of the
`content="…"` attribute, or inject into the `window.location.href = "…"` JS string
sink. The `url` sink is also raw: `getBaseUrl` derives the host from the
attacker-influenceable `Host` header (`index.ts:46-49`) and reflects it into both
a `<script>` string and a meta-refresh. This HTML is served to social-media
crawlers (and any client that requests the route with a crawler UA), making it a
stored XSS / HTML-injection against anything that renders the unfurl as HTML.

The `generateStoryOGHtml` doc comment (`template.ts:127-130`) asserts it "reuses
the audited generateOGHtml escaping path … no new escaping logic invented" — but
that path never escaped `image` or `url`, so the claim is false.

**Fix:** Escape every interpolated value, and additionally validate `image`/`url`
as http(s) URLs (reject `javascript:`/`data:` and non-URL strings) before
emitting. For the JS sink, JSON-encode rather than string-quote:

```ts
function safeHttpUrl(raw: string | undefined, fallback: string): string {
	if (!raw) return fallback
	try {
		const u = new URL(raw)
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback
		return u.toString()
	} catch {
		return fallback
	}
}

const safeImage = escapeHtml(safeHttpUrl(image, DEFAULT_IMAGE))
const safeUrl = escapeHtml(safeHttpUrl(url, '/'))
// meta tags use safeImage / safeUrl
// JS sink: window.location.href = ${JSON.stringify(safeHttpUrl(url, '/'))}
```

### CR-02: SSRF — untrusted Story `image` URL is server-side fetched with no scheme/host allowlist

**File:** `src/lib/og/renderImage.ts:63-78` (`fetchImageAsBase64`); reached via `src/index.ts:221-232` (`handleOGImageRoute` story branch) with `backgroundImageUrl: data?.image`

**Issue:** `handleOGImageRoute` (`type === 'story'`) passes the untrusted
`data?.image` (extracted by `fetchStoryOGData` from event content) into
`generateOGImagePNG({ ..., backgroundImageUrl: data?.image })`, which calls
`fetchImageAsBase64(url)` — a raw `fetch(url)` against an attacker-controlled URL
with no allowlist on scheme or host. An attacker publishes a Story whose `image`
is e.g. `http://169.254.169.254/latest/meta-data/…` or an internal service URL;
when any crawler (or anyone) requests `/og/image/story/:naddr`, the production
server makes that request from inside its network. The response is base64-inlined
into the SVG, so a permissive content-type also gives a limited read-back channel.
The 6s timeout and User-Agent header do not mitigate the SSRF.

`renderImage.ts` is not in the Phase 10 file list, but Phase 10's `fetchStoryOGData`
+ `handleOGImageRoute` story branch are the new code that drives untrusted Story
content into this sink, so it must be remediated as part of this phase.

**Fix:** Validate `backgroundImageUrl` before fetching: require `https:` (or an
explicit blob/CDN host allowlist), resolve and reject private/loopback/link-local
IP ranges, and disable redirects (`redirect: 'error'`) so a public URL can't 302
to an internal one:

```ts
const u = new URL(url)
if (u.protocol !== 'https:') return null
// reject 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7, etc.
const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(6000), headers: {...} })
```

## Warnings

### WR-01: `acceptStoryProposalImpl` never verifies the proposal targets THIS Story (or kind 37520) before republishing it as the owner's content

**File:** `src/features/social/hooks/acceptStoryProposal.ts:29-51`; caller `src/features/social/hooks/useStoryProposals.ts:134-147`

**Issue:** `acceptStoryProposalImpl(storyEvent, proposalEvent, signer)` takes the
proposal's raw `content` and republishes it verbatim as the owner's Story body via
`editStory`, with no check that `getProposalTargetAddress(proposalEvent)` actually
equals `storyEvent`'s `37520:<owner>:<d>` coordinate, nor that
`getProposalTargetKind(proposalEvent) === ARTICLE_KIND`. The subscription filter in
`useStoryProposals` (`#a` = the story coordinate) is the only thing keeping a
mismatched proposal out of the accept call — a filter is a discovery convenience,
not an integrity check. If the accept handler is ever invoked with a proposal
object obtained another way (re-render race, future caller, test), the owner would
sign arbitrary content onto their own Story. The author is shown a sanitized diff,
but they are signing the raw Markdown, not the sanitized render.

**Fix:** In `acceptStoryProposalImpl`, assert the proposal's target coordinate
matches the story before calling `editStory`:

```ts
const targetAddr = getProposalTargetAddress(proposalEvent)
const storyD = storyEvent.tags.find((t) => t[0] === 'd')?.[1]
const expected = `${ARTICLE_KIND}:${storyEvent.pubkey}:${storyD}`
if (!targetAddr || targetAddr !== expected) {
	throw new Error('Proposal does not target this story.')
}
```

### WR-02: `useStoryProposals` accept ignores the `isActing` guard — double-accept / concurrent-accept possible

**File:** `src/features/social/hooks/useStoryProposals.ts:134-147`

**Issue:** `acceptStoryProposal` sets `setIsActing(true)` only inside its own body;
nothing prevents it from being entered again while a previous accept is still in
flight (`isActing` is not checked at entry, and the UI button is not disabled on
`isLoading` in `StoryProposalsPanel` — the Accept button at lines 149-157 has no
`disabled`). A fast double-click republishes the Story twice and emits two
`applied` status events. Same applies to `rejectStoryProposal`.

**Fix:** Guard at entry (`if (isActing) return`) and/or pass `isLoading` down to
disable the Accept/Reject buttons in `StoryProposalsPanel`.

### WR-03: OG SQLite cache persists with NO eviction bound and only purges expired rows at startup

**File:** `src/lib/og/cache.ts:64-91, 140-166`

**Issue:** `persistCachedRecord` writes one row per `(type, naddr)` forever. The
only deletion of stale rows is the one-time `DELETE FROM og_cache WHERE stale_until
< ?` at DB-open (`cache.ts:83`); after that, expired rows are read and refreshed in
place but never deleted, and `inMemoryCache` (`cache.ts:55`) is an unbounded `Map`
that grows for the process lifetime. An attacker can publish unlimited distinct
Stories (each a new `naddr`) and have a crawler request each `/story/:naddr`,
growing both the SQLite file and the in-memory map without bound. Given the
project's documented history of a disk-full crash-loop (CLAUDE memory:
"VPS crash root cause … disk-full"), unbounded crawler-driven cache growth is a
real availability risk.

**Fix:** Bound `inMemoryCache` (LRU with a max entry count) and run the
`stale_until < now` purge periodically (or opportunistically on write), not only
at open.

### WR-04: `fetchEventFromRelay` resolves on the FIRST event without verifying it is the latest replaceable version

**File:** `src/lib/og/fetchEvent.ts:43-87, 180-186`

**Issue:** The OG fetch sends a REQ and resolves with `data[2]` on the first
`EVENT` frame (`fetchEvent.ts:67-71`), then closes. For a parameterized-replaceable
kind (37520), a relay may stream an older version before the newest, or multiple
versions; taking the first arrival can surface a stale title/summary/image in the
unfurl. There is no `created_at` comparison across received events and no wait for
EOSE before choosing. (The in-app `useStories` path correctly relies on the
EventStore's replaceable semantics; this server path does not.)

**Fix:** Accumulate EVENTs until EOSE (or the timeout) and resolve with the highest
`created_at`, rather than resolving on first EVENT.

### WR-05: `getBaseUrl` trusts the request `Host` header — reflected into OG output and self-redirects

**File:** `src/index.ts:46-49`, consumed throughout `handleStoryRoute`/`handleGeoEventRoute`/`handleContextRoute`

**Issue:** `getBaseUrl` builds the canonical URL from `new URL(req.url).host`, which
reflects the client-supplied `Host` header. That value is then used to build every
`og:url`, the `<meta refresh>` target, the `window.location.href` redirect, and the
`og:image` fallback URL. Beyond feeding CR-01's injection sink, a spoofed Host
enables open-redirect / cache-poisoning of the unfurl (the crawler is told the
canonical URL lives on an attacker host). 

**Fix:** Derive the base URL from a trusted configured origin (e.g.
`serverConfig`), not from the inbound Host header; or validate Host against an
allowlist before use.

## Info

### IN-01: `decodeNaddr` does not constrain the decoded `kind`/`pubkey`, but callers do — note for defense-in-depth

**File:** `src/lib/og/fetchEvent.ts:172-186`

**Issue:** `fetchStoryOGData` correctly rejects `decoded.kind !== ARTICLE_KIND`
(`fetchEvent.ts:178`), so a cross-kind naddr won't be fetched. Fine as-is; noted
only because `decodeNaddr` itself returns whatever `nip19.decode` yields and a
future caller could forget the kind guard.

**Fix:** Optionally accept an `expectedKind` param in `decodeNaddr` to centralize
the guard.

### IN-02: `StoriesPanel` "Copy link" copies a bare coordinate, not a shareable URL — and the doc comment admits it

**File:** `src/components/StoriesPanel.tsx:204-209`

**Issue:** `handleCopyLink` copies `${story.kind}:${story.pubkey}:${story.dTag}` to
the clipboard. The comment says Plan 03 wires the canonical `/story/:naddr` deep
link, but the routing IS shipped in this phase (`useRouting` parses `/story/...`,
`GeoSocialActions.buildSharePath` already builds a real story share URL). A user
clicking "Copy link" gets an unusable coordinate string, not a link.

**Fix:** Build the share URL the same way `buildSharePath` does
(`/story/${naddr}` via `nip19.naddrEncode`), matching the GeoSocialActions Share
action.

### IN-03: `formatRelativeDate`/`formatTimeAgo` duplicated across at least three Story files

**File:** `src/components/StoriesPanel.tsx:63-75`, `src/components/info-panel/StoryViewPanel.tsx:52-64`, `src/features/social/proposals/StoryProposalsPanel.tsx:39-51`

**Issue:** Three near-identical relative-time formatters (StoryViewPanel even
computes `diffHours` from `diffMins` while the others use ms divisors). Drift risk
and maintenance overhead.

**Fix:** Extract one shared `formatRelativeTime(createdAt?: number)` helper.

### IN-04: `StoryRow` key falls back to `story.id` while the Draft-detection map keys on `dTag` only

**File:** `src/components/StoriesPanel.tsx:199-200, 251-256`

**Issue:** `draftKeys` is built only from `story.dTag` (`:199`), and `hasLocalDraft`
is `Boolean(story.dTag && draftKeys.has(story.dTag))` (`:256`) — correct. But the
row `key` is `story.dTag ?? story.id` (`:251`). A published Article should always
have a `d` tag (it's parameterized-replaceable), so this is benign today; flagged
only because a 37520 event without a `d` tag would silently never show a Draft
badge and key off `id`. `useStories`'s `isArticle` filter likely already excludes
d-less events — worth confirming.

**Fix:** None required if `isArticle` guarantees a `d` tag; otherwise filter d-less
Stories out of the browse list explicitly.

---

_Reviewed: 2026-06-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
