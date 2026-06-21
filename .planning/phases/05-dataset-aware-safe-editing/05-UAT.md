---
status: testing
phase: 05-dataset-aware-safe-editing
source: [05-VERIFICATION.md]
started: 2026-06-21T08:05:00Z
updated: 2026-06-21T08:05:00Z
---

## Current Test

number: 1
name: Binding chip always-visible confirmation
expected: |
  BindingChip is always visible in the chat panel header at all times, even when no
  dataset is bound (shows 'Untitled draft'). The 'Just accept' toggle is visible
  alongside it. The chip shows the dataset name and feature count before any AI
  mutation fires — never a blank/missing chip.
awaiting: user response

## Tests

### 1. Binding chip always-visible confirmation
expected: Open the chat panel and observe the binding chip in the header. Send a message that triggers an AI write (e.g. "draw a circle here"). The chip always shows the dataset name and feature count before the mutation fires — never blank/missing. Shows 'Untitled draft' when nothing is bound. 'Just accept' toggle visible alongside.
result: [pending]

### 2. Diff disclosure renders without render loop (CR-01 — code review critical)
expected: With a dataset loaded, ask the AI to add new features AND modify/delete an existing one (e.g. "delete the first feature and add a point here"). At default Level 2 only the destructive changes require confirmation. An inline DatasetDiffDisclosure appears in the transcript showing classified counts (+N added · ~N changed · −N deleted), an expandable per-feature list, and Apply/Cancel buttons. Apply commits; Cancel leaves the editor unchanged. The block stays visible after resolution (Applied/Cancelled). **NOTE: CR-01 was fixed during execution (commit 9253578 — pendingDiffStore now caches its snapshot, invalidated in notify()). The diff panel should render without the "getSnapshot should be cached" loop. Still confirm in-browser that the panel renders and does not freeze.**
result: [pending]

### 3. Level 3 auto-apply + "Undo last AI edit" affordance
expected: Toggle 'Just accept' ON. Send a destructive request. (a) The mutation applies immediately without a confirm dialog; (b) the diff block still renders with 'Applied' status; (c) the 'Undo last AI edit' button appears and reverts the change when clicked (also Cmd+Z reverts via the dataset snapshot); (d) toggling OFF restores Level 2 (confirm-destructive) behavior.
result: [pending]

### 4. Safety level persistence across reload + Level 1 gating
expected: With the chat at Level 2 (default), set Level 1 via devtools (`useChatStore.getState().setSafetyLevel(1)`) or by importing settings with safetyLevel:1. Send a pure-add request (no modify/delete) — the user is prompted to confirm even a pure add at Level 1 (the diff appears pending, waiting for Apply/Cancel). Then reload the page and confirm the chosen safety level persists (encrypted settings round-trip via the live Nostr signer).
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
