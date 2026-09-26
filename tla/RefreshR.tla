---- MODULE RefreshR ----
(*
 * Refresh Model C: session reloads vs the nudge epoch guard.
 *
 * Extends Refresh.tla with a Reload actor. A reload builds a new Pi
 * runner in the same process: the in-flight refresh vanishes with the
 * old registry (silent -- neither abort-stamped nor published), but
 * OUR retry setTimeout survives and fires into the new session.
 *
 * Without the epoch guard (GuardEpoch=FALSE, current pre-fix code plus
 * retry-once), the stale timer's scoped refresh supersedes the new
 * nudge's generations: an extra kill beyond the storm budget, starving
 * consecutive sessions. With the guard (DropStaleRetry) the obsolete
 * timer stands down.
 *
 * Faithfulness notes beyond Refresh.tla:
 *  - Fresh storm budget + fresh retries per session (realistic: load and
 *    session_start handlers re-fire per session).
 *  - MaxSessions bounds the run; done requires all sessions exhausted.
 *  - A superseded-then-reloaded generation records no abort (it
 *    vanishes with its registry); only setProvider kills stamp aborts.
 *)
EXTENDS Naturals, TLC

CONSTANTS
    MaxStorm,
    FetchSteps,
    MaxRetries,
    MaxSessions,   \* sessions per run (reloads + 1)
    StrictLogging,
    GuardEpoch     \* TRUE = obsolete retries stand down (the fix)

VARIABLES
    gen,
    phase,
    fetchLeft,
    activeGen,
    persisted,
    loggedClean,
    stormLeft,
    retryPending,
    retryEpoch,    \* epoch that armed the pending retry (0 = none)
    retriesLeft,
    callOpen,
    nudgeWaiting,
    epoch,         \* current session epoch
    sessionsLeft,  \* reloads still available
    aborts

vars == <<gen, phase, fetchLeft, activeGen, persisted, loggedClean,
          stormLeft, retryPending, retryEpoch, retriesLeft, callOpen,
          nudgeWaiting, epoch, sessionsLeft, aborts>>

Init ==
    /\ gen = 0
    /\ phase = "idle"
    /\ fetchLeft = 0
    /\ activeGen = 0
    /\ persisted = FALSE
    /\ loggedClean = FALSE
    /\ stormLeft = MaxStorm
    /\ retryPending = FALSE
    /\ retryEpoch = 0
    /\ retriesLeft = MaxRetries
    /\ callOpen = FALSE
    /\ nudgeWaiting = TRUE
    /\ epoch = 1
    /\ sessionsLeft = MaxSessions
    /\ aborts = 0

NudgeRefresh ==
    /\ nudgeWaiting = TRUE
    /\ nudgeWaiting' = FALSE
    /\ callOpen' = TRUE
    /\ gen' = gen + 1
    /\ activeGen' = gen + 1
    /\ phase' = "restoring"
    /\ fetchLeft' = 0
    /\ UNCHANGED <<persisted, loggedClean, stormLeft,
                   retryPending, retryEpoch, retriesLeft, aborts,
                   epoch, sessionsLeft>>

RestoreDone ==
    /\ phase = "restoring"
    /\ phase' = "fetching"
    /\ fetchLeft' = FetchSteps
    /\ UNCHANGED <<gen, activeGen, persisted, loggedClean, stormLeft,
                   retryPending, retryEpoch, retriesLeft, callOpen,
                   nudgeWaiting, epoch, sessionsLeft, aborts>>

FetchStep ==
    /\ phase = "fetching"
    /\ fetchLeft > 1
    /\ fetchLeft' = fetchLeft - 1
    /\ UNCHANGED <<gen, phase, activeGen, persisted, loggedClean, stormLeft,
                   retryPending, retryEpoch, retriesLeft, callOpen,
                   nudgeWaiting, epoch, sessionsLeft, aborts>>

Persist ==
    /\ phase = "fetching"
    /\ fetchLeft = 1
    /\ activeGen = gen
    /\ phase' = "idle"
    /\ fetchLeft' = 0
    /\ activeGen' = 0
    /\ persisted' = TRUE
    /\ UNCHANGED <<gen, loggedClean, stormLeft, retryPending,
                   retryEpoch, retriesLeft, callOpen, nudgeWaiting,
                   epoch, sessionsLeft, aborts>>

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
                   retryEpoch, retriesLeft, callOpen, nudgeWaiting,
                   epoch, sessionsLeft>>

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
            /\ retryEpoch' = epoch
            /\ retriesLeft' = retriesLeft - 1
       ELSE /\ UNCHANGED <<retryPending, retryEpoch, retriesLeft>>
    /\ UNCHANGED <<gen, phase, fetchLeft, activeGen, persisted,
                   stormLeft, aborts, nudgeWaiting, epoch, sessionsLeft>>

RetryFire ==
    /\ retryPending = TRUE
    /\ ~GuardEpoch \/ retryEpoch = epoch
    /\ retryPending' = FALSE
    /\ retryEpoch' = 0
    /\ callOpen' = TRUE
    /\ gen' = gen + 1
    /\ activeGen' = gen + 1
    /\ phase' = "restoring"
    /\ fetchLeft' = 0
    /\ UNCHANGED <<persisted, loggedClean, stormLeft,
                   retriesLeft, aborts, nudgeWaiting, epoch, sessionsLeft>>

\* The fix: a retry armed by a previous epoch stands down silently.
DropStaleRetry ==
    /\ GuardEpoch = TRUE
    /\ retryPending = TRUE
    /\ retryEpoch /= epoch
    /\ retryPending' = FALSE
    /\ retryEpoch' = 0
    /\ UNCHANGED <<gen, phase, fetchLeft, activeGen, persisted,
                   loggedClean, stormLeft, retriesLeft, callOpen,
                   nudgeWaiting, epoch, sessionsLeft, aborts>>

\* Reload: new runner, same process. In-flight vanishes with the old
 \* registry (no abort stamp, no publish); OUR retry timer survives.
Reload ==
    /\ sessionsLeft > 0
    /\ sessionsLeft' = sessionsLeft - 1
    /\ epoch' = epoch + 1
    /\ nudgeWaiting' = TRUE
    /\ retriesLeft' = MaxRetries
    /\ stormLeft' = MaxStorm
    /\ phase' = "idle"
    /\ activeGen' = 0
    /\ fetchLeft' = 0
    /\ callOpen' = FALSE
    /\ UNCHANGED <<gen, persisted, loggedClean, retryPending,
                   retryEpoch, aborts>>

done ==
    /\ nudgeWaiting = FALSE
    /\ stormLeft = 0
    /\ retryPending = FALSE
    /\ callOpen = FALSE
    /\ phase = "idle"
    /\ sessionsLeft = 0

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
    \/ DropStaleRetry
    \/ Reload
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
    /\ retryEpoch \in Nat
    /\ retriesLeft \in 0..MaxRetries
    /\ callOpen \in BOOLEAN
    /\ nudgeWaiting \in BOOLEAN
    /\ epoch \in Nat
    /\ sessionsLeft \in 0..MaxSessions
    /\ aborts \in Nat

NoFalseClean == loggedClean => persisted

EventualRefresh == done => persisted

====
