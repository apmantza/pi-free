---- MODULE FetchJoin ----
(*
 * Model of pi-free's shared-catalog fetch join for ONE provider: the
 * detached endpoint refresh task vs Pi-nudge refreshModels calls sharing
 * one live fetch through pendingCatalogFetches (lib/built-in-toggle.ts).
 * One fetch generation per run; successor generations belong to later
 * sessions (Refresh.tla territory).
 *
 * pi-free semantics modelled (verified against repo code):
 *  - Join or start: a consumer joins the in-flight fetch when one exists;
 *    otherwise its own call starts it. Two fetches per tier per session
 *    (detached + nudge) collapse to one request.
 *  - The shared fetch takes NO consumer signal: one joiner's abort must
 *    not cancel shared work. Abort semantics live in each consumer's
 *    pre/post checks around the await (discard + retain current).
 *  - A pre-aborted refreshModels call returns current WITHOUT issuing
 *    any request (checked before any network I/O).
 *  - The detached task never rejects: failures resolve (retain silently)
 *    so joiners awaiting pendingEndpointRefreshes never observe a
 *    rejection (a past version rethrew: every blip fanned out a second
 *    "detached failed" warn to each waiter).
 *  - Settle-then-clear is modelled atomically. The code's delete-if-same
 *    identity check in fetchSharedCatalog/finally guards an ordering a
 *    successor entry interleaved between settle and clear — under JS
 *    microtask semantics no caller can observe the map in that window
 *    (a successor only starts once the entry is gone), so the guard is
 *    defensive and both variants behave identically; the spec records
 *    the atomic behavior.
 *
 * Out of scope: poisoning/retain rules on the payload (CacheGuard.tla),
 * endpoint dedup across sessions (pendingEndpointRefreshes), the Pi-side
 * abort-storm machinery (Refresh.tla/RefreshR.tla).
 *)
EXTENDS Naturals, TLC

CONSTANTS
    DetachedRuns,       \* the detached endpoint refresh task runs
    AllowNormalN,       \* a normal nudge consumer may arrive
    AllowPreAbortedN,   \* a pre-aborted nudge consumer may arrive
    JoinSharesFetch,    \* arrivals join a live fetch instead of starting one
    SharedIgnoresSignal,\* a joiner's abort never cancels the shared fetch
    DetachedResolves,   \* the detached task resolves (never rejects) on failure
    PreCheckRespected   \* a pre-aborted arrival issues no request

ASSUME /\ DetachedRuns \in BOOLEAN
       /\ AllowNormalN \in BOOLEAN
       /\ AllowPreAbortedN \in BOOLEAN
       /\ JoinSharesFetch \in BOOLEAN
       /\ SharedIgnoresSignal \in BOOLEAN
       /\ DetachedResolves \in BOOLEAN
       /\ PreCheckRespected \in BOOLEAN

VARIABLES
    fetch,      \* "idle" | "live" | "settled"
    result,     \* "none" | "ok" | "fail": settled outcome
    settledOnce,\* a fetch settled (single generation per run)
    live,       \* concurrent live fetches (0..2)
    requests,   \* network requests actually issued (0..2)
    killed,     \* shared fetch killed by a consumer abort (the bug)
    estat,      \* detached task: "absent" | "joined" | "done"
    eout,       \* "none" | "updated" | "retained" | "rejected"
    nstat,      \* normal nudge: "absent" | "joined" | "jaborted" | "done"
    nout,       \* "none" | "updated" | "retainedWarn" | "retainedSilent" | "discarded"
    nastat,     \* pre-aborted nudge: "absent" | "joined" | "done"
    naout,      \* "none" | "discarded"
    done        \* quiescent: arrivals complete, fetch idle

vars == <<fetch, result, settledOnce, live, requests, killed, estat,
          eout, nstat, nout, nastat, naout, done>>

Init ==
    /\ fetch = "idle"
    /\ result = "none"
    /\ settledOnce = FALSE
    /\ live = 0
    /\ requests = 0
    /\ killed = FALSE
    /\ estat = "absent"
    /\ eout = "none"
    /\ nstat = "absent"
    /\ nout = "none"
    /\ nastat = "absent"
    /\ naout = "none"
    /\ done = FALSE

