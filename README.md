# Local Video Editor

A browser-based local MP4 editor built with React + Material UI + ffmpeg.wasm.

## Features

- Load and preview local `.mp4` files
- Timeline playback with draggable seek slider
- Set trim **start** / **end** flags
- **Inclusive deletion**: remove selected range
- **Exclusive deletion**: keep selected range, remove everything else
- Edit history panel with revert support
- Export edited result to `.mp4`
- Save dialog with editable filename and destination folder picker
- Language switcher (English / Traditional Chinese / Japanese)

## Requirements

- Node.js 18+ (recommended 20+)
- A Chromium-based browser with File System Access API support:
  - Google Chrome (recommended)
  - Microsoft Edge

## Install

```bash
npm install
```

## Run (development)

```bash
npm run dev
```

Then open the local URL shown in terminal (usually `http://127.0.0.1:5173`).

## Build

```bash
npm run build
```

## Usage

1. Click **Select Source MP4** and choose an `.mp4` file.
2. (Optional) Click **Select Output Folder** to preselect destination.
3. Use playback controls and set **Trim Start** / **Trim End**.
4. Choose deletion mode:
   - **Inclusive Deletion**: delete inside `[start, end]`
   - **Exclusive Deletion**: keep only `[start, end]`
5. Click **Open Save Dialog**:
   - Confirm/change output folder
   - Edit output filename (auto-appends `.mp4` if missing)
6. Click **Save**.

You can cancel export while encoding/writing and continue editing.

## Notes & Limitations

- This app currently supports **MP4 input only**.
- Encoding/export runs in-browser via ffmpeg.wasm, so very large videos may be slower than native desktop FFmpeg.
- File writing requires browser permission to selected folder.

## Project Structure

- `src/App.jsx` - main UI and editing workflow
- `src/utils/segments.js` - segment math / timeline mapping
- `src/lib/ffmpegExport.js` - ffmpeg export pipeline
- `src/icons.jsx` - custom SVG icons

## License

Private/internal by default. Add your preferred license before publishing publicly.
