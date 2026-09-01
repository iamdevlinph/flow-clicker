# FlowClicker Product Plan

## Frontend toolchain

The frontend and WebView2 experiment are authored in strict TypeScript. Plain
`tsc` emits `.js` beside the static assets; Vitest runs the existing Node-only
tests without DOM emulation. Run `pnpm install --frozen-lockfile`, `pnpm check`,
`pnpm test`, and `pnpm build` before desktop packaging.

## Product intent and invariants

FlowClicker is a Tauri desktop application that records and replays physical OS
mouse clicks. It does not inject DOM events, use WebDriver, or support
background-tab clicking.

- Record click actions only. Pointer movement may be observed to locate a click,
  but movement actions are never stored.
- A click's `delayMs` is the delay before that click. Delay actions are explicit
  waits.
- Combining flows and importing actions deep-copy source actions and assign fresh
  IDs; source flows are never mutated.
- Combined-flow order is the checkbox selection order shown in the library.
- Canceling a prompt or dialog makes no change.
- State is persisted as `state.json` in the user's application-data directory,
  with the two preceding valid saves retained as `state.json.bak1` and
  `state.json.bak2` for transparent recovery.
- Stop requests must halt physical playback promptly.

## Status legend

- **Implemented and verified**: present in code with completed validation.
- **Verification pending**: present in code, but the required automated or
  platform smoke test has not been completed.
- **Planned**: approved work not yet implemented and verified.
- **Deferred**: intentionally outside the active milestone.

## Current feature inventory

Unless noted otherwise, these capabilities are present in code with
**verification pending**:

- Flow library with search, groups, and card drag reordering.
- Click-only recording; action editing and grouping; imports; and group repeats.
- Numbered click-map overlay with draggable points.
- Flow combining with fresh IDs, source immutability, and selection-order output.
- Playback by repeat count, duration timer, local stop time, or continuously.
- Shared playback configuration for every flow, global hotkeys, platform
  detection, and `state.json` persistence.
- Windows foreground-window-relative playback.
- macOS shared Enigo/Rdev playback and recording with screen-coordinate fallback.

No inventory item should be treated as **implemented and verified** until its
relevant automated check or platform smoke test is recorded here.

## Known gaps and defects

- Editor grouping and multi-selection interactions are incomplete.
- Rendered and physical smoke verification remains pending.
- Closing the overlay with Alt+F4 has an application-lifecycle defect.
- The frontend controller duplicates state/model behavior and lacks adequate
  automated coverage.

## Active milestone: approved library-first UI

All items remain **planned** until implemented and verified.

Implementation evidence (2026-08-24): focused Node coverage passes for flow
ordering, combine-selection order, playback-form mapping, and editor table
rendering. JavaScript syntax and whitespace checks also pass. Rendered desktop
verification remains pending, and the Rust check is blocked on unavailable
system GTK/pkg-config libraries in the current environment.

Follow-up evidence (2026-08-24): the compact library follow-up is implemented;
focused Node coverage, frontend syntax checks, and whitespace checks pass. The
library now uses card-only combine selection, four-column cards, unlabeled
ungrouped flows, row/header drag cues, and shared focus-managed group naming.
Combine ordering and pure group cancellation/save transformations are also
covered by the focused Node checks; code inspection confirms group saves use
the existing autosave path without touching flows. Rendered desktop verification
remains pending.

Click-map interaction evidence (2026-08-28): leaving the editor through the
Flows or Settings main navigation also hides the click map; the focused overlay handles
Escape through the existing hide path. Focusing an action name makes it the
primary selection and preserves full-value selection across the editor rerender.
The overlay emphasizes only the primary selected click and clears emphasis for
delays or no selection. Focused frontend coverage, JavaScript syntax checks,
Rust formatting, 14 Rust tests, `cargo check`, and whitespace validation pass.
Rendered comparison remains unavailable because no desktop browser tooling is
connected; physical input was not exercised.

Startup/speed correction evidence (2026-08-28): the main native window starts
with the shipped `--bg` color, playback speed controls use a 1–50× range with
1× steps, and frontend/backend normalization clamps sub-1× values to 1× while
preserving fractional values at or above 1×. Focused frontend and Rust tests,
frontend syntax, and whitespace checks pass; rendered cold-launch comparison
remains unavailable and physical playback was not exercised.