\* Detached task arrival: join the live fetch, else start it. Single-shot,
 \* pre-settle only (post-settle arrivals belong to the next generation).
EArrive ==
    /\ DetachedRuns = TRUE
    /\ settledOnce = FALSE
    /\ estat = "absent"
    /\ IF live = 0
       THEN /\ live' = 1
            /\ requests' = requests + 1
            /\ fetch' = "live"
       ELSE UNCHANGED <<live, requests, fetch>>
    /\ estat' = "joined"
    /\ UNCHANGED <<result, settledOnce, killed, eout, nstat, nout,
                   nastat, naout, done>>

\* Normal nudge arrival: pre-checks pass (network allowed, signal live),
 \* then join-or-start like the detached task. Single-shot, pre-settle.
NArrive ==
    /\ AllowNormalN = TRUE
    /\ settledOnce = FALSE
    /\ nstat = "absent"
    /\ IF live = 0
       THEN /\ live' = 1
            /\ requests' = requests + 1
            /\ fetch' = "live"
       ELSE IF JoinSharesFetch
            THEN UNCHANGED <<live, requests, fetch>>
            ELSE /\ live' = IF live < 2 THEN live + 1 ELSE 2
                 /\ requests' = requests + 1
                 /\ fetch' = "live"
    /\ nstat' = "joined"
    /\ UNCHANGED <<result, settledOnce, killed, estat, eout, nout,
                   nastat, naout, done>>

\* Pre-aborted nudge arrival: the pre-check returns current with no
 \* request and no fetch contact at all. Single-shot, pre-settle.
NAArrive ==
    /\ AllowPreAbortedN = TRUE
    /\ settledOnce = FALSE
    /\ nastat = "absent"
    /\ IF PreCheckRespected
       THEN /\ nastat' = "done"
            /\ naout' = "discarded"
            /\ UNCHANGED <<fetch, result, live, requests>>
       ELSE /\ IF live = 0
                   THEN /\ live' = 1
                        /\ requests' = requests + 1
                        /\ fetch' = "live"
                   ELSE UNCHANGED <<live, requests, fetch>>
            /\ nastat' = "joined"
            /\ UNCHANGED <<naout>>
    /\ UNCHANGED <<settledOnce, killed, estat, eout, nstat, nout, done,
                   result>>

\* A joined nudge's own signal aborts: its post-checks will discard.
 \* Shared work continues for the other joiners.
AbortN ==
    /\ nstat = "joined"
    /\ nstat' = "jaborted"
    /\ IF SharedIgnoresSignal
       THEN UNCHANGED <<fetch, result, settledOnce, live, killed>>
       ELSE /\ killed' = TRUE
            /\ live' = 0
            /\ fetch' = "settled"
            /\ result' = "fail"
            /\ settledOnce' = TRUE
    /\ UNCHANGED <<requests, estat, eout, nout, nastat, naout, done>>

\* The shared fetch settles; every joiner observes the same outcome.
SettleOk ==
    /\ fetch = "live"
    /\ fetch' = "settled"
    /\ result' = "ok"
    /\ settledOnce' = TRUE
    /\ UNCHANGED <<live, requests, killed, estat, eout, nstat, nout,
                   nastat, naout, done>>

SettleFail ==
    /\ fetch = "live"
    /\ fetch' = "settled"
    /\ result' = "fail"
    /\ settledOnce' = TRUE
    /\ UNCHANGED <<live, requests, killed, estat, eout, nstat, nout,
                   nastat, naout, done>>

\* Detached consume: success updates, failure retains silently — and, with
 \* the fix, the task itself always resolves.
ConsumeE ==
    /\ estat = "joined"
    /\ fetch = "settled"
    /\ estat' = "done"
    /\ IF DetachedResolves
       THEN eout' = IF result = "ok" THEN "updated" ELSE "retained"
       ELSE eout' = IF result = "ok" THEN "updated" ELSE "rejected"
    /\ UNCHANGED <<fetch, result, settledOnce, live, requests, killed,
                   nstat, nout, nastat, naout, done>>

