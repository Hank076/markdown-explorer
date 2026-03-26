# Markdown Explorer

A browser-based Markdown viewer. Open a local folder, browse files in the sidebar tree, and preview multiple `.md` files in tabs — all without any build step or installation.

[繁體中文 →](./README.zh-TW.md)

## Features

- Folder tree sidebar with drag-to-resize and collapsible toggle
- Multi-tab Markdown preview with scroll position preserved per file
- Syntax highlighting via [highlight.js](https://highlightjs.org/) and [Prism](https://prismjs.com/)
- [Mermaid](https://mermaid.js.org/) diagram rendering (flowchart, sequence, Gantt, etc.)
- Multiple themes with persistent preference
- **UI language toggle** — Traditional Chinese / English, saved to localStorage
- Accessibility: ARIA labels, `aria-pressed` states, `:focus-visible` support
- Works entirely in the browser — no build step, no server-side code

## Requirements

- Chrome or Edge (requires [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API))
- A local HTTP server (required for ES Module support; `file://` does not work)

## Quick Start

```bash
# Clone the repo
git clone https://github.com/your-username/markdown-explorer.git
cd markdown-explorer

# Start a local server (pick any method)
npx serve .
# or
python -m http.server 8000
# or
npm start
```

Then open `http://localhost:3000` (or whichever port) in Chrome or Edge.

## Usage

1. Click **Open Folder** and grant permission
2. Click any `.md` file in the sidebar to open it in a new tab
3. Drag the sidebar edge to resize, or click the toggle button to collapse it
4. Click the sun/moon icon (top-right) to switch themes
5. Click the language button (**中 / EN**) to toggle the UI language

## Project Structure

```
markdown-explorer/
├── index.html        # App shell
├── app.js            # All application logic
├── styles.css        # Styles
├── locales/
│   ├── zh-TW.json    # Traditional Chinese strings
│   └── en.json       # English strings
├── libs/             # Vendored dependencies (no npm install needed at runtime)
└── docs/             # Design documents
```

## Dependencies

All dependencies are vendored in `libs/` — no `npm install` needed to run the app.

| Package | Version | License |
|---------|---------|---------|
| [marked](https://github.com/markedjs/marked) | ^17 | MIT |
| [highlight.js](https://github.com/highlightjs/highlight.js) | ^11 | BSD-3-Clause |
| [Prism](https://github.com/PrismLibrary/Prism) | ^1.30 | MIT |
| [Mermaid](https://github.com/mermaid-js/mermaid) | ^11 | MIT |

## License

[MIT](./LICENSE) © 2026 Hank
