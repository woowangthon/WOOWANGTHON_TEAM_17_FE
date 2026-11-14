# Preference ensemble review

The private `내 취향` result renders each condition as a plain-language line. `취향 편집` opens the editing controls. A quick edit retains the original evidence. To add a preference, the user writes one sentence in `취향 추가`; the client appends it to the original input, saves it, and analyzes the updated text.

The editor keeps frequency operator (`exact`, `min`, `max`, `target`), approximate flag, count, period, value/unit, scope, audience, and priority basis independently. Frequency starts unset. The canonical `draft.atomicPreferences` shape remains unchanged.

Quick editing shows the relevant target, count, or value for the selected condition. `세부 조건 편집` opens the full editor, which keeps the original quotation and previously saved fields. Source quotations must be exact, nonempty substrings of the current original text, up to 1,000 characters long.

Unresolved notes explain which request still needs interpretation and allow the user to complete preparation. In edit mode, `기존 취향에 연결` links a note to a selected condition, and `안내 숨김` records a dismissal. `다시 표시` reopens it. Decisions use the complete note identity `(code, evidence, message)` and are saved with the private preference request through `unresolvedAcknowledgements`. A source change invalidates earlier associations.

Saved user-authored conditions or acknowledgements trigger an inline replacement confirmation before reanalysis. Ordinary saves, confirmation, and in-flight edit revision checks continue through the existing personal preparation hook. The existing API contract and compatibility rules are detailed in [personal-preferences.md](personal-preferences.md).