\* Nudge consume: an aborted joiner discards (silent cancel path); a live
 \* one updates on success or retains with a warning on failure.
ConsumeN ==
    /\ nstat \in {"joined", "jaborted"}
    /\ fetch = "settled"
    /\ nstat' = "done"
    /\ nout' = IF nstat = "jaborted" THEN "retainedSilent"
               ELSE IF result = "ok" THEN "updated"
               ELSE "retainedWarn"
    /\ UNCHANGED <<fetch, result, settledOnce, live, requests, killed,
                   estat, eout, nastat, naout, done>>

\* Pre-aborted-via-bug consume: the wrongly-started fetch settles, the
 \* joiner discards.
ConsumeNA ==
    /\ nastat = "joined"
    /\ fetch = "settled"
    /\ nastat' = "done"
    /\ naout' = "discarded"
    /\ UNCHANGED <<fetch, result, settledOnce, live, requests, killed,
                   estat, eout, nstat, nout, done>>

\* Settle the books once every joined party consumed: ready for Finish.
Reap ==
    /\ fetch = "settled"
    /\ estat /= "joined"
    /\ nstat \notin {"joined", "jaborted"}
    /\ nastat /= "joined"
    /\ fetch' = "idle"
    /\ result' = "none"
    /\ live' = 0
    /\ UNCHANGED <<settledOnce, requests, killed, estat, eout, nstat,
                   nout, nastat, naout, done>>

\* Quiescence marker. Parties that never arrived are excused only when
 \* they can no longer arrive (constant-off, or post-settle): with a live
 \* generation still joinable, its arrivals stay enabled instead.
Finish ==
    /\ done = FALSE
    /\ fetch = "idle"
    /\ estat /= "joined"
    /\ nstat \notin {"joined", "jaborted"}
    /\ nastat /= "joined"
    /\ \/ settledOnce = TRUE
       \/ /\ (DetachedRuns = FALSE \/ estat = "done")
          /\ (AllowNormalN = FALSE \/ nstat = "done")
          /\ (AllowPreAbortedN = FALSE \/ nastat = "done")
    /\ done' = TRUE
    /\ UNCHANGED <<fetch, result, settledOnce, live, requests, killed,
                   estat, eout, nstat, nout, nastat, naout>>

Terminate ==
    /\ done = TRUE
    /\ UNCHANGED vars

Next ==
    \/ EArrive
    \/ NArrive
    \/ NAArrive
    \/ AbortN
    \/ SettleOk
    \/ SettleFail
    \/ ConsumeE
    \/ ConsumeN
    \/ ConsumeNA
    \/ Reap
    \/ Finish
    \/ Terminate

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ fetch \in {"idle", "live", "settled"}
    /\ result \in {"none", "ok", "fail"}
    /\ settledOnce \in BOOLEAN
    /\ live \in 0..2
    /\ requests \in 0..2
    /\ killed \in BOOLEAN
    /\ estat \in {"absent", "joined", "done"}
    /\ eout \in {"none", "updated", "retained", "rejected"}
    /\ nstat \in {"absent", "joined", "done", "jaborted"}
    /\ nout \in {"none", "updated", "retainedWarn", "retainedSilent",
                 "discarded"}
    /\ nastat \in {"absent", "joined", "done"}
    /\ naout \in {"none", "discarded"}
    /\ done \in BOOLEAN

\* P1: join-or-start keeps at most one live fetch (no duplicate request
 \* per tier per session).
AtMostOneLive == live <= 1

\* P2: a joiner's abort never cancels the shared fetch.
SharedSurvivesAbort == killed = FALSE

\* P3: the detached task always resolves for its joiners, even on failure.
DetachedSettlesClean == estat = "done" => eout /= "rejected"

\* P4: exactly one request serves a fetching session (whoever arrives
 \* first starts; everyone else joins; the pre-aborted arrival requests
 \* nothing). Sessions that never fetch are excused via ~settledOnce.
SingleRequest == done => (settledOnce = FALSE \/ requests = 1)

\* P5: a pre-aborted-only session issues no request at all.
QuietWhenPreAborted == done => requests = 0

====
