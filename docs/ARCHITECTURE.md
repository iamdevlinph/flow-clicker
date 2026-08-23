# Architecture

```text
Tauri window / vanilla JS UI
        │
        ├── Flow library + editor
        ├── combine checked flows
        ├── import selected actions from another flow
        ├── repeat/timing/hotkey settings
        │
        ▼
Rust commands + event bridge
        │
        ├── rdev global input listener
        │     ├── click-only recording
        │     └── record/play global hotkeys
        │
        ├── playback scheduler
        │     └── enigo physical mouse input
        │
        ├── local JSON persistence
        │
        └── platform window resolver
              ├── Windows: foreground/title/rect + current window position
              └── macOS: screen coordinate fallback (window-relative TODO)
```

The click-map is a separate transparent Tauri window. In passive mode it ignores cursor events so clicks pass through to the application below. In edit mode it receives pointer events so markers can be dragged. It is not inserted into the target webpage DOM.

## Cross-platform strategy

The recorder and physical-input engine are shared Rust code through `rdev` and `enigo`. OS-specific code is isolated to window-relative coordinate resolution. This keeps the majority of the project identical between Windows and macOS while allowing native window metadata to be implemented correctly per OS.
