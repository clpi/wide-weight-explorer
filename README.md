# Wide — weight-space explorer (prototype)

A working prototype of the weight-space explorer for **Wide**, Idol's IDE for
weight-space programming. Single self-contained page, no build step, no
dependencies, no network requests.

**Live:** https://clpi.github.io/wide-weight-explorer/

## What it does

Three connected views over one mock session (`wide-session-8842`, checkpoint
`atlas-mini-l12 @ ckpt-18400`):

1. **Weight explorer** — a searchable, filterable grid of 23 weight tables with
   shape, dtype, value summary (norm / mean / coordinate bars), premise count,
   live-vs-total learned events, and a digest prefix. Search matches weight
   names, layers, and the text of every premise in the weight's cone. Filters:
   kind (held/derived), layer, standing, affected-by-withdrawal. Seven sorts.
2. **Premise graph** — for the selected weight: dependencies and anchor on the
   left, the revision in the middle, each learned update next to it, and the
   premises they cite on the right. Below it, a derivation ledger that adds the
   anchor and the live deltas in micro-units and shows the resulting snapshot,
   plus a list of every premise in the cone with a withdraw action.
3. **Retraction simulator** — withdraw one or more premises; the configuration
   recomputes immediately: retracted learned events, re-evaluated snapshots,
   derived views re-derived downstream, and a before/after diff table (norm,
   mean, standing, Δ, Δ%, depth, exact cause).

Plus an **About** page that separates what is real arithmetic from what is
simulated, and lists the deliberate deviations.

Named explorations and per-weight / per-premise notes persist in `localStorage`
between sessions. There is no server.

## Semantics

The engine ports the rules Wide's spec states (`spec.md` §1–6) and Idol core
profile 1 (*weights as first-class values*) onto the mock session:

- `support(x)` — transitive premise closure over required dependency edges.
- `live(event)` — every premise in the event's support is admitted and
  unwithdrawn.
- `snapshot(w)` — the anchor plus its live deltas (held tables), or the relation
  evaluated over its inputs (derived views).
- `usable(w)` — no withdrawn premise in the table's own required support.
- `cone(p)` — the records whose support contains `p`; retraction excludes
  exactly those events, nothing else.

All values are integers in micro-units, so `anchor + Σdeltas` is exact and the
diff shown is the diff computed. Nothing is subtracted from a rounded value.

Two support notions are kept deliberately separate: `support()` decides
liveness and usability, while `coneSupport()` (which also includes every event
in a table's revision) decides the blast radius, because a retracted event still
moves the snapshot.

## What is simulated

Everything in the session: the checkpoint, the 19 premises, 23 tables, 24 learned
events. Each seating carries an 8-coordinate sampled slice, not a payload; norms
and means are computed over the slice. `transpose`, `quantize`, `fold2` and
`scale` stand in for real weight relations. Digests are real SHA-256 over the
mock content. Expiry (`valid_until`) is a warning only and never auto-retracts.
No compiler, resident, or Idol machinery is contacted.

Named gaps, stated in-app: real Wide has no unwithdraw inside an epoch (this
prototype offers *restore* so exploration can continue), no epoch reset, no
seating/admission, no re-registration healing, no importance/recency derivation.

## Source layout

    seedgen.py     generates seed.json (deterministic, SHA-256 identities)
    engine.js      standing / support / cone / snapshot / diff
    app.js         views, interactions, localStorage persistence
    styles.css     design
    template.html  page shell with {{CSS}} {{SEED}} {{ENGINE}} {{APP}} slots
    build.py       inlines everything into index.html
    verify.mjs     engine checks: naive closure, exact arithmetic, cone vs recompute
    browsertest.mjs headless walkthrough: filters, withdraw, diff, persistence

Rebuild the single file:

    python3 seedgen.py && python3 build.py

Verify:

    node verify.mjs && node browsertest.mjs

## Prototype status

Mock data, real rules. The numbers are consistent and reproducible; the model is
not real.
