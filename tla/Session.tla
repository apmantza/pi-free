---- MODULE Session ----
(*
 * Model of pi-free's extension load / session_start / reload lifecycle
 * for the native-refresh nudge scope (lib/native-provider.ts).
 *
 * Pi mechanics modelled (verified against the installed
 * pi-coding-agent bundle):
 *  - Pi builds the extension runner from ALL loaded extensions and only
 *    then emits session_start (_buildRuntime -> emit sessionStartEvent).
 *    All pi-free providers register synchronously at extension load, so
 *    under this emission contract every session_start observes the full
 *    provider set. SessionB.cfg hardens the contract as an action guard;
 *    SessionA.cfg drops it to show what breaks without it.
 *  - Reload rebuilds the runtime AND reloads extensions, then emits a
 *    fresh session_start: the loaded set is wiped and rebuilt before the
 *    next start. The nudge reads its scope live at fire time
 *    ([...nudgeProviderIds]), so late (re-)registrations join the next
 *    attempt -- no scope snapshot goes stale by itself.
 *  - Stale-context drops and the epoch guard are RefreshR.tla's subject,
 *    not this module's; per-runner handler uniqueness is pinned by
 *    tests/native-refresh-nudge.test.ts ("one handler"). This module
 *    covers ONLY load/start/reload ordering vs scope completeness.
 *)
EXTENDS Naturals, TLC, FiniteSets

CONSTANTS Providers, MaxSessions, RequireFullLoad

VARIABLES loaded, sessionsLeft, started, scope, attempts

vars == <<loaded, sessionsLeft, started, scope, attempts>>

Init ==
    /\ loaded = {}
    /\ sessionsLeft = MaxSessions
    /\ started = FALSE
    /\ scope = {}
    /\ attempts = 0

\* Extension load (or reload): providers register synchronously.
Load ==
    /\ \E p \in Providers \ loaded : loaded' = loaded \cup {p}
    /\ UNCHANGED <<sessionsLeft, started, scope, attempts>>

\* Pi emits session_start. Under the emission contract (RequireFullLoad)
 \* every provider is already loaded; without it the start may observe a
 \* partial set. The nudge captures its scope live at fire time.
SessionStart ==
    /\ sessionsLeft > 0
    /\ RequireFullLoad => loaded = Providers
    /\ sessionsLeft' = sessionsLeft - 1
    /\ started' = TRUE
    /\ scope' = loaded
    /\ attempts' = attempts + 1
    /\ UNCHANGED <<loaded>>

\* Reload: runtime rebuilt, extensions re-run (loaded set wiped), and the
 \* current session ends. The next session needs its own load + start.
Reload ==
    /\ loaded' = {}
    /\ started' = FALSE
    /\ UNCHANGED <<sessionsLeft, scope, attempts>>

Next ==
    \/ Load
    \/ SessionStart
    \/ Reload

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ loaded \subseteq Providers
    /\ sessionsLeft \in 0..MaxSessions
    /\ started \in BOOLEAN
    /\ scope \subseteq Providers
    /\ attempts \in Nat

\* Scope completeness: once sessions are exhausted after a started
 \* session, the captured nudge scope is the full provider set.
ScopeComplete == (sessionsLeft = 0 /\ started) => scope = Providers

====
