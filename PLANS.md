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
- Per-flow playback configuration, global hotkeys, platform detection, and
  `state.json` persistence.
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

- Multi-monitor overlay selection and virtual-desktop coverage.
- Stronger Windows matching using process executable and HWND metadata instead
  of title text alone.
- macOS window-relative tracking plus Accessibility permission-status UX.
- Flow and action drag improvements not already implemented.
- Import/export of `.flowclicker.json` files.
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
