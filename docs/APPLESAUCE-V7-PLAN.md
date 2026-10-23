# Applesauce v7 migration and improvement plan

Prepared 2026-10-23 against the current Earthly checkout, the release announcement, upstream documentation/changelogs, and live npm metadata. Implementation is now present in the working tree. See [implementation decisions and verification](APPLESAUCE-V7-IMPLEMENTATION.md) for the delivered scope, measured results, and remaining limitations. The sections below retain the original planning rationale.

## Recommendation

Ship a compatibility release first, with correct relay lifecycle and failure reporting. Follow it with relay health, inexpensive social counts, wallet reliability improvements, and selected architectural simplifications. Measure the SDK's performance gains before attributing improvements to it.

The most valuable changes for Earthly are:

1. Preserve durable subscriptions and account-specific authentication under the new relay APIs.
2. Stop treating a loading deadline as proof that synchronization succeeded, especially for wallet readiness.
3. Add local relay liveness and explain recovery/authentication failures in the existing relay manager.
4. Use shared COUNT queries for visible social totals, with Earthly-specific address and comment semantics.
5. Adopt wallet/signing fixes and remove obsolete compatibility code only after its regression tests pass against the upstream implementation.

The [v6 → v7 migration guide](https://applesauce.build/migration/v6-v7) is the compatibility checklist. The [release announcement](https://nostr.at/naddr1qvzqqqr4gupzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qqxkzursd3jhxct4vdjj6a3hvhmxzc) supplies feature candidates; availability alone does not justify adding a new product surface.

## 1. Dependency scope

Exact target versions below were checked in the public npm registry on 2026-10-23. Recheck patch releases when implementation starts, then commit a reproducible lockfile. All direct applesauce packages should move together to major 7; their patch versions differ.

| Package | Before migration | Installed target |
| --- | --- | --- |
| `applesauce-accounts` | 6.2.0 | 7.0.2 |
| `applesauce-actions` | 6.2.0 | 7.0.0 |
| `applesauce-common` | 6.2.0 | 7.0.0 |
| `applesauce-core` | 6.2.0 | 7.0.3 |
| `applesauce-loaders` | 6.2.0 | 7.0.2 |
| `applesauce-react` | 6.0.0 | 7.0.0 |
| `applesauce-relay` | 6.2.1 | 7.0.0 |
| `applesauce-signers` | 6.2.2 | 7.0.1 |
| `applesauce-wallet` | 6.2.0 | 7.0.0 |
| `applesauce-wallet-connect` | 6.2.0 | 7.0.0 |

Also inspect the optional `applesauce-content` dependency brought in by React; it currently resolves to 6.0.0 and should resolve to v7 within the application dependency tree.

Adjacent dependencies:

- Earthly already declares `nostr-tools` 2.25.2 and `@cashu/cashu-ts` ^4.11.0. The verified v7 metadata accepts these. Confirm actual deduplication after installation, particularly because v6 currently brings its own `nostr-tools` ~2.19.
- `rxjs` is imported directly throughout Earthly but is not declared directly in `package.json`. Add a compatible explicit dependency rather than relying on transitive installation.
- Keep React and TypeScript stable during this migration. Upstream explicitly supports React 19 and does not require an application compiler upgrade to TypeScript 7.
- Keep `nostr-idb` 5.1.0 initially. Earthly does not currently depend on `applesauce-sqlite`; its SQLite performance improvements will not automatically improve the Rust-owned native database.
- **ContextVM is a compatibility exception.** The installed SDK 0.13.16 and the latest checked SDK 0.14.3 both depend on `applesauce-relay` ^6.2.1. The generator `@contextvm/ctxcn` also brings an older SDK with applesauce v4. Do not force these to v7 through global overrides. Earthly's generated geo client and private coordinator construct SDK-owned `ApplesauceRelayPool` instances, so isolated versions are a viable initial arrangement. Verify transport behavior and bundle cost. Upgrade or replace that adapter separately when supported.

Evidence: [package manifest](../package.json), [lockfile](../bun.lock), [migration guide](https://applesauce.build/migration/v6-v7), [core registry](https://registry.npmjs.org/applesauce-core/latest), [wallet registry](https://registry.npmjs.org/applesauce-wallet/latest), [ContextVM registry](https://registry.npmjs.org/@contextvm/sdk/latest), [geo client](../src/ctxcn/EarthlyGeoServerClient.ts), [private coordinator](../src/lib/private-workspace/coordinator.ts).

## 2. Compatibility work mapped to Earthly

### Relay lifecycle and result semantics

| Current code | Required work | Regression to prevent |
| --- | --- | --- |
| `src/lib/nostr/liveTimeline.ts` passes `reconnect` and `resubscribe` to raw `pool.req()` | Move durable lifecycle policy to high-level subscriptions. Adapt event delivery and per-relay readiness explicitly. | Catalogs, comments, wallets, and Maplets silently stop after socket failure or CLOSED. |
| `src/lib/nostr/sharedTimeline.ts` resolves one readiness boolean after EOSE/error/CLOSED or a four-second deadline | Introduce explicit initial-load status and per-relay outcomes. Retain cache-first rendering and shared subscriptions. | An offline or refused request looks successfully synchronized. |
| `src/features/maplets/useMapletCollectionDiscovery.ts` wraps raw messages to capture source and completion | Update its injected transport contract with the live-timeline migration. Preserve verification before ingestion and source provenance. | Losing verified-only ingestion, relay provenance, or discovery failure information. |
| `src/features/chat/settingsRelay.ts` and `src/features/maplets/myMapsServices.ts` use raw requests with removed policy options | Use bounded high-level requests where their semantics fit, or explicitly retain a raw one-shot adapter with deadlines/cancellation. Keep each caller's partial-failure policy. | Replacing failed settings reads with empty state; accepting incomplete Maplet discovery as complete. |
| `src/features/settings/UserRelayManager.tsx` performs raw discovery and reads removed auth-required status flags | Update discovery outcomes and replace flags with operation/authentication state. | Broken status badges and hidden discovery failures. |
| `src/features/offline/saved-regions/useSavedRegionDeletionSync.ts` uses raw per-relay EOSE to complete deletion checks and retains subscriptions | Preserve its initial completeness, ordering, live updates, failure, and cancellation contract. Treat this as an intentional raw consumer if necessary. | Reporting deletion checks complete when a required relay was skipped, failed, or never answered. |
| `src/lib/search/execute.ts`, entity-search hook, chat entity tools, seeder | Handle `RelayGroupError`, successful empty results, and changed finite-request completion. Set deliberate deadlines. | Unhandled RxJS errors or misleading “nothing found”; a caller timeout firing before intended completion. |
| Shared publish path, durable outbox replay, wallet action publisher | Keep negative acknowledgements distinct from transport exceptions; attach operation auth policy and retain existing acknowledgement gates. | Clearing recovery state or reporting publication success without an accepted relay response. |

v7's raw methods no longer own retries/authentication/reconnection. Group high-level subscriptions emit events without the raw per-relay EOSE messages Earthly currently consumes. A mechanical method rename is therefore insufficient. See [migration: relay requests and authentication](https://applesauce.build/migration/v6-v7).

Recommended implementation at the existing timeline seam:

- Keep cache hydration, reference counting, foreground/online refresh, and exact account/filter/relay isolation in Earthly.
- Let upstream high-level operations own socket retry and authentication behavior.
- For readers requiring per-relay status or provenance, aggregate single-relay high-level subscriptions, which expose EOSE, behind the existing shared module. If using `pool.relay(url)`, apply eligibility to the original candidate set explicitly: this method bypasses pool liveness filtering.
- Return status such as `loading`, `ready`, `partial`, or `unavailable`, accompanied by per-relay outcomes and cache availability. A presentation deadline may end a spinner; it must not manufacture a successful EOSE.
- Keep genuinely raw protocol consumers few, named, bounded, and covered by behavioral tests. Do not discard information just to standardize all callers on one method.

### Authentication and accounts

`setupNip42AuthResponder()` in `src/lib/nostr/index.ts` deduplicates answers by URL and challenge only. Account changes are not part of that key, and the challenge is recorded before authentication succeeds. Its catch path also does not inspect a resolved negative AUTH verdict.

Move signing policy to the requesting operation. Capture the intended signer/pubkey, use account-specific `waitForAuth` for private reads, inspect authentication responses, and propagate cancellation/failure. If proactive challenge handling remains, scope its records to relay, challenge, and account, and allow a failed attempt to recover. Use v7's multi-account authentication state in the manager rather than a single global authenticated identity.

For NIP-46:

- Test `nostrconnect://` pairing with a signer that returns the connection secret; plain `ack` no longer suffices for that flow. Keep `bunker://` behavior distinct.
- Handle bounded requests, failed publication, signer closure, and cancellation in login, signing, and encryption UI.
- Earthly overrides `fromNbunksec()` and calls `connect()` again. Upstream v7 explicitly fixes restored-session reconnection and used-secret handling. Update or remove that override so it does not preserve the old behavior.
- Compare the upstream private-key signer against the existing one-MiB dataset test. If it passes, remove `ExtendedNip44PrivateKeySigner` and unnecessary account/signer subclasses while retaining permission scopes and serialized-account compatibility. Do not assume a dependency range alone proves large-message interoperability.
- Consider client metadata and bounded logout as small usability improvements. Seed-word import and automatic relay switching are optional product changes, not prerequisites.

Evidence: [custom signer](../src/lib/nostr/largeEventNip46.ts), [large-message tests](../src/lib/nostr/largeEventNip46.test.ts), [signer changelog](https://github.com/hzrd149/applesauce/blob/master/packages/signers/CHANGELOG.md).

### Wallet, core, and helper changes

- `src/lib/wallet/actions.ts` dereferences `getTokenContent(token).del`, `.mint`, and `.proofs`. v7 can return `undefined` for malformed content. Validate once, retain only valid content for selection, and provide an explicit failure when an operation cannot proceed. Preserve recovery proofs and deletion-chain reconciliation.
- Audit helpers returning decrypted data, copies of decrypted events, and immutable event fixtures. v7's cached helper state is non-enumerable; spreading an event does not preserve it, and caching on frozen events can fail.
- Keep `new EventStore()`'s default signature verification. Do not construct an options object with `verifyEvent: undefined`: in v7 that explicitly disables verification.
- Compile all custom Factory/Cast types against v7. Default generics often continue to work; only migrate explicit store generics where needed. The source scan did not find custom `Model<T, Store>` uses or `EventFactory.kind()` calls requiring a blanket rewrite.
- Recheck the private deletion-manager access in `src/lib/nostr/store.ts`. Prefer a supported upstream interface if one matches; otherwise retain one isolated compatibility adapter with contract tests.
- Audit scripts and test doubles as well as `src/`. Mocks of raw request messages, signer publication responses, and pairing replies must represent v7 faithfully.

**Changes not currently required:** the source scan found no uses of `createTimelineLoader`, `createUserListsLoader`, `createSocialGraphLoader`, pool COUNT/sync consumers, or applesauce SQLite. Their breaking changes matter when adopting them; they are not existing migrations to invent.

## 3. Feature adoption priorities

| Priority | Improvement | Earthly use | Scope and acceptance |
| --- | --- | --- | --- |
| P1 | Local relay liveness | Shared pool and `UserRelayManager` | Skip failing optional reads, recover eligible relays in open subscriptions, show cooldown/last failure and authenticated accounts. Distinguish reachability from authorization. |
| P1 | Shared social counts | Entity tables and `GeoSocialActions` | Subscribe only for visible rows; share/cache requests. Display unknown separately from zero; retain stale results while refreshing. |
| P1 | Accurate zap totals | `useGeoReactions` | Replace the hard-coded 1,000 sats per Lightning receipt with the upstream parser, verified units, and malformed-receipt handling. Keep Cashu nutzap amounts separate until normalization. |
| P1 | Wallet recovery and connection reliability | NIP-60/NIP-47 panels | Test v2 keyset recovery offline, compact-token receiving with mint lookup, QR fragment capture, negotiation timeout, and account switching. Preserve all current spend and persistence safeguards. |
| P2 | Bounded history loading | Catalogs and long discussions | Pilot v7 time-window loading where chronological history is useful; keep a separate live stream and show incomplete coverage. Compare with current increasing-limit requests. |
| P2 | Shared thread projection | Shoutbox and geographic discussions | Adopt upstream standard NIP-22 support for shoutbox first. Prove custom comment adaptation before replacing its tree builder. Preserve geometry attachments and stable addresses. |
| P2 | Wallet session module | `src/lib/wallet/runtime.ts`, hooks, NWC client creation | Evaluate `NutWallet` against current guards and recovery behavior; consolidate loading/status/lifecycle behind an account-owned session if it reduces code. |
| P2 | Targeted sync/outbox selection | Personal history, profiles/lists, wallet backfill | Add `createSyncLoader` or outbox selection only for a defined missing-data problem, with supported relay capability and failure reporting. |
| Later | NIP-66 monitoring, moderation/notifications | Relay discovery and public discussion | Start only after local health and existing social flows work well; define monitor trust or notification semantics first. |

### Relay manager and liveness

Use one `RelayLiveness` source for runtime decisions and UI evidence. Keep unknown relays eligible. Preserve original candidate sets so recovered relays can rejoin; never overwrite saved NIP-65 lists with a temporary filtered set.

Before attaching liveness globally, verify its effect on required publication relays and deletion completeness: v7 filters one-shot publish/sync requests too. Skipping a required destination must remain pending/failed in the durable outbox, never silently count as delivery. An explicit retry may deliberately probe the selected relay.

Keep relay routing buckets, the guarded WebSocket constructor, local-only content writes, and authorized wallet/signer routing intact. Remote NIP-66 monitoring can be a later opt-in; it adds external evidence and does not prove reachability from an Android device. See [liveness documentation](https://applesauce.build/loading/relays/liveness).

### Counts require Earthly-specific metrics

Earthly deliberately disables total loading on dense dataset, Story, and Sighting rows using `loadCounts={false}`; `CurrentUserReactionSync` supplies the user's own reaction state once. Keep that shared personal-state approach. Add counts incrementally to visible rows without restoring per-row downloads of every reaction and receipt.

The [count service](https://applesauce.build/loading/loaders/count-service) returns a single relay's answer, not a deduplicated network total. Its built-in reaction metric targets event IDs; its built-in comments metric describes standard NIP-22 comments.

Define versioned Earthly metrics:

- Geographic comments: kind `37517`, root `#A` equal to the target's stable address. Preserve existing whole-discussion count semantics and test replacements/deletions at the counting relay.
- Addressable reactions: kind `7`, `#a` equal to the stable address. Retain the existing event-ID metric for regular events. Do not sum overlapping ID/address counts.
- Standard shoutbox comments: kind `1111`, root `#E`; upstream support is a closer fit here.

Use explicit stable target addresses so replacing a dataset does not reset its metrics. Keep relay provenance and approximation/freshness in the result model. Verify actual COUNT support and semantics against the local and production relay implementations before enabling this UI; existing eventstore wiring alone is not proof.

An unsupported/unavailable COUNT should yield an unknown count or bounded fallback, not endless spinners or a download of the entire network history. The service can keep retrying while observed, so the UI needs its own bounded loading presentation and must release offscreen demand. Invalidate after acknowledged relevant publication; preserve local optimistic reaction state while the count relay catches up.

COUNT cannot determine whether this account reacted or calculate sats. Keep those event-based reads. The existing Lightning amount placeholder is in [useGeoReactions](../src/features/social/hooks/useGeoReactions.ts); use `getZapAmount`/`getZapRequest` from `applesauce-common/helpers`, confirming their units in tests.

### Wallet: separate new fixes from older unused capabilities

The actual v7 wallet additions are mainly correctness improvements: full v2 keyset preservation in recovery storage, shortened-keyset resolution when receiving, improved QR fragment handling, bounded mint metadata requests, and cache clearing on lock. NWC gains encryption-negotiation timeout cleanup, invoice-expiry fixes, and cached NIP-44 conversation keys. See the [wallet changelog](https://github.com/hzrd149/applesauce/blob/master/packages/wallet/CHANGELOG.md) and [NWC changelog](https://github.com/hzrd149/applesauce/blob/master/packages/wallet-connect/CHANGELOG.md).

`NutWallet`, `MintTokens`, `CleanupDeletedTokens`, and `waitForPaid` already existed in 6.2. They are adoption opportunities, not newly introduced v7 features.

Evaluate an account-scoped `NutWallet` session, including its sync/backup side effects, against Earthly's existing signer capture, per-account couch, Web Locks, acknowledgement-before-store policy, and recoverable proof handling. Replace current orchestration only if all these contracts survive. Keep the current action implementation for the compatibility milestone.

Also evaluate reusing one NWC client per active connection: `nwc.ts` currently constructs clients for status and payment calls, which may reduce the benefit of upstream key caching. Define teardown and invalidation on account/connection changes using the supported client lifecycle. Do not persist decrypted content to achieve caching.

### Timeline and comments

The current catalog window grows a result limit by 100 and can remove the limit. A time-window loader is an opportunity to avoid repeated larger fetches, but it does not directly implement a count-based “next 100” UI. Prototype on one chronological surface; preserve the public browse/filter contract and measure bytes, requests, and time to useful content.

Keep live events separate from historical loading. Inspect per-source status for incomplete ranges, including crowded same-second boundaries; the new loader does not justify claiming complete network history. See [timeline loader](https://applesauce.build/loading/loaders/timeline-loader).

The geographic comment kind is addressable `37517` with JSON content and geometry, using NIP-22-style reference tags. It is not standard kind `1111`. Standard shoutbox comments are a useful first upstream thread-model adoption. For geographic comments, preserve addressable replacements, deleted/missing parents, out-of-order arrival, depth limits, and annotation identity. Avoid publishing duplicate standard comments merely to fit a library model.

## 4. Architecture changes that earn their cost

### Deepen the existing Nostr read module

The useful seam already exists in `liveTimeline.ts`, `sharedTimeline.ts`, and `hooks.ts`. Give callers events plus meaningful load status; hide cache hydration, subscription sharing, source bookkeeping, foreground recovery, auth policy, and cancellation there. Keep the shared EventStore as the reactive read model.

Separate finite reads, live reads, and historical window loading internally. They have different completion semantics. Domain code should choose the operation it needs, not repeat raw-message state machines.

Do not create a mirror interface for every applesauce method. Preserve raw access for protocol-specific requirements, and test the behavioral interface used by real callers.

### Make runtime ownership explicit

`src/lib/nostr/index.ts` currently owns accounts, auth responders, cache persistence, loaders, publication, and native-session bridges through module side effects. Its HMR cleanup covers only part of that work.

As those areas are changed, extract cohesive ownership into transport/auth, cache/loading, account sessions, and publication/outbox modules. Keep the public barrel stable initially. Add explicit initialization/disposal for owned subscriptions, loaders, liveness, and count services; continue using the existing single EventStore.

Avoid a large file-movement PR before migration. Extract when it makes an operation testable or gives one owner responsibility for cleanup. Maintain the existing platform interfaces for browser versus native implementations.

### Give social semantics one home

A shared social module should own stable target identity, Earthly count metrics, reaction/delete routing, receipt interpretation, and thread projection. Hooks become lifecycle adapters to it.

One current inconsistency is worth resolving explicitly: `useGeoReactions.toggleReaction` publishes through the author's outbox, while `useGeoComments.react` uses reply routing to include the recipient. Decide and test one intended discoverability policy, including development routing restrictions.

### Preserve native and private collaboration ownership

The native local node already performs its own sync. Applesauce JS sync should not create a second competing durable outbox or independently synchronize the same saved-region ownership without a specific design.

`RumorStore` is useful for genuine unsigned Nostr rumors. Private workspace projections currently adapt MLS-owned records to Earthly casts. They need an isolated design review before adopting a new store; unsigned/private content must not enter the public event cache or publication path accidentally. This is optional future work, not a dependency-upgrade requirement.

## 5. Delivery sequence

Each stage should leave a reviewable result and a passing regression gate. “Medium” and “large” describe relative scope, not calendar commitments.

| Stage | Scope | Depends on | Completion gate |
| --- | --- | --- | --- |
| 0 — Baseline and fixtures (small) | Record dependency/build/performance baseline; isolate scratch diagnostics; characterize current relay/auth outcomes. | None | Repeatable measurements and local failure fixtures; existing failures recorded separately. |
| 1 — v7 compatibility (large) | Upgrade direct packages together; migrate live/raw consumers, status fields, wallet getters, and NIP-46 behavior; preserve all guards. Include the read-status change needed to prevent false wallet readiness. | 0 | No new production type errors; relay/auth/cache/publication/wallet tests and focused browser scenarios pass. |
| 2 — Relay health (medium) | Add local liveness, manager evidence and recovery controls; verify required-destination semantics. | 1 | Dead relay recovery works; auth refusal is not offline; required writes and deletion checks cannot disappear through filtering. |
| 3 — Social metrics and correctness (medium) | Shared COUNT service and custom metrics; correct zap amounts; consolidate reaction routing. | 1; coordinate with 2 | Stable-address counts, unknown/zero states, delete/update invalidation, fewer row subscriptions, correct sats. |
| 4 — Wallet/signing simplification (medium) | Remove proven-obsolete large-message compatibility code; improve v2 recovery/QR coverage; evaluate account wallet/NWC sessions. | 1 | Large signing and restored sessions work; spending, account isolation, and recovery contracts remain intact. |
| 5 — History/thread pilot (medium) | One time-window loader surface and standard shoutbox thread adoption; decide custom comment reuse from evidence. | 1 and shared status contract | No missing/duplicate boundary events; useful loading status; measured request improvement; attachments and threading preserved. |
| 6 — Consolidation (small to medium) | Finish runtime lifecycle ownership, update docs/skills, prune resolved baselines and obsolete wrappers. | Relevant preceding stages | No duplicated policy or leaked subscriptions; current architecture docs match the final code. |

Stages 2–5 are independently releasable after compatibility. Extract only the module structure needed by each stage. Retain the baseline lockfile and ship additive UI features behind local configuration while validating them; avoid cache/schema migrations in stage 1 so rollback remains straightforward. If a later wallet storage change is necessary, require backward-reading fixtures before rollout.

## 6. Verification and performance evidence

### Existing coverage to reuse

- Nostr: `liveTimeline.test.ts`, `sharedTimeline.test.ts`, `hooks.test.tsx`, relay routing, acknowledgement/commit/outbox, deletion cache, account persistence, and one-MiB NIP-46 tests under `src/lib/nostr/`.
- Wallet: spend selection/locking, account isolation, nutzap send, default mint, and NWC tests under `src/lib/wallet/`.
- Browser: `catalog-loading.spec.ts`, `auth-nip46.spec.ts`, `social-actions.spec.ts`, `comments-surface-contract.spec.ts`, `thread-docking-publish-feedback.spec.ts`, `chat-connections.spec.ts`, `maplet-discovery.spec.ts`, and `saved-regions.spec.ts`.
- Private collaboration: the existing private-map smoke scripts. ContextVM geo/private coordinator behavior must remain covered despite the separate v6 dependency tree.
- Native: the Android smoke for suspend/resume, account persistence, local-node behavior, and process lifecycle. Responsive browser tests do not substitute for a WebView check.

The AI-suite README and task catalog were read for this plan. Reuse `auth.sign-in`, `setup.isolated-relays`, social comment/reply/annotation tasks, and existing navigation tasks. Add focused protocol fixtures for auth refusal, CLOSED, disconnect/reconnect, silent relays, negative OK, COUNT unsupported, and all-relay failure. Run mutating scenarios only on loopback with disposable identities and fully isolated relays; real wallet development exceptions must not leak into fixtures. Keep experiments in `ai-suite/scratch/` and generated evidence untracked.

### Required behavioral cases

| Area | Cases |
| --- | --- |
| Finite requests | Empty success, partial success, all failed, no first response, abort, deadline, late event. |
| Live streams | Events after EOSE, CLOSED recovery, disconnect/reconnect, foreground/online refresh, last-observer cleanup. |
| Authentication | Two accounts on one relay, account switch while signing, challenge refresh, negative AUTH, signer rejection/timeout. |
| Publication | Partial/all rejection, transport failure, skipped required relay, durable queued versus accepted state, retry same signed event. |
| Wallet | Malformed unlocked content, deletion chains, duplicate proofs, switch during spend, failed publication, retained recovery proofs, v2 token round trip offline. |
| Social | `#a`/`#A` stable identities versus event IDs, revisions/deletions, unknown versus zero COUNT, unsupported relay, optimistic state, correct zap units. |
| History | Unequal relay limits, same-second events, cancellation/re-entry, live arrivals during backfill, incomplete coverage. |

Run targeted tests first, then `bun run typecheck`, `bun run ai:typecheck`, a production build, and relevant browser/native suites. Broaden to full non-live test coverage before releasing the compatibility milestone. Do not baseline newly introduced application errors.

### Baseline observed during planning

`bun run typecheck` currently fails with **10 diagnostics new relative to its checked-in baseline**, all in `ai-suite/scratch/`: atlas-local-smoke, build-world-ad30-expansion, build-world-ad30, expand-world-ad30-story, hiking-expansion/read-public-events, and thumbnail-visual-check. No dependency changes had been made. The existing diagnostic baseline was not altered. This was the pre-implementation observation; subsequent test and build results are recorded in the implementation report.

The root tsconfig includes scratch experiments because it has no narrower include list and does not exclude that directory. Give production and maintained AI-suite code explicit checking scopes; typecheck experiments separately when needed. Keep promoted tasks and scenarios in the required checks.

### Measure improvements, do not promise a percentage

Use the same seeded data, relay behavior, browser/device, and cache state for before/after runs. Record cold and warm startup, first usable catalog/profile, comment expansion, repeated scrolling, and resume after disconnection. Include a representative large dataset and a large discussion.

Capture:

- Active WebSockets and subscriptions, request counts, events/bytes downloaded, time to useful content, and time to settled or degraded status.
- Main-thread long tasks/render commits and heap after repeated mount/unmount or account switching.
- COUNT requests and retained cache entries for visible versus offscreen rows.
- Bundle size and duplicated SDK/crypto versions, including the ContextVM subtree.

Acceptance: no correctness regression; no persistent growth after repeated lifecycle cycles; count-only rows avoid full-history downloads; healthy sources remain usable during a relay failure. Set numerical performance budgets after stage 0 has a repeatable baseline.

## 7. Housekeeping and deferred decisions

- Refresh the repository's applesauce skills against v7. Several current examples describe APIs Earthly does not use; implementation guidance should reference current, compile-checked examples rather than becoming another source of migration mistakes.
- Update architecture documentation after code changes, particularly read status, auth ownership, relay policy, and the distinction between the primary application pool and SDK-owned pools.
- Remove legacy NDK compatibility branches/comments only when repository-wide callers prove they are no longer needed.
- Audit HMR and logout disposal while extracting runtime ownership. Stop shared loaders/count services when their owner ends; do not leave auth subscriptions behind.
- Keep strict signature verification for public records, moderation gates, publication checks, and wallet state. Defer `OptimisticEventVerifier` until profiling proves verification is a bottleneck and its changed trust policy is separately evaluated.
- Defer adding spam classifiers, NIP-29 communities, NIP-C7 chat, napplets, seed-word onboarding, or a new SQLite backend solely because v7 supports them. Each needs an Earthly use case. Maplets and MLS workspaces already have distinct ownership and contracts.
- Decide from stage-0 evidence whether ContextVM's version duplication materially affects delivery size. It is a supported dependency constraint to manage, not grounds for a forced major override.

Recommended starting point: stage 0 followed by the compatibility milestone. Prioritize relay health and social counts next; keep broader wallet and history refactors separable.
