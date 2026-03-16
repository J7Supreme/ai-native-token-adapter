# Figma Variable Importer

Standalone Figma plugin package for importing multi-theme token payloads into local Figma Variables and paint styles.

## What It Imports

This plugin is intended to support two input paths:

- `Token Studio native schema` as a direct import source
- [`AI Native schema`](../schema/ai-native-schema.md) as the normalized import contract for adapted sources

It is not intended to import:

- raw Figma variable exports without adaptation
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
- one or more mode-aware sets such as `semantic/light` and `semantic/dark`
- token nodes with `$value`
- stable alias paths such as `{primitive.color.blue.500}`

## Typical Workflow

```text
Token Studio native schema -> import JSON into plugin
```

```text
Figma export or custom model -> adapt to AI Native schema -> import JSON into plugin
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
