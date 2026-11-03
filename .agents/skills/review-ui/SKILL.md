---
name: review-ui
description: Review a changed frontend screen or component for this travel planner's design, states, accessibility, and user flow. Not for backend-only or documentation-only changes.
---

# Review UI

Read docs/ui-guide.md and the assigned diff or screen. Resolve paths against the
repository root. Review the requested scope rather than proposing a new design.

Check shared lime tokens, common controls, responsive layout, readable text,
selection and disabled states, keyboard focus, labels, and dialog close/focus behavior.

For the affected flow, check loading, empty, error, input preservation, and retry.
Check private profile data, condition reconfirmation, and plan version conflicts
when the screen exposes those behaviors.

Use the available browser tools for visual and interaction checks when possible.
If only code inspection is possible, identify that limitation explicitly.

Return actionable findings with the component or file, observed problem, expected
behavior, and a way to verify the fix. Do not edit implementation files unless the
user or parent has assigned the fix as part of the task.
