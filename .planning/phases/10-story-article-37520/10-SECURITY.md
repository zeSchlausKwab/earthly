---
phase: 10-story-article-37520
slug: story-article-37520
status: draft
threats_open: 2
asvs_level: 1
created: 2026-06-27
---

# Phase 10 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Story / Article (kind 37520) author / read / propose feature.

**Audit verdict: OPEN_THREATS — 2 open (both BLOCKER under `block_on: high`).** The
plan-time register's two OG-path "mitigate" claims (T-10-09 and the register-omitted
SSRF) do NOT hold in the implemented code. Independently confirmed against
`src/lib/og/template.ts`, `src/lib/og/renderImage.ts`, `src/lib/og/fetchEvent.ts`,
and `src/index.ts` — these are not rubber-stamps of the code review.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Relay → in-app render | Untrusted kind-37520 Story content (`title`/`summary`/`image`/Markdown body) and kind-37519 proposal content rendered in the React SPA | Attacker-authored Markdown, image URLs, naddr refs |
| Relay → server OG path | Untrusted Story content fetched server-side for social-crawler unfurl HTML + PNG card | Attacker-authored `image`/`title`/`summary` |
| Client `Host` header → server OG output | `getBaseUrl` derives canonical URL from inbound `Host` header | Attacker-influenceable host string reflected into HTML + redirect sinks |
| Reader → owner Story (proposal accept) | A reader's kind-37519 Markdown body re-signed as the owner's Story content on accept | Attacker-authored Markdown body, proposal `a` coordinate |
| localStorage (per-device) | Local Story drafts, pubkey-scoped | Local-only; no remote trust crossing |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-10-01 | Tampering | `story/lifecycle.ts` naddr→`a` re-derive | mitigate | `naddrToCoordinate` returns null on bad decode (`references.ts:71-82`); `extractReferencedCoordinates` excludes nulls, never throws | closed |
| T-10-02 | DoS | `useStories()` cast | mitigate | `isArticle` guard applied BEFORE `castEvent` (`useStories.ts:32`) | closed |
| T-10-03 | Tampering | local Story draft storage | accept | local-only, pubkey-scoped, defensive parse→`{}` never throws (`draft.ts:28-45`) | closed |
| T-10-04 | XSS | StoryEditorPanel Preview tab | mitigate | Preview renders only via `RichContentRenderer` (`StoryEditorPanel.tsx:328`); no `dangerouslySetInnerHTML` | closed |
| T-10-05 | XSS | StoriesPanel list-row cover/title/summary | mitigate | title/summary auto-escaped React text nodes; cover plain `<img src>` + onError (`StoriesPanel.tsx:112-149`) | closed |
| T-10-06 | DoS | StoriesPanel relay events | mitigate | `useStories()` `isArticle`-filters before cast | closed |
| T-10-07 | XSS | StoryViewPanel narrative render | mitigate | renders only via `RichContentRenderer` (`StoryViewPanel.tsx:165`); no `dangerouslySetInnerHTML` (grep gate = 0 real sinks) | closed |
| T-10-08 | Tampering/InfoDisclosure | inline naddr refs → main map | mitigate | `GeoMentionChip` defaults hidden (`useState(false)`, `RichContentRenderer.tsx:460`); malformed refs inert | closed |
| **T-10-09** | **XSS** | **OG HTML template (`og/template.ts`, `index.ts`)** | **mitigate** | **CLAIMED reuse of "audited" escaping — FALSE: `image` + `url` interpolated RAW into `<meta content>`, http-equiv refresh, and `<script>` sink (`template.ts:47,55,58,66`)** | **open** |
| T-10-10 | Spoofing | comment/react on Story coordinate | accept | reuses signed NIP-22/kind-7 path; authorship by signature | closed |
| T-10-11 | XSS | StoryProposalsPanel accept-preview | mitigate | proposed Markdown rendered via `RichContentRenderer` (`StoryProposalsPanel.tsx:117`); no `dangerouslySetInnerHTML` | closed |
| T-10-12 | Tampering | accept → republish | mitigate | `acceptStoryProposalImpl` routes through `editStory`; `a` re-derived, `d`-tag preserved (`acceptStoryProposal.ts:37`) — see WR-01 residual | closed (with residual) |
| T-10-13 | Spoofing/target-confusion | `getProposalTargetKind` off `a` coord | mitigate | kind parsed from `a`, returns `undefined` on malformed (`helpers.ts:69-76`) | closed |
| T-10-14 | DoS | `useStoryProposals` over relay | mitigate | subscribed by `#a`+kind 37519; `getProposalMarkdownContent` returns string, never throws (`helpers.ts:57-59`) | closed |
| **T-10-15** | **InfoDisclosure/SSRF** | **`handleOGImageRoute` story branch → `fetchImageAsBase64` (`renderImage.ts`, `index.ts`)** | **mitigate (register-omitted)** | **untrusted Story `image` server-side `fetch`ed with NO scheme/host allowlist + NO redirect block; unauthenticated via `/og/image/story/:naddr` (`renderImage.ts:63-77`, `index.ts:221-232`)** | **open** |
| T-10-SC | Tampering (supply-chain) | npm/pip/cargo installs | mitigate | zero new dependencies across all 4 plans (confirmed in 4 SUMMARYs) | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