Recording-replacement and playback-effect evidence (2026-08-28): recording
startup now replaces the selected flow's actions and clears editor selection
only after the native recorder starts successfully, then persists the empty
flow. Successful physical click releases emit a nonfatal, primary-monitor-only
450 ms CSS ripple through the existing click-through overlay, which is hidden
when playback stops or completes; opening the interactive click map restores
normal cursor interaction and focus. The playback-settings gear reuses the
existing accessible 32×32 icon-button pattern. Focused frontend tests, frontend
build and type checks, Rust formatting, and 16 Rust tests pass. Physical input
and rendered desktop comparison were not exercised.

Lifecycle/settings evidence (2026-08-24): empty-library normalization, deletion
selection rules, and validated hotkey capture normalization are covered by
focused Node checks; frontend syntax and whitespace checks pass. Rendered and
physical hotkey verification remain pending.

In-window editor evidence (2026-08-30): editing is a Flows subview in the fixed
460×720 main window. Actions render as compact wrapping cards with inline names
and native per-action disclosure for metadata and row-local move, duplicate, and
delete controls. The legacy
`editorSize` field remains accepted as ignored schema-version-3 compatibility
data. Rendered comparison and physical input verification remain pending.

Collapsible-group evidence (2026-08-24): group collapse state is normalized
into schema-version-3 group records, defaults new and legacy groups to
expanded, survives rename, and toggles immutably through the existing
autosave path. Native disclosure markup and larger group-only action hit areas
are covered by focused Node checks; active search visually expands collapsed
groups without changing saved state. Rendered desktop comparison remains
pending.

Group-ordering evidence (2026-08-30): named groups can be reordered by dragging
their headers or pressing Alt+Up/Down on the focused disclosure. Reordering
preserves group records and uses the existing autosave path; Ungrouped remains
fixed above named groups. Flow cards use reduced padding and spacing for a more
compact library. Focused frontend tests, type checks, build, and whitespace
validation pass. Rendered desktop, persistence-after-reload, and physical drag
verification remain pending because desktop tooling is unavailable.

Runtime-status evidence (2026-08-25): the main window reserves a full-width
status banner above the top bar. It announces Idle, Recording, and Playing
states accessibly and uses the existing grey, red, and green tokens. Focused
Node coverage, frontend syntax checks, and whitespace checks pass; rendered
desktop comparison remains unavailable because the current environment lacks
the Tauri/Linux GUI dependencies.

Playback-banner evidence (2026-08-25): playback status now reports execution,
repeat, duration, and local 12-hour until-time context. Focused frontend
checks, syntax, and whitespace validation pass; physical playback and rendered
desktop comparison remain pending.

Playback HUD and activity badge evidence (2026-08-28): playback temporarily
reuses the main window as a compact 220×36 logical-pixel, frameless, always-on-top,
unfocusable, click-through HUD clamped to the current monitor work area. The
click-map overlay is hidden for playback and the main window's size, position,
decorations, and stacking are restored after stop, completion, or failure,
revealing the editor subview when playback began there. The existing accessible runtime status is the only HUD content;
recording keeps the normal UI. Native activity commands apply green playback,
red recording, and normal idle app-icon badges; badge/HUD failures are
nonfatal. Focused Node checks, syntax, and whitespace validation pass; native
Rust validation and rendered desktop comparison remain unavailable here
because the required GUI/dependency environment is absent.

Duration persistence evidence (2026-08-27): stopping duration playback through
the hotkey or editor Stop button saves the rounded-up whole-second remainder in
shared playback settings, clamped to one second; natural completion, errors,
other modes, and changed duration settings leave the configured value alone.

Version-display evidence (2026-08-25): `Cargo.toml` is the single packaged
version source at 1.1.0. The main header and main native window title obtain
that version at runtime; editor and overlay titles remain unchanged. The
version-script tests, 30 frontend tests, JavaScript syntax checks, 8 Rust tests,
`cargo check`, whitespace validation, and macOS bundle build pass. The bundle
reports version 1.1.0 and identifier `com.flowclicker.desktop`; only the retained
transitive `block v0.1.6` future-compatibility notice remains. Rendered comparison
is unavailable because no browser is connected. The skill validator is blocked
because its host Python environment lacks `yaml`; manual metadata inspection and
the skill's behavior tests pass.

