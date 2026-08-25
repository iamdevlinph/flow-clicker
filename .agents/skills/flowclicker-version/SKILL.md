---
name: flowclicker-version
description: Classify completed FlowClicker product or build changes and apply the required SemVer bump before final validation. Ignore documentation, plans, tests, and agent-instruction-only changes.
---

# FlowClicker Version

After completing product or build changes, classify the task-owned diff by its highest impact:

- **major**: incompatible persisted-state, public workflow/API, platform identity, or behavior change without compatibility handling
- **minor**: backward-compatible feature or capability
- **patch**: compatible fix, warning cleanup, styling, internal refactor, or build/config correction
- **none**: documentation, plans, tests, or agent instructions only

An explicit user-selected level overrides classification. Run:

```bash
python3 .agents/skills/flowclicker-version/scripts/bump_version.py <major|minor|patch|none>
```

The script derives the target from the version committed at `HEAD`, updates only `src-tauri/Cargo.toml` and FlowClicker's root `src-tauri/Cargo.lock` entry, and refuses unrelated working version edits. It is idempotent before commit. Never stage, commit, or tag.