T-10-15 is added to this register because the plan-time register omitted the SSRF
sink that Phase 10's new `fetchStoryOGData` + `handleOGImageRoute` story branch
drive untrusted Story `content.image` into. It is a real, reachable, unmodeled threat
and is treated as OPEN per the task constraint.

---

## Open Threat Detail (BLOCKERs)

### T-10-09 — OG HTML attribute/script injection (was claimed mitigated; claim refuted)

**Files:** `src/lib/og/template.ts:16-69` (sink), reached via
`src/lib/og/fetchEvent.ts:192-216` (untrusted `content.image`/`title`/`summary`
sourcing) → `src/index.ts:155-167` (`generateStoryOGHtml(..., data?.image)`).

The plan/SUMMARY assert `generateStoryOGHtml` "reuses the audited generateOGHtml
escaping path … no new escaping logic invented (T-10-09)" (`template.ts:127-130`,
`10-03-SUMMARY.md:181-182`). **Verified false against code:** `generateOGHtml`
applies `escapeHtml` to ONLY `title`/`description` (`template.ts:26-27`). The `image`
and `url` values are interpolated RAW at:
- `template.ts:47` `<meta property="og:image" content="${image}">`
- `template.ts:55` `<meta property="twitter:image" content="${image}">`
- `template.ts:58` `<meta http-equiv="refresh" content="0;url=${url}">`
- `template.ts:66` `<script>window.location.href = "${url}";</script>` (JS string context)

For a Story, `image` is untrusted `content.image` from the event
(`fetchEvent.ts:200`, fallback to the `image` tag `:213-216`), with no URL
validation before emit. A Story author setting `image` to e.g.
`"><script>…</script>` breaks out of the attribute; the `url` sink additionally
reflects the attacker-influenceable `Host` header (`index.ts:46-49`, see WR-05).
This HTML is served to social crawlers and any crawler-UA request to
`/story/:naddr`. **Disposition stays `mitigate`; status `open` (BLOCKER).**

Remediation (implementation, NOT done here): `escapeHtml` every interpolated value;
validate `image`/`url` as `http(s)` URLs (reject `javascript:`/`data:`/non-URL);
JSON-encode the value going into the `<script>` sink. Applies to ALL entry points
of `generateOGHtml` (also `generateGeoEventOGHtml`/`generateContextOGHtml`), not
just the Story wrapper.

### T-10-15 — SSRF via server-side fetch of untrusted Story `image` (register-omitted)

**Files:** `src/lib/og/renderImage.ts:63-77` (`fetchImageAsBase64` — raw
`fetch(url)`, no allowlist), reached via `src/index.ts:221-232`
(`handleOGImageRoute` `type === 'story'` → `generateOGImagePNG({ backgroundImageUrl:
data?.image })`) → `renderImage.ts:101`.

