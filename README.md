# CKEditor 5 Text Selection Plugin

CKEditor 5 plugin that preserves text selection.

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
