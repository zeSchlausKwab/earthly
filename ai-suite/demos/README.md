# Earthly campaign demo recorder

Record a tested Earthly AI-chat flow as a 1920×1080 MP4, then keep the matching X post and
video alt text beside it. The recorder targets the loopback Earthly app only. It performs sign-in
and provider import in an unrecorded browser context so credentials and setup screens do not appear
in the final clip.

## One-time setup

1. Start the local Earthly stack with `bun run dev`.
2. In Earthly, open **Settings → Chat**, configure the provider/model, and choose **Export settings**.
3. Paste that plaintext JSON into `ai-suite/.secrets/live-chat.json`, then clear the clipboard. The
   `.secrets` directory is ignored by Git; the export contains plaintext API keys.
4. Install Chromium and ffmpeg if needed: `bunx playwright install chromium` and your platform's
   ffmpeg package.

Point the recorder at the secret snapshot for the current shell:

```bash
export EARTHLY_LIVE_AI_SETTINGS_FILE=ai-suite/.secrets/live-chat.json
```

## Create and run a demo

Copy `example.geometry.json` and edit its human-facing fields:

- `prompts` is the tested prompt chain. Its `approvals` array is an allow-list and an assertion:
  add `edits` when the turn must visibly pass through one or more **Apply** gates, and
  `reference-publish` when it must ask **Publish and continue**. Every listed gate must appear at
  least once, every repeated gate of that kind is handled, and any unlisted gate stops the run.
- `target` makes the opening intent explicit: `conversation`, `new-dataset`, or `current-dataset`.
  Geometry tours and map-edit approvals require one of the Dataset targets; Earthly never silently
  creates an edit state for a read-only conversation.
- `tour` can contain `chat`, `geometry`, or `story`. Geometry zooms to the result and opens one
  editable feature. Story switches the AI-authored Story draft to its reader preview.
- `post` is the natural explanatory X copy emitted beside the video. `videoAltText` is optional but
  recommended.
- `xAccountTier` is `standard` (the default) or `premium`. It selects hard post, duration, and file
  limits; the recorder refuses a package that cannot be uploaded under that tier.
- `typingDelayMs` controls prompt typing; `actionDelayMs` controls the visible browser pace.

Validate cheaply, rehearse the real flow without keeping a video, then record:

```bash
bun run demo:check -- ai-suite/demos/my-demo.json
bun run demo:rehearse -- ai-suite/demos/my-demo.json
bun run demo:record -- ai-suite/demos/my-demo.json
```

Target selection happens before the recording trim point, so the published clip starts with the
first prompt rather than setup UI. Each recording gets a timestamped package under
`ai-suite/artifacts/demos/<demo-id>/`:

- an H.264 MP4 at 1920×1080, 30 fps, capped below 25 Mbps;
- `-post.txt` and optional `-alt.txt` ready to paste into X;
- `-details.json` recording which tested prompts and tour produced the clip.

Ask Codex to draft or revise a manifest when you want AI help. The JSON and the commands remain
usable directly when you do not.

Standard packages are limited to 280 post characters, 140 seconds, and 512 MB. Premium packages
are limited to 25,000 post characters, a video shorter than four hours, and 16 GB. Both tiers must
pass the MP4/H.264/yuv420p, 1920×1080, 30 fps, and 25 Mbps checks. See X's current
[video upload limits](https://help.x.com/en/using-x/x-videos) before publishing; update these hard
limits when X changes its documented contract.
