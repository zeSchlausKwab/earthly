# Deferred Items — Phase 01

## Pre-existing lint (out of scope for Plan 01-01)

- **`src/features/chat/useChatSettingsSync.ts`** — 2 Biome `lint/correctness/useExhaustiveDependencies`
  errors: the load effect (`[currentUser, signer]`) and save effect
  (`[currentUser, serializedSnapshot, signer, snapshot]`) do not list `userPubkey` in their deps.
  - These predate Plan 01-01 (confirmed: present at HEAD before any edits).
  - Plan 01-01 Task 2 explicitly forbids touching the sync hook's effect deps / generation guard:
    "Do NOT change the generation-counter guard, debounced save, or effect deps in this task
    (Plan 02 owns the load-state amendments)."
  - Defer to Plan 01-02, which owns the load-state amendments to this hook.
  - **Update (Plan 01-02):** the LOAD-effect half is now RESOLVED — `userPubkey` was added to the
    load-effect deps as part of publishing the load lifecycle (commit `32da25f`). The SAVE-effect
    warning remains: Plan 01-02 Task 2 was explicitly scoped to the load effect only ("do NOT touch
    the debounced save effect"), and `userPubkey` is already read inside the save effect
    (`userPubkey ?? currentUser.pubkey`), so the remaining warning is cosmetic and behavior-neutral.
    Clear in a future maintenance pass.

## Pre-existing formatter nit (out of scope for Plan 01-03)

- **`src/features/chat/ChatSettingsSection.tsx`** — 1 Biome `format` diff on the unrelated
  "Changes are saved for the active Nostr account…" paragraph (the loaded-status banner copy,
  not touched by Plan 01-03). Biome wants the line-wrap re-flowed (`…when the app` / `starts.`).
  - Confirmed pre-existing: `git stash` + `biome check` at HEAD (`8aacf68`) reproduces the same
    single error before any Plan 01-03 edit.
  - Out of scope per the executor scope boundary (only auto-fix issues the current task caused).
    The Export/Import code added by Plan 01-03 lints clean. Clear in a future maintenance pass.
