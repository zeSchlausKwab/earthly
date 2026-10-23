# Applesauce v7: implementation and verification

Implemented 2026-10-23. This records the outcome of [the migration plan](APPLESAUCE-V7-PLAN.md). Changes are local to this checkout; no release or deployment was performed.

## Delivered scope

| Area | Result |
| --- | --- |
| Dependencies | All ten direct Applesauce packages are pinned to the verified v7 versions in `package.json` and `bun.lock`; RxJS 7.8.2 is now a direct dependency. |
| Relay lifecycle | Live readers use high-level, single-relay subscriptions with reconnection and resubscription. Finite reads and required deletion reads retain explicit completion and failure policies. |
| Authentication | Each operation captures its intended account. Negative AUTH responses fail the operation; changing accounts while signing cannot authenticate the new account on the old operation. |
| Load status | Shared timelines expose cache and per-relay status. A loading deadline ends the initial presentation wait without claiming that synchronization succeeded. Wallet spending readiness requires complete relay synchronization. |
| Relay manager | Shows authenticated pubkeys, current-account authentication refusal, connection failures, cooldown, and a retry control. Local liveness filters optional reads; required writes and deletion reads still attempt every destination. |
| Social totals | Visible compact action rows share bounded COUNT work. Stable-address reactions and Earthly comments retain totals across revisions. Unavailable counts are distinct from zero. |
| Zap receipts | Totals use parsed Lightning invoice amounts and normalized nutzap units instead of the old fixed 1,000-sat placeholder. Malformed receipts are skipped. |
| Signing | Removed the custom large-message signer/account implementations. Upstream v7 passes the one-MiB NIP-46 regression and restores nbunksec without reusing the connection secret. Existing account serialization and permissions remain supported. |
| Wallet | Validates decrypted token content before spend selection, preserves deletion-chain suppression even for malformed replacement proofs, bounds NWC capability discovery, and exercises v2 recovery, shortened keysets, and QR fragments. |
| Comments | Shoutbox uses upstream NIP-22 reply parsing in a snapshot-based tree builder, preserving deletion, missing/late parents, deterministic ordering, and depth limits. |
| Housekeeping | Uses public DeleteManager ownership, fixes affected Cast/Factory typing, adds runtime disposal, excludes scratch experiments from the main typecheck, prunes 32 resolved baseline entries, and refreshes reusable browser tasks. |

## Ownership and implementation guidance

### Transport and authentication

`src/lib/nostr/relayRuntime.ts` owns the guarded pool and `RelayLiveness`. `src/lib/nostr/index.ts` remains the composition root and public import surface. The router still decides which relays may be contacted. Liveness is temporary client-side evidence, not a change to saved relay preferences.

`relayAuthOptions()` captures the active account; callers publishing a signed event pass that event's pubkey. `relayAuthentication.ts` checks that the account is still current before and after asynchronous signing and checks the AUTH acknowledgement. Logged-out reads use `waitForAuth: false`.

Use the smallest appropriate read operation:

| Operation | Module | Contract |
| --- | --- | --- |
| Shared UI timeline | `hooks.ts` → `sharedTimeline.ts` → `liveTimeline.ts` | Cache-first, reference-counted, account-scoped; live events and per-relay EOSE; foreground recovery and optional-relay liveness. |
| Finite lookup | `finiteRead.ts` | Every selected relay is attempted with a deadline, event ceiling, and optional abort signal. Returns per-relay success/failure plus received events. The caller decides whether partial results suffice. |
| Required live deletion check | `requiredRelayStream.ts` | Attempts all sources, authenticates each operation, preserves source-specific EOSE and live records, and reports interruption as failure. The saved-region controller retains batching, ordering, persistence, and byte/record limits. |

Settings and relay-list discovery require at least one successful source. My Maps discovery requires all selected sources. Saved-region deletion checks cannot become ready through a timeout or a skipped relay. Search and seeder requests have explicit deadlines.

