---- MODULE Fallback ----
(*
 * Model of pi-free's auto-fallback settled-run orchestration for ONE
 * provider with three models {A, B, C} (lib/auto-fallback/index.ts).
 *
 * Faithfulness notes:
 *  - Settled runs are ATOMIC actions: Pi emits agent_settled once per
 *    fully-settled run and awaits the handler ("processed exactly once,
 *    in order"). What the model interleaves is the fire-and-forget
 *    recovery restore (maybeRestorePreFallback's `void
 *    safeSetModel(...).then(...)`) with LATER settles and user actions --
 *    the real hazard. Observer events (message_end, after_provider_-
 *    response) mutate no strike/switch state and are omitted; classifier
 *    accuracy is classifier.ts's (pure, unit-tested) concern, so failure
 *    vs clean is an environment choice here.
 *  - Blacklist TTL is abstracted to infinity: expiry only re-admits, and
 *    re-admission can neither clobber a switch, overspend a budget, nor
 *    duplicate a strike, so all three safety properties are
 *    expiry-insensitive. TTL/expiry itself is covered by
 *    tests/auto-fallback-blacklist.test.ts. Counts cap at 3 (hard ban).
 *  - Provider identity abstracted away (model ids ARE keys): the race is
 *    provider-agnostic. Cross-provider scope rules are selection.ts's
 *    (pure) concern.
 *  - History list, notifier, log lines: no effect on the properties.
 *)
EXTENDS Naturals, TLC, FiniteSets

CONSTANTS Models, MaxBudget, MaxFailSettles

VARIABLES
    cur,             \* current model
    pre,             \* pre-fallback pick (null as "") or ""
    lastFrom,        \* fromKey of the most recent switch
    recovered,      \* outstanding switch already recovered
    banned,         \* key -> strikes, capped at 3
    settlesPerKey,  \* failure settles charged per key (audit for P3)
    collateral,     \* switch-attempt strikes on innocent candidates
    budget,         \* auto-continue budget
    initFlag,       \* budget initialized this session
    hasPrompt,      \* captured user prompt available for replay
    restoreTarget,  \* in-flight async restore destination or ""
    doomed,         \* in-flight restore no longer matches user intent
    overrodeUser,   \* violation latch for P1
    failBudget      \* bounds failure settles (finite states)

vars == <<cur, pre, lastFrom, recovered, banned, settlesPerKey,
          collateral, budget, initFlag, hasPrompt, restoreTarget,
          doomed, overrodeUser, failBudget>>

NoModel == "NONE"

Min(a, b) == IF a < b THEN a ELSE b

Eligible == { m \in Models : m /= cur /\ banned[m] = 0 }

Init ==
    /\ cur = "A"
    /\ pre = NoModel
    /\ lastFrom = "A"
    /\ recovered = TRUE
    /\ banned = [m \in Models |-> 0]
    /\ settlesPerKey = [m \in Models |-> 0]
    /\ collateral = 0
    /\ budget = 0
    /\ initFlag = FALSE
    /\ hasPrompt = FALSE
    /\ restoreTarget = NoModel
    /\ doomed = FALSE
    /\ overrodeUser = FALSE
    /\ failBudget = MaxFailSettles

\* One failure settle, atomic: exactly one strike on the failing key,
 \* then either a switch (arming+resolving the replay same-settle),
 \* collateral damage on an innocent candidate, or exhaustion.
FailSettle ==
    /\ failBudget > 0
    /\ failBudget' = failBudget - 1
    /\ settlesPerKey' = [settlesPerKey EXCEPT ![cur] = @ + 1]
    /\ \/ \E nxt \in Eligible :
            /\ banned' = [banned EXCEPT ![cur] = Min(@ + 1, 3)]
            /\ cur' = nxt
            /\ pre' = IF pre = NoModel THEN cur ELSE pre
            /\ lastFrom' = cur
            /\ recovered' = FALSE
            /\ initFlag' = TRUE
            /\ LET refilled == IF initFlag THEN budget ELSE MaxBudget IN
               IF hasPrompt /\ refilled > 0
               THEN budget' = refilled - 1
               ELSE budget' = refilled
            /\ UNCHANGED collateral
       \/ \E m \in Eligible :
            /\ banned' = [banned EXCEPT ![cur] = Min(@ + 1, 3),
                                          ![m] = Min(@ + 1, 3)]
            /\ collateral' = collateral + 1
            /\ UNCHANGED <<cur, pre, lastFrom, recovered, budget,
                           initFlag>>
       \/ Eligible = {} /\ banned' = [banned EXCEPT ![cur] = Min(@ + 1, 3)]
            /\ UNCHANGED <<cur, pre, lastFrom, recovered, budget,
                           initFlag, collateral>>
    /\ UNCHANGED <<hasPrompt, restoreTarget, doomed, overrodeUser>>

\* Clean run: refill budget; recover the outstanding switch (clear the
 \* failed key, dispatch the async restore). Display/model unchanged.
CleanSettle ==
    /\ IF pre /= NoModel /\ ~recovered
       THEN /\ banned' = [banned EXCEPT ![lastFrom] = 0]
            /\ recovered' = TRUE
            /\ restoreTarget' = pre
       ELSE UNCHANGED <<banned, recovered, restoreTarget>>
    /\ budget' = MaxBudget
    /\ initFlag' = TRUE
    /\ UNCHANGED <<cur, pre, lastFrom, settlesPerKey, collateral,
                   hasPrompt, doomed, overrodeUser, failBudget>>

\* The in-flight restore lands (the un-awaited .then). Possibly stale.
RestoreLand ==
    /\ restoreTarget /= NoModel
    /\ IF doomed THEN overrodeUser' = TRUE ELSE UNCHANGED overrodeUser
    /\ cur' = restoreTarget
    /\ pre' = NoModel
    /\ restoreTarget' = NoModel
    /\ doomed' = FALSE
    /\ UNCHANGED <<lastFrom, recovered, banned, settlesPerKey,
                   collateral, budget, initFlag, hasPrompt, failBudget>>

\* Explicit user selection. In-flight restores are NOT cancelled --
 \* the hazard: a restore dispatched earlier still lands afterwards.
UserSelect ==
    /\ \E m \in Models :
         /\ cur' = m
         /\ IF pre /= NoModel /\ m /= pre
            THEN pre' = NoModel
            ELSE UNCHANGED pre
         /\ IF restoreTarget /= NoModel /\ restoreTarget /= m
            THEN doomed' = TRUE
            ELSE IF restoreTarget /= NoModel /\ m = restoreTarget
                 THEN doomed' = FALSE
                 ELSE UNCHANGED doomed
    /\ UNCHANGED <<lastFrom, recovered, banned, settlesPerKey,
                   collateral, budget, initFlag, hasPrompt,
                   restoreTarget, overrodeUser, failBudget>>

\* Genuine user prompt (before_agent_start): captured, supersedes replays.
UserPrompt ==
    /\ hasPrompt' = TRUE
    /\ UNCHANGED <<cur, pre, lastFrom, recovered, banned, settlesPerKey,
                   collateral, budget, initFlag, restoreTarget, doomed,
                   overrodeUser, failBudget>>

\* Session start clears prompt capture and budget init (budget value kept).
SessionStart ==
    /\ hasPrompt' = FALSE
    /\ initFlag' = FALSE
    /\ UNCHANGED <<cur, pre, lastFrom, recovered, banned, settlesPerKey,
                   collateral, budget, restoreTarget, doomed,
                   overrodeUser, failBudget>>

Next ==
    \/ FailSettle
    \/ CleanSettle
    \/ RestoreLand
    \/ UserSelect
    \/ UserPrompt
    \/ SessionStart

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ cur \in Models
    /\ pre \in Models \cup {NoModel}
    /\ lastFrom \in Models
    /\ recovered \in BOOLEAN
    /\ \A m \in Models : banned[m] \in 0..3
    /\ \A m \in Models : settlesPerKey[m] \in Nat
    /\ collateral \in Nat
    /\ budget \in 0..MaxBudget
    /\ initFlag \in BOOLEAN
    /\ hasPrompt \in BOOLEAN
    /\ restoreTarget \in Models \cup {NoModel}
    /\ doomed \in BOOLEAN
    /\ overrodeUser \in BOOLEAN
    /\ failBudget \in 0..MaxFailSettles

\* P1: an in-flight restore never overrides an explicit user selection.
ManualWins == ~overrodeUser

\* P2: the auto-continue budget never goes negative.
BudgetSafe == budget \in 0..MaxBudget

\* P3: strikes are accountable -- every ban count is covered by a failure
 \* settle on that key or a recorded collateral hit. The double-strike
 \* regression (striking again at switch time) would break this.
SingleStrike ==
    \A k \in Models : banned[k] <= settlesPerKey[k] + collateral

====
