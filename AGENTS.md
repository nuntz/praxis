## Binding documents

- `CODING_STANDARDS.md`: the coding standards, read at review.
- `DESIGN.md`: binding for all UI code.
- `PRODUCT.md`: the product truth design work starts from. Its terminology follows `GLOSSARY.md`.

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues: read one with `gh issue view <n> --json title,body,labels,comments`; the rest is in `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), unchanged. See `docs/agents/triage-labels.md`.

### Testing seams

Fixed by ADR 0015 and SPEC section 13: `/tdd` works at them without asking.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Flaky journeys

A journey that keeps coming back flaky, or fails on its retry in CI: `docs/flaky-journeys.md`.

### Production

The weekly Prod Review of production is the `/prod-review praxis` skill; it inspects only.
