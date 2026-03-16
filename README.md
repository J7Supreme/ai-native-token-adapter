# AI Native Token Adapter

AI Native Token Adapter is a standalone package for importing multi-theme token payloads and related styles into Figma.

## Repository Contents

- `figma-plugin/` contains the Figma plugin package
- `schema/` contains the AI Native schema contract
- `tools/` contains an optional generator for producing conforming payloads
- `docs/` contains Figma Community listing and launch materials

## What This Package Does

This project centers on two workflows:

- import `Token Studio native schema` into Figma with multi-theme support
- adapt Figma-derived or custom token models into `AI Native schema`, then import that normalized payload

It does not re-import arbitrary raw Figma exports directly. Adapted payloads should conform to the public AI Native contract in [`schema/ai-native-schema.md`](schema/ai-native-schema.md).

The plugin creates or updates:

- variable collections
- collection modes
- local variables
- local gradient paint styles

## Recommended Flow

```text
Token Studio native schema -> import with figma-plugin
```

```text
Figma export or custom model -> adapt -> AI Native schema -> import with figma-plugin
```

## Core Files

- Plugin manifest: [`figma-plugin/manifest.json`](figma-plugin/manifest.json)
- Plugin guide: [`figma-plugin/README.md`](figma-plugin/README.md)
- Public contract: [`schema/ai-native-schema.md`](schema/ai-native-schema.md)
- Generator: [`tools/build-figma-adapter.py`](tools/build-figma-adapter.py)
- Sample inputs: [`examples/`](examples)

Included samples:

- [`examples/token-studio-native.sample.json`](examples/token-studio-native.sample.json)
- [`examples/figma-export.sample.json`](examples/figma-export.sample.json)
- [`examples/ai-native-schema.sample.json`](examples/ai-native-schema.sample.json)
- [`examples/ai-native-direct.sample.json`](examples/ai-native-direct.sample.json)

## Adapter CLI

The adapter script can normalize multiple input shapes into AI Native schema.

Supported input formats:

- `auto`
- `token-studio-native`
- `figma-export`
- `ai-native`

Example:

```bash
python3 tools/build-figma-adapter.py \
  --source examples/figma-export.sample.json \
  --input-format figma-export \
  --output /tmp/ai-native.json
```

### `figma-export` Input Shape

The current adapter expects a top-level `collections` array.

Minimal shape:

```json
{
  "collections": [
    {
      "name": "primitive",
      "modes": [
        { "modeId": "1:0", "name": "Light" },
        { "modeId": "1:1", "name": "Dark" }
      ],
      "variables": [
        {
          "name": "color/blue/500",
          "resolvedType": "COLOR",
          "value": "#007FFF",
          "description": "Optional"
        }
      ]
    },
    {
      "name": "semantic",
      "modes": [
        { "modeId": "2:0", "name": "Light" },
        { "modeId": "2:1", "name": "Dark" }
      ],
      "variables": [
        {
          "name": "text/primary",
          "resolvedType": "COLOR",
          "valuesByMode": {
            "2:0": "{primitive.color.blue.500}",
            "2:1": "{primitive.color.blue.500}"
          }
        }
      ]
    }
  ]
}
```

Supported fields today:

- `collections[].name`
- `collections[].modes[].modeId`
- `collections[].modes[].name`
- `collections[].variables[].name`
- `collections[].variables[].resolvedType` or `type`
- `collections[].variables[].value`
- `collections[].variables[].valuesByMode`
- `collections[].variables[].description`
- `collections[].styles[].name`
- `collections[].styles[].styleType`
- `collections[].styles[].paintsByMode`
- `collections[].styles[].paints`
- top-level `styles[]` with the same style fields

Current behavior:

- the `primitive` collection becomes the AI Native `primitive` token set
- other collections become `{collection}/{mode}` token sets
- `valuesByMode` may be keyed by `modeId`, mode name, lowercase mode name, or normalized theme id
- gradient paints are adapted into `styles/<mode>` gradient tokens

Current limitations:

- styles are only adapted for paint-like inputs that can be converted to solid colors or gradients
- text styles and effect styles are not yet converted into AI Native style tokens
- gradient angle and transform data are currently normalized to a generic linear gradient shape

## Community Publishing

Community submission materials are included in:

- [`docs/community-listing.md`](docs/community-listing.md)
- [`docs/community-launch-checklist.md`](docs/community-launch-checklist.md)

## Notes

- The plugin currently declares no network access.
- The AI Native schema is the primary dependency boundary for adapted imports.
- Token Studio native schema is also a first-class compatibility target for the plugin.
- If a source token system does not match either path directly, it should be normalized or adapted before import.
