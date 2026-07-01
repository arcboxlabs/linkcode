---
name: linear
description: "ArcBox's Linear workflow. Use whenever starting a task that may have or need a tracking issue, or working with Linear at all — finding, creating, or updating issues, syncing progress, moving status, triage, or branch/PR linking. Trigger on any mention of Linear, an issue/ticket, an issue ID like ABX-123, a project, the board, or sprint/standup planning."
---

# Linear Workflow

Linear is the source of truth for what's being worked on. Keep issues in sync with reality, and treat an issue's history as shared — prefer adding over rewriting.

Resolve teams, projects, labels, statuses, and people **by name** (`list_teams`, `list_projects`, `list_issue_labels`, `list_issue_statuses`, `list_users`). Never paste raw IDs.

## Before Starting a Task

1. **Search first.** Look for an existing issue before doing the work — `list_issues(query:…)`, or filter by project/label/assignee. Don't assume there isn't one.
2. **If none exists**, don't silently create it. Ask the user the scope: which team and project, and whether it's one issue or several sub-issues. Then create it per *Creating Issues*.
3. **If one exists**, read it fully (`get_issue`, `includeRelations:true`) and bring it up to date before working:
   - Does the status reflect reality? Move it (e.g. → In Progress).
   - Is the assignee whoever is actually doing it? Fix it.
   - Is context missing — a decision, a new constraint, a related issue? Add it as a comment.

## While Working

- **Sync through comments** (`save_comment`), promptly. When you hit a blocker, change approach, or learn something that shifts scope, leave a comment — don't let the issue drift from reality, and don't bury the change by rewriting the description.
- **Move status as it changes**: In Progress when you start, In Review when a PR is open, Done when merged.

## Editing the Description

The description is the agreed spec. Once an issue is old, accepted, or has discussion, treat it as append-only:

- Prefer a **comment** over editing the description at all.
- If you must edit: wrap large removals in strikethrough (`~~…~~`) instead of deleting them; prefix any changed or added line with **`EDIT (YYYY-MM-DD):`** so the original intent stays legible.
- A fresh issue you just created, with no discussion yet, can be edited freely.

## Creating Issues

- Confirm scope (team / project / how to slice it) with the user first unless it's obvious.
- **Title**: imperative, no ID prefix (Linear adds `ABX-N`). Use a conventional-commit prefix (`fix(vmm):`, `feat(sandbox):`) when the issue maps to a code change; otherwise a plain descriptive title.
- **Labels**: exactly one `type:` label plus one or more `area:` labels (resolve names with `list_issue_labels(team)`). Use only the parented `type:`/`area:` system — ignore legacy duplicates like flat `networking` / `Bug` or migrated `area: ci`. Apply only labels that already exist; **never create a label** — if a needed one is missing, ask the user.
- **Priority** `1` Urgent … `4` Low. **Assignee** by name/email/`"me"`. Set `project` and the current `cycle` for active work; add an `estimate` only when planning a cycle.
- Break large work into sub-issues with `parentId` rather than one giant issue.
- **Description**: Markdown with literal newlines. Bug → Problem / Root cause / Fix; task → Goal / Tasks / Acceptance. Reference code as `path:line`.

## Status & Branch Linking

- Lifecycle: Backlog → Todo → In Progress → In Review → Done (plus Canceled, Duplicate). Resolve names with `list_issue_statuses(team)`; teams may differ.
- Use the issue's `gitBranchName` (from `get_issue`) as the git branch — Linear's GitHub integration then auto-links the branch and PR and advances status.

## Tooling

`save_issue` creates (omit `id`) and updates (pass `id`). `get_issue(includeRelations:true)` for full context. `list_comments` / `save_comment` for the discussion log. Pass team/project/labels/state/assignee by name.
