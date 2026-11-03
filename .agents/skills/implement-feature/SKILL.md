---
name: implement-feature
description: Implement or substantially change a frontend feature in this travel-planner project, coordinating bounded work and verification. Not for simple questions or small copy and token changes.
---

# Implement a frontend feature

Read root AGENTS.md, docs/orchestration.md, docs/github-workflow.md, and only the UI/API documents relevant
to the requested feature. Resolve paths against the repository root.

Define the user-visible outcome, affected files, API assumptions, and acceptance
criteria before splitting work. Preserve existing approved behavior.

For a nontrivial feature, let the root own the design and delegate bounded execution
to a Luna worker where supported. Give each worker exact file ownership, relevant
context, constraints, and checks. Parallelize only independent work.

Keep shared tokens, primitive components, and API contracts under one writer.
If a worker needs a shared change outside its scope, have it report the need.

Integrate the implementation, run relevant existing checks, and verify the actual
user flow. For cross-cutting, privacy, versioning, or meaningful behavior changes,
use independent review where available. A tiny edit need not create every role.

If model routing or delegation is unavailable, state the limitation and do not claim
that a named model ran. Continue only within the user's authorized scope; do not
silently substitute a different model for one the user explicitly required.

Report changed behavior, files, checks, reviewer findings handled, and remaining
limitations. Never report browser validation based only on a successful build.

For implementation requests, complete the authorized issue/branch/commit/push/PR
workflow using the repository's deliver-pr skill. The root owns delivery. Do not
stop at a local implementation when the requested scope includes PR delivery.
If delivery or required verification is blocked, report that status instead of
claiming the feature is complete. Respect a user instruction to keep work local.
