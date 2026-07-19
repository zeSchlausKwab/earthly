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
bun run experience:audit:ai -- --project desktop
```

## AI-assisted journeys

AI journeys have two deliberately separate evidence lanes:

- `experience:audit:ai` uses a deterministic OpenAI-compatible model fixture. It exercises the
  production chat stream, tool registry, edit-approval gate, GeoEditor, and publication workflow,
  but makes no claim about model intelligence or source correctness.
- `experience:audit:ai:live` is an explicit, potentially paid experience audit against a real
  provider. It is skipped unless `EARTHLY_LIVE_AI_SETTINGS_FILE` points to a settings snapshot.

Keep live settings outside Git. The conventional path is already ignored:

```bash
mkdir -p ai-suite/.secrets
chmod 700 ai-suite/.secrets
$EDITOR ai-suite/.secrets/chat-settings.json
chmod 600 ai-suite/.secrets/chat-settings.json
EARTHLY_LIVE_AI_SETTINGS_FILE=ai-suite/.secrets/chat-settings.json \
  bun run experience:audit:ai:live -- --project desktop
```

The file accepts the same version-2 JSON as Earthly's **Settings → Chat → Import settings** action.
Live tests disable Playwright traces, screenshots-on-failure, and video because those artifacts can
retain authorization headers or plaintext form values. Journey screenshots begin only after the
import field has been cleared. Do not use private-group, unpublished, customer, or other sensitive
content in a live-model prompt.

## Rules

- Experience personas never contain credentials. Automation signs with `test-identities/`.
- API credentials never belong in personas, journeys, fixtures, committed snapshots, or artifacts.
- Every journey includes recovery, understanding, and follow-up work.
- Exploration begins from the participant prompt without selector or implementation hints.
- Deterministic replay composes reusable tasks from `ai-suite/tasks/`.
- Run evidence belongs in ignored Playwright artifacts. Only triaged findings are versioned.
- Hypothetical AI behavior is not user validation; preserve the evidence level.
- A finding is not automatically a feature request. Map it to shared capabilities first.
- Keep findings in research until they recur across at least two meaningfully different journeys
  or reveal a blocker, data-loss, privacy, security, or accessibility failure. During a research
  cohort, add evidence and contracts for current behavior; do not interleave speculative UI fixes.
- Start event-count-sensitive audits from a fresh `bun run dev`; the command resets and seeds the
  local LMDB relay before serving Earthly.
