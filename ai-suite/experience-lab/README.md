# Earthly Journey Lab

The Journey Lab combines behavioral experience personas, end-to-end goals, exploratory evidence,
human session cards, and promoted E2E contracts. The canonical product language lives in
`CONTEXT.md`; the full implementation direction lives in `docs/EARTHLY-JOURNEY-LAB-PLAN.md`.

## Commands

```bash
bun run experience:list
bun run experience:list -- --format json
bun run experience:card -- --journey squirrel-capture
bun run experience:card -- --journey event-venue-map --persona event-visitor
bun run experience:audit -- --project mobile
```

## Rules

- Experience personas never contain credentials. Automation signs with `test-identities/`.
- Every journey includes recovery, understanding, and follow-up work.
- Exploration begins from the participant prompt without selector or implementation hints.
- Deterministic replay composes reusable tasks from `ai-suite/tasks/`.
- Run evidence belongs in ignored Playwright artifacts. Only triaged findings are versioned.
- Hypothetical AI behavior is not user validation; preserve the evidence level.
- A finding is not automatically a feature request. Map it to shared capabilities first.
- Start event-count-sensitive audits from a fresh `bun run dev`; the command resets and seeds the
  local LMDB relay before serving Earthly.
