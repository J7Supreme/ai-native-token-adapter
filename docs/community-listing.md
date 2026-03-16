# Figma Community Listing Draft

This draft is written for the current plugin name in the manifest: `ds skill v2`.

## Name

ds skill v2

## Tagline

Import adapted design tokens into Figma Variables with support for collections, modes, aliases, and gradients.

## Short Description

`ds skill v2` imports schema-adapted design token JSON into local Figma Variables and paint styles. It is designed for teams with a canonical token source that has been adapted into a Figma-friendly contract.

## Full Description

`ds skill v2` is a schema-driven variable importer for design systems.

It helps teams move an adapted token payload into Figma as:

- variable collections
- collection modes
- local variables
- gradient paint styles

The plugin is designed for design-token workflows where one canonical source is transformed into a Figma adapter payload before import.

### Best for

- teams with an existing design token pipeline
- systems that already define primitive tokens and one or more semantic layers
- workflows that want deterministic Figma import behavior
- setups that need aliases, theme modes, and collection grouping to survive import

### Expected input

The plugin expects a JSON payload that follows the public adapter contract in [`schema/figma-adapter-spec.md`](../schema/figma-adapter-spec.md).

At minimum, the payload should include:

- a required `primitive` set
- token leaves using `$value`
- stable alias paths such as `{primitive.color.blue.500}`

Optional collections such as `semantic`, `pattern`, and `component` can also be imported when present.

### What it does not do

- It does not import arbitrary Figma variable exports.
- It does not infer a complete design-token architecture from unstructured JSON.
- It does not send token data to an external service.

### Typical workflow

```text
source tokens -> normalize (optional) -> adapt -> plugin import
```

If your source system uses different naming or layer conventions, adapt it into the plugin's contract before import.

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
