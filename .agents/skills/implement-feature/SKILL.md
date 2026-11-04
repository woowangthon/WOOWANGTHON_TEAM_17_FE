---
name: implement-feature
description: Implement or substantially change a frontend feature in this travel-planner project, coordinating bounded work and verification. Not for simple questions or small copy and token changes.
---

# Implement a frontend feature

Read root AGENTS.md, docs/orchestration.md, docs/github-workflow.md, and only the UI/API documents relevant
to the requested feature. Resolve paths against the repository root.

For API work, follow docs/api-contract.md. The FE root reads the shared Notion
specification, reuses existing APIs, and writes missing method/path, request and
response examples, authorization, and errors within the requested feature scope.
Use 작성 중 / 구현 요청 / 구현 완료; an FE specification marked 구현 요청 is
the BE implementation basis. No separate dual approval or mandatory API ID,
revision, or approver fields are required. Give subagents the relevant content
and status; they report needed changes to the root. Respect read-only/local-only
instructions. Only FE writes specification content; BE implements, validates,
and updates implementation status and BE PR links. Develop FE with mocks until BE
is ready, then verify actual integration. Check the impact of breaking changes
before editing and share the changes. For meaningful specification changes,
compare differences and revalidate affected behavior. Follow the documented
single-writer and failed/uncertain-write handling without creating duplicate APIs.

For a nontrivial feature, behavior change, or bug fix, the root first delegates
planning to the separate Astra medium planner, even when the root's selected
model is Astra. Wait for the planner's result before assigning implementation.
The planner returns the user-visible outcome, affected files and API/mock
constraints, UI states and accessibility risks, bounded tasks with file
ownership and dependencies, acceptance checks, and open questions. The root
owns coordination, acceptance, integration, final checks, and Git delivery.

Small copy, token, or single-element edits and explanation-only requests stay
with the root. User-requested scope and model choices take precedence. If named
planner-role invocation is unavailable, use a separate explicitly selected
Astra medium agent with the planner instructions and report this routing. If
neither that route nor the named role/model is available, report the exact
limitation, continue only independent read-only discovery, and ask the user for
a revised approach before dependent implementation.

After planning, delegate bounded implementation to Luna high where supported.
Give each worker exact file ownership, relevant context, constraints, and checks.
Parallelize only independent work. A worker, tester, or reviewer reports to the
root and does not recursively start orchestration or repeat the PR workflow.
Use an independent Astra medium reviewer where applicable.

Keep shared tokens, primitive components, and API contracts under one writer.
If a worker needs a shared change outside its scope, have it report the need.

Integrate the implementation, run relevant existing checks, and verify the actual
user flow. For cross-cutting, privacy, versioning, or meaningful behavior changes,
use independent review where available. A tiny edit need not create every role.

Do not claim a named model ran unless its actual execution is confirmed. The
planner role's TOML pins its model; the root's default configuration does not
change the session-selected root model.

Report changed behavior, files, checks, reviewer findings handled, and remaining
limitations. Never report browser validation based only on a successful build.

For implementation requests, complete the authorized issue/branch/commit/push/PR
workflow using the repository's deliver-pr skill. The root owns delivery. Do not
stop at a local implementation when the requested scope includes PR delivery.
If delivery or required verification is blocked, report that status instead of
claiming the feature is complete. Respect a user instruction to keep work local.
