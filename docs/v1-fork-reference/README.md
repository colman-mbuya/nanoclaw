# v1 fork reference

Your v1 install at `/home/nanoclaw/nanoclaw` had **113 commits ahead of upstream**.
v2 is a ground-up rewrite, so those source patches don't apply mechanically.
This directory stashes the relevant v1 source files plus a commit list so you
can re-implement features against v2's architecture if you still want them.

## What's already preserved in v2

These customizations survived the migration without manual porting:

- **Personality, Firecrawl, Outlook integration, scheduling timezone note** —
  kept in `groups/whatsapp_main/CLAUDE.local.md` with paths updated to
  `/workspace/agent/`.
- **Firecrawl skill** (`container/skills/firecrawl/`) — copied across; the
  `/workspace/agent/.env` reference is now corrected.
- **Sub-agent SOPs** (`groups/whatsapp_main/agents/...`) — copied wholesale,
  paths inside them are still `/workspace/agent/...` so they work as-is.
- **Group `.env`** with `FIRECRAWL_API_KEY` etc. — copied.
- **Baileys keystore** (`store/auth/`) — copied so the phone stays paired.

## Features that need re-implementation against v2 if you want them back

| v1 feature | v1 file (stashed) | Why it doesn't port |
|------------|-------------------|---------------------|
| Voice transcription (OpenAI Whisper) | `src/transcription.ts` | v2 WhatsApp adapter has no Whisper hook. Reimplement as an MCP tool or as a host-side hook in `src/channels/whatsapp.ts` (v2 version). |
| TTS voice replies (OpenAI TTS) | `src/tts.ts` | Same — no TTS path in v2 WhatsApp adapter. |
| Image vision (sharp + multimodal blocks) | `src/image.ts` | v2 routes inbound messages through the two-DB session model; image-as-content-block handling would need to be added to the adapter and the agent-runner. |
| `[Attach: path]` outbound marker | (in v1 `src/channels/whatsapp.ts`) | v2 already supports outbound file attachments via a different code path (see `src/channels/whatsapp.ts` line ~716 — "Send file attachments"). Test whether the marker syntax still works or if v2 uses a different convention before assuming feature parity. |
| Bypass OneCLI proxy for Firecrawl | `src/container-runner.ts` patch | v2 routes credentials through OneCLI in a different way — see `docs/build-and-runtime.md` and the `onecli-gateway` container skill. Firecrawl using its own API key from `/workspace/agent/.env` should "just work" without a bypass. |
| Auto-load `/workspace/group/.env` into agent process.env | `container/agent-runner/src/index.ts` patch | In v2 this is `/workspace/agent/.env`. The v2 agent-runner already loads it — check `container/agent-runner/src/` before patching. |
| Pin model to `claude-sonnet-4-6` (200K context) | `container/agent-runner` patch | In v2, set this via `container_configs.model` in the central DB: `ncl groups config update --id <agent-group-id> --set model=claude-sonnet-4-6`. No source patch needed. |
| Firecrawl CLI in Dockerfile | `container/Dockerfile` | Trunk v2 doesn't bundle the Firecrawl CLI — add it to the Dockerfile's pnpm global-install block, pinned via a new `ARG`, then rebuild via `./container/build.sh`. |

## Stashed files

- `src/transcription.ts` — voice-note → text via OpenAI Whisper
- `src/tts.ts` — text → MP3 reply via OpenAI TTS
- `src/image.ts` — inbound image preprocessing (sharp + multimodal block builder)
- `src/whatsapp.v1.ts` — full v1 WhatsApp adapter for reference (don't drop in as-is — v2's adapter is structured very differently)
- `v1-commits.txt` — first 80 commit subjects, run `git -C /home/nanoclaw/nanoclaw log upstream/main..HEAD` for the rest

## v1-only container skills

`skills/capabilities/` and `skills/status/` were moved here because they
reference v1-only concepts (`/workspace/project`, the "main channel"
distinction, `/workspace/ipc`, `/workspace/extra`). See `skills/README.md`.

## v1 checkout

`/home/nanoclaw/nanoclaw` is left untouched and read-only as far as this
migration is concerned. Delete it whenever you're confident v2 has
everything you need.
