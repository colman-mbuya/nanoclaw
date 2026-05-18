# v1 fork reference: skills

These container skills were carried over from a v1 install but reference v1-only
concepts that don't exist in v2 — `/workspace/project`, `/workspace/ipc`,
`/workspace/extra`, the "main channel" distinction, and the old `/workspace/group/`
mount (renamed to `/workspace/agent/` in v2).

They've been moved here rather than translated because each is too v1-architected
to mechanically rewrite. If you still want them in v2, rewrite each by hand and
move the folder back to `container/skills/<name>/`. Otherwise leave them here
as historical reference or delete.

## What each one did in v1

- **capabilities/** — self-introspection skill the agent ran to list what tools,
  mounts, and channels it had access to. References `/workspace/project`,
  `/workspace/group/CLAUDE.md`, `/workspace/extra/`. v2 surfaces capability info
  through the runtime system prompt and `container/CLAUDE.md`, so the skill is
  largely redundant.

- **status/** — printed a one-line health summary (working dir, channel,
  whether the main-channel mount was attached). Concept is v1-only: v2 doesn't
  have a "main channel" — see `docs/isolation-model.md`.
