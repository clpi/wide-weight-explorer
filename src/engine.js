/* Wide weight-space explorer — derivation engine.
 *
 * Ports the standing / support / retraction rules of Idol core profile 1
 * (clpi/idol-wide spec.md sections 1-6, clpi/idol-wsp Idol-Weights-Semantics.md)
 * onto the mock session in seed.json. Every number is exact integer arithmetic
 * in micro-units (1e-6), so the browser and verify.mjs cannot drift.
 *
 * Rules implemented:
 *   support(x)      = transitive premise closure over required dependency edges
 *   live(event)     = every premise in support(event) admitted and unwithdrawn
 *   snapshot(w)     = anchor + sum of live deltas (held), or relation of deps (derived)
 *   usable(w)       = no withdrawn premise in support(w)
 *   cone(p)         = the records (events, weights) whose support contains p
 *   retraction      = withdraw p, exclude exactly the events in its cone
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WideEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MICRO = 1000000;

  function roundDiv(a, b) {
    // round half away from zero, integer only
    var q = Math.abs(a) / Math.abs(b);
    var r = Math.floor(q);
    var frac = q - r;
    var m = frac >= 0.5 ? r + 1 : r;
    if (m === 0) return 0;
    return (a < 0) !== (b < 0) ? -m : m;
  }

  function createEngine(seed) {
    var premises = new Map();
    var weights = new Map();
    var events = new Map();
    var eventOrder = [];

    seed.premises.forEach(function (p) { premises.set(p.id, p); });
    seed.weights.forEach(function (w) {
      weights.set(w.id, w);
      (w.events || []).forEach(function (e) {
        var rec = Object.assign({}, e, { weight: w.id });
        events.set(rec.id, rec);
        eventOrder.push(rec);
      });
    });

    /* ---------------------------------------------------------- support */
    var supportCache = new Map();

    function citeSupport(target, set) {
      target.forEach(function (c) {
        if (!premises.has(c) && !weights.has(c) && !events.has(c)) {
          throw new Error('unresolved citation: ' + c);
        }
        support(c).forEach(function (x) { set.add(x); });
      });
    }

    function support(id) {
      if (supportCache.has(id)) return supportCache.get(id);
      var set = new Set();
      var p = premises.get(id);
      if (p) {
        set.add(id);
        if (p.derivation && p.derivation.cites) citeSupport(p.derivation.cites, set);
      } else if (weights.has(id)) {
        var w = weights.get(id);
        if (w.kind === 'held') {
          citeSupport(w.anchor.cites, set);
        } else {
          citeSupport(w.relation.deps, set);
          citeSupport(w.relation.premises || [], set);
        }
      } else if (events.has(id)) {
        citeSupport(events.get(id).cites, set);
      } else {
        throw new Error('unknown record: ' + id);
      }
      supportCache.set(id, set);
      return set;
    }

    /* Blast-radius support: the static premise closure a record's *value*
     * depends on. For a weight this includes its anchor support, its derived
     * inputs, and every learned event in its revision -- an event that a
     * withdrawal kills still changes the snapshot, so it is inside the cone.
     * Liveness (below) uses the narrower support(), which is why a weight with
     * one dead event can still be usable. */
    var coneSupportCache = new Map();
    function coneSupport(id) {
      if (coneSupportCache.has(id)) return coneSupportCache.get(id);
      var set = new Set();
      var p = premises.get(id);
      if (p) {
        set.add(id);
        if (p.derivation && p.derivation.cites) {
          p.derivation.cites.forEach(function (c) { coneSupport(c).forEach(function (x) { set.add(x); }); });
        }
      } else if (weights.has(id)) {
        var w = weights.get(id);
        support(id).forEach(function (x) { set.add(x); });
        if (w.kind !== 'held') {
          w.relation.deps.forEach(function (d) { coneSupport(d).forEach(function (x) { set.add(x); }); });
        }
        (w.events || []).forEach(function (e) {
          support(e.id).forEach(function (x) { set.add(x); });
        });
      } else if (events.has(id)) {
        support(id).forEach(function (x) { set.add(x); });
        events.get(id).cites.forEach(function (c) { coneSupport(c).forEach(function (x) { set.add(x); }); });
      }
      coneSupportCache.set(id, set);
      return set;
    }

    // acyclic check over the dependency graph (premises -> weights -> events)
    function checkAcyclic() {
      var state = new Map();
      function children(id) {
        var p = premises.get(id);
        if (p) return (p.derivation && p.derivation.cites) || [];
        var w = weights.get(id);
        if (w) {
          return w.kind === 'held'
            ? w.anchor.cites.slice()
            : w.relation.deps.concat(w.relation.premises || []);
        }
        var e = events.get(id);
        if (e) return e.cites.slice();
        return [];
      }
      function walk(id, stack) {
        var s = state.get(id);
        if (s === 2) return;
        if (s === 1) throw new Error('cyclic dependency: ' + stack.concat(id).join(' -> '));
        state.set(id, 1);
        children(id).forEach(function (c) { walk(c, stack.concat(id)); });
        state.set(id, 2);
      }
      Array.from(premises.keys()).forEach(function (id) { walk(id, []); });
      Array.from(weights.keys()).forEach(function (id) { walk(id, []); });
      Array.from(events.keys()).forEach(function (id) { walk(id, []); });
      return true;
    }

    /* ------------------------------------------------------------ cone */
    function cone(premiseId) {
      if (!premises.has(premiseId)) throw new Error('cone: unknown premise ' + premiseId);
      var coneEvents = [];
      var coneWeights = [];
      eventOrder.forEach(function (e) {
        if (support(e.id).has(premiseId)) coneEvents.push(e.id);
      });
      Array.from(weights.keys()).forEach(function (wid) {
        if (coneSupport(wid).has(premiseId)) coneWeights.push(wid);
      });
      return { premise: premiseId, events: coneEvents, weights: coneWeights };
    }

    /* -------------------------------------------------------- evaluation */
    function firstWithdrawn(ids, withdrawn) {
      var hit = null;
      ids.forEach(function (pid) { if (!hit && withdrawn.has(pid)) hit = pid; });
      return hit;
    }

    function relationApply(rel, upValues) {
      var base = upValues[0] ? upValues[0].slice() : [];
      switch (rel.op) {
        case 'transpose':
          return base.slice().reverse();
        case 'quantize':
          return base.map(function (v) { return Math.round(v / rel.step) * rel.step; });
        case 'fold2': {
          var out = [];
          for (var i = 0; i + 1 < base.length; i += 2) out.push(roundDiv(base[i] + base[i + 1], 2));
          if (base.length % 2) out.push(base[base.length - 1]);
          return out;
        }
        case 'scale':
          return base.map(function (v) { return roundDiv(v * rel.p, rel.q); });
        case 'negate':
          return base.map(function (v) { return -v; });
        default:
          return base;
      }
    }

    function resolver(withdrawnSet) {
      var withdrawn = withdrawnSet instanceof Set ? withdrawnSet : new Set(withdrawnSet || []);
      var memo = new Map();

      function state(wid) {
        if (memo.has(wid)) return memo.get(wid);
        var w = weights.get(wid);
        var out = { id: wid, weight: w, liveEvents: [], deadEvents: [] };
        var supportHit = firstWithdrawn(support(wid), withdrawn);
        out.supportHit = supportHit;

        if (w.kind === 'held') {
          out.values = w.anchor.values.slice();
          w.events.forEach(function (e) {
            var killedBy = firstWithdrawn(support(e.id), withdrawn);
            if (killedBy) {
              out.deadEvents.push({ event: e, killedBy: killedBy });
            } else {
              out.liveEvents.push(e);
              for (var i = 0; i < out.values.length; i++) out.values[i] += e.delta[i] || 0;
            }
          });
          out.relationNote = null;
        } else {
          var upStates = w.relation.deps.map(state);
          out.values = relationApply(w.relation, upStates.map(function (s) { return s.values; }));
          var upstreamUnusable = upStates.filter(function (s) { return !s.usable; })[0];
          out.upstreamNote = upstreamUnusable ? upstreamUnusable.id : null;
        }

        out.usable = !supportHit && (!out.upstreamNote);
        out.unusableReason = supportHit
          ? { kind: 'anchor', premise: supportHit }
          : (out.upstreamNote
            ? { kind: 'upstream', weight: out.upstreamNote,
                premise: state(out.upstreamNote).unusableReason && state(out.upstreamNote).unusableReason.premise }
            : null);
        memo.set(wid, out);
        return out;
      }

      function stats(s) {
        var sum = 0, sumsq = 0, maxAbs = 0;
        s.values.forEach(function (v) {
          sum += v; sumsq += v * v;
          if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
        });
        return {
          values: s.values,
          norm: Math.sqrt(sumsq) / MICRO,
          mean: s.values.length ? sum / s.values.length / MICRO : 0,
          maxAbs: maxAbs / MICRO,
          usable: s.usable,
          unusableReason: s.unusableReason,
          liveEvents: s.liveEvents,
          deadEvents: s.deadEvents,
          liveCount: s.liveEvents.length,
          deadCount: s.deadEvents.length
        };
      }

      return { state: state, stats: stats, withdrawn: withdrawn };
    }

    function snapshot(withdrawnSet) {
      var r = resolver(withdrawnSet);
      var out = new Map();
      weights.forEach(function (w, wid) { out.set(wid, r.stats(r.state(wid))); });
      return out;
    }

    /* ------------------------------------------------------------- diff */
    function causeText(wid, before, after) {
      var reasons = [];
      if (after.deadEvents.length > before.deadEvents.length) {
        var extra = after.deadEvents.filter(function (d) {
          return !before.deadEvents.some(function (b) { return b.event.id === d.event.id; });
        });
        extra.forEach(function (d) {
          reasons.push('event ' + d.event.id + ' retracted by ' + d.killedBy);
        });
      }
      if (!after.usable && before.usable && after.unusableReason) {
        var why = after.unusableReason;
        if (why.kind === 'anchor') reasons.push('anchor support withdrawn: ' + why.premise);
        else reasons.push('upstream ' + why.weight + ' is no longer usable');
      }
      if (!reasons.length) {
        var w = weights.get(wid);
        if (w.kind === 'derived') reasons.push('derived from ' + w.relation.deps.join(', ') + ' re-evaluated');
        else reasons.push('snapshot unchanged');
      }
      return reasons;
    }

    function diff(withdrawn) {
      var before = snapshot([]);
      var after = snapshot(withdrawn);
      var depthMemo = new Map();

      function depthOf(wid) {
        if (depthMemo.has(wid)) return depthMemo.get(wid);
        var w = weights.get(wid);
        var b = before.get(wid), a = after.get(wid);
        if (b.liveCount !== a.liveCount || (b.usable && !a.usable)) {
          depthMemo.set(wid, 0);
          return 0;
        }
        if (w.kind === 'derived') {
          var best = Infinity;
          w.relation.deps.forEach(function (d) {
            var dd = depthOf(d);
            if (dd + 1 < best) best = dd + 1;
          });
          if (best !== Infinity) { depthMemo.set(wid, best); return best; }
        }
        depthMemo.set(wid, 0);
        return 0;
      }

      var rows = [];
      weights.forEach(function (w, wid) {
        var b = before.get(wid), a = after.get(wid);
        var valuesChanged = b.values.some(function (v, i) { return v !== a.values[i]; });
        var statusChanged = b.usable !== a.usable;
        var eventsChanged = b.liveCount !== a.liveCount;
        if (!valuesChanged && !statusChanged && !eventsChanged) return;
        rows.push({
          weightId: wid,
          name: w.name,
          kind: w.kind,
          layer: w.layer,
          role: w.role,
          depth: depthOf(wid),
          before: b,
          after: a,
          deltaNorm: a.norm - b.norm,
          pctNorm: b.norm ? (a.norm - b.norm) / b.norm * 100 : 0,
          valuesChanged: valuesChanged,
          statusChanged: statusChanged,
          eventsChanged: eventsChanged,
          cause: causeText(wid, b, a)
        });
      });
      rows.sort(function (x, y) {
        if (x.depth !== y.depth) return x.depth - y.depth;
        return Math.abs(y.deltaNorm) - Math.abs(x.deltaNorm);
      });

      var eventsRetracted = 0, weightsAffected = rows.length;
      eventOrder.forEach(function (e) {
        var live = !firstWithdrawn(support(e.id), withdrawn);
        if (!live) eventsRetracted++;
      });
      return {
        rows: rows,
        summary: {
          weightsAffected: weightsAffected,
          eventsRetracted: eventsRetracted,
          eventsTotal: eventOrder.length,
          weightsHistorical: rows.filter(function (r) { return !r.after.usable; }).length,
          downstream: rows.filter(function (r) { return r.depth > 0; }).length
        }
      };
    }

    /* --------------------------------------------------------- utilities */
    function paramCount(dims) {
      return dims.reduce(function (a, b) { return a * b; }, 1);
    }

    function premiseUsage(pid) {
      var evs = [], ws = [];
      eventOrder.forEach(function (e) { if (support(e.id).has(pid)) evs.push(e.id); });
      weights.forEach(function (w, wid) { if (coneSupport(wid).has(pid)) ws.push(wid); });
      return { events: evs, weights: ws };
    }

    function eventsForWeight(wid) {
      var w = weights.get(wid);
      return w.kind === 'held' ? w.events.slice() : [];
    }

    function premisesForWeight(wid) {
      return Array.from(coneSupport(wid));
    }

    function record(id) {
      return premises.get(id) || weights.get(id) || events.get(id) || null;
    }

    return {
      seed: seed,
      meta: seed.meta,
      MICRO: MICRO,
      premises: premises,
      weights: weights,
      events: events,
      eventOrder: eventOrder,
      support: support,
      coneSupport: coneSupport,
      cone: cone,
      checkAcyclic: checkAcyclic,
      resolver: resolver,
      snapshot: snapshot,
      diff: diff,
      paramCount: paramCount,
      premiseUsage: premiseUsage,
      eventsForWeight: eventsForWeight,
      premisesForWeight: premisesForWeight,
      record: record,
      roundDiv: roundDiv
    };
  }

  return { createEngine: createEngine, MICRO: MICRO, roundDiv: roundDiv };
}));
