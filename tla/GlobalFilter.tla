---- MODULE GlobalFilter ----
(*
 * Model of pi-free's global free-only filter vs per-provider overrides
 * for TWO providers: R (regular catalog) and E (empty-free paid-only
 * catalog). Covers lib/registry.ts applyGlobalFilter/applyFilterToProvider/
 * resolveModelView, the toggle persist paths (native-provider
 * registerNativeProviderToggle + built-in runToggleCommand, both via
 * setModelViewOverride), and createToggleState resolveMode.
 *
 * pi-free semantics modelled (verified against repo code):
 *  - resolveModelView: an explicit per-provider override wins, otherwise
 *    the global default applies. The single rule behind every decision.
 *  - Toggle = read effective view, then flip + persist the choice as the
 *    explicit override + apply. The read and the write are separated by
 *    awaits (capture wait, registry ops, serialized config write), so two
 *    rapid toggles can interleave read/read/write/write on the same
 *    stale read: the second flip collapses (net one flip for two
 *    commands). No mutex exists; updateConfig only serializes the writes.
 *  - GlobalFlip re-resolves every entry (the applyGlobalFilter loop) with
 *    a FRESH resolveModelView per entry, so an override written mid-loop
 *    still governs its entry; explicit choices survive global flips.
 *  - Strict empty: a free view over an empty free list serves HIDDEN
 *    (the provider vanishes from the picker), never the paid catalog;
 *    an all view over an empty all list falls back to free.
 *  - Native providers behave identically at this level (served view =
 *    resolveModelView; invalidate-vs-reregister is unobservable here),
 *    so R stands for both; the boot-from-persisted rule is assumed equal
 *    to the default in-model (boundary).
 *  - The applyGlobalFilter loop itself is synchronous: no interleaving
 *    is possible mid-loop, so loop ORDER needs no model — only the
 *    per-entry fresh resolve, which ApplyGlobal captures. More providers
 *    would add no new interleavings, so two (regular + empty-free)
 *    suffice.
 *)
EXTENDS Naturals, TLC

CONSTANTS Providers

VARIABLES
    global,     \* global default: "free" | "all"
    override,   \* explicit per-provider choice: "none" | "free" | "all"
    servedR,    \* R's served view: "free" | "all"
    servedE,    \* E's served view: "free" | "all" | "hidden"
    intent,     \* in-flight toggle target per provider (read, unwritten)
    reads,      \* toggle reads issued per provider (0..2, see below)
    changes,    \* net served flips via toggle writes per provider (0..2)
    stale       \* entry disagrees until re-resolved (loop/toggle in flight)

vars == <<global, override, servedR, servedE, intent, reads, changes,
          stale>>

Resolve(p) == IF override[p] /= "none" THEN override[p] ELSE global
Flip(v) == IF v = "free" THEN "all" ELSE "free"
ApplyR(v) == v
ApplyE(v) == IF v = "free" THEN "hidden" ELSE "all"
Expected(p) == IF p = "E" THEN ApplyE(Resolve(p)) ELSE Resolve(p)
Served(p) == IF p = "E" THEN servedE ELSE servedR

Init ==
    /\ global = "free"
    /\ override = [p \in Providers |-> "none"]
    /\ servedR = "free"
    /\ servedE = "hidden"
    /\ intent = [p \in Providers |-> "none"]
    /\ reads = [p \in Providers |-> 0]
    /\ changes = [p \in Providers |-> 0]
    /\ stale = [p \in Providers |-> FALSE]

\* Toggle command, read half: sample the effective view. Cap two reads:
 \* the collapse needs exactly two rapid toggles; deeper equivalents add
 \* no new shape.
ToggleRead(p) ==
    /\ reads[p] < 2
    /\ reads' = [reads EXCEPT ![p] = reads[p] + 1]
    /\ intent' = [intent EXCEPT ![p] = Flip(Resolve(p))]
    /\ stale' = [stale EXCEPT ![p] = TRUE]
    /\ UNCHANGED <<global, override, servedR, servedE, changes>>

\* Toggle command, write half: apply the (possibly stale) intent, persist
 \* it as the explicit choice, resolve the entry.
ToggleWrite(p) ==
    /\ intent[p] /= "none"
    /\ servedE' = IF p = "E" THEN ApplyE(intent[p]) ELSE servedE
    /\ servedR' = IF p = "E" THEN servedR ELSE ApplyR(intent[p])
    /\ IF Served(p) /= (IF p = "E" THEN ApplyE(intent[p])
                        ELSE ApplyR(intent[p]))
       THEN changes' = [changes EXCEPT ![p] = changes[p] + 1]
       ELSE UNCHANGED changes
    /\ override' = [override EXCEPT ![p] = intent[p]]
    /\ intent' = [intent EXCEPT ![p] = "none"]
    /\ stale' = [stale EXCEPT ![p] = FALSE]
    /\ UNCHANGED <<global, reads>>

\* Global flip + re-resolve loop, one entry per step (fresh resolve each).
GlobalFlip ==
    /\ global' = Flip(global)
    /\ stale' = [p \in Providers |-> TRUE]
    /\ UNCHANGED <<override, servedR, servedE, intent, reads, changes>>

ApplyGlobal(p) ==
    /\ stale[p] = TRUE
    /\ servedE' = IF p = "E" THEN ApplyE(Resolve(p)) ELSE servedE
    /\ servedR' = IF p = "E" THEN servedR ELSE Resolve(p)
    /\ stale' = [stale EXCEPT ![p] = FALSE]
    /\ UNCHANGED <<global, override, intent, reads, changes>>

Next ==
    \/ \E p \in Providers : ToggleRead(p)
    \/ \E p \in Providers : ToggleWrite(p)
    \/ GlobalFlip
    \/ \E p \in Providers : ApplyGlobal(p)

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ global \in {"free", "all"}
    /\ override \in [Providers -> {"none", "free", "all"}]
    /\ servedR \in {"free", "all"}
    /\ servedE \in {"free", "all", "hidden"}
    /\ intent \in [Providers -> {"none", "free", "all"}]
    /\ reads \in [Providers -> 0..2]
    /\ changes \in [Providers -> 0..2]
    /\ stale \in [Providers -> BOOLEAN]

\* P1: a resolved entry always serves the effective view (override wins,
 \* else global) — across toggles, global flips, and loop interleavings.
QuiescentAgreement ==
    \A p \in Providers : stale[p] = FALSE => Served(p) = Expected(p)

\* P2: strict empty — free over an empty free list hides the provider,
 \* never serves paid.
NoPaidLeak ==
    (stale["E"] = FALSE /\ Resolve("E") = "free") => servedE = "hidden"

\* P3 (documents the TOCTOU, SessionA-style): two rapid toggles collapse
 \* to one net flip when both read before either writes. At quiescence
 \* (no in-flight intent, all resolved) reads minus applied flips is even;
 \* the collapse leaves it odd. No mutex exists in code (updateConfig only
 \* serializes the writes); fix direction is read-inside-lock, unimplemented.
FlipParity ==
    (\A p \in Providers : intent[p] = "none" /\ stale[p] = FALSE)
        => \A p \in Providers : (reads[p] - changes[p]) % 2 = 0

====
