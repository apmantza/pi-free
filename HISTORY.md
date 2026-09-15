# History

Destination for what `agents.md` removes — not a parallel changelog (that's
`CHANGELOG.md`). This file updates ONLY on shedding: when an agents.md
section completes, dissolves, or a rule's supporting narrative stops
changing any future decision, the narrative moves here and the live rule
stays there. A quiet file while agents.md only gains content is the
expected state, not neglect.

No entries yet — the shedding discipline starts here. Shed record format: dated heading, what moved and why, pointer to the live rule.

## 2026-09-15 — Dual pi-ai copy type clash (issue #539, PR #538)

Dependabot's pi-coding-agent 0.84.4 → 0.85.1 bump (PR #537) split the dev tree into top-level pi-ai@0.84.4 (peer auto-install) and nested pi-ai@0.85.1, reddening master on `tsc` TS2322 at providers/opencode-session.ts(585,2). Fixed by raising the pi-ai peer floor to ^0.85.1. Two dead ends, both proven red before discard: a devDependency pin fixed `tsc` but broke the Production source install job (devDeps suppress the peer install under `--omit=dev`, losing the REQUIRED peer); an npm `overrides` pin is rejected with `EOVERRIDE` (a peer counts as a direct dependency for override purposes). No source-level fix exists — pi-coding-agent does not re-export the pi-ai type symbols. Standing rule: agents.md recurring defect shape 10. Recurrence watch: the peer floor must track pi-coding-agent's minor.
