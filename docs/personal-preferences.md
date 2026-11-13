# Personal preference profiles

The room preparation screen keeps the existing private v1 preference fields and accepts the optional v2 `draft.atomicPreferences` profile. V2 interpretation places the profile in `suggestions.atomicPreferences` and adds `analysisMeta.requestId`; the client parser continues to accept older v1 response shapes.

## V2 profile

The profile contains `schemaVersion: 2`, server-computed `sourceDigest`, `status` (`current` or `stale`), `conditions`, and `unresolved`. A condition carries a server ID, dimension, target, polarity, priority and its basis, scope, audience, optional frequency, optional value and unit, approximate flag, source evidence, and origin. The canonical enum values and examples are documented in the AI contract at `../ensemble-AI/docs/atomic-contract.md`.

When an atomic profile exists, it is the editable source of truth and the duplicate legacy preference controls are hidden. The review shows a compact condition summary and expands its controls on demand. People can change target, direction, priority, frequency, or numeric values and remove conditions. A manual edit is marked `직접 수정` while retaining its source quote as a separate reference. Editing the original text marks the profile stale; legacy-only drafts remain directly editable and saveable. Unresolved entries are shown as review notes, without creating new required questions. V1 keeps its saved walking choice. V2 derives a legacy walking bucket only from a supported atomic walking value; it does not carry over an older bucket when the current profile has no supported walking limit.

## Saving and privacy

The initial source save does not send an analysis receipt. After interpretation, the final save echoes the response’s `analysisMeta.requestId` as a top-level `analysisReceipt`; the server scopes that receipt to the current trip, member, device session, and source versions. A stale receipt returns `409 STALE_AI_RESULT` and the screen asks the person to analyze the current text again. Routine manual saves omit the receipt and preserve the stored profile.

Original preference text and the profile remain in the member’s private draft. They are not added to shared room views by this UI. The browser does not store provider secrets or expose provider diagnostics.
