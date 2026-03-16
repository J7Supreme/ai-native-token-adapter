# AI Native Schema

This document defines the AI Native schema consumed by the standalone Figma importer in [`figma-plugin/`](../figma-plugin/).

The AI Native schema is the repo's standard import contract. It exists to support multi-theme variable import and style import in Figma, while giving external users a stable target format for adapting their own token models.

## Purpose

Use this schema when you want to:

- adapt a source token model into a stable Figma import payload
- preserve multiple themes or modes across import
- import both variables and style-like values such as gradients
- keep alias references stable across imports
- support teams whose source model may differ, as long as it can be mapped into this contract

## Supported Workflows

This repository is built around two workflows:

- import `Token Studio native schema` into Figma with multi-theme support
- adapt other source models, including Figma-derived exports, into `AI Native schema` before import

In other words:

- `Token Studio native schema` is a first-class input shape the plugin aims to support
- `AI Native schema` is the normalized contract for adapted imports
- other models should be transformed into `AI Native schema` by scripts or adapters

## Top-Level Structure

The payload is a JSON object with token sets at the top level.

Recommended set shapes:

- `primitive`
- `{collection}/{mode}` such as `semantic/light`
- optional metadata keys beginning with `$`

Example:

```json
{
  "primitive": {
    "primitive": {
      "color": {
        "blue": {
          "500": {
            "$type": "color",
            "$value": "#007FFF",
            "$description": "Primary brand blue"
          }
        }
      }
    }
  },
  "semantic/light": {
    "text": {
      "primary": {
        "$type": "color",
        "$value": "{primitive.color.blue.500}",
        "$description": "Primary text color in light mode"
      }
    }
  },
  "semantic/dark": {
    "text": {
      "primary": {
        "$type": "color",
        "$value": "{primitive.color.blue.500}",
        "$description": "Primary text color in dark mode"
      }
    }
  }
}
```

## Contract Rules

- A `primitive` token set is required.
- Token nodes must use `$value`. `$type` is strongly recommended and may be inferred by the generator.
- Token aliases must use curly-brace paths such as `{primitive.color.blue.500}` or `{semantic/light.text.primary}`.
- Collection and mode names should be stable across runs.
- Metadata keys may exist and must begin with `$`.

The contract does not require a specific semantic taxonomy beyond these import concerns:

- collections
- modes or themes
- typed token values
- aliases
- optional import metadata

## Collections

The contract allows any collection name.

The current implementation has first-class ordering and naming behavior for:

- `primitive`
- `semantic`
- `pattern`
- `component`

Collections beyond these are allowed and should still follow the `{collection}/{mode}` convention for mode-aware sets.

## Modes And Themes

The importer works best with `light` and `dark` source modes, which become `Light` and `Dark` in Figma.

Other mode names are allowed if they follow the same `{collection}/{mode}` structure.

## Token Node Shape

Leaf token nodes use this shape:

```json
{
  "$type": "color",
  "$value": "#007FFF",
  "$description": "Optional human-readable description"
}
```

Supported `$type` values:

- `color`
- `string`
- `number`
- `float`
- `dimension`
- `boolean`
- `gradient`
- `fontFamilies`
- `fontWeights`
- `fontSizes`
- `lineHeights`
- `letterSpacing`
- `spacing`
- `sizing`
- `borderRadius`
- `borderWidth`
- `opacity`

These types are defined around import capability, not around any one source taxonomy.

## Value Semantics

Supported `$value` forms:

- string literals such as `"#FFFFFF"` or `"16px"`
- numbers such as `16`
- booleans such as `true`
- alias strings such as `"{primitive.spacing.16}"`
- gradient objects with `type`, `angle`, and `stops`

Sentinel values:

- `[MISSING]` is treated as intentionally absent and is skipped by the importer

## Alias Rules

Aliases must point to token paths, not Figma variable IDs.

Examples:

- `{primitive.color.gray.900}`
- `{semantic/light.text.primary}`
- `{component/dark.button.primary.background}`

If your source system uses different path semantics, normalize or adapt them before import.

## Optional Metadata

Two metadata keys are commonly included:

- `$themes`
- `$metadata`

These are optional for the plugin, but useful for compatibility with token tooling and generation workflows.

Example:

```json
{
  "$themes": [
    {
      "id": "light",
      "name": "Light"
    },
    {
      "id": "dark",
      "name": "Dark"
    }
  ],
  "$metadata": {
    "tokenSetOrder": [
      "primitive",
      "semantic/light",
      "semantic/dark"
    ]
  }
}
```

## Compatibility Notes

- A source system does not need to have `pattern` or `component` layers.
- A source system does need enough structure to map into collections, modes, typed values, and aliases.
- Raw Figma variable exports are not expected to match this contract directly.
- If your source system uses different names such as `global`, `base`, or `alias`, map them into this contract during adaptation.
- This contract is intentionally source-agnostic. It defines the import target, not the source authoring model.

## Figma Export Adapter Input

The repository also ships an adapter for a Figma-derived export shape. This is not the AI Native schema itself. It is an adapter input that can be transformed into AI Native schema by [`tools/build-figma-adapter.py`](../tools/build-figma-adapter.py).

Expected top-level shape:

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
          "value": "#007FFF"
        }
      ]
    }
  ]
}
```

Supported adapter fields:

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
- top-level `styles[]`

Adapter mapping behavior:

- the `primitive` collection is mapped into the AI Native `primitive` token set
- non-primitive collections are mapped into `{collection}/{mode}` token sets
- `valuesByMode` may be keyed by `modeId` or by a mode name variant
- gradient paint styles are mapped into `styles/<mode>` gradient tokens

Current adapter limitations:

- text styles and effect styles are not yet mapped into AI Native style tokens
- only paint-like style payloads that can be reduced to solid colors or gradients are adapted
- gradient transform details are normalized into a generic linear gradient value

## Recommended Pipelines

```text
Token Studio native schema -> import via figma-plugin
```

```text
Figma export or custom source model -> adapt to AI Native schema -> import via figma-plugin
```

`normalize` is optional for already-clean systems and important for inconsistent real-world sources.
