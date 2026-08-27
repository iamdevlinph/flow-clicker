# FlowClicker Product Plan

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
- State is persisted as `state.json` in the user's application-data directory.
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

- Separate editor-window grouping and multi-selection interactions are incomplete.
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

Lifecycle/settings evidence (2026-08-24): empty-library normalization, deletion
selection rules, and validated hotkey capture normalization are covered by
focused Node checks; frontend syntax and whitespace checks pass. Rendered and
physical hotkey verification remain pending.

Editor action-layout evidence (2026-08-24): row actions render as one compact
four-button group, the Target and Actions columns shrink-wrap their controls,
and the editor's native/document minimum width is 720 logical pixels. Focused
Node coverage, frontend syntax checks, configuration parsing, and whitespace
checks pass; rendered comparison remains pending because the current environment
lacks the Tauri/Linux GUI dependencies.

Collapsible-group evidence (2026-08-24): group collapse state is normalized
into schema-version-3 group records, defaults new and legacy groups to
expanded, survives rename, and toggles immutably through the existing
autosave path. Native disclosure markup and larger group-only action hit areas
are covered by focused Node checks; active search visually expands collapsed
groups without changing saved state. Rendered desktop comparison remains
pending.

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
- [ ] Open and stabilize the separate hidden editor OS window for flow editing.
- [ ] Keep Settings and the closed-editor state compact.
- [ ] Dismiss the Actions menu on click-away.
- [ ] Make Escape dismiss the click-map overlay.
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
- The main window stays compact; editing opens the separate hidden `editor` OS window, which receives flow snapshots and sends narrow edit/transport intents back to the main window.
- Settings and closed-editor states use a compact window.
- Escape dismisses the overlay; Alt+F4 exits the application.
- The overlay is a separate OS window in the same process.
- Flow-group collapse is persisted as `collapsed` on each schema-version-3
  group; search is a temporary visual override and does not rewrite that
  preference.
- Editor size is persisted as logical width/height on close and restored when
  the editor opens; position, maximized state, and continuous resize events are
  intentionally not persisted.
- Playback settings are shared by every flow and edited from any card's gear;
  the steps editor keeps row-local move, duplicate, and delete icon actions in
  an Actions column.
- Portable exports contain flows and groups only. Portable import accepts a
  chosen file or pasted JSON, replaces the library after confirmation, and
  preserves device-local settings and editor size.
- The main-window runtime state is always visible in a layout-reserving banner
  above the top bar: grey Idle, red Recording, and green Playing. The separate
  editor window is unchanged.
