# FlowClicker Codex Notes

## Goal
FlowClicker is now a Tauri desktop app. It intentionally uses the physical OS mouse rather than DOM events or WebDriver. Background-tab clicking is out of scope for now.

## Architecture
- `src/`: framework-free HTML/CSS/TypeScript. `pnpm install --frozen-lockfile && pnpm build` emits browser JavaScript beside the static assets; `pnpm test` runs Vitest in Node.
- `src-tauri/`: Rust/Tauri backend.
- `enigo`: cross-platform physical mouse playback.
- `rdev`: cross-platform global mouse/keyboard observation for click-only recording and hotkeys.
- `src-tauri/src/platform.rs`: small OS-specific window-relative layer. Windows is implemented first; macOS currently falls back to screen coordinates.

## Invariants
- Record click actions only. Observe mouse movement internally only to know the pointer position; never store movement actions.
- `delayMs` on a click means delay *before* that click.
- Delay actions are explicit waits.
- Never mutate a source flow when combining flows or importing actions. Always deep-copy and assign fresh IDs.
- Combined-flow order is the checkbox selection order shown in the Flow Library.
- Local state is written to the user's application-data directory as `state.json`.
- Physical playback must stop promptly when Stop is requested.

## UI behavior
- Keep product-facing layout and workflow decisions in `PLANS.md`.
- Import Actions modal copies selected actions from another flow at beginning/end/after selected action.
- Click-map overlay is an OS window, not injected into the target webpage.

## Current platform status
- Windows: physical playback, global recording, global hotkeys, foreground-window-relative coordinates.
- macOS: Enigo/Rdev paths are shared; Accessibility permission is required. Screen-coordinate playback is the current fallback. Add Quartz/CGWindow-based window-relative tracking in `platform.rs` later.

## Development guidance
- Read the existing documentation and nearby implementation before editing. Keep changes minimal, architecture-aligned, and limited to the request; preserve unrelated work and dirty state.
- TypeScript is strict and runtime modules retain `.js` import specifiers so emitted browser assets work without a bundler. Do not add DOM emulation for Node tests.
- Read and preserve `PLANS.md` during product-facing work and template reconciliation. Record only evidence-backed durable decisions, roadmap/status, and resume-worthy milestones; never invent or backfill speculative history. Update feature status only after implementation and verification.
- Before user-facing changes, inspect the closest existing UI pattern and reuse its structure, styling, interactions, responsive behavior, and native accessibility semantics. Compare the rendered result when tooling permits and report when it does not.
- For every new or materially changed feature, keep entrypoints focused on composition, move independently understandable concerns into descriptive feature-local files, run targeted validation, and obtain a `code-reviewer` structural review.
- Use the repository's existing Cargo and platform build conventions. Run the smallest check that validates the change; documentation-only edits do not require an application build.
- Get explicit approval before running physical playback or global input hooks because they can observe or control real OS input.
- When `TEMPLATE_AGENTS.md` changes or `codex-kit project status` requires reconciliation, use the global `codex-kit-reconcile-agents` skill; never replace this file wholesale or run `codex-kit project sync` on the user's behalf.
- After completed product or build changes, use `.agents/skills/flowclicker-version` before final validation. Classify the task-owned diff by its highest SemVer impact; an explicit user-selected level wins.

## Roadmap
See `PLANS.md` for current feature status, the active milestone, decisions, known gaps, and deferred work.