Do not pass lifecycle options to raw `req()` in v7. Single-relay `subscription()` emits events and the literal `"EOSE"`; group subscriptions omit that source-specific completion information. Do not attach liveness as a global pool filter: it would also affect required publication destinations. Calls through `pool.relay(url)` need deliberate eligibility policy.

`TimelineStatus.settled` means the initial loading presentation can settle. `complete` means every requested relay reached EOSE after cache hydration settled; it becomes false again on interruption. The legacy `eose` hook field is an alias for presentation settlement, so correctness-sensitive consumers must use `status.complete`. A disabled timeline is complete; a requested timeline with no relays is not.

The transport, shared timelines, loaders, count service, account persistence subscriptions, and outbox browser listeners now have explicit HMR cleanup. This is a focused ownership improvement; the remaining composition root was not split into thin forwarding modules.

### Social counts and receipts

`socialCounts.ts` owns one lazy service per account and relay policy. Concurrent visible readers share it; last-reader cleanup releases work. It limits active requests to four, inactive cached targets to 500, and an attempt to four seconds. `useVisibleSocialCounts.ts` manages viewport demand and retains the latest display snapshot while offscreen.

- Reactions to addressable entities: kind `7`, `#a = kind:pubkey:d`.
- Geographic discussion totals: kind `37517`, root `#A = kind:pubkey:d`.
- Reactions to ordinary events: kind `7`, `#e = event id`.

Each value is one relay's answer, with relay provenance and freshness available in the tooltip. It is not a deduplicated global total. Unknown displays as a dash with an accessible label. Unsupported COUNT does not trigger a full-history fallback. Acknowledged reaction/comment/deletion publication invalidates counts, including outbox replay. Own-reaction state and detailed discussions keep their event-based reads.

Both geographic and shoutbox reaction publication use reply routing. Development routing constraints remain in force.

`zapTotals.ts` interprets BOLT11 millisats as sats, checks the embedded zap request before attributing its sender, and normalizes supported nutzap units. These are amounts declared by receipts, not proof that the recipient's wallet balance increased. Malformed and unsupported-unit receipts do not contribute.

### Wallet and event integrity

Public events still enter a signature-verifying EventStore. A publicly supplied `DeleteManager` replaces private-field access. Custom types were migrated without disabling verification or loosening the main TypeScript baseline.

`spendableTokenContent()` validates mint, unit, deletion IDs, and proof fields before selection. Deletion-chain metadata is processed separately: malformed replacement proofs must not make previously consumed proofs spendable again. Recovery data is not erased by validation failure.

The existing account capture, Web Locks, per-account recovery couch, acknowledgement-before-store behavior, and action runtime remain. The wallet UI shows incomplete sync and keeps cached information available for inspection; readiness never follows merely from a four-second wait. NWC support discovery has a 15-second bound before the existing RPC deadline.

Use these current modules and their tests as migration examples. The preexisting local Applesauce skills contain older API examples; this task did not rewrite those user-owned, untracked skill directories.

## Evaluations and deferred work

| Candidate | Evidence and decision |
| --- | --- |
| Catalog time-window loader | A deterministic 300-event experiment downloaded 304 records over five requests, versus 600 over three growing-limit requests. A crowded same-second fixture reported incomplete coverage. Keep this as a pilot: converting the existing “next 100” UI and validating real network latency remain separate work. |
| Upstream ThreadModel | Its accumulation retains nodes after store deletion. Adopted its standard reply-pointer helper, with Earthly rebuilding the tree from current snapshots. Geographic kind `37517` comments keep their existing domain projection. |
| NutWallet orchestration | Retained Earthly's action runtime to preserve spend locking, publication acknowledgement, and recovery contracts. Adopting a second orchestrator is not required for the v7 correctness fixes. |
| Cached NWC sessions | The public client has no close method, and shared request streams retain work for a 60-second grace period. Kept operation-owned clients plus bounded capability discovery until a clear session lifecycle is available. |
| ContextVM | SDK 0.13.16 retains its isolated relay 6.2.1 dependency; the checked 0.14.3 release still requires that major. No unsupported global override was added. The generator also has an isolated older dependency tree. |
| Native sync / SQLite / RumorStore | Existing Rust local-node and MLS ownership remain. No second durable outbox, native database replacement, or public-store treatment of unsigned private records was introduced. |

