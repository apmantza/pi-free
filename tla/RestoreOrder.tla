---- MODULE RestoreOrder ----
(*
 * Model of pi-free's deferred saved-model restore for ONE provider
 * (maybeRestoreSavedModel / restoreSavedModelInner, lib/built-in-toggle.ts):
 * lookup in the current catalog, one join of the pending endpoint
 * refresh + one retry on miss, then restore / warn / skip.
 *
 * pi-free semantics modelled (verified against repo code):
 *  - The saved choice resolves once at restore entry (session ledger
 *    walk + live context read): none, another provider, or ours. A
 *    session already on the saved model is a no-op.
 *  - Hit: setModel restores (or warns when Pi rejects, e.g. auth).
 *  - Miss with a live refresh: join it ONCE, retry the lookup ONCE.
 *    Miss with no live refresh, or miss after retry: warn + keep Pi's
 *    fallback (honest give-up, never a half-state).
 *  - Stale context at any await: skip quietly (#509).
 *  - A user switch landing DURING the refresh join is the race (#602):
 *    the entry-time read is stale by the post-join setModel. With the
 *    RecheckAfterJoin fix the restore re-resolves after the join and
 *    stands down (preempted) when the choice moved or departed; without
 *    it the stale pick lands over the user's explicit pick — the same
 *    hazard class as FallbackA's ManualWins on another path.
 *
 * Out of scope: WHICH model is saved (session file / ledger walk),
 * refresh payload semantics (FetchJoin/CacheGuard), multi-provider
 * restores, setModel internals.
 *)
EXTENDS Naturals, TLC

CONSTANTS
    RecheckAfterJoin  \* re-resolve after the refresh join; stand down on change

ASSUME RecheckAfterJoin \in BOOLEAN

VARIABLES
    phase,        \* "start" | "ready" | "lookedup" | "joined" | "retry" | "settled"
    saved,        \* "none" | "other" | "ours": entry-time resolved choice
    current,      \* "fallback" | "S": session model at entry
    found,        \* saved id present in the (re)looked-up catalog
    userPick,     \* "none" | "S" | "other": explicit user switch mid-join
    sessionModel, \* "fallback" | "S" | "other": live session model
    outcome       \* "none" | "noop" | "restored" | "warned" | "skipped" | "preempted"

vars == <<phase, saved, current, found, userPick, sessionModel, outcome>>

Init ==
    /\ phase = "start"
    /\ saved = "none"
    /\ current = "fallback"
    /\ found = FALSE
    /\ userPick = "none"
    /\ sessionModel = "fallback"
    /\ outcome = "none"

\* Restore entry: resolve the saved choice + read the live model.
Begin ==
    /\ phase = "start"
    /\ phase' = "ready"
    /\ saved' \in {"none", "other", "ours"}
    /\ current' \in {"fallback", "S"}
    /\ sessionModel' = current'
    /\ UNCHANGED <<found, userPick, outcome>>

\* Catalog lookup. Nothing to do unless ours-and-not-current.
Lookup ==
    /\ phase = "ready"
    /\ IF saved /= "ours" \/ current = "S"
       THEN /\ outcome' = "noop"
            /\ phase' = "settled"
            /\ UNCHANGED <<found>>
       ELSE /\ found' \in BOOLEAN
            /\ phase' = IF found' THEN "retry" ELSE "lookedup"
            /\ UNCHANGED outcome
    /\ UNCHANGED <<saved, current, userPick, sessionModel>>

\* Miss with no live refresh to join: honest give-up.
GiveUp ==
    /\ phase = "lookedup"
    /\ outcome' = "warned"
    /\ phase' = "settled"
    /\ UNCHANGED <<saved, current, found, userPick, sessionModel>>

\* Miss with a live refresh: join it once.
JoinRefresh ==
    /\ phase = "lookedup"
    /\ phase' = "joined"
    /\ UNCHANGED <<saved, current, found, userPick, sessionModel,
                   outcome>>

\* Retry after the join: the refreshed catalog may or may not have it.
Retry ==
    /\ phase = "joined"
    /\ found' \in BOOLEAN
    /\ IF found'
       THEN /\ phase' = "retry"
            /\ UNCHANGED outcome
       ELSE /\ outcome' = "warned"
            /\ phase' = "settled"
    /\ UNCHANGED <<saved, current, userPick, sessionModel>>

\* User switches models mid-join (the race window).
UserSwitch ==
    /\ phase = "joined"
    /\ userPick = "none"
    /\ userPick' \in {"S", "other"}
    /\ sessionModel' = userPick'
    /\ UNCHANGED <<phase, saved, current, found, outcome>>

\* Restore lands: with the fix, a moved/departed choice preempts first.
RestoreAccept ==
    /\ phase = "retry"
    /\ ~(RecheckAfterJoin = TRUE /\ userPick = "other")
    /\ outcome' = "restored"
    /\ sessionModel' = "S"
    /\ phase' = "settled"
    /\ UNCHANGED <<saved, current, found, userPick>>

\* Post-join recheck stands down when the choice moved away.
RestorePreempted ==
    /\ RecheckAfterJoin = TRUE
    /\ phase = "retry"
    /\ userPick = "other"
    /\ outcome' = "preempted"
    /\ phase' = "settled"
    /\ UNCHANGED <<saved, current, found, userPick, sessionModel>>

\* Pi rejects the setModel (e.g. auth): warn, keep fallback.
RestoreReject ==
    /\ phase = "retry"
    /\ outcome' = "warned"
    /\ phase' = "settled"
    /\ UNCHANGED <<saved, current, found, userPick, sessionModel>>

\* Stale context at any await: skip quietly (#509).
StaleSkip ==
    /\ phase \in {"ready", "lookedup", "joined", "retry"}
    /\ outcome' = "skipped"
    /\ phase' = "settled"
    /\ UNCHANGED <<saved, current, found, userPick, sessionModel>>

Terminate ==
    /\ phase = "settled"
    /\ UNCHANGED vars

Next ==
    \/ Begin
    \/ Lookup
    \/ GiveUp
    \/ JoinRefresh
    \/ Retry
    \/ UserSwitch
    \/ RestoreAccept
    \/ RestoreReject
    \/ RestorePreempted
    \/ StaleSkip
    \/ Terminate

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ phase \in {"start", "ready", "lookedup", "joined", "retry",
                  "settled"}
    /\ saved \in {"none", "other", "ours"}
    /\ current \in {"fallback", "S"}
    /\ found \in BOOLEAN
    /\ userPick \in {"none", "S", "other"}
    /\ sessionModel \in {"fallback", "S", "other"}
    /\ outcome \in {"none", "noop", "restored", "warned", "skipped",
                    "preempted"}

\* P1: a landed restore never overwrites an explicit other-pick (#602).
NoClobber == ~(outcome = "restored" /\ userPick = "other")

\* P2: give-up and skip paths never move the live model (honest: warn or
 \* quiet, but Pi's fallback stands).
StableOnGiveUp ==
    outcome \in {"warned", "skipped", "noop", "preempted"} =>
        ((userPick = "none" => sessionModel = current)
         /\ (userPick /= "none" => sessionModel = userPick))

\* P3: restores land only on found entries.
RestoreNeedsFound == outcome = "restored" => found

====
