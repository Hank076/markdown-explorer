# Markdown Explorer

A browser-based Markdown viewer. Open a local folder, browse files in the sidebar tree, and preview multiple `.md` files in tabs — all without any build step or installation.

## Features

- Folder tree sidebar with drag-to-resize and collapsible toggle
- Multi-tab Markdown preview
- Syntax highlighting via [highlight.js](https://highlightjs.org/) and [Prism](https://prismjs.com/)
- [Mermaid](https://mermaid.js.org/) diagram rendering (flowchart, sequence, Gantt, etc.)
- Multiple themes with persistent preference
- Scroll position preserved per file
- Works entirely in the browser — no server-side code

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

1. Click **開啟資料夾 / Open Folder** and grant permission
2. Click any `.md` file in the sidebar to open it in a new tab
3. Switch themes from the top-right menu

## Dependencies

All dependencies are vendored in `libs/` — no `npm install` needed to run the app.

| Package | License |
|---------|---------|
| [marked](https://github.com/markedjs/marked) | MIT |
| [highlight.js](https://github.com/highlightjs/highlight.js) | BSD-3-Clause |
| [Prism](https://github.com/PrismLibrary/Prism) | MIT |
| [Mermaid](https://github.com/mermaid-js/mermaid) | MIT |

## License

[MIT](./LICENSE) © 2026 Hank
