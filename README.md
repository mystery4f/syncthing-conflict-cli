# Syncthing Conflict Resolver (GUI)

A native desktop application for resolving [Syncthing](https://syncthing.net/) conflict files.

Built with [Tauri](https://tauri.app/) + React + TypeScript + Rust.

## Features

- Scan directories for Syncthing conflict files (`.sync-conflict-*`)
- Side-by-side diff viewer
- Three-panel merge editor (Original / Merged / Conflict)
- Resolve conflicts: keep original, keep conflict, merge, or delete
- Auto-backup before overwriting (saved to `.stc-backup/`)

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/) (latest stable)
- [Tauri CLI](https://tauri.app/)

### Setup

```bash
npm install

# Generate app icons (replace with your own icon source)
# npm run tauri icon ./path-to-icon.png

npm run tauri dev
```

### Build

```bash
npm run tauri build
```

The installer will be in `src-tauri/target/release/bundle/`.

## License

MIT