`data?.image` is untrusted Story `content.image` (`fetchEvent.ts:200`). It is
server-side `fetch`ed with no scheme restriction (so `http://`, internal hosts,
link-local `169.254.169.254` metadata, etc. are all reachable), no host allowlist,
and no `redirect: 'error'` (a public URL can 302 to an internal one). The 6s timeout
and User-Agent header (`renderImage.ts:66-67`) do NOT mitigate SSRF. The response is
base64-inlined into the SVG card, giving a limited read-back channel. Reachable
unauthenticated by any request to `/og/image/story/:naddr` (production OG route,
`index.ts:305`). **Disposition `mitigate`; status `open` (BLOCKER).**

Remediation (implementation, NOT done here): in `fetchImageAsBase64` require
`https:` (or a blob/CDN host allowlist), reject private/loopback/link-local IP ranges
after resolution, and set `redirect: 'error'`. Same sink is also reached by the
context branch (`index.ts:198`), so fix at the `fetchImageAsBase64` chokepoint.

---

## Residual / Robustness Notes (not blockers, carried from code review)

These do not flip a register threat to OPEN on their own, but are recorded so they
do not silently disappear:

- **WR-01 (relates to T-10-12/T-10-13):** `acceptStoryProposalImpl`
  (`acceptStoryProposal.ts:29-51`) republishes the proposal body via `editStory`
  WITHOUT asserting `getProposalTargetAddress(proposalEvent)` equals the story's
  `37520:<owner>:<d>` coordinate or that `getProposalTargetKind === ARTICLE_KIND`.
  T-10-12 (a-tag re-derive + d-tag lineage) and T-10-13 (target-kind parsed off `a`)
  both genuinely hold, but NEITHER threat covers a *target-match assertion on the
  accept path*. Today the `#a` subscription filter in `useStoryProposals.ts:69-76` is
  the only thing keeping a mismatched proposal out of the accept call — a discovery
  filter, not an integrity check. Defense-in-depth gap, not currently exploitable via
  the shipped UI; recommend the WR-01 fix (assert target coordinate before
  `editStory`). Recorded as a residual, NOT counted in `threats_open`.
- **WR-05 (feeds T-10-09):** `getBaseUrl` (`index.ts:46-49`) trusts the inbound
  `Host` header and reflects it into the `url` sinks. Fixing T-10-09's escaping is
  necessary but not sufficient — deriving the base URL from trusted `serverConfig`
  closes the open-redirect/cache-poison angle.
- **WR-03 (availability):** OG SQLite + in-memory cache is unbounded
  (`cache.ts:55,140-166`); only purged at DB-open. Crawler-driven unbounded growth is
  a real availability risk given the documented prior disk-full crash-loop. Not a
  Phase-10 register threat; recorded for the ops backlog.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-10-03 | T-10-03 | Story drafts are local-only, per-device, pubkey-scoped via `readScopedStorage`/`writeScopedStorage`; a corrupted localStorage value yields an empty map (`draft.ts:28-45`) and never throws. No trust boundary is crossed — verified in code. | plan-time disposition (register_authored_at_plan_time) | 2026-06-27 |
| AR-10-10 | T-10-10 | Comment/react on a Story coordinate reuses the shipped, signature-authenticated NIP-22/kind-7 path proven on Groups (Phase 9). Spoofing is bounded by Nostr signature authorship; no new trust surface introduced by Phase 10. | plan-time disposition | 2026-06-27 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-27 | 15 | 13 | 2 | gsd-security-auditor (Claude) |

Total counts T-10-01..T-10-14, T-10-SC, and the newly-registered T-10-15 (SSRF). Two
open: T-10-09 (OG HTML XSS) and T-10-15 (OG image SSRF), both BLOCKER under
`block_on: high`.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (AR-10-03, AR-10-10)
- [ ] `threats_open: 0` confirmed — **NO, `threats_open: 2` (T-10-09, T-10-15)**
- [ ] `status: verified` set in frontmatter — **blocked: 2 open BLOCKERs**

**Approval:** pending — 2 open threats (T-10-09 OG HTML injection, T-10-15 OG image
SSRF) must be remediated in implementation and re-audited before sign-off.