Portable-data evidence (2026-08-26): Settings can export schema-version-3 flows
and groups to a dated `.flowclicker.json` file, or replace the library from a
chosen file or pasted JSON after destructive confirmation. Strict validation
and focused Node coverage verify round trips, source immutability, device-local
setting preservation, empty libraries, malformed or unsupported data, invalid
actions, duplicate IDs, and broken group references. Frontend syntax and
whitespace checks pass. Native Rust validation is blocked by unavailable Linux
GTK/pkg-config tooling; rendered comparison is unavailable in this environment.

Linux build-support evidence (2026-08-26): the Ubuntu-family x86_64 build path
now installs missing Tauri/X11 prerequisites, builds AppImage and Debian
bundles, and validates/copies them to `dist/FlowClicker.AppImage` and
`dist/FlowClicker.deb`. Shell syntax, frontend tests and syntax, versioning, and
whitespace checks pass. Package installation, Rust checks, the full bundle
build, and artifact inspection are blocked on this host because `sudo` cannot
prompt for its password; physical input and rendered desktop verification
remain pending until an X11 desktop is available.

- [ ] Make the flow library the primary application view.
- [ ] Put Edit, Duplicate, and Delete in each card's right-click menu.
- [ ] Keep card dragging as the manual flow-ordering interaction.
- [ ] Open a full playback-settings modal from the card gear.
- [ ] Move flow combining to **Actions → Combine Flows** in a modal.
- [x] Edit flows in a compact Flows subview of the fixed main window.
- [x] Keep Settings and the closed-editor state compact.
- [ ] Dismiss the Actions menu on click-away.
- [x] Make Escape dismiss the click-map overlay.
- [ ] Make Alt+F4 exit the application, including when the overlay has focus.
- [ ] Keep the overlay as a separate OS window in the same Tauri process.
- [ ] Remove frontend controller duplication and leave responsibilities in
      descriptive, independently testable files.
- [ ] Add focused automated coverage for the refactored state and interaction
      behavior.
- [ ] Validate the decomposed implementation, compare the rendered UI with its
      closest shipped analogues, and complete structural review.

## Deferred roadmap

Parallel WebView2 experiment (2026-08-27): disposable Stage A trusted-input
POC added under `experiments/webview2-input-poc/`. Automated contract tests pass
on macOS; Windows bridge compilation and the explicitly approved live proof are
pending, so the result remains **NOT RUN** and no successor-app work may start.

- Multi-monitor overlay selection and virtual-desktop coverage.
- Stronger Windows matching using process executable and HWND metadata instead
  of title text alone.
- macOS window-relative tracking plus Accessibility permission-status UX.
- Flow and action drag improvements not already implemented.
- Remaining automated coverage for combine, import, repeat, and stop behavior.
- Physical Windows and macOS smoke tests, including recording, playback,
  hotkeys, prompt cancellation, and prompt Stop response.

## Decision log

- The card right-click menu owns Edit, Duplicate, and Delete.
- Card dragging remains the manual ordering mechanism.
- The card gear opens a full playback-settings modal.
- **Actions → Combine Flows** opens a modal.
- The main window stays fixed at 460×720; editing opens a compact Flows subview
  whose renderer sends narrow edit/transport intents to the main controller.
- Settings and closed-editor states use a compact window.
- Escape dismisses the overlay; Alt+F4 exits the application.
- The overlay is a separate OS window in the same process.
- Flow-group collapse is persisted as `collapsed` on each schema-version-3
  group; search is a temporary visual override and does not rewrite that
  preference.
- Legacy `editorSize` data remains accepted for schema-version-3 compatibility
  but has no runtime window-management effect.
- Playback settings are shared by every flow and edited from any card's gear;
  double-clicking a card also opens those settings. Each card keeps a pencil
  action for opening the editor, and the steps editor keeps row-local move,
  duplicate, and delete icon actions in an Actions column.
- Portable exports contain flows and groups only. Portable import accepts a
  chosen file or pasted JSON, replaces the library after confirmation, and
  preserves device-local settings and editor size.
- Right-click action evidence (2026-08-28): click actions carry strict
  `left`/`right` buttons across recording, editing, playback, persistence,
  copying, and portable transfer; legacy missing buttons default to left.
  Focused Node and Rust checks pass; rendered and physical input verification
  remain pending.
- Flow-card interaction evidence (2026-08-30): double-click opens shared
  playback settings, while the pencil and Edit-menu actions open the editor.
  Frontend checks, build, full Vitest, version validation, and whitespace
  validation pass; rendered comparison remains unavailable.
- The main-window runtime state is always visible in a layout-reserving banner
  above the top bar: grey Idle, red Recording, and green Playing.
