# AI Native Token Adapter

AI Native Token Adapter is a standalone package for importing adapted design-token payloads into Figma Variables.

## Repository Contents

- `figma-plugin/` contains the Figma plugin package
- `schema/` contains the public adapter contract
- `tools/` contains an optional generator for producing conforming payloads
- `docs/` contains Figma Community listing and launch materials

## What This Package Does

This project is schema-driven.

It does not import arbitrary token JSON or raw Figma variable exports. It imports JSON payloads that conform to the public adapter contract in [`schema/figma-adapter-spec.md`](schema/figma-adapter-spec.md).

The plugin creates or updates:

- variable collections
- collection modes
- local variables
- local gradient paint styles

## Recommended Flow

```text
source tokens -> normalize (optional) -> adapt -> import with figma-plugin
```

## Core Files

- Plugin manifest: [`figma-plugin/manifest.json`](figma-plugin/manifest.json)
- Plugin guide: [`figma-plugin/README.md`](figma-plugin/README.md)
- Public contract: [`schema/figma-adapter-spec.md`](schema/figma-adapter-spec.md)
- Generator: [`tools/build-figma-adapter.py`](tools/build-figma-adapter.py)

## Community Publishing

Community submission materials are included in:

- [`docs/community-listing.md`](docs/community-listing.md)
- [`docs/community-launch-checklist.md`](docs/community-launch-checklist.md)

## Notes

- The plugin currently declares no network access.
- The adapter contract is the primary dependency boundary.
- If a source token system does not match the contract directly, it should be normalized or adapted before import.
