---- MODULE Toggle ----
(*
 * Model of pi-free's per-provider free/all toggle lifecycle for ONE
 * provider (e.g. infron) and its interplay with catalog refresh.
 *
 * pi-free semantics modelled (verified against repo code):
 *  - Effective view: explicit per-provider override wins, else the
 *    provider default (show_paid=false -> "free"; config.ts).
 *  - Toggle flips the view synchronously, persists the override,
 *    re-registers (registerNativeOpenAIProvider toggle handler).
 *  - reRegister -> Pi setProvider -> ABORTS the in-flight refresh
 *    generation (Pi bundle ModelsImpl).
 *  - persistNativeProviderModels writes the EFFECTIVE view, not the full
 *    fetch: under a free view the store keeps only free models.
 *  - Restore loads the persisted subset into stored.all AND stored.free
 *    (classifyFree over the subset); a full catalog returns only via a
 *    completed network fetch (onFetched).
 *
 * Pi semantics modelled (verified against the installed bundle):
 *  - reRegister syncs the /model snapshot from live getModels().
 *  - A completed provider refresh is followed by an availability refresh
 *    that applies filterModels live -> display converges to the
 *    view-appropriate slice of current stored.
 *  - Display is therefore synced exactly at: restart-restore, toggle
 *    (reRegister), and fetch-complete (availability refresh). Between
 *    those points it lags. Pi's availability scheduler itself is out of
 *    scope; the sync points above are sufficient for the properties.
 *)
EXTENDS Naturals, TLC, FiniteSets

CONSTANTS Catalog, FreeIds
(* Catalog = {f1, f2, p1, p2}; FreeIds = {f1, f2}; instantiation in .cfg *)

VARIABLES
    view,          \* effective view: "free" | "all" (init "free": show_paid default false)
    storedAll,    \* in-memory full-list slot (may hold a restored subset!)
    storedFree,   \* in-memory free-list slot (classifyFree over storedAll)
    persistedSet, \* what Pi's store holds across restart (effective view!)
    restarted,    \* session restore has run
    toggled,      \* a toggle has fired this session
    inFlight,     \* refresh generation in flight
    fetchedFull,  \* a full-catalog fetch completed this session
    complete,     \* stored.all is published-full (set only by fetch)
    warned,       \* honest notify shown on a toggle over incomplete data
    displayedView,
    displayedSet

vars == <<view, storedAll, storedFree, persistedSet, restarted,
          toggled, inFlight, fetchedFull, complete, warned,
          displayedView, displayedSet>>

Slice(v) == IF v = "free" THEN storedFree ELSE storedAll

Init ==
    /\ view = "free"
    /\ storedAll = {}
    /\ storedFree = {}
    /\ persistedSet = FreeIds   \* production mirror: free view persisted (14d store)
    /\ restarted = FALSE
    /\ toggled = FALSE
    /\ inFlight = FALSE
    /\ fetchedFull = FALSE
    /\ complete = FALSE
    /\ warned = FALSE
    /\ displayedView = "free"
    /\ displayedSet = {}

\* Session restore: the persisted (possibly free-only) subset lands in
 \* BOTH in-memory slots; display syncs to the default view.
Restart ==
    /\ restarted = FALSE
    /\ restarted' = TRUE
    /\ storedAll' = persistedSet
    /\ storedFree' = persistedSet \cap FreeIds
    /\ complete' = FALSE   \* restore cannot prove completeness
    /\ displayedView' = view
    /\ displayedSet' = (IF view = "free"
                         THEN persistedSet \cap FreeIds
                         ELSE persistedSet)
    /\ UNCHANGED <<view, persistedSet, toggled, inFlight,
                   fetchedFull, warned>>

\* Nudge fetch begins (needs a live session).
FetchStart ==
    /\ restarted = TRUE
    /\ inFlight = FALSE
    /\ inFlight' = TRUE
    /\ UNCHANGED <<view, storedAll, storedFree, persistedSet, restarted,
                   toggled, fetchedFull, complete, warned,
                   displayedView, displayedSet>>

\* Network generation completes AND publishes: full catalog in memory,
 \* availability refresh syncs the display to the current view.
FetchComplete ==
    /\ inFlight = TRUE
    /\ inFlight' = FALSE
    /\ storedAll' = Catalog
    /\ storedFree' = FreeIds
    /\ fetchedFull' = TRUE
    /\ complete' = TRUE
    /\ displayedSet' = (IF view = "free" THEN FreeIds ELSE Catalog)
    /\ UNCHANGED <<view, persistedSet, restarted, toggled,
                   displayedView, warned>>

\* A re-register (toggle's own, or probe/storm) kills the in-flight fetch.
 \* Stored data is untouched; the generation simply never publishes.
FetchAborted ==
    /\ inFlight = TRUE
    /\ inFlight' = FALSE
    /\ UNCHANGED <<view, storedAll, storedFree, persistedSet, restarted,
                   toggled, fetchedFull, complete, warned,
                   displayedView, displayedSet>>

\* /toggle-x: synchronous flip + persist + reRegister. The reRegister
 \* aborts any in-flight fetch AND syncs the display to the (possibly
 \* stale) stored data under the new view.
Toggle ==
    /\ restarted = TRUE
    /\ view' = IF view = "free" THEN "all" ELSE "free"
    /\ IF inFlight THEN inFlight' = FALSE ELSE UNCHANGED inFlight
    /\ displayedView' = IF view = "free" THEN "all" ELSE "free"
    /\ displayedSet' = (IF view = "free" THEN storedAll ELSE storedFree)
    /\ warned' = IF complete THEN warned ELSE TRUE
    /\ toggled' = TRUE
    /\ UNCHANGED <<storedAll, storedFree, persistedSet, restarted,
                   fetchedFull, complete>>

Next ==
    \/ Restart
    \/ FetchStart
    \/ FetchComplete
    \/ FetchAborted
    \/ Toggle

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ view \in {"free", "all"}
    /\ storedAll \subseteq Catalog
    /\ storedFree \subseteq Catalog
    /\ persistedSet \subseteq Catalog
    /\ restarted \in BOOLEAN
    /\ toggled \in BOOLEAN
    /\ inFlight \in BOOLEAN
    /\ fetchedFull \in BOOLEAN
    /\ complete \in BOOLEAN
    /\ warned \in BOOLEAN
    /\ displayedView \in {"free", "all"}
    /\ displayedSet \subseteq Catalog

\* P1: a displayed "all" view is the complete catalog, never a restored
 \* free-view subset masquerading as all.
NoSubsetAsAll == displayedView = "all" => displayedSet = Catalog

\* P2: the display always agrees with the effective view over current data.
ViewDisplayAgree ==
    /\ displayedView = view
    /\ displayedSet = Slice(view)

\* P3: the full "all" display is reachable only via a completed fetch
 \* (constructive counterpart of P1: the good path exists).
FullDisplayNeedsFetch ==
    displayedSet = Catalog => (fetchedFull \/ ~restarted)

\* P4 (the fix): a subset displayed as "all" is always flagged by the
 \* honest notify -- toggling over incomplete data warns.
FlaggedHonesty ==
    (displayedView = "all" /\ displayedSet /= Catalog) => warned

====
