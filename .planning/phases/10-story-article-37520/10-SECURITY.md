---
phase: 10-story-article-37520
slug: story-article-37520
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-27
---

# Phase 10 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Story / Article (kind 37520) author / read / propose feature.

**Audit verdict (re-audit 2026-06-27): SECURED — 0 open, 15/15 closed.** The two
OG-path BLOCKERs flagged in the initial audit (T-10-09 OG-HTML XSS, T-10-15 OG-image
SSRF) have been remediated in implementation and independently re-verified against the
CURRENT code in `src/lib/og/template.ts`, `src/lib/og/renderImage.ts`,
`src/index.ts`, with regression tests in `src/lib/og/template.test.ts` (5/5 pass).
One TOCTOU caveat on T-10-15 is recorded as a documented residual (below ASVS-L1
`block_on: high` threshold), not an open threat.

> Initial-audit verdict (superseded, retained for trail): OPEN_THREATS — 2 open (both
> BLOCKER under `block_on: high`); the plan-time register's two OG-path "mitigate"
> claims did NOT hold in the as-shipped code.

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
| T-10-09 | XSS | OG HTML template (`og/template.ts`, `index.ts`) | mitigate | `sanitizeUrl`+`escapeHtml`/`escapeJsString` applied to EVERY `url`/`image` sink in the single `generateOGHtml` chokepoint (`template.ts:37-40,55,58,63,66,69,75,77`); no raw `${url}`/`${image}` remains; tests cover the breakout cases (`template.test.ts`, 5/5 pass) | closed |
| T-10-10 | Spoofing | comment/react on Story coordinate | accept | reuses signed NIP-22/kind-7 path; authorship by signature | closed |
| T-10-11 | XSS | StoryProposalsPanel accept-preview | mitigate | proposed Markdown rendered via `RichContentRenderer` (`StoryProposalsPanel.tsx:117`); no `dangerouslySetInnerHTML` | closed |
| T-10-12 | Tampering | accept → republish | mitigate | `acceptStoryProposalImpl` routes through `editStory`; `a` re-derived, `d`-tag preserved (`acceptStoryProposal.ts:37`) — see WR-01 residual | closed (with residual) |
| T-10-13 | Spoofing/target-confusion | `getProposalTargetKind` off `a` coord | mitigate | kind parsed from `a`, returns `undefined` on malformed (`helpers.ts:69-76`) | closed |
| T-10-14 | DoS | `useStoryProposals` over relay | mitigate | subscribed by `#a`+kind 37519; `getProposalMarkdownContent` returns string, never throws (`helpers.ts:57-59`) | closed |
| T-10-15 | InfoDisclosure/SSRF | `handleOGImageRoute` story branch → `fetchImageAsBase64` (`renderImage.ts`, `index.ts`) | mitigate (register-omitted) | `fetchImageAsBase64` now gates on `assertPublicImageUrl` (http(s)-only + DNS-resolved private/loopback/link-local/CGNAT/reserved block, IPv4 + IPv6 + `::ffff:` mapped) before any fetch; fetch uses `redirect:'error'`, enforces `image/*` content-type, caps at `MAX_IMAGE_BYTES` (`renderImage.ts:74-161`); sole `fetch(` in the og module, no bypass path | closed (residual: DNS TOCTOU) |
| T-10-SC | Tampering (supply-chain) | npm/pip/cargo installs | mitigate | zero new dependencies across all 4 plans (confirmed in 4 SUMMARYs) | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

T-10-15 is added to this register because the plan-time register omitted the SSRF
sink that Phase 10's new `fetchStoryOGData` + `handleOGImageRoute` story branch
drive untrusted Story `content.image` into. It is a real, reachable, unmodeled threat
and is treated as OPEN per the task constraint.

---

## Closed Threat Detail (former BLOCKERs — remediated + re-verified 2026-06-27)

### T-10-09 — OG HTML attribute/script injection — CLOSED

**Files (current code):** `src/lib/og/template.ts:16-206` (sink + new guards),
reached via `src/lib/og/fetchEvent.ts:192-216` (untrusted `content.image`/`title`/
`summary` sourcing, unchanged) → `src/index.ts:155-167` (`generateStoryOGHtml(...,
data?.image)`).