NIP-66 monitoring, notifications, moderation, new chat/community surfaces, seed-word onboarding, and optimistic signature verification remain outside this migration.

## Verification and measurements

### Automated checks

- Pre-upgrade Nostr/wallet baseline: 232 tests passed across 47 files.
- Release validation: `bun run test` passed all 418 source, script, and operations test files. The maintained runner gives each file a fresh process to isolate Bun module mocks and DOM globals, enforces a file deadline, and propagates failures. CI runs this gate.
- Corrected stale Map labels, routing-limit and replacement-accounting assertions, and kept the compact chat prompt within its existing size budget. Nullable GeoJSON normalization now has an explicit renderable boundary; regression tests preserve metadata while rejecting invalid geometry from rendering.
- Schema validation without a spawnable Worker now rejects regex-dependent keywords before compilation. Worker validation retains regex support and its termination watchdog; separate cache policies prevent bypassing the synchronous restriction.
- Local wire-level relay fixtures cover two accounts sharing a socket, negative AUTH/publication acknowledgements, zero/unsupported COUNT, clean CLOSED resubscription, and reconnect after socket loss. Unit coverage also exercises finite-read cancellation/limits, liveness recovery, timeline completeness, wallet recovery, and signer restoration.
- Main typecheck: no new diagnostics; 292 existing diagnostics remain. Pruned 34 resolved entries. Scratch experiments are excluded, while maintained AI-suite tasks remain checked.
- Changed-file Biome checks have no errors, and the production build passes. The AI-suite typecheck now passes; both typecheck gates run in CI.
- Private-map MLS, delayed coordinator echo, and established-workspace join smoke scripts pass.
- Across focused browser runs, 21 desktop and six mobile checks passed. These cover remote-signer login (desktop), comments, social actions/counts, and application/platform smoke checks. Updated stale sign-in, action-menu, and responsive navigation selectors in reusable tasks; the viewport-specific skip remains intentional.

Android emulator checks passed for Nearby, Circles, Local drafts, warm App Link navigation, background/foreground with the same process, and force-stop/restart with a new process. The maintained instrumentation assertions now use current Nearby/Circles labels. The instrumentation APK could not be built because Google's Maven endpoints returned HTTP 404 for AndroidX test artifacts; the navigation/lifecycle checks were performed through ADB and UI Automator instead.

### Performance evidence

| Measurement | v6 baseline | v7 implementation |
| --- | --- | --- |
| Total emitted JavaScript, including separately built workers, uncompressed | 12,449,965 bytes / 207 files | 12,264,575 bytes / 221 files (about 1.5% smaller) |
| Bundler-reported build duration, one run | Approximately 1,006 ms | Approximately 1,066 ms (final run) |

These are build observations, not a startup or interaction-speed benchmark. Additional lazy chunks and the isolated ContextVM dependency tree remain. No percentage runtime-speed claim is made.

The new COUNT browser contract verifies two shared metric requests for a visible entity and no unbounded reaction-history request. The isolated local relay preserved geographic COUNT semantics through creation, addressable replacement, and deletion (0 → 1 → 1 → 0). A read-only probe of the configured production relay returned a supported COUNT response with zero results. All mutating browser fixtures used loopback and disposable test data.

History and protocol experiments live in ignored `ai-suite/scratch/`; generated logs and browser traces are not committed. Browser regression scenarios and reusable task changes are maintained in `ai-suite/`.

### Release limitations

Physical-device performance and live mint/NWC spending were not exercised. QR, recovery, and payment-receipt tests use controlled fixtures without moving real funds. The main compiler baseline still contains 292 legacy diagnostics; release checks reject new diagnostics rather than claiming a clean strict whole-project compile. Android instrumentation dependency downloads remain externally blocked as described above.
