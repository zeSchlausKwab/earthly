# Earthly AI suite

This directory is the shared browser toolbox for humans and AI agents working on Earthly. It is
deliberately rough at the scenario level and strict at the task level: experiments are welcome,
but stable tasks must hide selectors, document side effects, and verify their own postconditions.

## Quick start

The suite connects to an already-running local Earthly server. It never starts or resets `bun dev`
by default because that command resets and seeds the relay.

```bash
bun run ai:list
bun run ai:typecheck
bun run ai:e2e
bun run ai:e2e:editor
bun run ai:audit
bun run ai:audit:editor
bun run ai:audit:workflows
bun run ai:known-issues
bun run ai:verify
bun run ai:e2e -- --project mobile
bun run ai:e2e:visible
```

Configuration:

- `AI_SUITE_BASE_URL` — defaults to `http://localhost:3000`; loopback URLs only.
- Local commands always launch a visible browser so a developer can watch the workflow.
- `AI_SUITE_SLOW_MO` — visible action delay in milliseconds; defaults to `75` locally.
- `CI=1` — the only headless mode; also enables CI retries and disables the action delay.

Install the browser once after installing dependencies:

```bash
bunx playwright install chromium
```

Artifacts are written to `ai-suite/artifacts/` and ignored by Git. Playwright keeps screenshots and
traces for failures.

## Structure

- `core/` — environment guards, readiness, the `EarthlySession` interface, and task metadata.
- `fixtures/` — Playwright fixtures exposed to scenarios.
- `personas/` — deterministic local identities and browser-extension adapters.
- `tasks/` — reusable Earthly actions. Tasks own selectors and action sequencing.
- `scenarios/` — product claims composed from tasks.
- `scratch/` — disposable scripts and investigations.

## Task contract

Every promoted task must:

1. Represent a reusable Earthly action rather than one test's assertion.
2. Export metadata: id, summary, preconditions, side effects, and supported viewports.
3. Accept an `EarthlySession` instead of creating browsers or discovering servers itself.
4. Prefer roles, labels, and visible text over implementation classes.
5. Verify that the action reached its expected postcondition before returning.
6. Avoid fixed sleeps and remote side effects.
7. Be exercised by at least one scenario.

Scenarios own business assertions. A task may verify that it successfully opened or saved something,
but it should not encode unrelated product expectations.

## Adding automation

Search `tasks/` and run `bun run ai:list` first. If no task fits, prototype under `scratch/`. Promote
the automation only if it is a core user action or will be reused by more than one scenario.

Known product bugs are represented with Playwright's expected-failure marker. When a fix makes such a
scenario pass, Playwright reports an unexpected pass so the marker can be removed.

Audit scenarios use the `@audit` tag and attach JSON observations plus screenshots to the HTML
report. `@known-issue` scenarios are narrow red-capable reproductions: they should fail for the
documented product reason, not merely record a metric. `ai:e2e` excludes the evidence-heavy audit
sweeps so map rendering and screenshot capture do not starve ordinary workflow checks; `ai:verify`
runs the regular and audit groups sequentially. Run any individual group with the scripts above.

`@workflow-audit` scenarios publish disposable events to the local development relay. They are
excluded from regular E2E and `ai:verify`; run them deliberately with `bun run ai:audit:workflows`.
Earthly's localhost relay router must keep public writes disabled throughout these scenarios.

## GeoEditor refactor safety net

`@editor-contract` is the fast, non-publishing characterization layer for the GeoEditor. It covers
cancel/unlock recovery, undo/redo, geometry draft reload, and the active draft's Map Stack
lifecycle on desktop and mobile where the product surface exists. It is part of the regular
`ai:e2e` run and can be run alone with `bun run ai:e2e:editor` while changing editor internals.

`@editor-ux-audit` captures comparable browser-health, surface inventory, and screenshots at
browse, new-draft, drawing, and cancelled-drawing states. Run it with `bun run ai:audit:editor`.
Its evidence is deliberately separate from the pass/fail contract so UI improvements do not turn
into brittle pixel assertions.

Deep collaborative drawing remains in `@workflow-audit` because it publishes local Nostr events.
That group exercises point/line/polygon/label comment attachments, default annotation visibility,
hide/show, zoom and reload durability, plus a Dataset proposal that changes geometry and becomes
the accepted canonical version. Run it only against the disposable local relay with
`bun run ai:audit:workflows`.

The `mobile` Playwright project is a responsive-browser contract, not an Android WebView test. Use
`bun run e2e:android:smoke` for Tauri commands, app links, intents, permissions, safe areas, and
process-lifecycle behavior; `bun run e2e:android:emulator` starts or selects the deterministic AVD.
Deep multi-persona collaboration currently stays in the browser suite because the NIP-07 test
personas are browser adapters. Promote only the smallest native-critical journeys to Android
instrumentation instead of duplicating the whole browser matrix.

## Personas and safety

`owner` and contributor personas reuse the development identities from `src/lib/fixtures.ts`. They
are public test keys and must only be used with local development relays. The NIP-07 adapter signs in
through Earthly's real browser-extension login control and can sign local test events.

Publishing tasks remain localhost-only and deliberately excluded from the default smoke suite.
Destructive tasks should eventually run in an isolated managed environment; until that adapter
exists, do not add them to the default smoke suite.
