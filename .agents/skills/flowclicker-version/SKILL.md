---
name: flowclicker-version
description: Classify completed FlowClicker product or build changes, update its release notes, and apply the required SemVer bump before final validation. Ignore documentation, plans, tests, and agent-instruction-only changes.
---

# FlowClicker Version

After completing product or build changes, classify the task-owned diff by its highest impact:

- **major**: incompatible persisted-state, public workflow/API, platform identity, or behavior change without compatibility handling
- **minor**: backward-compatible feature or capability
- **patch**: compatible fix, warning cleanup, styling, internal refactor, or build/config correction
- **none**: documentation, plans, tests, or agent instructions only

An explicit user-selected level overrides classification. Run:

For every `major`, `minor`, or `patch` bump, first update `RELEASE_NOTES.md` with the complete user-facing body for that release. Keep the portable-download introduction and replace the bullets under `## What's Changed` with concise summaries of the task-owned changes. Do not include a version heading because the workflow supplies the release name.

Then run:

```bash
python3 .agents/skills/flowclicker-version/scripts/bump_version.py <major|minor|patch|none>
```

The script derives the target from the version committed at `HEAD`, requires a non-empty task-owned `RELEASE_NOTES.md` change for a bump, updates only `src-tauri/Cargo.toml` and FlowClicker's root `src-tauri/Cargo.lock` entry, and refuses unrelated working version edits. It is idempotent before commit. Never stage, commit, or tag.

After the user commits and pushes the release notes and version bump to `main`,
GitHub Actions owns release tag creation and publishing; never commit, tag,
push, or publish from this skill.
