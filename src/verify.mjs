import fs from 'fs';
import WideEnginePkg from './engine.js';
const { createEngine } = WideEnginePkg;

const seed = JSON.parse(fs.readFileSync('seed.json', 'utf8'));
const E = createEngine(seed);
let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('== structure');
ok('dependency graph is acyclic', (() => { try { E.checkAcyclic(); return true; } catch (e) { console.log('    ' + e.message); return false; } })());
ok('every citation resolves', (() => {
  try { E.weights.forEach((w, id) => E.support(id)); E.eventOrder.forEach(e => E.support(e.id)); E.premises.forEach((p, id) => E.support(id)); return true; }
  catch (e) { console.log('    ' + e.message); return false; }
})());

// independent brute-force support, written differently on purpose
const premIds = new Set(seed.premises.map(p => p.id));
const premById = new Map(seed.premises.map(p => [p.id, p]));
const wById = new Map(seed.weights.map(w => [w.id, w]));
const evById = new Map();
seed.weights.forEach(w => w.events.forEach(e => evById.set(e.id, e)));
function naiveSupport(id, seen = new Set()) {
  if (seen.has(id)) throw new Error('cycle at ' + id);
  seen = new Set(seen);
  seen.add(id);
  const out = new Set();
  if (premById.has(id)) {
    out.add(id);
    (premById.get(id).derivation?.cites || []).forEach(c => naiveSupport(c, seen).forEach(x => out.add(x)));
  } else if (wById.has(id)) {
    const w = wById.get(id);
    const cites = w.kind === 'held' ? w.anchor.cites : [...w.relation.deps, ...(w.relation.premises || [])];
    cites.forEach(c => naiveSupport(c, seen).forEach(x => out.add(x)));
  } else if (evById.has(id)) {
    evById.get(id).cites.forEach(c => naiveSupport(c, seen).forEach(x => out.add(x)));
  } else throw new Error('unknown ' + id);
  return out;
}
let supportMismatch = 0;
[seed.premises.map(p => p.id), seed.weights.map(w => w.id), [...evById.keys()]].flat().forEach(id => {
  const a = [...E.support(id)].sort().join(',');
  const b = [...naiveSupport(id)].sort().join(',');
  if (a !== b) { supportMismatch++; console.log('    support mismatch ' + id + '\n      engine: ' + a + '\n      naive : ' + b); }
});
ok('support matches naive closure', supportMismatch === 0, supportMismatch + ' mismatches');

console.log('== baseline snapshots');
const base = E.snapshot([]);
let arithBad = 0;
seed.weights.filter(w => w.kind === 'held').forEach(w => {
  const s = base.get(w.id);
  const naiveVals = w.anchor.values.map((v, i) => v + w.events.reduce((a, e) => a + (e.delta[i] || 0), 0));
  if (naiveVals.join(',') !== s.values.join(',')) { arithBad++; console.log('    value mismatch ' + w.id); }
  if (s.liveCount !== w.events.length) { arithBad++; console.log('    live count mismatch ' + w.id); }
});
ok('anchor + all deltas is the baseline snapshot', arithBad === 0);

const qkv = base.get('w-b7-qkv');
console.log('    blocks.7.attn.qkv.weight norm=' + qkv.norm.toFixed(4) + ' mean=' + qkv.mean.toFixed(6) + ' live=' + qkv.liveCount);
const tv = base.get('d-b7qkv-t');
ok('transposed view is the reverse of qkv', tv.values.join(',') === qkv.values.slice().reverse().join(','));
const i8 = base.get('d-b7qkv-i8');
ok('int8 view quantizes the transposed view', i8.values.every((v, i) => v === Math.round(tv.values[i] / 3906) * 3906));