The fix adds two context-aware sanitisers and routes every untrusted `url`/`image`
value through them inside the single `generateOGHtml` chokepoint:

- `sanitizeUrl(raw, fallback)` (`template.ts:190-206`): site-relative paths require
  exactly one leading slash with no backslash, so `//host` (protocol-relative) and
  `/\host` are rejected (`:194`); absolute URLs must parse via `new URL` AND carry an
  `http:`/`https:` protocol (`:198-199`), so `javascript:`/`data:`/`vbscript:` fall
  through to the fallback. Verified `"/"` fallback for `url`, `DEFAULT_IMAGE` fallback
  for `image`.
- `escapeJsString(text)` (`template.ts:175-182`): `JSON.stringify` plus explicit
  `<`/`>`/`&`/U+2028/U+2029 neutralisation for the inline-`<script>` context.

Every sink now consumes a sanitised+escaped value — no raw `${url}`/`${image}`
remains:
- og:url `:55`, twitter:url `:63`, http-equiv refresh `:69`, `<a href>` `:75` →
  `safeUrlAttr = escapeHtml(sanitizeUrl(url, '/'))` (`:37-38`)
- inline `<script>window.location.href = ...` `:77` → `safeUrlJs =
  escapeJsString(sanitizeUrl(url, '/'))` (`:39`)
- og:image `:58`, twitter:image `:66` → `safeImageAttr =
  escapeHtml(sanitizeUrl(image, DEFAULT_IMAGE))` (`:40`)

Because the fix is at the shared `generateOGHtml`, it covers ALL entry points
(`generateStoryOGHtml`, `generateGeoEventOGHtml`, `generateContextOGHtml`,
`generateHomeOGHtml`), not just the Story wrapper. Regression tests
(`template.test.ts`) assert quote-breakout escaping, `javascript:` rejection →
`"/"`, attribute-breakout image → default image, `</script>` breakout neutralised to
exactly one legitimate `<script>` (+`</script`), and a legitimate https
image/url passthrough — **5/5 pass**. **CLOSED.**

WR-05 note still applies as defence-in-depth: `getBaseUrl` (`index.ts:46-49`) still
derives the base URL from the inbound request URL/`Host`. The XSS sink is now closed
(any hostile host string is escaped/sanitised before emit); deriving the base URL
from trusted `serverConfig` would additionally close the open-redirect/cache-poison
angle. Recorded as a residual, not counted in `threats_open`.

### T-10-15 — SSRF via server-side fetch of untrusted Story `image` — CLOSED

**Files (current code):** `src/lib/og/renderImage.ts:74-161` (guard + guarded
fetch), reached via `src/index.ts:221-232` (`handleOGImageRoute` `type === 'story'`
→ `generateOGImagePNG({ backgroundImageUrl: data?.image })`) → `buildSvg`
(`renderImage.ts:189`) → `fetchImageAsBase64`.

`fetchImageAsBase64` (`:139-161`) now calls `assertPublicImageUrl` first and returns
null on rejection (`:140-141`):

- `assertPublicImageUrl` (`:115-137`): rejects non-`http(s)` schemes (`:122`);
  resolves the hostname via `dns.lookup(host, { all: true })` and blocks if ANY
  resolved address is non-public (`:129-131`), defeating public-DNS-name →
  internal-IP rebinds at check time; IP literals are checked directly (`:126-127`).
- `isBlockedIPv4` (`:74-87`) covers `0.0.0.0/8`, `10/8`, `127/8`, `169.254/16` (incl.
  the `169.254.169.254` cloud-metadata endpoint), `172.16-31`, `192.168/16`,
  `192.0/16`, `100.64-127` (CGNAT), `198.18-19` (benchmarking), and `>=224`
  (multicast/reserved).
- `isBlockedIPv6` (`:89-99`) covers `::1`, `::`, `fc00::/7` ULA, `fe80::/10`
  link-local, and `::ffff:` IPv4-mapped (delegates to the IPv4 check).
