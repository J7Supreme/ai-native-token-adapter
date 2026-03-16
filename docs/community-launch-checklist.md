# Figma Community Launch Checklist

Use this checklist before submitting the plugin to Figma Community.

## Account and Submission Requirements

- Publish from the Figma Desktop App.
- Confirm your Figma account has two-factor authentication enabled.
- Decide whether to publish as yourself, a team, or an organization.
- Prepare a support contact that will be shown in the listing.

## Manifest

- `networkAccess` is explicitly set in [`figma-plugin/manifest.json`](../figma-plugin/manifest.json).
- Current setting is `allowedDomains: ["none"]`, which should display as `No access to network` in the listing.
- Confirm the plugin still works after adding the network restriction.
- Keep the current plugin name as-is for this submission if you are intentionally delaying the rename.

## Functional Review

- Verify import works from pasted JSON.
- Verify import works from uploaded JSON file.
- Verify invalid JSON produces a clear error.
- Verify Token Studio native schema imports correctly.
- Verify multi-theme payloads create the expected modes in Figma.
- Verify alias-based tokens import correctly.
- Verify gradient tokens create local paint styles.
- Verify the plugin behaves correctly when `pattern` and `component` sets are absent.
- Verify warning reporting is understandable when unsupported tokens exist.

## Listing Content

- Finalize the tagline from [`docs/community-listing.md`](./community-listing.md).
- Finalize the short description from [`docs/community-listing.md`](./community-listing.md).
- Finalize the full description from [`docs/community-listing.md`](./community-listing.md).
- Replace the placeholder support contact in [`docs/community-listing.md`](./community-listing.md).
- Make sure the listing clearly states that Token Studio native schema is supported directly.
- Make sure the listing clearly states that raw Figma exports require adaptation into AI Native schema.

## Visual Assets

- Prepare a square plugin icon export for Community if needed.
- Prepare a `1920x1080` thumbnail for the listing.
- Prepare 1-3 screenshots or cover images showing:
  - the expected JSON input
  - the import UI
  - the resulting Figma Variables collections and modes
- Make sure all visuals match the current plugin UI and behavior.

## Security and Review Readiness

- State clearly that the plugin has no network access.
- State clearly that JSON is processed locally.
- State clearly that no login, API key, or backend service is required.
- Avoid overstating compatibility; describe Token Studio native support and the AI Native schema accurately.
- Make sure there is no placeholder or internal-only language in the user-facing listing.

## Post-Submission

- Expect Community review to take roughly 5-10 business days, based on current Figma guidance.
- Be ready to respond to reviewer feedback and resubmit if needed.
- If you make major changes after approval, expect possible re-review.
