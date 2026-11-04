---
name: deliver-pr
description: Deliver authorized frontend implementation work through an issue-linked branch, commits, push, and a PR report with Codex verification evidence. Use after or alongside implementation; not for explanation-only requests.
---

# Deliver an implementation PR

Read root AGENTS.md and docs/github-workflow.md. Resolve paths from the repository
root. This skill coordinates authorized repository delivery; it does not authorize
messages, deployments, merges, or unrelated repository changes.

Respect explicit local-only scope before any issue, branch, stage, commit, push,
or PR action. For API-related delivery, follow docs/api-contract.md: link the
Notion API page and record the method/path, specification summary, and actual
validation results in the PR. Quote relevant content when useful; do not require
separate snapshot files or a version-management system. Keep FE/BE issues,
branches, commits, and PRs separate with cross-links. FE owns specification
content; BE updates implementation status and BE PR links. Respect read-only
restrictions and report access/write failures truthfully. Compare meaningful
specification changes and revalidate affected behavior. Do not impose a separate
contract approval gate on Ready status; use the existing verification and review
criteria, distinguishing mock checks from actual integration. OpenAPI generation
alone does not verify runtime authorization or error behavior.

Confirm the intended repository, remote, base branch, current branch, user changes,
and authenticated GitHub access without printing credentials. Reuse the requested
issue and existing branch/PR for the same work. Otherwise establish the feature's
issue and a codex/ branch as defined in the workflow before implementation.

Let the root own Git operations. Preserve unrelated edits. Review and stage only
the task's files, commit coherent changes, and push only the intended branch.
Do not reset user work, force-push, or merge as part of ordinary delivery.

Create or update one Draft PR using .github/pull_request_template.md. Explain the
actual behavior and evidence. Link the issue, include available UI evidence, and
list missing checks. Use structured tool arguments or body files for multiline text.
Before retrying an uncertain remote write, look up whether it already succeeded.

GitHub CI is intentionally excluded from this setup. Do not add workflows or make
CI status a delivery requirement unless the user changes that decision. If applying
this setup to an existing repository, inspect and preserve its established checks
and protections unless their removal is explicitly authorized.

Fix attributable local validation failures and review findings, rerun focused
verification, and update the same PR. Validate after the last code change and record
the final head commit. Do not weaken tests or claim a build proves browser behavior.

Mark the PR ready only when the applicable Codex-run checks, required user-flow
verification, and material review findings are resolved. Record what actually ran
and include usable UI evidence when relevant. If required verification, authentication,
decisions, or environment issues block progress, leave a truthful Draft and explain
the blocker. Never record an unperformed check as passed.

Return issue and PR URLs, head commit, validation results, and any remaining action.
Distinguish ready-for-human-review, draft-with-blockers, and delivery-not-created.
