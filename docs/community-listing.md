# Figma Community Listing Draft

This draft is written for the current plugin name in the manifest: `ds skill v2`.

## Name

ds skill v2

## Tagline

Import multi-theme tokens into Figma Variables and styles with support for modes, aliases, and gradients.

## Short Description

`ds skill v2` imports multi-theme design token JSON into local Figma Variables and paint styles. It supports direct import for Token Studio native schema and adapted import through the AI Native schema.

## Full Description

`ds skill v2` is a multi-theme token importer for design systems.

It helps teams move token payloads into Figma as:

- variable collections
- collection modes
- local variables
- gradient paint styles

The plugin is designed for two workflows:

- direct import of Token Studio native schema
- adapted import into AI Native schema from Figma-derived or custom token models

### Best for

- teams with an existing design token pipeline
- teams using Token Studio and multiple themes
- workflows that want deterministic Figma import behavior
- setups that need aliases, theme modes, collections, and gradient styles to survive import
- teams that want a stable contract for adapting non-Token-Studio models

### Expected input

The plugin accepts:

- Token Studio native schema
- AI Native schema as defined in [`schema/ai-native-schema.md`](../schema/ai-native-schema.md)

At minimum, the payload should include:

- a required `primitive` set
- token leaves using `$value`
- one or more themes or modes
- stable alias paths such as `{primitive.color.blue.500}`

Collections such as `semantic`, `pattern`, and `component` are supported when present, but the main emphasis is correct multi-theme import and style generation.

### What it does not do

- It does not import arbitrary Figma variable exports without adaptation.
- It does not infer a complete design-token architecture from unstructured JSON.
- It does not send token data to an external service.

### Typical workflow

```text
Token Studio native schema -> plugin import
```

```text
Figma export or custom model -> adapt to AI Native schema -> plugin import
```

If your source system uses different naming or layer conventions, adapt it into AI Native schema before import.

## Data and Security Notes

- This plugin does not require network access.
- Imported JSON is processed locally inside the plugin.
- No account connection, API key, or external backend is required.

## Support Contact

Use your preferred support channel here before submission:

- support email
- GitHub issues URL
- documentation URL

## Suggested Community Tags

- design tokens
- variables
- design systems
- import
- theming
