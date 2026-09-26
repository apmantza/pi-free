---- MODULE Refresh ----
(*
 * Model of pi-free's session-start catalog refresh for ONE provider
 * (e.g. infron) against Pi's ModelsImpl refresh semantics.
 *
 * Pi semantics modelled (from the installed pi-coding-agent bundle):
 *  - setProvider() supersedes the provider's in-flight refresh generation.
 *  - A superseded generation never publishes (generation-checked publish).
 *  - Per-provider aborts are swallowed: refresh() returns clean.
 * pi-free semantics modelled (lib/native-provider.ts):
 *  - Nudge: one scoped refresh at session start, one retry on supersede.
 *  - Storm: re-register events from extension load, toggle captures,
 *    auto-probe completions, reload overlap. Nondeterministic placement.
 *)
EXTENDS Naturals, TLC

CONSTANTS
    MaxStorm,      \* re-register budget per session (adversarial placement)
    FetchSteps,    \* atomic steps in one catalog fetch (kill can land anywhere)
    MaxRetries,   \* nudge retries after supersede (1 = current, 3 = proposed)
    StrictLogging \* TRUE = log clean only if persisted (proposed fix)

VARIABLES
    gen,          \* Pi registry generation counter for the provider
    phase,        \* "idle" | "restoring" | "fetching"
    fetchLeft,    \* fetch steps remaining in the in-flight generation
    activeGen,    \* generation of the in-flight refresh (0 = none)
    persisted,    \* a network generation completed AND published
    loggedClean,  \* nudge logged "refreshed clean"
    stormLeft,    \* remaining re-register events this session
    retryPending, \* retry timer armed
    retriesLeft,  \* retries remaining
    callOpen,     \* nudge's refresh() call outstanding
    nudgeWaiting, \* session just started, nudge not yet fired
    aborts        \* superseded generations observed (diagnostic counter)

vars == <<gen, phase, fetchLeft, activeGen, persisted, loggedClean,
          stormLeft, retryPending, retriesLeft, callOpen, nudgeWaiting,
          aborts>>

Init ==
    /\ gen = 0
    /\ phase = "idle"
    /\ fetchLeft = 0
    /\ activeGen = 0
    /\ persisted = FALSE
    /\ loggedClean = FALSE
    /\ stormLeft = MaxStorm
    /\ retryPending = FALSE
    /\ retriesLeft = MaxRetries
    /\ callOpen = FALSE
    /\ aborts = 0
    /\ nudgeWaiting = TRUE

\* Session start: the nudge fires its scoped refresh. Pi begins a new
\* generation, superseding anything in flight (nothing is, first time).
NudgeRefresh ==
    /\ nudgeWaiting = TRUE
    /\ nudgeWaiting' = FALSE
    /\ callOpen' = TRUE
    /\ gen' = gen + 1
    /\ activeGen' = gen + 1
    /\ phase' = "restoring"
    /\ fetchLeft' = 0
    /\ UNCHANGED <<persisted, loggedClean, stormLeft,
                   retryPending, retriesLeft, aborts>>

\* Pi phase 1 (offline): restore store snapshot. Always succeeds.
RestoreDone ==
    /\ phase = "restoring"
    /\ phase' = "fetching"
    /\ fetchLeft' = FetchSteps
    /\ UNCHANGED <<gen, activeGen, persisted, loggedClean, stormLeft,
                   retryPending, retriesLeft, callOpen, aborts, nudgeWaiting>>

\* One network step of the catalog fetch.
FetchStep ==
    /\ phase = "fetching"
    /\ fetchLeft > 1
    /\ fetchLeft' = fetchLeft - 1
    /\ UNCHANGED <<gen, phase, activeGen, persisted, loggedClean, stormLeft,
                   retryPending, retriesLeft, callOpen, aborts, nudgeWaiting>>

