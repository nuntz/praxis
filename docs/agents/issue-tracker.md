# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: first `bun lint/tickets.ts --closing <number>`, and clear each placeholder it names, since a comment naming a closed ticket fails CI; then `gh issue close <number> --comment "..."`. A ticket closed with one left is reopened by the Ticket closed workflow, with a comment naming each.

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue. A spec's tickets hold every one of its user stories between them: each ticket names the numbers of the stories its criteria hold, and a story no ticket names gets a ticket of its own before any is built. #107's stories 35 and 49 sat in no ticket, and its review found them missing only once all nine were built.

A spec's claim about the code as it is ("as Attention says it", "the Deployment's list of Connections", "the composer's picker, reused") is read in the code before publishing, and a false one is rewritten as a change to build. #117 named Attention's wording, ended Connections and a reusable picker that the code did not have. Name each ADR whose decision the spec changes beside the SPEC sections, as #117 changed ADR 0023's "one ranked list from words and from meaning" and named only 9.4.

A ticket with an acceptance criterion that needs what another open ticket builds (a refusal for a state that ticket makes, a reason that ticket gives) is blocked by it: add the edge as in **Blocking** below, or write the stand-in into the criterion.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above, then its open blockers: `gh api repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by --jq '.[] | select(.state=="open") | "#\(.number) \(.title)"'`. Any printed is work the ticket stands on that is not built yet: name each to the user and ask before building.

A ticket is one **slice** of `SPEC.md`, and its open siblings own the rest. When reviewing a ticket against the spec or the ADRs, list the open tickets (`gh issue list --state open --json number,title`) and report what a sibling owns as deferred to that ticket, by number, rather than as missing.

What a ticket's criteria stand on that no open ticket builds, as #70's Unsent writes stood on a screen that opens with no network, is a ticket of its own: file it before building, and add it as a blocker of each ticket that stands on it.

A ticket whose tool meets a rule a sibling ticket owns, without that sibling blocking it, says what stands in until that sibling lands, such as a call refused until the Held Change it should leave exists. The implementer builds the stand-in, with a placeholder comment naming the sibling.

A question an implementer leaves open for a sibling to settle is a placeholder too: a comment naming that sibling by number, at the code its answer changes, so `bun lint/tickets.ts --closing <n>` names it when the sibling closes. #61 left one in a closed ticket's comment and in code naming no ticket ("Settled with the Agent's Runs"); #62 closed with it open, and #79 met it as an acceptance criterion its tests contradicted.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
