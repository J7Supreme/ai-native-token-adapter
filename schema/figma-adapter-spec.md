# Figma Adapter Spec

This document defines the public JSON contract consumed by the standalone Figma variable importer in [`figma-plugin/`](../figma-plugin/).

The plugin is schema-driven. It does not import arbitrary Figma exports or arbitrary design-token JSON. It imports token payloads that conform to this contract.

## Purpose

Use this schema when you want to:

- adapt a canonical design-token source into a Figma-friendly import payload
- preserve collection grouping and theme modes
- keep alias references stable across imports
- support teams whose source model may differ, as long as it can be mapped into this contract

## Top-Level Structure

The payload is a JSON object with token sets at the top level.

Supported set shapes:

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

## Required Rules

- A `primitive` token set is required.
- Token nodes must use `$value`. `$type` is strongly recommended and may be inferred by the generator.
- Token aliases must use curly-brace paths such as `{primitive.color.blue.500}` or `{semantic/light.text.primary}`.
- Collection and mode names should be stable across runs.
- Metadata keys may exist and must begin with `$`.

## Supported Collections

The importer recognizes any collection name, but it has first-class ordering and naming behavior for:

- `primitive`
- `semantic`
- `pattern`
- `component`

Collections beyond these are allowed, but should still follow the `{collection}/{mode}` convention for mode-aware sets.

## Supported Modes

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
- A source system does need enough structure to map into at least one base layer plus any optional consumer layers.
- Raw Figma variable exports are not expected to match this contract.
- If your source system uses different names such as `global` and `alias`, map them into this contract during adaptation.

## Recommended Pipeline

```text
source tokens -> normalize (optional) -> adapt to this spec -> import via figma-plugin
```

`normalize` is optional for already-clean systems and important for inconsistent real-world sources.
