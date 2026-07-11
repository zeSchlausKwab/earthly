---
name: earthly-ai-suite
description: Reuse and extend Earthly's repository-owned Playwright task toolbox and E2E scenarios. Use when auditing the Earthly UI, automating browser workflows, logging in with development personas, progressing onboarding, creating datasets or Stories, reproducing UI bugs, writing Playwright regression coverage, or considering a new reusable browser script.
---

# Earthly AI Suite

Use `ai-suite/` as the first choice for Earthly browser automation. Keep stable selectors and
workflow knowledge inside reusable tasks so fixes remain local.

## Workflow

1. Read `ai-suite/README.md` completely.
2. Run `bun run ai:list` and inspect `ai-suite/tasks/` before writing automation.
3. Reuse existing tasks in a scenario whenever possible.
4. Put one-off investigation code in `ai-suite/scratch/`.
5. Promote a scratch flow only when it is reusable and has scenario coverage.
6. Run the narrowest relevant scenario, then the complete suite when practical.

## Commands

```bash
bun run ai:list
bun run ai:typecheck
bun run ai:e2e
bun run ai:e2e -- --project mobile
bun run ai:e2e:headless
```

Set `AI_SUITE_BASE_URL` to override `http://localhost:3000`. The suite rejects non-loopback URLs.

## Contribution rules

- Accept an `EarthlySession`; do not create a browser inside a task.
- Export task metadata and list it in `ai-suite/catalog.ts`.
- Prefer roles and user-visible labels. Use test ids only when semantics are insufficient.
- Wait for observable state; never add fixed sleeps.
- Verify the task's postcondition before returning.
- Keep product assertions in scenarios.
- Never add real credentials or allow mutating tasks against remote URLs or public relays.
- Leave generated screenshots, traces, videos, and experiments untracked.

Use the seeded personas and NIP-07 adapter for routine local authentication. Test the real key
creation/import wizard only in scenarios specifically about identity onboarding.

If no existing task fits, keep the initial script in `scratch/`, prove it against the running app,
then extract the Earthly-level action into `tasks/` and add a scenario that exercises it.
