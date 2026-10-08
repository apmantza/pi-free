---- MODULE CacheGuard ----
(*
 * Model of pi-free's provider disk-cache poisoning guards for ONE
 * provider: the guarded persist gate (lib/provider-cache.ts
 * saveProviderCacheGuarded) vs an adversarial endpoint, plus the
 * retain-on-failure / retain-on-empty refresh paths that never write.
 *
 * pi-free semantics modelled (verified against repo code):
 *  - saveProviderCacheGuarded refuses an empty list (never caches empty)
 *    and refuses a list smaller than half the healthy cached entry
 *    (transient partial/error responses must not wipe a good list).
 *    With no existing entry anything non-empty seeds the cache.
 *    Integer-exact rule: refuse iff newSize * 2 < diskSize.
 *  - A failed fetch retains the in-memory catalog and writes nothing;
 *    an empty live response retains likewise (no updateModels, hence
 *    no persist). Only a non-empty success reaches the guarded gate.
 *  - In-memory and disk move in lockstep (success updates + persists
 *    together; retain touches neither), so the disk alone carries the
 *    state; the model tracks counts only.
 *
 * Out of scope: the opencode sync cache (ungated persist by design;
 * persist-points covered by Capture.tla SyncNeverWrites), the native
 * models.dev snapshot fallback, TTL/freshness (probe-cache), endpoint
 * retry/backoff storms (Refresh.tla).
 *)
EXTENDS Naturals, TLC

CONSTANTS
    SeededDisk,      \* boot with a healthy cached entry (else cold start)
    ShrinkGate,      \* refuse persists below half the cached entry
    NeverEmpty,      \* refuse persisting an empty list
    RetainOnFailure  \* a failed fetch writes nothing

ASSUME /\ SeededDisk \in BOOLEAN
       /\ ShrinkGate \in BOOLEAN
       /\ NeverEmpty \in BOOLEAN
       /\ RetainOnFailure \in BOOLEAN

VARIABLES
    hasDisk,   \* a cache entry exists on disk
    disk,      \* cached model count (0..3)
    prevDisk,  \* disk count before the last persist (shrink baseline)
    resp,      \* "none" | "ok" | "empty" | "err": pending endpoint response
    respSize   \* model count carried by an ok response (0..3)

vars == <<hasDisk, disk, prevDisk, resp, respSize>>

Init ==
    /\ IF SeededDisk
       THEN /\ hasDisk = TRUE
            /\ disk = 3
            /\ prevDisk = 3
       ELSE /\ hasDisk = FALSE
            /\ disk = 0
            /\ prevDisk = 0
    /\ resp = "none"
    /\ respSize = 0

\* Endpoint delivers a full catalog.
FetchFull ==
    /\ resp = "none"
    /\ resp' = "ok"
    /\ respSize' = 3
    /\ UNCHANGED <<hasDisk, disk, prevDisk>>

\* Endpoint delivers a mildly shrunk catalog (at/above half).
FetchMild ==
    /\ resp = "none"
    /\ resp' = "ok"
    /\ respSize' = 2
    /\ UNCHANGED <<hasDisk, disk, prevDisk>>

\* Endpoint delivers a severely shrunk catalog (below half of 3).
FetchSevere ==
    /\ resp = "none"
    /\ resp' = "ok"
    /\ respSize' = 1
    /\ UNCHANGED <<hasDisk, disk, prevDisk>>

\* Endpoint delivers an empty list.
FetchEmpty ==
    /\ resp = "none"
    /\ resp' = "empty"
    /\ UNCHANGED <<hasDisk, disk, prevDisk, respSize>>

\* Endpoint fails (network stall, malformed payload).
FetchError ==
    /\ resp = "none"
    /\ resp' = "err"
    /\ UNCHANGED <<hasDisk, disk, prevDisk, respSize>>

\* Guarded persist of a success: refuse below-half shrinks (against a
 \* healthy entry) and seed otherwise.
Persist ==
    /\ resp = "ok"
    /\ resp' = "none"
    /\ IF ShrinkGate /\ hasDisk /\ respSize * 2 < disk
       THEN UNCHANGED <<hasDisk, disk, prevDisk>>
       ELSE /\ hasDisk' = TRUE
            /\ prevDisk' = disk
            /\ disk' = respSize
    /\ UNCHANGED <<respSize>>

\* Empty responses never reach the gate: retained, never persisted.
RetainEmpty ==
    /\ resp = "empty"
    /\ resp' = "none"
    /\ IF NeverEmpty
       THEN UNCHANGED <<hasDisk, disk, prevDisk>>
       ELSE /\ hasDisk' = TRUE
            /\ prevDisk' = disk
            /\ disk' = 0
    /\ UNCHANGED <<respSize>>

\* Failed fetches retain the catalog and write nothing.
RetainError ==
    /\ resp = "err"
    /\ resp' = "none"
    /\ IF RetainOnFailure
       THEN UNCHANGED <<hasDisk, disk, prevDisk>>
       ELSE /\ hasDisk' = TRUE
            /\ prevDisk' = disk
            /\ disk' = 0
    /\ UNCHANGED <<respSize>>

Next ==
    \/ FetchFull
    \/ FetchMild
    \/ FetchSevere
    \/ FetchEmpty
    \/ FetchError
    \/ Persist
    \/ RetainEmpty
    \/ RetainError

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ hasDisk \in BOOLEAN
    /\ disk \in 0..3
    /\ prevDisk \in 0..3
    /\ resp \in {"none", "ok", "empty", "err"}
    /\ respSize \in 0..3

\* P1: no persist step ever drops below half the pre-persist baseline
 \* (integer-exact twin of the newSize * 2 < diskSize refuse rule).
ShrinkBounded == disk * 2 >= prevDisk

\* P2: the disk never holds an empty entry.
NeverEmptyDisk == hasDisk => disk > 0

====
