# FlowClicker Codex Notes

## Goal
FlowClicker is now a Tauri desktop app. It intentionally uses the physical OS mouse rather than DOM events or WebDriver. Background-tab clicking is out of scope for now.

## Architecture
- `src/`: framework-free HTML/CSS/JavaScript. No npm/Node build is required.
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
- Left panel: every flow, search, combine checkboxes, combine order badges.
- Center: selected flow editor and action table.
- Right: repeat, timing, hotkey, and platform settings.
- Import Actions modal copies selected actions from another flow at beginning/end/after selected action.
- Click-map overlay is an OS window, not injected into the target webpage.

## Current platform status
- Windows: physical playback, global recording, global hotkeys, foreground-window-relative coordinates.
- macOS: Enigo/Rdev paths are shared; Accessibility permission is required. Screen-coordinate playback is the current fallback. Add Quartz/CGWindow-based window-relative tracking in `platform.rs` later.

## Development guidance
- Read the existing documentation and nearby implementation before editing. Keep changes minimal, architecture-aligned, and limited to the request; preserve unrelated work and dirty state.
- Before user-facing changes, inspect the closest existing UI pattern and reuse its structure, styling, interactions, responsive behavior, and native accessibility semantics. Compare the rendered result when tooling permits and report when it does not.
- For every new or materially changed feature, keep entrypoints focused on composition, move independently understandable concerns into descriptive feature-local files, run targeted validation, and obtain a `code-reviewer` structural review.
- Use the repository's existing Cargo and platform build conventions. Run the smallest check that validates the change; documentation-only edits do not require an application build.
- Get explicit approval before running physical playback or global input hooks because they can observe or control real OS input.
- When `TEMPLATE_AGENTS.md` changes or `codex-kit project status` requires reconciliation, use the global `codex-kit-reconcile-agents` skill; never replace this file wholesale or run `codex-kit project sync` on the user's behalf.

## Suggested next work
1. Compile and smoke-test the Tauri app on Windows.
2. Add multi-monitor overlay selection/virtual-desktop overlay.
3. Improve Windows window matching using process executable + HWND metadata instead of title text only.
4. Add macOS window-relative tracking and permission-status UX.
5. Add drag reorder for flows and actions.
6. Add import/export `.flowclicker.json` files.
7. Add automated unit tests for combine/import/repeat behavior.
