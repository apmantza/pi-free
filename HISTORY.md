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

## 2026-09 — Auto-fallback design record (shed from agents.md)

Live rules stay in agents.md (opt-in, settled-only decision point, blacklist numbers, scope selection, hard limits). What moved here is the point-in-time design trace:

Pipeline per event (`index.ts`): `after_provider_response` records `{provider, model, status}` into `lib/fallback-state.ts` (no body read); `message_end` stores the latest assistant message; `agent_settled` runs one pass — recovery (clean run un-bans via history `fromKey`, refills replay budget), failure handling (classify, ONE strike, `pi.setModel()`, arm replay), auto-continue dispatch (re-issue captured prompt, budget-capped); `before_agent_start` clears armed replays on user input; `model_select` clears the restore marker.

Classifier matrix: fatal patterns (invalid key, model not found, context length) and HTTP 400/401/403/404/422 → unrecoverable, no switch; HTTP 402/408/425/429 and 5xx (500-504, 521-527, 529), pi-ai retryable text, pi-ai non-retryable + quota pattern, abort + last status ≥ 500 → recoverable, strike + switch; abort without 5xx (user Esc) → not a failure. Decision codes from the design review: blacklist dual rule Q9 = C, scope strategy Q3 = D, notify aggregation Q31 = B (first switch toasts, rest roll into one 5-minute summary).

## 2026-09 — pi-ai loader resolution order (shed from convention 16)

Live rule stays in agents.md (dynamic imports only, vendored bundle is last resort). The full `loadPiAiEntry` order: bare specifier → on-disk fallbacks (walk-up from this package, nested under pi-coding-agent, the running pi host's realpath-resolved entry script — covers pnpm virtual-store layouts, #448 — plus `~/.pi/agent/npm`, `%APPDATA%\npm`, executable-relative roots) → `dist/vendor` esbuild bundles by absolute path. The `dist/vendor` bundles (`pi-ai-compat.js`: OpenAI completions, Anthropic messages, OpenAI responses, Google generative AI factories; `pi-ai-providers-all.js`: builtin-catalog readers) exist because Bun-compiled pi binaries (scoop/winget/standalone zip, #502) disable bare-specifier resolution from external files — no on-disk layout can serve pi-free there, and even a correctly installed pi-ai dies on its own internal bare imports. Bundles inline every transitive dep (only `node:*` external), stay out of the startup path, freeze pi-ai at pi-free's build time, and back the OpenCode `importPiAiSubpath` fallback so `opencode-free`/`opencode-go` work on Bun hosts.

2026-09 addendum, #581 (live rules: convention 16 + defect shape 11): the bare-specifier fast path can fail two ways, not one. `ERR_MODULE_NOT_FOUND` means no pi-ai on the chain; `ERR_PACKAGE_PATH_NOT_EXPORTED` for an allow-listed subpath means a *stale pi-ai copy resolved instead of the real one* — a long-ago install in a `node_modules` directory above the pi-free install (right name, version ≥ the peer floor, `exports` predating the entry), which shadowed the walk-up from `~/.pi/agent/npm` and killed every stream at first use on otherwise-healthy installs. Both codes now trigger the on-disk fallback; any other subpath still surfaces (pi-ai's own internal breakage must not silently pick another copy). The probe is also entry-aware — a candidate root must define the requested entry in its `exports` map (or carry the known dist file) before it wins, so a stale copy is skipped rather than pinning the search, and the resolved-root cache is keyed per entry so one subpath's root never pins another's. Detection layer added in the same change: `scripts/smoke-pi-ai-shadowed.mjs` builds the hostile layout (stale copy at the top of the walk-up, real copy reachable only through a host entry script, `dist/vendor` removed so the vendored last resort cannot mask a broken disk fallback) and requires sentinel exports from the real copy on every CI matrix OS — the layer that would have caught this before merge, since all load-only/normal-layout smokes pass on that machine.

## 2026-09 — OpenCode refresh warnings without an environment key, #504 (shed from auth notes)

Live rules stay in agents.md (detached public-endpoint refresh, retain-on-failure, `resolveApiKey` omits absent keys; defect shape 9). The incident: Pi surfaced refresh warnings for `opencode-free`/`opencode-go` while both OpenCode endpoints returned 200 — pi-free supplied a missing `$OPENCODE_API_KEY` reference, and Pi's refresh auth resolution threw before the extension callback ran. Hence the screen: missing-credential paths go through real `ModelRuntime.refresh`, never a mocked registry; passing public catalog fetches prove nothing about auth/composition (`tests/built-in-toggle-runtime.test.ts`). Related timing facts: the detached refresh never blocks `session_start` (~2ms handler, fetch lands ~0.6–1.0s later, `PI_STARTUP_BENCHMARK=1`), deduplicated per process; Pi's own pi.dev overlay fetch for built-in `opencode-go` runs before ours in provider-composer — never infer a mirror failure from successful endpoint logs.

## 2026-09 — Cline port details (shed from agents.md)

Live rules stay in agents.md (public-catalog auth, shared mutable headers). Shed instance detail: Cline's endpoint speaks vanilla OpenAI Chat Completions, so models use `openai-completions` via the lazy compat bridge like every other OpenAI-compatible provider; pi-ai maps `reasoning`/`reasoning_details` natively, no transform layer. Models restored from Pi's store with the retired `cline-xml-tools` api normalize on restore (#433). The OAuth callback-server flow adapts onto `AuthInteraction` exactly as Pi's `adaptOAuth` (`onAuth`→`auth_url`, `onProgress`→`progress`, `onManualCodeInput`→`manual_code`, results tagged `type: "oauth"`); `refresh` delegates to `refreshClineToken`; `toAuth` applies the `workos:` bearer prefix (raw tokens 401).

## 2026-09 — Refresh-supersede narrative (shed from defect shape 4)

Live rule stays in agents.md (scope, retry-once, seed-static). The incident: pi-free's own captures re-registered ~40ms after the session-start nudge fired, so an unscoped unretried network refresh was deterministically aborted by Pi's supersede — empty catalog on fresh installs, caught live by the RPC session check, not by any unit test.

## 2026-09 — #510 filter saga (shed from defect shape 2)

Live rule stays in agents.md (resolve live at call time). The incident: a per-provider `show_paid` capture froze the view at capture time, then native registration froze it a second time — later global `/toggle-free` flips never reached either frozen copy, so the picker showed a stale view no toggle could fix. Two freezes, same shape, one saga: any value captured at registration/capture and trusted later is suspect, including registry handles and `filterModels` internals.
