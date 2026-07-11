# Earthly agent guidance

## Browser automation

Before writing Playwright or browser-automation code, read `ai-suite/README.md` and run
`bun run ai:list`.

- Reuse tasks from `ai-suite/tasks/` instead of duplicating selectors or flows.
- Put one-off experiments in `ai-suite/scratch/`; do not commit generated artifacts.
- Promote an experiment only when it represents a reusable Earthly action and has scenario coverage.
- Never point mutating AI-suite tasks at a non-loopback URL or public relay.
- Prefer user-visible roles and labels. Add `data-testid` only when no stable semantic selector exists.
- Do not use fixed sleeps; wait for observable UI or network state.

Use the repo-local `earthly-ai-suite` skill for audits, browser workflows, and E2E scenarios.
