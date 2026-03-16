# Figma Variable Importer

Standalone Figma plugin package for importing adapted design-token payloads into local Figma Variables and paint styles.

## What It Imports

This plugin imports JSON payloads that conform to [`schema/figma-adapter-spec.md`](../schema/figma-adapter-spec.md).

It is not intended to import:

- raw Figma variable exports
- arbitrary design-token JSON without adaptation
- project-specific skill metadata

## Package Contents

- `manifest.json`
- `code.js`
- `ui.html`
- `icon.png`

## Expected Input

The plugin expects:

- a required `primitive` set
- optional mode-aware sets such as `semantic/light` and `semantic/dark`
- token nodes with `$value`
- stable alias paths such as `{primitive.color.blue.500}`

## Typical Workflow

```text
source tokens -> adapt to figma adapter spec -> import JSON into plugin
```

If your source system is already clean and aligned, adaptation can be minimal. If it is inconsistent, add a normalization pass before adaptation.

## Install In Figma

1. Open Figma desktop.
2. Go to `Plugins` -> `Development` -> `Import plugin from manifest...`.
3. Choose [`figma-plugin/manifest.json`](./manifest.json).

## Import Flow

1. Open the plugin in a Figma file.
2. Paste a conforming JSON payload or select a JSON file.
3. Run import.
4. Review any unsupported token warnings shown by the plugin.

## Compatibility

The plugin uses the Figma Variables API and creates or updates:

- variable collections
- collection modes
- local variables
- local paint styles for gradients