console.log('== cone vs recomputation, per premise');
seed.premises.forEach(p => {
  const cone = E.cone(p.id);
  const d = E.diff(new Set([p.id]));
  const changed = new Set(d.rows.map(r => r.weightId));
  const deadEvents = E.eventOrder.filter(e => naiveSupport(e.id).has(p.id)).map(e => e.id);
  const coneOk = deadEvents.length === cone.events.length && deadEvents.every(id => cone.events.includes(id));
  const changedOutsideCone = [...changed].filter(w => !cone.weights.includes(w) && !cone.events.some(e => evById.get(e).weight === w));
  ok(p.id + ' cone=' + cone.events.length + 'ev/' + cone.weights.length + 'w changed=' + changed.size
     + ' dead=' + d.summary.eventsRetracted,
     coneOk && changedOutsideCone.length === 0,
     coneOk ? 'changed weight outside cone: ' + changedOutsideCone.join(',') : 'cone set mismatch');
  if (!changed.size) console.log('    note: withdrawing ' + p.id + ' changes no weight value');
});

console.log('== scenario: retract R-LEARN1');
const dLearn = E.diff(new Set(['R-LEARN1']));
dLearn.rows.forEach(r => {
  console.log('    ' + r.name.padEnd(44) + ' depth ' + r.depth + ' ' + r.before.norm.toFixed(4) + ' -> '
    + r.after.norm.toFixed(4) + ' (' + (r.pctNorm >= 0 ? '+' : '') + r.pctNorm.toFixed(3) + '%) live '
    + r.before.liveCount + '->' + r.after.liveCount + '  ' + r.cause.join('; '));
});
const expected = ['w-b7-qkv', 'd-b7qkv-t', 'd-b7qkv-i8'];
ok('learn-1 retraction hits exactly qkv + its two views',
   JSON.stringify(dLearn.rows.map(r => r.weightId).sort()) === JSON.stringify(expected.slice().sort()),
   JSON.stringify(dLearn.rows.map(r => r.weightId)));
const qAfter = dLearn.rows.find(r => r.weightId === 'w-b7-qkv').after;
const qBefore = dLearn.rows.find(r => r.weightId === 'w-b7-qkv').before;
const naiveAfter = wById.get('w-b7-qkv').anchor.values.map((v, i) =>
  v + wById.get('w-b7-qkv').events.filter(e => !['R-LEARN1'].some(p => naiveSupport(e.id).has(p)))
    .reduce((a, e) => a + (e.delta[i] || 0), 0));
ok('retracted snapshot drops exactly the learn-1 delta', naiveAfter.join(',') === qAfter.values.join(','));
ok('norm before != after', qBefore.norm !== qAfter.norm);
ok('transposed view follows its upstream by the exact delta',
   dLearn.rows.find(r => r.weightId === 'd-b7qkv-t').after.values.join(',')
   === qAfter.values.slice().reverse().join(','));

console.log('== scenario: retract F-DTYPE (descriptor)');
const dType = E.diff(new Set(['F-DTYPE']));
console.log('    weights affected ' + dType.summary.weightsAffected + ', historical ' + dType.summary.weightsHistorical);
ok('descriptor retraction makes every dependent weight historical',
   dType.rows.every(r => !r.after.usable));

console.log('== scenario: multi-premise');
const multi = E.diff(new Set(['C-EQUALIZE', 'A-OPERATOR-SAFETY']));
console.log('    ' + multi.rows.map(r => r.name + '(' + r.after.liveCount + ')').join(', '));
ok('multi retraction is the union of causes',
   multi.summary.eventsRetracted === E.diff(new Set(['C-EQUALIZE'])).summary.eventsRetracted
   + E.diff(new Set(['A-OPERATOR-SAFETY'])).summary.eventsRetracted);

console.log('== every weight selectable, every premise withdrawable');
ok('all weights expose values', [...base.values()].every(s => Array.isArray(s.values) && s.values.length > 0));
ok('every premise has a cone call', seed.premises.every(p => Array.isArray(E.cone(p.id).events)));

console.log('\n' + (failures ? failures + ' FAILURES' : 'all checks passed'));
process.exit(failures ? 1 : 0);