- The fetch (`:143-147`) sets `redirect: 'error'` (blocks public→internal 302
  bypass), enforces `content-type` starts with `image/` (`:151`, refuses
  text/JSON internal read-back), and caps size on both declared `content-length`
  and actual byte length against `MAX_IMAGE_BYTES` (8 MiB, `:152-155`).

This is the ONLY `fetch(` in the entire `src/lib/og/` module (grep-confirmed), and
`backgroundImageUrl` — the sole entry for both the story and context branches — flows
exclusively through `fetchImageAsBase64`. No remaining raw-fetch bypass. **CLOSED.**

**Documented residual (T-10-15 TOCTOU — NOT an open threat under `block_on: high`):**
the DNS resolution performed in `assertPublicImageUrl` is not pinned to the address
the subsequent `fetch` connects to, so a DNS-rebinding attacker controlling a
short-TTL record could in principle return a public IP at check time and an internal
IP at fetch time. The combined `redirect: 'error'` + `image/*` content-type
enforcement + 8 MiB size cap + 6 s timeout reduce both reachability and any read-back
value below the ASVS-L1 `block_on: high` blocking threshold. Recommended future
hardening (not required for sign-off): resolve once and connect to the pinned IP
(or use a custom resolver/`lookup` callback). Recorded as a residual, not counted in
`threats_open`.

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
| 2026-06-27 (re-audit) | 15 | 15 | 0 | gsd-security-auditor (Claude) |

Total counts T-10-01..T-10-14, T-10-SC, and the registered T-10-15 (SSRF). Initial
audit left two open BLOCKERs (T-10-09 OG-HTML XSS, T-10-15 OG-image SSRF).

## Security Audit 2026-06-27 (re-audit)

Re-audit after remediation of the two OG-path BLOCKERs. Verified against the CURRENT
code on disk; not a re-read of the prior audit's claims.

| Metric | Initial (2026-06-27) | Re-audit (2026-06-27) |
|--------|----------------------|-----------------------|
| Threats total | 15 | 15 |
| Closed | 13 | 15 |
| Open (BLOCKER) | 2 | 0 |
| `threats_open` | 2 | 0 |
| Status | draft (OPEN_THREATS) | verified (SECURED) |
| Documented residuals | WR-01, WR-03, WR-05 | WR-01, WR-03, WR-05, T-10-15 DNS-TOCTOU |

**Re-verified closures:**

| Threat ID | Category | Evidence (current code) |
|-----------|----------|-------------------------|
| T-10-09 | XSS | `template.ts:37-40` sanitise+escape every `url`/`image`; sinks `:55,58,63,66,69,75,77`; `sanitizeUrl` `:190-206`; `escapeJsString` `:175-182`; no raw `${url}`/`${image}`; tests `template.test.ts` 5/5 pass |
| T-10-15 | InfoDisclosure/SSRF | `renderImage.ts:140` gates on `assertPublicImageUrl` `:115-137` (http(s)-only + DNS private/loopback/link-local/CGNAT/reserved block, IPv4+IPv6+`::ffff:`); fetch `redirect:'error'` `:146`, `image/*` `:151`, `MAX_IMAGE_BYTES` `:152-155`; sole `fetch(` in og module |

**Verification commands:** `bun test src/lib/og/template.test.ts` → 5 pass / 0 fail;
`grep -rn "fetch(" src/lib/og/` → single guarded site (`renderImage.ts:143`).

**Residual carried forward (not counted in `threats_open`):** T-10-15 DNS-TOCTOU —
the pre-fetch DNS check is not pinned to the connected address; mitigated below the
ASVS-L1 `block_on: high` threshold by `redirect:'error'` + image-content-type +
size-cap + timeout. See T-10-15 detail above.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (AR-10-03, AR-10-10)
- [x] `threats_open: 0` confirmed — re-audit 2026-06-27 (T-10-09 + T-10-15 closed)
- [x] `status: verified` set in frontmatter — 0 open BLOCKERs

**Approval:** SECURED — 15/15 threats closed, 0 open. Both former BLOCKERs (T-10-09 OG
HTML injection, T-10-15 OG image SSRF) remediated in implementation and re-verified
against current code. T-10-15 DNS-TOCTOU recorded as a documented residual below the
ASVS-L1 `block_on: high` threshold.
