---- MODULE Capture ----
(*
 * Model of pi-free's built-in provider capture lifecycle for ONE opencode
 * tier (e.g. opencode-free): synchronous disk-cache registration at
 * extension load (#596) vs the detached async session_start capture,
 * duplicate session_start dedup, reload drops, and the view-syncing
 * re-register (#510).
 *
 * pi-free semantics modelled (verified against repo code, post-#596/#597):
 *  - Load: setupBuiltInProviderToggles runs trySyncCacheRegistration per
 *    active config. Non-opencode ids, existing providerStates entries, and
 *    cache misses are no-ops; a hit calls createProviderState with
 *    source="cache-sync" and modelRegistry=undefined, which lands in
 *    providerStates AND the global toggle registry (same flush timing as
 *    native providers, so ids resolve before session_start).
 *  - WARM CACHE RETIRES THE CAPTURE: a sync-created entry makes every
 *    later session_start take the existing-state path (setModelRegistry +
 *    applyCurrent + restore + refresh), so tryCaptureProvider never runs
 *    on a warm-cache process. The async capture runs only on a cache
 *    miss then persists for the next process; freshness in steady state
 *    comes from the endpoint refresh, not a re-capture. (The #596 body
 *    says the capture "still replaces the state seconds later" — that
 *    holds only on cache-miss processes; WarmCacheRetiresCapture pins
 *    the actual steady-state behavior.)
 *  - Sync loads NEVER persist: only captures (source="captured") and
 *    refresh updateModels write the cache. No read-write feedback loop.
 *  - First session_start with NO state starts ONE detached capture
 *    (pendingCaptures guard); duplicate session_start events while it is
 *    in flight only hand it the latest snapshot, never a second task.
 *  - Both generations derive their initial view from resolveModelView at
 *    creation, so a toggle between sync and capture is picked up, never
 *    resurrected; the reapply path pushes the CURRENT view (#510).
 *  - Reload (new runner, same process): pendingCaptures.clear() drops the
 *    in-flight task (stale work must not publish); module state
 *    (providerStates, toggle views, overrides) survives, so the next
 *    session_start takes the reapply path.
 *  - Toggle (/toggle-<id>) flips the live view, persists the override,
 *    and applies to the live registration. With no registration it waits
 *    out a pending capture first (ToggleCapture models the wait plus the
 *    on-demand capture with flip-on-landing).
 *
 * Out of scope (covered elsewhere): endpoint-refresh storms (Refresh.tla,
 * RefreshR.tla), the global free/all filter loop (registry applyGlobalFilter),
 * restore-vs-refresh content ordering, non-chat catalog entries (pi 1.x).
 *)
EXTENDS Naturals, TLC

CONSTANTS
    CachePresent,    \* disk cache hit at load (FALSE = first run)
    BuiltinPresent,  \* Pi's built-in catalog carries the provider
    DedupGuard,      \* pendingCaptures dedup on duplicate session_start
    ViewSyncWrapper, \* reapply pushes the current view, not the creation view
    ToggleWaits,     \* toggle joins a pending capture instead of racing one
    MaxSessions,     \* new-session bound (sessionsStarted)
    MaxDups          \* duplicate-session_start bound while a capture is pending

ASSUME /\ CachePresent \in BOOLEAN
       /\ BuiltinPresent \in BOOLEAN
       /\ DedupGuard \in BOOLEAN
       /\ ViewSyncWrapper \in BOOLEAN
       /\ ToggleWaits \in BOOLEAN
       /\ MaxSessions \in Nat /\ MaxSessions > 0
       /\ MaxDups \in Nat /\ MaxDups > 0

VARIABLES
    loaded,          \* setup ran (sync stage done)
    syncReg,         \* "none" | "sync": cache-sync state registered at load
    cap,             \* "none" | "pending" | "done" | "miss": async capture
    session,         \* current session number
    sessionsStarted, \* new sessions begun (excludes duplicates)
    dups,            \* duplicate session_starts observed while pending
    inflight,        \* concurrent capture generations (0..2)
    view,            \* effective view: "free" | "all"
    override,        \* an explicit toggle persisted an override
    registered,      \* provider id resolvable
    regView,         \* view the live registration serves
    stateView,       \* view the live state was created with
    startView,       \* view at capture-task creation (resolveModelView then)
    staleDropped,    \* a reload dropped an in-flight capture
    toggleQueued,    \* a toggle is waiting on its own capture to land
    cacheWritten,    \* the disk cache was persisted (capture only)
    done             \* quiescent: sessions exhausted, nothing pending

vars == <<loaded, syncReg, cap, session, sessionsStarted, dups,
          inflight, view, override, registered, regView, stateView,
          startView, toggleQueued, staleDropped, cacheWritten, done>>

hasState == syncReg = "sync" \/ cap = "done"
Resolvable == BuiltinPresent \/ CachePresent
flipView(v) == IF v = "free" THEN "all" ELSE "free"

Init ==
    /\ loaded = FALSE
    /\ syncReg = "none"
    /\ cap = "none"
    /\ session = 0
    /\ sessionsStarted = 0
    /\ dups = 0
    /\ inflight = 0
    /\ view = "free"
    /\ override = FALSE
    /\ registered = FALSE
    /\ regView = "free"
    /\ stateView = "free"
    /\ startView = "free"
    /\ toggleQueued = FALSE
    /\ staleDropped = FALSE
    /\ cacheWritten = FALSE
    /\ done = FALSE

\* Extension load: sync-cache registration or no-op.
Load ==
    /\ loaded = FALSE
    /\ loaded' = TRUE
    /\ IF CachePresent
       THEN /\ syncReg' = "sync"
            /\ registered' = TRUE
            /\ regView' = "free"
            /\ stateView' = "free"
       ELSE UNCHANGED <<syncReg, registered, regView, stateView>>
    /\ UNCHANGED <<cap, session, sessionsStarted, dups, inflight, view,
                   override, startView, toggleQueued, staleDropped,
                   cacheWritten, done>>

\* New session tick. With a live state: reapply path (registry swap +
 \* current-view apply + detached restore/refresh, all instantaneous here).
 \* Without one and nothing pending: start the single detached capture.
SessionStartNew ==
    /\ loaded = TRUE
    /\ sessionsStarted < MaxSessions
    /\ cap /= "pending"
    /\ sessionsStarted' = sessionsStarted + 1
    /\ session' = sessionsStarted + 1
    /\ IF hasState
       THEN /\ regView' = IF ViewSyncWrapper THEN view ELSE stateView
            /\ UNCHANGED <<cap, inflight, syncReg, startView, stateView>>
       ELSE /\ cap' = "pending"
            /\ inflight = 0
            /\ inflight' = 1
            /\ startView' = view
            /\ UNCHANGED <<syncReg, regView, stateView>>
    /\ UNCHANGED <<loaded, view, override, registered, toggleQueued,
                   staleDropped, cacheWritten, dups, done>>

\* Duplicate session_start while a capture is in flight: hand it the
 \* latest snapshot, never a second task (pendingCaptures guard).
DupSessionStart ==
    /\ loaded = TRUE
    /\ cap = "pending"
    /\ dups < MaxDups
    /\ dups' = dups + 1
    /\ IF DedupGuard
       THEN UNCHANGED inflight
       ELSE inflight' = IF inflight < 2 THEN inflight + 1 ELSE 2
    /\ UNCHANGED <<loaded, syncReg, cap, session, sessionsStarted, view,
                   override, registered, regView, stateView, startView,
                   toggleQueued, staleDropped, cacheWritten, done>>

\* Detached capture settles: registers into the latest snapshot session
 \* and persists the cache. A miss (provider absent from Pi's catalog)
 \* leaves a standing sync registration in place. A toggle queued on its
 \* own capture flips the created view on landing (toggle-after-capture).
CaptureDone ==
    /\ cap = "pending"
    /\ cap' = IF BuiltinPresent THEN "done" ELSE "miss"
    /\ inflight' = 0
    /\ IF BuiltinPresent
       THEN /\ registered' = TRUE
            /\ cacheWritten' = TRUE
            /\ regView' = IF toggleQueued THEN flipView(startView) ELSE startView
            /\ stateView' = startView
       ELSE UNCHANGED <<registered, cacheWritten, regView, stateView>>
    /\ IF toggleQueued
       THEN /\ view' = flipView(view)
            /\ override' = TRUE
            /\ toggleQueued' = FALSE
       ELSE UNCHANGED <<view, override, toggleQueued>>
    /\ UNCHANGED <<loaded, syncReg, session, sessionsStarted, dups,
                   startView, staleDropped, done>>

\* /toggle-<id>: flip + persist override + apply to the live registration.
 \* Enabled when registered (with no state the command waits first; see
 \* ToggleCapture). A toggle can never slip between capture creation
 \* and its applyCurrent.
Toggle ==
    /\ loaded = TRUE
    /\ registered = TRUE
    /\ view' = flipView(view)
    /\ override' = TRUE
    /\ regView' = view'
    /\ UNCHANGED <<loaded, syncReg, cap, session, sessionsStarted, dups,
                   inflight, registered, stateView, startView,
                   toggleQueued, staleDropped, cacheWritten, done>>

\* Toggle with no registration: after waiting out any pending capture
 \* (ToggleWaits), capture on demand and flip on landing (toggleQueued).
 \* Without the wait the toggle races a second, untracked generation:
 \* runToggleCommand's own tryCaptureProvider call is NOT in
 \* pendingCaptures, so the await is the only serialization.
ToggleCapture ==
    /\ loaded = TRUE
    /\ sessionsStarted > 0
    /\ registered = FALSE
    /\ IF ToggleWaits THEN cap /= "pending" ELSE TRUE
    /\ cap' = "pending"
    /\ inflight' = IF inflight < 2 THEN inflight + 1 ELSE 2
    /\ startView' = view
    /\ toggleQueued' = TRUE
    /\ UNCHANGED <<loaded, syncReg, session, sessionsStarted, dups, view,
                   override, registered, regView, stateView,
                   staleDropped, cacheWritten, done>>

\* Reload: new runner, same process. The in-flight task is dropped (it
 \* belongs to the dead session); module state survives, so the next tick
 \* takes the reapply path (or restarts the capture when none exists).
 \* Gated on remaining session budget WITHOUT consuming it: a drop is
 \* always followed by a tick that can retry, so repeated reloads can
 \* never starve resolution within the modeled horizon (reloads + 1
 \* sessions, RefreshR-style). Enabled only while a capture is pending:
 \* otherwise it changes nothing.
Reload ==
    /\ loaded = TRUE
    /\ sessionsStarted < MaxSessions
    /\ cap = "pending"
    /\ cap' = "none"
    /\ staleDropped' = TRUE
    /\ inflight' = 0
    /\ toggleQueued' = FALSE
    /\ UNCHANGED <<loaded, syncReg, session, sessionsStarted, dups, view,
                   override, registered, regView, stateView, startView,
                   cacheWritten, done>>

\* Quiescence marker for the resolve property.
Finish ==
    /\ loaded = TRUE
    /\ sessionsStarted = MaxSessions
    /\ cap /= "pending"
    /\ done = FALSE
    /\ done' = TRUE
    /\ UNCHANGED <<loaded, syncReg, cap, session, sessionsStarted, dups,
                   inflight, view, override, registered, regView,
                   stateView, startView, toggleQueued, staleDropped,
                   cacheWritten>>

Next ==
    \/ Load
    \/ SessionStartNew
    \/ DupSessionStart
    \/ CaptureDone
    \/ Toggle
    \/ ToggleCapture
    \/ Reload
    \/ Finish

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ loaded \in BOOLEAN
    /\ syncReg \in {"none", "sync"}
    /\ cap \in {"none", "pending", "done", "miss"}
    /\ session \in 0..MaxSessions
    /\ sessionsStarted \in 0..MaxSessions
    /\ dups \in 0..MaxDups
    /\ inflight \in 0..2
    /\ view \in {"free", "all"}
    /\ override \in BOOLEAN
    /\ registered \in BOOLEAN
    /\ regView \in {"free", "all"}
    /\ stateView \in {"free", "all"}
    /\ startView \in {"free", "all"}
    /\ toggleQueued \in BOOLEAN
    /\ staleDropped \in BOOLEAN
    /\ cacheWritten \in BOOLEAN
    /\ done \in BOOLEAN

\* P1: at most one capture generation in flight (pendingCaptures guard).
SingleFlight == inflight <= 1

\* P2: a warm cache retires the capture. A sync registration puts a live
 \* state in providerStates at load, so every session_start takes the
 \* reapply path and tryCaptureProvider never runs on a warm-cache
 \* process; freshness in steady state comes from the endpoint refresh.
WarmCacheRetiresCapture == (syncReg = "sync") => (cap = "none")

\* P3: the live registration always serves the effective view (#510: no
 \* resurrection of the creation-time view on reapply).
ViewPreserved == registered => regView = view

\* P4: only a completed capture persists the disk cache; a sync load
 \* never writes back what it read (no stale-cache feedback loop).
SyncNeverWrites == cacheWritten => cap = "done"

\* P5 (resolve-as-safety): once quiescent, the id resolves whenever there
 \* was anything to resolve from (warm cache and/or built-in catalog).
EventualResolve == done => (registered \/ ~Resolvable)

====