\* Fetch finished AND generation still current -> publish + persist.
\* (A superseded generation can never reach here: Reregister clears
 \*  phase to "idle", exactly like Pi's generation-checked publish.)
Persist ==
    /\ phase = "fetching"
    /\ fetchLeft = 1
    /\ activeGen = gen
    /\ phase' = "idle"
    /\ fetchLeft' = 0
    /\ activeGen' = 0
    /\ persisted' = TRUE
    /\ UNCHANGED <<gen, loggedClean, stormLeft, retryPending,
                   retriesLeft, callOpen, aborts, nudgeWaiting>>

\* A re-register (extension load / toggle capture / probe completion /
 \* reload overlap) hits setProvider -> generation bump + abort in flight.
Reregister ==
    /\ stormLeft > 0
    /\ stormLeft' = stormLeft - 1
    /\ gen' = gen + 1
    /\ IF phase /= "idle"
       THEN /\ aborts' = aborts + 1
            /\ phase' = "idle"
            /\ activeGen' = 0
            /\ fetchLeft' = 0
       ELSE /\ aborts' = aborts
            /\ UNCHANGED <<phase, activeGen, fetchLeft>>
    /\ UNCHANGED <<persisted, loggedClean, retryPending,
                   retriesLeft, callOpen, nudgeWaiting>>

\* Pi's refresh() returns to the nudge. Aborts are swallowed, so the
 \* result is ALWAYS clean -- current code logs it unconditionally.
NudgeReturn ==
    /\ callOpen = TRUE
    /\ phase = "idle"
    /\ activeGen = 0
    /\ callOpen' = FALSE
    /\ IF StrictLogging
       THEN IF persisted THEN loggedClean' = TRUE
                           ELSE UNCHANGED loggedClean
       ELSE loggedClean' = TRUE
    /\ IF /\ persisted = FALSE
          /\ retriesLeft > 0
       THEN /\ retryPending' = TRUE
            /\ retriesLeft' = retriesLeft - 1
       ELSE /\ UNCHANGED <<retryPending, retriesLeft>>
    /\ UNCHANGED <<gen, phase, fetchLeft, activeGen, persisted,
                   stormLeft, aborts, nudgeWaiting>>

\* The retry timer fires (or the retry generation begins).
RetryFire ==
    /\ retryPending = TRUE
    /\ retryPending' = FALSE
    /\ callOpen' = TRUE
    /\ gen' = gen + 1
    /\ activeGen' = gen + 1
    /\ phase' = "restoring"
    /\ fetchLeft' = 0
    /\ UNCHANGED <<persisted, loggedClean, stormLeft,
                   retriesLeft, aborts, nudgeWaiting>>

done ==
    /\ nudgeWaiting = FALSE
    /\ stormLeft = 0
    /\ retryPending = FALSE
    /\ callOpen = FALSE
    /\ phase = "idle"

\* Stuttering terminal step: keeps TLC from reporting deadlock on the
 \* quiescent state; lets the done=>persisted invariant do the talking.
Terminate ==
    /\ done
    /\ UNCHANGED vars

Next ==
    \/ NudgeRefresh
    \/ RestoreDone
    \/ FetchStep
    \/ Persist
    \/ Reregister
    \/ NudgeReturn
    \/ RetryFire
    \/ Terminate

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ gen \in Nat
    /\ phase \in {"idle", "restoring", "fetching"}
    /\ fetchLeft \in 0..FetchSteps
    /\ activeGen \in Nat
    /\ persisted \in BOOLEAN
    /\ loggedClean \in BOOLEAN
    /\ stormLeft \in 0..MaxStorm
    /\ retryPending \in BOOLEAN
    /\ retriesLeft \in 0..MaxRetries
    /\ callOpen \in BOOLEAN
    /\ aborts \in Nat
    /\ nudgeWaiting \in BOOLEAN

\* Safety 1: Pi says clean => a generation actually published.
NoFalseClean == loggedClean => persisted

\* Starvation-as-safety: once quiescent, a generation must have published.
EventualRefresh == done => persisted

====
