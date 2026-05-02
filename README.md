# CKEditor 5 Text Selection Plugin

A plugin that makes the editor keep its text selection when switching between
WYSIWYG and Source mode, and scrolls the selection into the viewport.

Inspired by the [CKEditor Text Selection plugin](https://ckeditor.com/cke4/addon/textselection).

This plugin also works with the [CKEditor 5 CodeMirror Source Editing](https://github.com/cdubz/ckeditor5-source-editing-codemirror) plugin.

## Demo

Open `demo/index.html` in a browser to try the plugin with CKEditor 5 loaded
from CDN. Select text, toggle **Source** mode, and see the selection preserved.

## License

Licensed under the terms of the [GPL-2.0 License](LICENSE).

## Structure

```
ckeditor5-textselection/
├── build/                   # Compiled JS bundle (output of webpack)
│   └── textSelection.js
├── src/                     # Plugin source code
│   ├── index.js             # Plugin entry point (exports default object)
│   └── textselection.js     # Plugin implementation
├── package.json
└── webpack.config.js
```

## Building

```bash
npm install
npm run build        # production (minified)
npm run build:dev    # development (unminified)
npm run watch        # watch mode
```
