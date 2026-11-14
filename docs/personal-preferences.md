# Personal preference profiles

The room preparation screen keeps the existing private v1 preference fields and accepts the optional v2 `draft.atomicPreferences` profile. V2 interpretation places the profile in `suggestions.atomicPreferences` and adds `analysisMeta.requestId`; the client parser continues to accept older v1 response shapes.

## V2 profile

The profile contains `schemaVersion: 2`, server-computed `sourceDigest`, `status` (`current` or `stale`), `conditions`, and `unresolved`. A condition carries a server ID, dimension, target, polarity, priority and its basis, scope, audience, optional frequency, optional value and unit, approximate flag, source evidence, and origin. The canonical enum values and examples are documented in the AI contract at `../ensemble-AI/docs/atomic-contract.md`.

The current v2 profile is the source of truth for the results. The default view presents the preferences and the reasons a request has not been included. A person can confirm their preparation immediately while notes are pending. Opening or closing a result never changes its review status. The original input is available in `내가 쓴 내용`. The text editor is shown on first entry and when reanalysis or retry is needed.

`취향 편집` opens optional editing tools. An existing correction retains its related source quote and structured fields. Explicit editing supports the frequency operator, period, scope, audience, scalar value/unit and importance. Source quotes must be exact private substrings of at most 1,000 characters. The display does not assign an inferred activity or unit to an ambiguous value. Legacy v1 drafts still use their existing fields and walking choice.

A new preference is entered as one sentence. Submitting it appends the sentence to the original input and follows the same source-save, interpretation and result-save sequence as the main analysis button. Reanalysis that replaces manual conditions or note decisions asks first. After a transient failure the composed original remains available for retry. V2 only projects a legacy walking choice from a supported atomic value.

Review actions are available in editing mode. Linking a pending note to an existing preference updates only the selected condition and note. Hiding a notice records that review choice. Decisions stay local until the private preference update and can be reopened. The optional top-level `unresolvedAcknowledgements` uses the source digest and the exact code, evidence and message to identify a note. It is kept out of the canonical profile and browser storage. Changing the original clears the local association.

## Saving and privacy

The initial source save does not send an analysis receipt. After interpretation, the final save echoes the response’s `analysisMeta.requestId` as a top-level `analysisReceipt`; the server scopes that receipt to the current trip, member, device session, and source versions. A stale receipt returns `409 STALE_AI_RESULT` and the screen asks the person to analyze the current text again. Routine manual saves omit the receipt and preserve the stored profile.

Source-only saves omit `draft.atomicPreferences`, `analysisReceipt`, and `unresolvedAcknowledgements` entirely. This uses the existing optional-extension contract: the server retains its older profile as stale, rather than validating old evidence as edits to the new source. Explicit `atomicPreferences: null` is not used for source saves because it means deletion. The first reanalysis save always uses this mode; ordinary draft saves use it when their atomic profile is stale. Current manual profile edits retain their normal save behavior.

An accepted source response advances the persisted baseline and version independently of the displayed analysis. Existing local conditions remain visible as stale while interpretation or its result save is pending or fails. A fresh model profile and its operation-local receipt are published only after their result PUT succeeds; failed attempts are analyzed afresh on retry. Old acknowledgement associations are not sent with the changed source, and final results reset acknowledgements with the fresh profile digest. Saved-source status and stale-analysis status remain separate. Preparation completion continues to require accepted current analysis and an explicit confirmation request.

When the accepted source still has the same current digest, local pending acknowledgement edits survive reanalysis or a stale source-only save failure; the saved acknowledgement baseline remains separate. Changed-source or stale server profiles cannot restore those associations. A successful result response with a missing, null, stale, or different-digest profile is treated as an uncertain write. The client keeps the input and requires an explicit reload instead of publishing analysis success or silently repeating the write.

Interpretation errors distinguish `AI_UNAVAILABLE` (analysis service unavailable), `AI_TIMEOUT` (response timeout), and `AI_INVALID_RESPONSE` (analysis result rejected). Each message states that the source is saved and offers reanalysis; these service/result failures do not ask the person to correct their original text or reveal provider diagnostics.

Original preference text and the profile remain in the member’s private draft. They are not added to shared room views by this UI. The browser does not store provider secrets or expose provider diagnostics.


## Preparation status display

Unspecified audience and scope remain in the data and editor without repeated warning tags on every row. Explicit group/segment/required tags remain visible. Optional notes may remain while saving and confirming; their visible section identifies them as optional. Private saved state reads as saved but not yet ready, and the public participant progress explicitly counts preparation-complete members. Neither note acknowledgement nor analysis automatically confirms preparation.
