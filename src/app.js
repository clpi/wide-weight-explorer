/* Wide weight-space explorer — application shell.
 * Vanilla JS, no dependencies. All numbers come from WideEngine over WIDE_SEED.
 */
(function () {
  'use strict';

  var E = window.WideEngine.createEngine(window.WIDE_SEED);
  var STORE = 'wide.wse.v1';
  var MICRO = E.MICRO;

  var DEFAULTS = {
    view: 'explorer',
    selected: 'w-b7-qkv',
    withdrawn: [],
    filters: { q: '', kind: 'all', layer: 'all', status: 'all', sort: 'name' },
    premiseFilter: '',
    notes: {},
    premiseNotes: {},
    explorations: [],
    activeId: null,
    focusPremise: null,
    diffWeight: null
  };

  var state = JSON.parse(JSON.stringify(DEFAULTS));
  var cache = null;
  var toastTimer = null;

  /* ------------------------------------------------------------- helpers */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cut(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function f4(v) { return (v >= 0 ? '' : '') + v.toFixed(4); }
  function f6(v) { return v.toFixed(6); }
  function sg(v) { return (v >= 0 ? '+' : '\u2212') + Math.abs(v).toFixed(6); }
  function pct(v) { return (v >= 0 ? '+' : '\u2212') + Math.abs(v).toFixed(2) + '%'; }
  function shapeText(dims) { return dims.join(' \u00d7 '); }
  function paramsN(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }
  function dt(iso) {
    if (!iso) return '\u2014';
    return iso.replace('T', ' ').replace('Z', ' UTC');
  }
  function vecText(values) {
    return '[' + values.map(function (v) { return (v < 0 ? '\u2212' : '+') + Math.abs(v / MICRO).toFixed(4); }).join(' ') + ']';
  }
  function microVec(values) {
    return '[' + values.map(function (v) { return (v < 0 ? '\u2212' : '+') + String(Math.abs(v)); }).join(' ') + ']';
  }

  var KIND_ORDER = ['fact', 'observation', 'rule', 'constraint', 'authority'];

  /* -------------------------------------------------------------- storage */
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var saved = JSON.parse(raw);
      Object.keys(DEFAULTS).forEach(function (k) {
        if (saved[k] !== undefined) state[k] = saved[k];
      });
      state.filters = Object.assign({}, DEFAULTS.filters, saved.filters || {});
      state.withdrawn = (saved.withdrawn || []).filter(function (p) { return E.premises.has(p); });
      if (!E.weights.has(state.selected)) state.selected = DEFAULTS.selected;
    } catch (err) { /* corrupted storage: start clean */ }
  }

  var persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORE, JSON.stringify({
          view: state.view, selected: state.selected, withdrawn: state.withdrawn,
          filters: state.filters, notes: state.notes, premiseNotes: state.premiseNotes,
          explorations: state.explorations, activeId: state.activeId
        }));
        var el = $('#savestate');
        if (el) el.textContent = 'saved ' + new Date().toLocaleTimeString();
      } catch (err) { /* quota or private mode */ }
    }, 120);
  }

  /* ------------------------------------------------------------ recompute */
  function compute() {
    var wd = new Set(state.withdrawn);
    var base = E.snapshot([]);
    var cur = E.snapshot(wd);
    var diff = E.diff(wd);
    var changed = new Set();
    diff.rows.forEach(function (r) { changed.add(r.weightId); });
    cache = { snapBase: base, snapCur: cur, diff: diff, changed: changed, wd: wd,
              cones: {} };
    if (!cache.snapCur.get(state.selected)) state.selected = DEFAULTS.selected;
  }

  function coneOf(pid) {
    if (!cache.cones[pid]) cache.cones[pid] = E.cone(pid);
    return cache.cones[pid];
  }

  function statusOf(wid) {
    var s = cache.snapCur.get(wid);
    var w = E.weights.get(wid);
    if (!s.usable) return { cls: 'hist', label: 'historical', dot: 'hist', title: 'not usable: a premise in its required support is withdrawn' };
    if (s.deadCount) return { cls: 'partial', label: 'partial', dot: 'partial', title: s.deadCount + ' of ' + (s.deadCount + s.liveCount) + ' learned events retracted' };
    if (w.kind === 'derived') return { cls: 'derived', label: 'derived', dot: 'derived', title: 'derived view: evaluated from its input' };
    return { cls: 'ok', label: 'standing', dot: 'ok', title: 'every required premise is admitted and unwithdrawn' };
  }

  /* --------------------------------------------------------------- chrome */
  function renderChrome() {
    $$('.tab').forEach(function (t) {
      t.setAttribute('aria-selected', t.dataset.view === state.view ? 'true' : 'false');
    });
    var wc = $('#tab-withdrawn');
    if (wc) wc.textContent = state.withdrawn.length ? String(state.withdrawn.length) : '';
    var ec = $('#tab-weights');
    if (ec) ec.textContent = String(E.weights.size);
    var sb = $('#sb-withdrawn');
    if (sb) sb.innerHTML = state.withdrawn.length
      ? '<span style="color:var(--rose)">' + state.withdrawn.length + ' withdrawn</span>'
      : '<span>nothing withdrawn</span>';
  }

  /* ------------------------------------------------------------- explorer */
  function filteredWeights() {
    var f = state.filters;
    var q = f.q.trim().toLowerCase();
    var rows = [];
    E.weights.forEach(function (w, id) {
      var s = cache.snapCur.get(id);
      var st = statusOf(id);
      if (f.kind !== 'all' && w.kind !== f.kind) return;
      if (f.layer !== 'all' && w.layer !== f.layer) return;
      if (f.status === 'usable' && !s.usable) return;
      if (f.status === 'historical' && s.usable) return;
      if (f.status === 'changed' && !cache.changed.has(id)) return;
      if (f.status === 'partial' && !(s.usable && s.deadCount)) return;
      if (q) {
        var pids = E.premisesForWeight(id);
        var hay = [w.name, id, w.layer, w.role, w.dtype].join(' ').toLowerCase();
        var premiseHay = pids.map(function (p) {
          var pr = E.premises.get(p);
          return (pr.label + ' ' + pr.id + ' ' + pr.statement).toLowerCase();
        }).join(' ');
        if (hay.indexOf(q) < 0 && premiseHay.indexOf(q) < 0) return;
      }
      rows.push({ w: w, id: id, s: s, st: st });
    });
    var sort = f.sort;
    rows.sort(function (a, b) {
      switch (sort) {
        case 'norm-desc': return b.s.norm - a.s.norm;
        case 'norm-asc': return a.s.norm - b.s.norm;
        case 'delta': return Math.abs(b.s.norm - cache.snapBase.get(b.id).norm) - Math.abs(a.s.norm - cache.snapBase.get(a.id).norm);
        case 'premises': return E.premisesForWeight(b.id).length - E.premisesForWeight(a.id).length;
        case 'params': return E.paramCount(b.w.dims) - E.paramCount(a.w.dims);
        case 'layer': return a.w.layer.localeCompare(b.w.layer) || a.w.name.localeCompare(b.w.name);
        default: return a.w.name.localeCompare(b.w.name);
      }
    });
    return rows;
  }

  function sparkBars(values) {
    var max = Math.max.apply(null, values.map(function (v) { return Math.abs(v); })) || 1;
    return '<span class="sparkbars" aria-hidden="true">' + values.map(function (v) {
      var h = Math.max(3, Math.round(Math.abs(v) / max * 24));
      return '<i class="' + (v >= 0 ? 'p' : 'n') + '" style="height:' + h + 'px"></i>';
    }).join('') + '</span>';
  }

  function weightCard(row) {
    var w = row.w, s = row.s, st = row.st;
    var prem = E.premisesForWeight(row.id).length;
    var affected = cache.changed.has(row.id);
    var base = cache.snapBase.get(row.id);
    var evcount = w.kind === 'held'
      ? s.liveCount + '/' + (s.liveCount + s.deadCount) + ' events'
      : 'derived';
    return '' +
      '<button class="wcard" data-act="select-weight" data-id="' + esc(row.id) + '"' +
        ' data-selected="' + (state.selected === row.id) + '" aria-label="Open premise graph for ' + esc(w.name) + '">' +
        '<span class="top">' +
          '<span class="nm">' + esc(w.name) + '</span>' +
          '<span class="dot ' + st.dot + '" title="' + esc(st.title) + '"></span>' +
        '</span>' +
        '<span class="chips">' +
          '<span class="chip quiet">' + esc(shapeText(w.dims)) + '</span>' +
          '<span class="chip quiet">' + esc(w.dtype) + '</span>' +
          '<span class="chip' + (w.kind === 'derived' ? '' : ' quiet') + '">' + esc(w.kind) + '</span>' +
          (s.usable ? '' : '<span class="chip warn">historical</span>') +
        '</span>' +
        '<span class="vals">' +
          '<span class="val"><span class="n">' + f4(s.norm) + '</span><br><span class="l">norm (L2)</span></span>' +
          '<span class="val"><span class="n">' + f4(s.mean) + '</span><br><span class="l">mean</span></span>' +
          '<span class="spark">' + sparkBars(s.values) + '</span>' +
        '</span>' +
        '<span class="foot">' +
          '<span>' + prem + ' premises</span>' +
          '<span>' + esc(evcount) + '</span>' +
          '<span class="' + (affected ? 'aff' : '') + '">' +
            (affected ? '\u0394 ' + pct(base.norm ? (s.norm - base.norm) / base.norm * 100 : 0) : 'unchanged') +
          '</span>' +
          '<span class="dg">' + esc(w.digest.slice(0, 8)) + '</span>' +
        '</span>' +
      '</button>';
  }

  function renderExplorer() {
    var rows = filteredWeights();
    var layers = [];
    E.weights.forEach(function (w) { if (layers.indexOf(w.layer) < 0) layers.push(w.layer); });
    layers.sort();
    var totals = { weights: E.weights.size, premises: E.premises.size, events: E.eventOrder.length };
    var totalParams = 0;
    E.weights.forEach(function (w) { totalParams += E.paramCount(w.dims); });
    var affected = cache.diff.rows.length;
    var q = state.filters;

    return '' +
    '<div class="vhead">' +
      '<div><h1>Weight explorer</h1>' +
      '<p class="lede">Every table seated in <span class="mono" style="font-family:var(--mono)">wide-session-8842</span>, with the value its standing revision evaluates to and the number of premises that value cannot do without. Search matches weight names, layers and cited premises.</p></div>' +
      '<div class="actions">' +
        '<button class="btn" data-act="drawer-open">Saved explorations<span class="kbd">' + state.explorations.length + '</span></button>' +
        '<button class="btn primary" data-act="save-open">Save exploration</button>' +
      '</div>' +
    '</div>' +

    '<div class="stats">' +
      stat('weight tables', String(totals.weights), 'held ' + countKind('held') + ' \u00b7 derived ' + countKind('derived')) +
      stat('premises', String(totals.premises), 'admitted in this session') +
      stat('learned events', String(totals.events), 'appended to seating chains') +
      stat('parameters', paramsN(totalParams), 'across all seatings') +
      stat('affected now', String(affected), state.withdrawn.length ? state.withdrawn.length + ' premises withdrawn' : 'nothing withdrawn') +
    '</div>' +

    '<div class="toolbar">' +
      '<span class="search">' + iconSearch() +
        '<input type="search" id="q" data-filter="q" value="' + esc(q.q) + '" placeholder="Search weights, layers, premises  ( / )" aria-label="Search weights">' +
      '</span>' +
      '<select class="ctl" data-filter="kind" aria-label="Filter by kind">' +
        opt('all', 'all kinds', q.kind) + opt('held', 'held', q.kind) + opt('derived', 'derived', q.kind) +
      '</select>' +
      '<select class="ctl" data-filter="layer" aria-label="Filter by layer">' +
        opt('all', 'all layers', q.layer) + layers.map(function (l) { return opt(l, l, q.layer); }).join('') +
      '</select>' +
      '<select class="ctl" data-filter="status" aria-label="Filter by standing">' +
        opt('all', 'any standing', q.status) + opt('usable', 'usable', q.status) +
        opt('partial', 'retracted events', q.status) + opt('historical', 'historical only', q.status) +
        opt('changed', 'affected by withdrawal', q.status) +
      '</select>' +
      '<span class="sep"></span>' +
      '<select class="ctl" data-filter="sort" aria-label="Sort">' +
        opt('name', 'sort: name', q.sort) + opt('norm-desc', 'sort: norm ↓', q.sort) +
        opt('norm-asc', 'sort: norm ↑', q.sort) + opt('delta', 'sort: |Δ| norm', q.sort) +
        opt('premises', 'sort: premises', q.sort) + opt('params', 'sort: parameters', q.sort) +
        opt('layer', 'sort: layer', q.sort) +
      '</select>' +
      '<span class="tbcount">' + rows.length + ' / ' + E.weights.size + '</span>' +
    '</div>' +

    (rows.length
      ? '<div class="wgrid">' + rows.map(weightCard).join('') + '</div>'
      : '<div class="empty"><strong>No weight matches those filters.</strong><br>Clear the search with <kbd class="hint" style="font-family:var(--mono)">/</kbd> or reset the filters below.<br><br><button class="btn sm" data-act="clear-filters">Clear filters</button></div>');
  }

  function countKind(kind) {
    var n = 0;
    E.weights.forEach(function (w) { if (w.kind === kind) n++; });
    return n;
  }
  function stat(k, v, s) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>';
  }
  function opt(v, label, cur) {
    return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(label) + '</option>';
  }
  function iconSearch() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>';
  }

  /* ---------------------------------------------------------------- graph */
  var COL = [
    { x: 20, w: 252 },
    { x: 330, w: 268 },
    { x: 660, w: 254 },
    { x: 976, w: 184 }
  ];
  var CANVAS_W = 1180;

  function renderGraph() {
    var w = E.weights.get(state.selected);
    var s = cache.snapCur.get(state.selected);
    var st = statusOf(state.selected);
    var base = cache.snapBase.get(state.selected);
    var note = state.notes[state.selected] || {};
    var prem = E.premisesForWeight(state.selected);
    var changed = cache.changed.has(state.selected);

    var html = '' +
    '<div class="vhead">' +
      '<div style="min-width:0">' +
        '<div class="crumb"><button data-act="nav" data-view="explorer">weight explorer</button> / ' + esc(w.layer) + ' / premise graph</div>' +
        '<h1 class="mono">' + esc(w.name) + '</h1>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' +
          '<span class="chip quiet">' + esc(shapeText(w.dims)) + '</span>' +
          '<span class="chip quiet">' + esc(w.dtype) + '</span>' +
          '<span class="chip quiet">' + esc(paramsN(E.paramCount(w.dims))) + ' params</span>' +
          '<span class="chip ' + (s.usable ? 'live' : 'warn') + '">' + esc(st.label) + '</span>' +
          '<span class="chip quiet" title="' + esc(w.digest) + '">digest ' + esc(w.digest.slice(0, 12)) + '</span>' +
          (changed ? '<span class="chip warn">changed by withdrawal ' + pct(base.norm ? (s.norm - base.norm) / base.norm * 100 : 0) + '</span>' : '') +
          (w.kind === 'derived' ? '<span class="chip quiet">derived \u00b7 ' + esc(w.relation.op) + '</span>' : '<span class="chip quiet">' + (s.liveCount + s.deadCount) + ' learned events</span>') +
        '</div>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="btn" data-act="nav" data-view="retraction">Retraction simulator</button>' +
        '<button class="btn primary" data-act="save-open">Save exploration</button>' +
      '</div>' +
    '</div>' +

    '<div class="graph-scroll">' + graphSVG() + '</div>' +
    '<div class="legend">' +
      '<span><i class="solid"></i>required dependency</span>' +
      '<span><i class="sup"></i>anchor / relation premise</span>' +
      '<span><i class="dash"></i>retracted (premise withdrawn)</span>' +
      '<span class="hint">click any node to open it \u00b7 scroll sideways on narrow screens</span>' +
    '</div>' +

    '<div class="cols2">' +
      '<div class="panel"><h2>Why this value <span class="tag">exact micro-unit arithmetic</span></h2>' + ledgerHTML(state.selected) + '</div>' +
      '<div class="panel"><h2>Premises in the cone <span class="tag">' + prem.length + '</span></h2>' +
        '<p class="hint" style="margin:-4px 0 10px">Everything this value cannot do without, direct or inherited through a dependency. Withdrawing any of them recomputes the snapshot.</p>' +
        '<div class="plist">' + prem.map(function (p) { return premiseRow(p, state.selected); }).join('') + '</div>' +
      '</div>' +
    '</div>' +

    '<div class="panel notes">' +
      '<h2>Notes on this weight' +
        '<span class="saved" id="note-saved">' + (note.updated ? 'saved ' + dt(note.updated) : 'not saved yet') + '</span>' +
      '</h2>' +
      '<textarea data-note="weight" data-id="' + esc(state.selected) + '" placeholder="Why you looked, what you concluded, what you would retract next. Stored locally and kept across sessions.">' + esc(note.text || '') + '</textarea>' +
      '<p class="hint" style="margin:8px 0 0">Notes persist in this browser (localStorage) for every weight and every premise, independent of saved explorations.</p>' +
    '</div>';

    return html;
  }

  function graphSVG() {
    var wid = state.selected;
    var w = E.weights.get(wid);
    var s = cache.snapCur.get(wid);
    var wd = cache.wd;

    var deps = [];
    if (w.kind === 'held') {
      deps.push({ type: 'anchor', key: 'anchor' });
      w.anchor.cites.forEach(function (c) { deps.push({ type: 'premise', id: c }); });
    } else {
      w.relation.deps.forEach(function (d) { deps.push({ type: 'weight', id: d }); });
      (w.relation.premises || []).forEach(function (c) { deps.push({ type: 'premise', id: c }); });
    }
    var events = E.eventsForWeight(wid);
    var cited = [];
    events.forEach(function (e) {
      e.cites.forEach(function (c) {
        if (E.premises.has(c) && cited.indexOf(c) < 0) cited.push(c);
      });
    });
    cited.sort(function (a, b) { return a.localeCompare(b); });

    function h(node) { return node.type === 'anchor' ? 50 : node.type === 'weight' ? 58 : node.type === 'event' ? 58 : 46; }
    var H = { deps: sum(deps.map(h)), events: sum(events.map(function () { return 58; })),
              cited: sum(cited.map(function () { return 46; })) , focus: 74 };
    function sum(a) { return a.reduce(function (x, y) { return x + y + 12; }, -12); }
    var tallest = Math.max(H.deps, H.focus, H.events, H.cited);
    var canvasH = Math.max(320, tallest + 96);
    var midY = canvasH / 2;

    function colYs(list, heights) {
      var total = sum(heights);
      var y = midY - total / 2;
      return list.map(function (item, i) {
        var box = { item: item, y: y, h: heights[i] };
        y += heights[i] + 12;
        return box;
      });
    }

    var depBoxes = colYs(deps, deps.map(h));
    var evBoxes = colYs(events, events.map(function () { return 58; }));
    var citBoxes = colYs(cited, cited.map(function () { return 46; }));
    var focusBox = { y: midY - H.focus / 2, h: H.focus };

    var out = [];
    out.push('<svg class="g" width="' + CANVAS_W + '" height="' + canvasH + '" viewBox="0 0 ' + CANVAS_W + ' ' + canvasH + '" role="img" aria-label="Premise graph for ' + esc(w.name) + '">');
    out.push('<text class="col-label" x="' + COL[0].x + '" y="22">dependencies</text>');
    out.push('<text class="col-label" x="' + COL[1].x + '" y="22">weight revision</text>');
    out.push('<text class="col-label" x="' + COL[2].x + '" y="22">learning updates</text>');
    out.push('<text class="col-label" x="' + COL[3].x + '" y="22">cited premises</text>');

    // edges deps -> focus
    depBoxes.forEach(function (b) {
      var toY = midY;
      var cls = 'edge live';
      if (b.item.type === 'premise') {
        if (wd.has(b.item.id)) cls = 'edge dead';
        else cls = 'edge support';
      } else if (b.item.type === 'weight') {
        var ups = cache.snapCur.get(b.item.id);
        cls = ups && ups.usable ? 'edge live' : 'edge dead';
      } else { cls = 'edge support'; }
      out.push(edge(COL[0].x + COL[0].w, b.y + b.h / 2, COL[1].x, toY, cls));
    });
    // focus -> events
    evBoxes.forEach(function (b) {
      var live = true;
      Array.from(E.support(b.item.id)).forEach(function (p) { if (wd.has(p)) live = false; });
      out.push(edge(COL[1].x + COL[1].w, midY, COL[2].x, b.y + b.h / 2, live ? 'edge live' : 'edge dead'));
    });
    // events -> cited premises
    evBoxes.forEach(function (eb) {
      var e = eb.item;
      e.cites.forEach(function (cid) {
        var idx = cited.indexOf(cid);
        if (idx < 0) return;
        var cb = citBoxes[idx];
        out.push(edge(COL[2].x + COL[2].w, eb.y + eb.h / 2, COL[3].x, cb.y + cb.h / 2, wd.has(cid) ? 'edge dead' : 'edge live'));
      });
    });

    // dep nodes
    depBoxes.forEach(function (b) {
      var x = COL[0].x, wid2 = COL[0].w;
      if (b.item.type === 'anchor') {
        out.push(node(x, b.y, wid2, b.h, false, [
          { cls: 't1', text: 'anchor \u00b7 ckpt-18400' },
          { cls: 't3', text: microVec(w.anchor.values).slice(0, 30) + '\u2026' }
        ], '', '', 'anchor payload of the revision'));
      } else if (b.item.type === 'premise') {
        var pr = E.premises.get(b.item.id);
        out.push(node(x, b.y, wid2, b.h, false, [
          { cls: 't1', text: cut(pr.id, 26) },
          { cls: 't3', text: pr.kind + ' \u00b7 anchor premise' }
        ], 'premise-detail', b.item.id, pr.statement, wd.has(pr.id)));
      } else {
        var upw = E.weights.get(b.item.id);
        var ups = cache.snapCur.get(b.item.id);
        out.push(node(x, b.y, wid2, b.h, false, [
          { cls: 't1', text: cut(upw.name, 28) },
          { cls: 't3', text: shapeText(upw.dims) + ' \u00b7 norm ' + f4(ups.norm) }
        ], 'select-weight', b.item.id, 'upstream weight', !ups.usable));
      }
    });

    // focus node
    var st = statusOf(wid);
    out.push('<g class="node" data-act="none" aria-label="' + esc(w.name) + '">' +
      '<rect class="n-box focus" x="' + COL[1].x + '" y="' + focusBox.y + '" width="' + COL[1].w + '" height="' + focusBox.h + '" rx="10"></rect>' +
      '<text class="t1" x="' + (COL[1].x + 12) + '" y="' + (focusBox.y + 24) + '">' + esc(cut(w.name, 28)) + '</text>' +
      '<text class="t2" x="' + (COL[1].x + 12) + '" y="' + (focusBox.y + 41) + '">' + esc(shapeText(w.dims) + ' \u00b7 ' + w.dtype) + '</text>' +
      '<text class="t3" x="' + (COL[1].x + 12) + '" y="' + (focusBox.y + 58) + '">norm ' + f4(s.norm) + ' \u00b7 ' + esc(st.label) + '</text>' +
      '</g>');

    // event nodes
    evBoxes.forEach(function (b) {
      var e = b.item;
      var deadPid = null;
      Array.from(E.support(e.id)).forEach(function (p) { if (!deadPid && wd.has(p)) deadPid = p; });
      out.push(node(COL[2].x, b.y, COL[2].w, b.h, false, [
        { cls: 't1', text: cut(e.id, 24) + ' \u00b7 ' + e.rule },
        { cls: 't3', text: 'step ' + e.step + ' \u00b7 ' + (deadPid ? 'retracted by ' + cut(deadPid, 12) : '\u0394 norm ' + f4(deltaNorm(e))) }
      ], 'premise-detail', e.cites[0], e.note, !!deadPid));
    });

    // cited premise nodes
    citBoxes.forEach(function (b) {
      var pr = E.premises.get(b.item);
      out.push(node(COL[3].x, b.y, COL[3].w, b.h, false, [
        { cls: 't1', text: cut(pr.id, 22) },
        { cls: 't3', text: pr.kind }
      ], 'premise-detail', b.item, pr.statement, wd.has(pr.id)));
    });

    out.push('</svg>');
    return out.join('');
  }

  function deltaNorm(e) {
    var sum = 0;
    e.delta.forEach(function (v) { sum += v * v; });
    return Math.sqrt(sum) / MICRO;
  }

  function edge(x1, y1, x2, y2, cls) {
    var dx = Math.max(30, (x2 - x1) * 0.42);
    return '<path class="' + cls + '" d="M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2 + '"></path>';
  }

  function node(x, y, width, height, isFocus, lines, act, id, title, bad) {
    var rectCls = 'n-box' + (bad ? ' bad' : '');
    var html = '<g class="node" tabindex="0" role="button"' +
      (act && act !== 'none' ? ' data-act="' + act + '" data-id="' + esc(id) + '"' : '') +
      ' aria-label="' + esc(title || '') + '">' +
      '<title>' + esc(title || '') + '</title>' +
      '<rect class="' + rectCls + '" x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" rx="8"></rect>';
    lines.forEach(function (l, i) {
      html += '<text class="' + l.cls + '" x="' + (x + 10) + '" y="' + (y + 20 + i * 16) + '">' + esc(l.text) + '</text>';
    });
    html += '</g>';
    return html;
  }

  function ledgerHTML(wid) {
    var w = E.weights.get(wid);
    var s = cache.snapCur.get(wid);

    if (w.kind === 'derived') {
      var rows = w.relation.deps.map(function (d) {
        var up = cache.snapCur.get(d);
        return '<tr><td class="op">\u2190</td><td>' + esc(E.weights.get(d).name) +
          '<span class="why">input of <b>' + esc(w.relation.op) + '</b></span></td>' +
          '<td>' + microVec(up.values) + '</td></tr>';
      }).join('');
      (w.relation.premises || []).forEach(function (p) {
        var dead = cache.wd.has(p);
        rows += '<tr class="' + (dead ? 'dead' : '') + '"><td class="op">' + (dead ? '\u2212' : '+') + '</td>' +
          '<td>' + esc(p) + '<span class="why">relation premise' + (dead ? ' \u00b7 withdrawn, relation not usable' : '') + '</span></td>' +
          '<td>' + esc(E.premises.get(p).statement) + '</td></tr>';
      });
      return '<div class="ledwrap"><table class="ledger"><thead><tr><th></th><th>record</th><th>value</th></tr></thead><tbody>' +
        rows +
        '<tr class="total"><td class="op">=</td><td>snapshot<span class="why">' + esc(w.relation.op) + ' evaluated in this configuration</span></td><td>' + microVec(s.values) + '</td></tr>' +
        '</tbody></table></div>' +
        '<div class="formula">norm = \u221a\u03a3v\u00b2 = <b>' + f6(s.norm) + '</b>\u2003mean = <b>' + f6(s.mean) + '</b>\u2003max|v| = <b>' + f6(s.maxAbs) + '</b>' +
        '<br><span class="hint">Derived views hold no payload: their value is evaluated from the inputs above, so a retraction upstream moves them.</span></div>';
    }

    var rows2 = '<tr><td class="op">+</td><td>anchor \u00b7 ckpt-18400<span class="why">' +
      esc(w.anchor.cites.join(' \u00b7 ')) + '</span></td><td>' + microVec(w.anchor.values) + '</td></tr>';
    w.events.forEach(function (e) {
      var killed = Array.from(E.support(e.id)).filter(function (p) { return cache.wd.has(p); })[0];
      rows2 += '<tr class="' + (killed ? 'dead' : '') + '"><td class="op">' + (killed ? '\u2212' : '+') + '</td>' +
        '<td>' + esc(e.id) + ' \u00b7 ' + esc(e.rule) + ' \u00b7 step ' + e.step +
        '<span class="why">' + esc(e.note) + (killed ? ' \u2014 retracted, cites ' + esc(killed) : ' \u2014 cites ' + e.cites.map(esc).join(', ')) + '</span></td>' +
        '<td>' + (killed ? '<s>' + microVec(e.delta) + '</s>' : microVec(e.delta)) + '</td></tr>';
    });
    return '<div class="ledwrap"><table class="ledger"><thead><tr><th></th><th>record</th><th>delta (micro-units)</th></tr></thead><tbody>' +
      rows2 +
      '<tr class="total"><td class="op">=</td><td>snapshot<span class="why">anchor + every live delta, converted once (' + esc(w.dtype) + ')</span></td><td>' + microVec(s.values) + '</td></tr>' +
      '</tbody></table></div>' +
      '<div class="formula">norm = \u221a\u03a3v\u00b2 = <b>' + f6(s.norm) + '</b>\u2003mean = <b>' + f6(s.mean) + '</b>\u2003max|v| = <b>' + f6(s.maxAbs) + '</b>' +
      '<br><span class="hint">' + (s.liveCount) + ' of ' + (s.liveCount + s.deadCount) + ' learned events are live. ' +
      (s.usable ? 'Anchor support is intact, so the snapshot is usable as current knowledge.'
        : 'Anchor support is withdrawn, so this snapshot is historical only: inspectable, not usable.') + '</span></div>';
  }

  function premiseRow(pid, wid) {
    var pr = E.premises.get(pid);
    if (!pr) return '';
    var withdrawn = cache.wd.has(pid);
    var cone = coneOf(pid);
    var directEvents = E.eventsForWeight(wid).filter(function (e) { return e.cites.indexOf(pid) >= 0; });
    var isAnchorPremise = E.weights.get(wid).anchor && (E.weights.get(wid).anchor.cites || []).indexOf(pid) >= 0;
    var isRelation = E.weights.get(wid).relation && (E.weights.get(wid).relation.premises || []).indexOf(pid) >= 0;
    var tag = directEvents.length ? 'cites ' + directEvents.length + ' event' + (directEvents.length > 1 ? 's' : '')
      : isAnchorPremise ? 'anchor support' : isRelation ? 'relation premise' : 'inherited';
    var expiring = pr.valid_until && pr.valid_until < '2026-11-10T06:00:00Z';
    return '<div class="prow" data-withdrawn="' + withdrawn + '">' +
      '<span class="kind ' + esc(pr.kind) + '">' + esc(pr.kind) + '</span>' +
      '<span>' +
        '<button class="pid" data-act="premise-detail" data-id="' + esc(pid) + '" style="background:none;border:0;padding:0;color:inherit;text-align:left">' + esc(pid) + '</button>' +
        '<span class="pst">' + esc(cut(pr.label, 74)) + '</span>' +
        '<span class="meta"><span>' + esc(tag) + '</span><span>cone ' + cone.events.length + ' ev \u00b7 ' + cone.weights.length + ' w</span>' +
        (expiring ? '<span style="color:var(--rose)">valid_until ' + esc(dt(pr.valid_until)) + '</span>' : '') + '</span>' +
      '</span>' +
      '<span class="right">' +
        (withdrawn
          ? '<button class="btn sm" data-act="restore" data-id="' + esc(pid) + '">restore</button>'
          : '<button class="btn sm danger" data-act="withdraw-open" data-id="' + esc(pid) + '">withdraw</button>') +
      '</span>' +
    '</div>';
  }

  /* ----------------------------------------------------------- retraction */
  function renderRetraction() {
    var q = state.premiseFilter.trim().toLowerCase();
    var groups = KIND_ORDER.map(function (kind) {
      var list = [];
      E.premises.forEach(function (p) {
        if (p.kind !== kind) return;
        if (q && (p.id + ' ' + p.label + ' ' + p.statement).toLowerCase().indexOf(q) < 0) return;
        list.push(p);
      });
      return { kind: kind, list: list };
    }).filter(function (g) { return g.list.length; });

    var d = cache.diff;
    var rows = d.rows;
    var strip = state.withdrawn.length
      ? '<div class="withdrawn-strip">' + state.withdrawn.map(function (p) {
          return '<span class="wtag">' + esc(p) + '<button data-act="restore" data-id="' + esc(p) + '" aria-label="Restore ' + esc(p) + '">\u00d7</button></span>';
        }).join('') + '</div>'
      : '';

    var right;
    if (!state.withdrawn.length) {
      right = '<div class="panel"><h2>Nothing withdrawn <span class="tag">before \u2192 after is empty</span></h2>' +
        '<p class="lede" style="margin-top:0">Withdraw a premise on the left and every recomputation happens immediately: learned events whose support contains that premise are retracted, each affected snapshot is evaluated again, and derived views follow their inputs. Nothing is cached and nothing is subtracted from a rounded value.</p>' +
        '<div class="reasons"><span>Worth trying:</span>' +
          '<ul>' +
            '<li><code>R-LEARN1</code> retracts two learned events on <code>blocks.7.attn.qkv.weight</code> and moves its two derived views.</li>' +
            '<li><code>C-EQUALIZE</code> spans three layers, so the cone crosses the graph.</li>' +
            '<li><code>F-DTYPE</code> is the descriptor every anchor cites: withdrawing it makes every snapshot historical.</li>' +
          '</ul>' +
        '</div>' +
        '<div class="tryrow">' +
          '<button class="btn sm" data-act="withdraw-open" data-id="R-LEARN1">Preview cone of R-LEARN1</button>' +
          '<button class="btn sm" data-act="withdraw-open" data-id="C-EQUALIZE">Preview cone of C-EQUALIZE</button>' +
          '<button class="btn sm" data-act="withdraw-open" data-id="F-DTYPE">Preview cone of F-DTYPE</button>' +
        '</div></div>';
    } else {
      var chosen = state.diffWeight && rows.filter(function (r) { return r.weightId === state.diffWeight; })[0];
      if (!chosen) chosen = rows[0];
      right = '<div class="stats">' +
        stat('weights recomputed', String(d.summary.weightsAffected), 'of ' + E.weights.size + ' seatings') +
        stat('events retracted', String(d.summary.eventsRetracted), 'of ' + d.summary.eventsTotal + ' learned') +
        stat('downstream moves', String(d.summary.downstream), 'depth \u2265 1') +
        stat('now historical', String(d.summary.weightsHistorical), 'support no longer live') +
      '</div>' +
      '<div class="panel" style="margin-bottom:12px">' +
        '<h2>Before \u2192 after <span class="tag">' + (chosen ? esc(chosen.name) : '') + '</span>' +
          '<span class="saved"><button class="btn sm ghost" data-act="copy-diff">Copy diff as text</button></span></h2>' +
        (chosen ? diffBars(chosen) : '<p class="hint">No weight changed.</p>') +
      '</div>' +
      '<div class="tblwrap"><table class="dtable"><thead><tr>' +
        '<th>weight</th><th>depth</th><th>standing</th><th class="num">norm before</th><th class="num">norm after</th>' +
        '<th class="num">\u0394 norm</th><th class="num">\u0394%</th><th>why</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr data-act="select-weight" data-id="' + esc(r.weightId) + '" class="' + (chosen && chosen.weightId === r.weightId ? 'flash' : '') + '">' +
          '<td><span class="wname">' + esc(r.name) + '</span></td>' +
          '<td><span class="depth ' + (r.depth === 0 ? 'd0' : 'dn') + '">' + (r.depth === 0 ? 'direct' : '+' + r.depth) + '</span></td>' +
          '<td>' + standingCell(r.before.usable, r.after.usable) + '</td>' +
          '<td class="num">' + f4(r.before.norm) + '</td>' +
          '<td class="num now">' + f4(r.after.norm) + '</td>' +
          '<td class="num delta ' + (r.deltaNorm >= 0 ? 'up' : 'down') + '">' + (r.deltaNorm >= 0 ? '+' : '\u2212') + Math.abs(r.deltaNorm).toFixed(6) + '</td>' +
          '<td class="num delta ' + (r.pctNorm >= 0 ? 'up' : 'down') + '">' + pct(r.pctNorm) + '</td>' +
          '<td><span class="cause">' + r.cause.map(esc).join('; ') + '</span></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<p class="hint" style="margin-top:8px">Click any row to open that weight\u2019s premise graph. \u0394 is exact (\u0394norm shown to 1e-6); percentages are relative to the pre-withdrawal snapshot.</p>';
    }

    return '' +
    '<div class="vhead">' +
      '<div><h1>Retraction simulator</h1>' +
      '<p class="lede">Withdraw premises and watch the configuration recompute. Retraction excludes exactly the learned events whose support contains the premise, then every snapshot is evaluated again: anchors stay immutable, deltas are added, derived views re-derive. The cone is shown before you confirm.</p></div>' +
      '<div class="actions">' +
        '<button class="btn" data-act="undo" ' + (state.withdrawn.length ? '' : 'disabled') + '>Undo last</button>' +
        '<button class="btn danger" data-act="reset-withdrawals" ' + (state.withdrawn.length ? '' : 'disabled') + '>Restore all</button>' +
        '<button class="btn primary" data-act="save-open">Save exploration</button>' +
      '</div>' +
    '</div>' +
    strip +
    '<div class="wdlayout">' +
      '<div class="picker">' +
        '<div class="search">' + iconSearch() +
          '<input type="search" id="pq" data-pfilter placeholder="Filter premises" value="' + esc(state.premiseFilter) + '" aria-label="Filter premises">' +
        '</div>' +
        '<div class="plist" id="premiselist">' +
          groups.map(function (g) {
            return '<div class="kgroup"><div class="kh"><span class="kind ' + g.kind + '">' + g.kind + '</span><span class="n">' + g.list.length + '</span></div>' +
              g.list.map(function (p) {
                var withdrawn = cache.wd.has(p.id);
                var cone = coneOf(p.id);
                return '<button class="prow" data-act="withdraw-open" data-id="' + esc(p.id) + '" data-withdrawn="' + withdrawn + '">' +
                  '<span><span class="pid">' + esc(p.id) + '</span>' +
                  '<span class="pst">' + esc(cut(p.label, 52)) + '</span>' +
                  '<span class="meta"><span>' + (withdrawn ? 'withdrawn' : 'admitted') + '</span>' +
                  '<span>cone ' + cone.events.length + ' ev \u00b7 ' + cone.weights.length + ' w</span></span></span>' +
                  '<span class="right"><span class="dot ' + (withdrawn ? 'hist' : 'ok') + '"></span></span>' +
                '</button>';
              }).join('') + '</div>';
          }).join('') +
        '</div>' +
        '<p class="hint" style="margin:10px 0 0">Cone counts are exact: learned events retracted and weight tables whose value moves. Click a premise for its record and the confirmation.</p>' +
      '</div>' +
      '<div>' + right + '</div>' +
    '</div>';
  }

  function standingCell(before, after) {
    if (before === after) return '<span class="chip ' + (after ? 'live' : 'warn') + '">' + (after ? 'usable' : 'historical') + '</span>';
    return '<span class="was">' + (before ? 'usable' : 'hist') + '</span> \u2192 <span class="chip warn">historical</span>';
  }

  function diffBars(row) {
    var maxN = Math.max(row.before.norm, row.after.norm, 0.0001);
    var maxM = Math.max(Math.abs(row.before.mean), Math.abs(row.after.mean), 0.0001);
    return '<div class="db-legend"><span><i class="sw before"></i>before</span><span><i class="sw after"></i>after</span>' +
        '<span class="hint">values are the standing snapshot at each configuration</span></div>' +
      '<div class="diffbars">' +
      dbRow('norm', row.before.norm, row.after.norm, maxN, row.pctNorm) +
      dbRow('mean', row.before.mean, row.after.mean, maxM, null) +
      '<div class="vec"><span class="hint">before  </span>' + microVec(row.before.values) + '</div>' +
      '<div class="vec"><span class="hint">after   </span>' + microVec(row.after.values) + '</div>' +
      '</div>';
  }
  function dbRow(label, b, a, max, p) {
    function w(v) { return Math.max(2, Math.abs(v) / max * 100).toFixed(1); }
    return '<div class="db-row">' +
      '<span class="db-k">' + esc(label) + '</span>' +
      '<span class="db-tracks">' +
        '<span class="db-t"><i class="b" style="width:' + w(b) + '%"></i></span>' +
        '<span class="db-t"><i class="a" style="width:' + w(a) + '%"></i></span>' +
      '</span>' +
      '<span class="db-v">' + b.toFixed(4) + ' \u2192 ' + a.toFixed(4) +
        (p !== null ? '<br><b class="' + (p >= 0 ? 'up' : 'down') + '">' + pct(p) + '</b>' : '') +
      '</span>' +
    '</div>';
  }

  /* --------------------------------------------------------------- about */
  function renderAbout() {
    return '' +
    '<div class="vhead"><div><h1>About this prototype</h1>' +
    '<p class="lede">What is simulated here, what is real arithmetic, and what Wide itself does differently.</p></div></div>' +
    '<div class="about">' +

    '<div class="panel"><h2>What this is</h2>' +
      '<p>A working prototype of the weight-space explorer for <strong>Wide</strong>, the IDE for weight-space programming, where weights are first-class program values and a correction is a premise retraction rather than an edit to a number.</p>' +
      '<p>Three connected views over one session: an explorer over every weight table, a premise graph explaining why one weight holds its value, and a retraction simulator that withdraws premises and shows the recomputed values, the affected downstream weights, and a before/after diff. Named explorations and your notes persist in this browser between sessions.</p>' +
      '<p class="hint">Every number in the interface is computed at render time from the embedded seed data. There are no stored screenshots, no pre-baked diffs, and no hidden state.</p>' +
    '</div>' +

    '<div class="two">' +
      '<div class="panel"><h2>What is real</h2><div class="real">' +
        '<ul>' +
        '<li><strong>The rules.</strong> Support, standing, the cone, and retraction follow Wide\u2019s spec (\u00a7\u00a71\u20136) and Idol core profile 1: support is the transitive premise closure over required dependency edges; an event is live only while every premise in its support is admitted and unwithdrawn; a snapshot is the anchor plus its live deltas; retraction excludes exactly the events in the cone.</li>' +
        '<li><strong>The arithmetic.</strong> Values are integers in micro-units, so <code>anchor + \u03a3deltas</code> is exact and the diff you see is the diff that was computed. Nothing is subtracted from a rounded value.</li>' +
        '<li><strong>The identities.</strong> Every premise, weight and event digest is a real SHA-256 over its mock content.</li>' +
        '<li><strong>The cone counts.</strong> Each premise\u2019s cone is enumerated, not estimated: the same set drives the preview, the retraction, and the diff table.</li>' +
        '</ul>' +
      '</div></div>' +

      '<div class="panel"><h2>What is simulated</h2><div class="gap">' +
        '<ul>' +
        '<li><strong>The session.</strong> <code>wide-session-8842</code>, checkpoint <code>atlas-mini-l12 @ ckpt-18400</code>, 19 premises, 23 weight tables and 24 learned events are invented. No compiler, resident, or Idol machinery is contacted; the page makes no network requests at all.</li>' +
        '<li><strong>The tensors.</strong> Each seating carries an 8-coordinate sampled slice of a table, not the payload. Shapes, dtypes and parameter counts are realistic labels; norms, means and max|v| are computed over the slice only.</li>' +
        '<li><strong>The relations.</strong> <code>transpose</code>, <code>quantize</code>, <code>fold2</code> and <code>scale</code> are stand-ins for real weight relations, applied exactly to the slice.</li>' +
        '<li><strong>Expiry.</strong> <code>valid_until</code> is displayed as a warning and does not auto-retract anything. Withdrawal is always explicit.</li>' +
        '<li><strong>Persistence.</strong> Saved explorations and notes live in this browser\u2019s localStorage. There is no server, no account, and no sync between devices or profiles.</li>' +
        '</ul>' +
      '</div></div>' +
    '</div>' +

    '<div class="panel"><h2>Named gaps \u2014 deliberate deviations</h2>' +
      '<ul>' +
      '<li><strong>Restore.</strong> Real Wide has no unwithdraw inside an epoch: healing is re-registration, which publishes new records under new identities. This prototype offers <em>restore</em> so you can keep exploring; it is not a Wide operation.</li>' +
      '<li><strong>Epochs.</strong> The session presents one epoch. There is no epoch reset surface, and nothing from an earlier epoch answers a question.</li>' +
      '<li><strong>Seating.</strong> Seating new contents (admission, readback, resident refusals) is not implemented. Every table is already seated in the seed.</li>' +
      '<li><strong>Re-registration and healing.</strong> Withdrawn premises cannot be healed by re-registering corrected evidence; that path is absent.</li>' +
      '<li><strong>Importance and time.</strong> The spec\u2019s priority/recency derivations are not modelled; the graph shows structure, not importance.</li>' +
      '</ul>' +
    '</div>' +

    '<div class="panel"><h2>Reading the numbers</h2>' +
      '<ul>' +
      '<li><code>norm</code> is the Euclidean norm of the sampled snapshot, <code>mean</code> its arithmetic mean, <code>max|v|</code> its largest absolute coordinate. Value vectors are printed as signed integers in micro-units, so <code>\u22123516 \u2261 \u22120.003516</code>.</li>' +
      '<li><strong>standing</strong> means every premise in the snapshot\u2019s support is admitted and unwithdrawn. <strong>partial</strong> means some of its learned events were retracted but the anchor still stands. <strong>historical</strong> means the anchor\u2019s own support is withdrawn: the value is inspectable, not usable.</li>' +
      '<li><strong>direct</strong> diffs come from a retracted event or a withdrawn anchor premise on that table; <strong>+1, +2</strong> are derived views re-evaluated from an affected input.</li>' +
      '<li><strong>cone N ev \u00b7 M w</strong> is the exact blast radius of a premise: N learned events retracted, M weight tables whose value or standing moves.</li>' +
      '</ul>' +
    '</div>' +

    '<div class="panel"><h2>Keyboard</h2>' +
      '<p><code>/</code> search \u00b7 <code>e</code> explorer \u00b7 <code>g</code> premise graph \u00b7 <code>r</code> retraction \u00b7 <code>Esc</code> close dialog \u00b7 <code>Enter</code> activate a focused node.</p>' +
      '<div class="tryrow" style="margin-top:12px">' +
        '<button class="btn sm" data-act="drawer-open">Saved explorations</button>' +
        '<button class="btn sm" data-act="export">Export session state (JSON)</button>' +
        '<button class="btn sm danger" data-act="clear-data">Clear local data</button>' +
      '</div>' +
      '<p class="hint" style="margin-top:10px">Seed data: <span style="font-family:var(--mono)">seed.json</span>, generated deterministically (SHA-256) and embedded in this file. Session clock ' + esc(dt(E.meta.clock)) + '.</p>' +
    '</div>' +

    '</div>';
  }

  /* --------------------------------------------------------------- modal */
  function closeModal() {
    var s = $('#scrim');
    if (s) s.remove();
    state.focusPremise = null;
  }

  function openModal(html) {
    closeModal();
    var scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.id = 'scrim';
    scrim.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(scrim);
    var first = scrim.querySelector('input, textarea, button.primary, button');
    if (first) first.focus();
  }

  function premiseModal(pid) {
    var pr = E.premises.get(pid);
    if (!pr) return;
    var cone = coneOf(pid);
    var withdrawn = cache.wd.has(pid);
    var usage = E.premiseUsage(pid);
    var note = state.premiseNotes[pid] || {};
    var effectRows = usage.events.length
      ? usage.events.map(function (eid) {
          var e = E.events.get(eid);
          var w = E.weights.get(e.weight);
          var deadPid = Array.from(E.support(eid)).filter(function (p) { return cache.wd.has(p); })[0];
          return '<li>' + esc(eid) + ' \u00b7 ' + esc(e.rule) + ' \u00b7 step ' + e.step + ' \u2192 ' + esc(w.name) +
            (deadPid ? ' <span style="color:var(--rose)">(retracted by ' + esc(deadPid) + ')</span>' : '') + '</li>';
        }).join('')
      : '<li>no learned event cites this premise directly</li>';

    openModal(
      '<div class="mh"><div style="min-width:0">' +
        '<div class="crumb">' + esc(pr.kind) + ' \u00b7 ' + esc(pr.subkind) + '</div>' +
        '<h3 style="font-family:var(--mono);word-break:break-all">' + esc(pr.id) + '</h3>' +
        '<div style="color:var(--ink-2);font-size:13px;margin-top:4px">' + esc(pr.label) + '</div>' +
      '</div><button class="btn ghost x" data-act="modal-close" aria-label="Close">\u2715</button></div>' +
      '<div class="mbody">' +
        '<dl class="kv">' +
          '<dt>assertion</dt><dd>' + esc(pr.statement) + '</dd>' +
          '<dt>authority</dt><dd class="mono">' + esc(pr.authority) + '</dd>' +
          '<dt>source</dt><dd class="mono">' + esc(pr.source) + '</dd>' +
          '<dt>registered</dt><dd class="mono">' + esc(dt(pr.registered)) + '</dd>' +
          (pr.valid_until ? '<dt>valid_until</dt><dd class="mono" style="color:var(--rose)">' + esc(dt(pr.valid_until)) + ' \u2014 warning only, no auto-retraction</dd>' : '') +
          '<dt>identity</dt><dd class="mono">' + esc(pr.digest) + '</dd>' +
          (pr.derivation ? '<dt>derivation</dt><dd class="mono">' + esc(pr.derivation.rule) + ' \u2190 ' + esc(pr.derivation.cites.join(', ')) + '</dd>' : '') +
          '<dt>state</dt><dd>' + (withdrawn ? '<span class="chip warn">withdrawn</span>' : '<span class="chip live">admitted \u00b7 unwithdrawn</span>') + '</dd>' +
          '<dt>apex</dt><dd class="mono">cone ' + cone.events.length + ' events \u00b7 ' + cone.weights.length + ' weights</dd>' +
        '</dl>' +
        '<div><h2 style="font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--ink-3);margin:0 0 6px">Learned events that cite it</h2>' +
          '<ul class="mono" style="margin:0;padding-left:16px;font-size:11px;color:var(--ink-2)">' + effectRows + '</ul></div>' +
        '<div class="cone"><div class="h">If withdrawn, these fall exactly</div>' +
          '<ul>' +
            (cone.events.length ? cone.events.map(function (e) { return '<li>' + esc(e) + ' \u00b7 ' + esc(E.weights.get(E.events.get(e).weight).name) + '</li>'; }).join('')
              : '<li>no learned event cites this premise</li>') +
            (cone.weights.length ? cone.weights.filter(function (w) { return !cone.events.some(function (e) { return E.events.get(e).weight === w; }); })
              .map(function (w) { return '<li>' + esc(E.weights.get(w).name) + ' \u00b7 support withdrawn</li>'; }).join('') : '') +
          '</ul></div>' +
        '<div><label class="hint" for="pnote" style="display:block;margin-bottom:5px">Note on this premise</label>' +
          '<textarea id="pnote" data-note="premise" data-id="' + esc(pid) + '" placeholder="Why it stands, what would make you withdraw it.">' + esc(note.text || '') + '</textarea></div>' +
      '</div>' +
      '<div class="mfoot">' +
        (withdrawn
          ? '<button class="btn" data-act="restore" data-id="' + esc(pid) + '">Restore (prototype only)</button>'
          : '<button class="btn danger" data-act="withdraw-confirm" data-id="' + esc(pid) + '">Withdraw this premise</button>') +
        '<button class="btn" data-act="modal-close">Close</button>' +
      '</div>'
    );
  }

  function withdrawConfirmModal(pid) {
    var pr = E.premises.get(pid);
    var cone = coneOf(pid);
    var already = cache.wd.has(pid);
    if (already) { premiseModal(pid); return; }
    var d = E.diff(new Set(state.withdrawn.concat([pid])));
    openModal(
      '<div class="mh"><div><div class="crumb">retraction \u00b7 cone first</div>' +
        '<h3 style="font-family:var(--mono)">' + esc(pid) + '</h3>' +
        '<div style="color:var(--ink-2);font-size:13px">' + esc(pr.label) + '</div></div>' +
        '<button class="btn ghost x" data-act="modal-close" aria-label="Close">\u2715</button></div>' +
      '<div class="mbody">' +
        '<p style="margin:0;color:var(--ink-2);font-size:13px">Withdrawing an identity cannot be undone in Wide: healing is re-registration. The cone below is exact \u2014 these records lose standing, nothing else does.</p>' +
        '<div class="cone"><div class="h">Cone of ' + esc(pid.slice(0, 12)) + '</div>' +
          '<ul>' +
            (cone.events.length ? cone.events.map(function (e) {
              var ev = E.events.get(e);
              return '<li>' + esc(e) + ' \u00b7 ' + esc(ev.rule) + ' \u00b7 ' + esc(E.weights.get(ev.weight).name) + '</li>';
            }).join('') : '') +
            (cone.weights.filter(function (w) {
              return !cone.events.some(function (e) { return E.events.get(e).weight === w; });
            }).map(function (w) { return '<li>' + esc(E.weights.get(w).name) + ' \u00b7 support withdrawn</li>'; }).join('')) +
          '</ul>' +
          '<div style="margin-top:8px;font-family:var(--mono);font-size:11px;color:var(--ink-2)">falls ' + cone.events.length + ' events \u00b7 ' + cone.weights.length + ' weights</div>' +
        '</div>' +
        '<div class="stats" style="margin:0">' +
          stat('weights recompute', String(d.summary.weightsAffected), 'value or standing moves') +
          stat('downstream', String(d.summary.downstream), 'derived views re-derive') +
          stat('historical', String(d.summary.weightsHistorical), 'support no longer live') +
        '</div>' +
      '</div>' +
      '<div class="mfoot">' +
        '<button class="btn" data-act="modal-close">Cancel</button>' +
        '<button class="btn danger" data-act="withdraw-confirm" data-id="' + esc(pid) + '">Withdraw ' + esc(pid) + '</button>' +
      '</div>'
    );
  }

  function saveModal() {
    var n = state.explorations.length + 1;
    var cur = state.activeId ? state.explorations.filter(function (e) { return e.id === state.activeId; })[0] : null;
    openModal(
      '<div class="mh"><div><h3>Save this exploration</h3>' +
        '<p style="margin:4px 0 0;color:var(--ink-3);font-size:12.5px">Stores the withdrawn set, the selected weight and a note. Your per-weight and per-premise notes are always kept.</p></div>' +
        '<button class="btn ghost x" data-act="modal-close" aria-label="Close">\u2715</button></div>' +
      '<div class="mbody">' +
        '<label class="hint" for="expname">Name</label>' +
        '<input class="ctl" id="expname" style="width:100%" value="' + esc(cur ? cur.name : 'exploration ' + n) + '" placeholder="e.g. learn-1 retracted, layer 7">' +
        '<label class="hint" for="expnote">Note</label>' +
        '<textarea id="expnote" placeholder="What this exploration shows, and what you would try next.">' + esc(cur ? cur.note || '' : '') + '</textarea>' +
        '<div class="hint">' + (state.withdrawn.length ? state.withdrawn.length + ' premise(s) withdrawn: ' + esc(state.withdrawn.join(', ')) : 'nothing withdrawn') +
          ' \u00b7 selected ' + esc(E.weights.get(state.selected).name) + '</div>' +
      '</div>' +
      '<div class="mfoot">' +
        '<button class="btn" data-act="modal-close">Cancel</button>' +
        '<button class="btn primary" data-act="save-confirm">Save exploration</button>' +
      '</div>'
    );
  }

  /* -------------------------------------------------------------- drawer */
  function renderDrawer() {
    var list = state.explorations.slice().sort(function (a, b) { return b.updated.localeCompare(a.updated); });
    var body = '<div class="dh"><h3>Saved explorations</h3>' +
      '<span class="chip quiet">' + list.length + '</span>' +
      '<span class="spacer" style="flex:1"></span>' +
      '<button class="btn ghost" data-act="drawer-close" aria-label="Close">\u2715</button></div>' +
      '<div class="db">' +
      (list.length ? list.map(function (x) {
        return '<div class="expl">' +
          '<div class="nm">' + esc(x.name) + '</div>' +
          '<div class="meta">' + esc(dt(x.updated)) + ' \u00b7 ' + (x.withdrawn.length ? x.withdrawn.length + ' withdrawn' : 'nothing withdrawn') +
            ' \u00b7 ' + esc(x.selectedName || x.selected) + '</div>' +
          (x.withdrawn.length ? '<div class="meta" style="color:var(--rose)">' + esc(x.withdrawn.join(', ')) + '</div>' : '') +
          (x.note ? '<div class="note">' + esc(x.note) + '</div>' : '') +
          '<div class="btns"><button class="btn sm primary" data-act="exploration-load" data-id="' + esc(x.id) + '">Open</button>' +
          '<button class="btn sm" data-act="exploration-delete" data-id="' + esc(x.id) + '">Delete</button>' +
          '<button class="btn sm ghost" data-act="exploration-export" data-id="' + esc(x.id) + '">Export</button></div>' +
        '</div>';
      }).join('') : '<p class="hint">Nothing saved yet. Withdraw something, then use <em>Save exploration</em>.</p>') +
      '<div class="panel" style="margin-top:6px"><h2>This browser</h2>' +
        '<p class="hint" style="margin:0">Everything is stored in localStorage under <span style="font-family:var(--mono)">wide.wse.v1</span>. Reloading the page restores the session exactly; clearing site data erases it.</p>' +
        '<div class="btns" style="display:flex;gap:6px;margin-top:10px"><button class="btn sm" data-act="export">Export state</button>' +
        '<button class="btn sm danger" data-act="clear-data">Clear data</button></div>' +
      '</div>' +
      '</div>';
    var existing = $('#drawer');
    if (existing) existing.remove();
    var el = document.createElement('aside');
    el.className = 'drawer';
    el.id = 'drawer';
    el.setAttribute('aria-label', 'Saved explorations');
    el.innerHTML = body;
    document.body.appendChild(el);
  }

  function closeDrawer() {
    var d = $('#drawer');
    if (d) d.remove();
  }

  /* ---------------------------------------------------------- interactions */
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  function withdraw(pid) {
    if (cache.wd.has(pid)) return;
    state.withdrawn.push(pid);
    state.diffWeight = null;
    state.lastAction = pid;
    compute();
    persist();
    renderAll();
    var d = cache.diff;
    toast('Withdrew ' + pid + ' \u00b7 ' + d.summary.eventsRetracted + ' events retracted, ' +
      d.summary.weightsAffected + ' weights recomputed');
    closeModal();
  }

  function restore(pid) {
    state.withdrawn = state.withdrawn.filter(function (p) { return p !== pid; });
    compute();
    persist();
    renderAll();
    toast('Restored ' + pid + ' (prototype only \u2014 Wide has no unwithdraw)');
    closeModal();
  }

  function selectWeight(id) {
    if (!E.weights.has(id)) return;
    state.selected = id;
    state.view = 'graph';
    persist();
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setView(v) {
    state.view = v;
    state.focusPremise = null;
    persist();
    renderAll();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function saveExploration() {
    var nameEl = $('#expname');
    var noteEl = $('#expnote');
    var name = (nameEl && nameEl.value.trim()) || 'exploration ' + (state.explorations.length + 1);
    var note = noteEl ? noteEl.value.trim() : '';
    var existing = state.activeId && state.explorations.filter(function (e) { return e.id === state.activeId; })[0];
    var rec;
    if (existing && existing.name === name) {
      rec = existing;
    } else {
      rec = { id: 'exp-' + Date.now().toString(36), name: name, created: new Date().toISOString() };
      state.explorations.push(rec);
    }
    rec.note = note;
    rec.withdrawn = state.withdrawn.slice();
    rec.selected = state.selected;
    rec.selectedName = E.weights.get(state.selected).name;
    rec.updated = new Date().toISOString();
    state.activeId = rec.id;
    persist();
    closeModal();
    renderChrome();
    toast('Saved \u201c' + name + '\u201d');
  }

  function loadExploration(id) {
    var rec = state.explorations.filter(function (e) { return e.id === id; })[0];
    if (!rec) return;
    state.withdrawn = rec.withdrawn.filter(function (p) { return E.premises.has(p); });
    if (E.weights.has(rec.selected)) state.selected = rec.selected;
    state.activeId = rec.id;
    state.diffWeight = null;
    compute();
    persist();
    closeDrawer();
    renderAll();
    toast('Opened \u201c' + rec.name + '\u201d');
  }

  function deleteExploration(id) {
    state.explorations = state.explorations.filter(function (e) { return e.id !== id; });
    if (state.activeId === id) state.activeId = null;
    persist();
    renderDrawer();
    renderChrome();
    toast('Deleted');
  }

  function copyDiff() {
    var d = cache.diff;
    var lines = ['Wide session ' + E.meta.session + ' \u2014 retraction diff',
      'as of ' + E.meta.clock, 'withdrawn: ' + (state.withdrawn.join(', ') || 'none'), ''];
    d.rows.forEach(function (r) {
      lines.push(r.name + '  depth ' + r.depth + '  norm ' + r.before.norm.toFixed(6) + ' -> ' + r.after.norm.toFixed(6) +
        '  (' + pct(r.pctNorm) + ')  standing ' + (r.before.usable ? 'usable' : 'historical') + ' -> ' + (r.after.usable ? 'usable' : 'historical') +
        '  | ' + r.cause.join('; '));
    });
    lines.push('', 'weights recomputed ' + d.summary.weightsAffected + ', events retracted ' + d.summary.eventsRetracted +
      ', now historical ' + d.summary.weightsHistorical);
    var text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Diff copied'); }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Diff copied'); } catch (e) { toast('Copy failed \u2014 select the table instead'); }
    ta.remove();
  }

  function exportState(one) {
    var payload = one || {
      session: E.meta.session, checkpoint: E.meta.checkpoint, clock: E.meta.clock,
      withdrawn: state.withdrawn, selected: state.selected,
      notes: state.notes, premiseNotes: state.premiseNotes, explorations: state.explorations
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wide-explorations-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    toast('Exported JSON');
  }

  function clearData() {
    openModal('<div class="mh"><div><h3>Clear local data</h3>' +
      '<p style="margin:4px 0 0;color:var(--ink-3);font-size:12.5px">Deletes saved explorations, every note, and the current withdrawn set from this browser. The seed data is unaffected.</p></div>' +
      '<button class="btn ghost x" data-act="modal-close">\u2715</button></div>' +
      '<div class="mfoot"><button class="btn" data-act="modal-close">Cancel</button>' +
      '<button class="btn danger" data-act="clear-confirm">Delete local data</button></div>');
  }

  /* --------------------------------------------------------------- render */
  function renderAll() {
    compute();
    var v = $('#view');
    if (state.view === 'explorer') v.innerHTML = renderExplorer();
    else if (state.view === 'graph') v.innerHTML = renderGraph();
    else if (state.view === 'retraction') v.innerHTML = renderRetraction();
    else v.innerHTML = renderAbout();
    renderChrome();
    var sb = $('#sb-view');
    if (sb) sb.textContent = state.view;
  }

  function bind() {
    document.addEventListener('click', function (ev) {
      var el = ev.target.closest('[data-act]');
      if (!el) return;
      var act = el.dataset.act;
      var id = el.dataset.id;
      if (act === 'nav') { setView(el.dataset.view); return; }
      if (act === 'select-weight') { selectWeight(id); return; }
      if (act === 'premise-detail') { premiseModal(id); return; }
      if (act === 'withdraw-open') { withdrawConfirmModal(id); return; }
      if (act === 'withdraw-confirm') { withdraw(id); return; }
      if (act === 'restore') { restore(id); return; }
      if (act === 'modal-close') { closeModal(); return; }
      if (act === 'drawer-open') { renderDrawer(); return; }
      if (act === 'drawer-close') { closeDrawer(); return; }
      if (act === 'save-open') { saveModal(); return; }
      if (act === 'save-confirm') { saveExploration(); return; }
      if (act === 'exploration-load') { loadExploration(id); return; }
      if (act === 'exploration-delete') { deleteExploration(id); return; }
      if (act === 'exploration-export') {
        var rec = state.explorations.filter(function (e) { return e.id === id; })[0];
        if (rec) exportState(rec);
        return;
      }
      if (act === 'export') { exportState(); return; }
      if (act === 'clear-data') { clearData(); return; }
      if (act === 'clear-confirm') {
        try { localStorage.removeItem(STORE); } catch (e) {}
        state = JSON.parse(JSON.stringify(DEFAULTS));
        compute(); closeModal(); closeDrawer(); renderAll();
        toast('Local data cleared');
        return;
      }
      if (act === 'copy-diff') { copyDiff(); return; }
      if (act === 'clear-filters') {
        state.filters = Object.assign({}, DEFAULTS.filters);
        persist(); renderAll(); return;
      }
      if (act === 'reset-withdrawals') {
        state.withdrawn = []; state.diffWeight = null;
        compute(); persist(); renderAll(); toast('All premises restored'); return;
      }
      if (act === 'undo') {
        var last = state.withdrawn[state.withdrawn.length - 1];
        if (last) { restore(last); }
        return;
      }
    });

    document.addEventListener('change', function (ev) {
      var el = ev.target.closest('[data-filter]');
      if (!el) return;
      state.filters[el.dataset.filter] = el.value;
      persist();
      renderAll();
    });

    var pqTimer = null;
    document.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.id === 'q') {
        state.filters.q = t.value;
        clearTimeout(pqTimer);
        pqTimer = setTimeout(function () {
          var pos = t.selectionStart;
          renderAll();
          var ni = $('#q');
          if (ni) { ni.focus(); try { ni.setSelectionRange(pos, pos); } catch (e) {} }
        }, 160);
        persist();
        return;
      }
      if (t.hasAttribute && t.hasAttribute('data-pfilter')) {
        state.premiseFilter = t.value;
        renderAll();
        var np = $('#pq');
        if (np) { np.focus(); }
        return;
      }
      if (t.hasAttribute && t.hasAttribute('data-note')) {
        var kind = t.dataset.note;
        var id = t.dataset.id;
        var bucket = kind === 'weight' ? state.notes : state.premiseNotes;
        bucket[id] = { text: t.value, updated: new Date().toISOString() };
        persist();
        var lbl = $('#note-saved');
        if (lbl) lbl.textContent = 'saving\u2026';
        clearTimeout(t._noteTimer);
        t._noteTimer = setTimeout(function () {
          var l2 = $('#note-saved');
          if (l2) l2.textContent = 'saved ' + new Date().toLocaleTimeString();
        }, 500);
      }
    });

    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (ev.key === 'Escape') {
        if ($('#scrim')) { closeModal(); return; }
        if ($('#drawer')) { closeDrawer(); return; }
      }
      if (typing) return;
      if (ev.key === '/') {
        ev.preventDefault();
        if (state.view !== 'explorer') setView('explorer');
        var q = $('#q'); if (q) q.focus();
        return;
      }
      if (ev.key === 'e') setView('explorer');
      if (ev.key === 'g') setView('graph');
      if (ev.key === 'r') setView('retraction');
      if (ev.key === 'a') setView('about');
      if (ev.key === 'Enter' || ev.key === ' ') {
        var node = ev.target.closest && ev.target.closest('.node[data-act]');
        if (node) { ev.preventDefault(); node.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
      }
    });

    document.addEventListener('click', function (ev) {
      if (ev.target.id === 'scrim') closeModal();
    });
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
    load();
    compute();
    bind();
    renderAll();
    var tag = $('#boot-note');
    if (tag) tag.textContent = E.premises.size + ' premises \u00b7 ' + E.weights.size + ' weights \u00b7 ' + E.eventOrder.length + ' events';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
