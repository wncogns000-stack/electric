/*
 * 실험 테이블 화면
 *
 * 상태(state)를 고치면 update()를 불러 회로를 다시 계산하고 화면 전체를 다시 그린다.
 * 끌기는 SVG 루트가 포인터를 잡아서 처리하므로 다시 그려도 끌기가 끊기지 않는다.
 */
(function () {
  'use strict';

  var P = window.LabParts;
  var C = window.LabCircuit;
  var TYPES = P.TYPES;

  var TOOL_ORDER = ['battery', 'holder', 'bulb', 'socket', 'switch', 'wire'];
  var WIRE_COLORS = ['#d2382d', '#26292c', '#e2b21c', '#2f6fd0', '#2e9a58'];
  var SNAP = 34;          // 집게를 놓았을 때 단자에 물리는 거리 (테이블 좌표)
  var DRAG_START = 6;     // 이만큼(px) 움직여야 끌기로 본다
  var BASE_WIDTH = 1000;  // 화면 폭이 이만큼일 때 1배로 그린다
  var CLIP_ROOM = 36;     // 테이블 가장자리와 부품 사이에 집게가 들어갈 여유

  var FIRST_HINTS = {
    battery: '전지는 전지 끼우개 위로 끌어다 놓으면 끼워져요.',
    holder: '전지를 전지 끼우개 위로 끌어다 놓으면 끼워져요.',
    bulb: '꼬마전구는 전구 끼우개 위로 끌어다 놓으면 끼워져요.',
    socket: '꼬마전구를 전구 끼우개 위로 끌어다 놓으면 끼워져요.',
    switch: '스위치를 누르면 켜지고, 한 번 더 누르면 꺼져요.',
    wire: '집게를 끌어서 금속 부분에 물려 보세요.'
  };

  var MISSIONS = [
    {
      id: 'light',
      title: '꼬마전구에 불 켜기',
      body: '전지, 꼬마전구, 집게 달린 전선으로 꼬마전구에 불을 켜 보세요.',
      think: '꼬마전구의 어느 두 곳에 전선을 이어야 불이 켜질까요?',
      check: function (r) { return litBulbs(r).length > 0; }
    },
    {
      id: 'switch',
      title: '스위치로 켜고 끄기',
      body: '전지는 전지 끼우개에, 꼬마전구는 전구 끼우개에 끼우고 스위치를 넣어 회로를 만든 뒤 스위치로 불을 켜 보세요.',
      think: '스위치를 끄면 왜 불이 꺼질까요?',
      check: function (r) {
        return state.parts.some(function (b) { return b.type === 'bulb' && b.socketId && r.bulbs[b.id].lit; }) &&
          state.parts.some(function (s) { return s.type === 'switch' && s.closed && r.switches[s.id].current > 0.02; }) &&
          state.parts.some(function (h) {
            return h.type === 'holder' && h.batteryId && Math.abs(r.batteries[h.batteryId].current) > 0.02;
          });
      }
    },
    {
      id: 'series',
      title: '전구 2개 직렬연결',
      body: '꼬마전구 2개를 한 줄로 이어 불을 켜 보세요.',
      think: '전구 하나를 빼면 나머지 전구는 어떻게 될까요?',
      check: function (r) { return pairShape(r) === 'series'; }
    },
    {
      id: 'parallel',
      title: '전구 2개 병렬연결',
      body: '꼬마전구 2개를 두 갈래로 나누어 이어 불을 켜 보세요.',
      think: '직렬연결과 비교하면 전구의 밝기는 어떤가요? 전구 하나를 빼면 어떻게 될까요?',
      check: function (r) { return pairShape(r) === 'parallel'; }
    },
    {
      id: 'cells',
      title: '더 해 보기: 전지 2개 잇기',
      body: '전지 2개를 한 줄로 이어 꼬마전구 1개에 불을 켜 보세요.',
      think: '전지 1개일 때보다 밝은가요? 전지 하나의 방향을 바꾸면 어떻게 될까요?',
      check: function (r) {
        return litBulbs(r).some(function (b) { return r.bulbs[b.id].brightness > 2.5; });
      }
    }
  ];

  var state = {
    parts: [],
    wires: [],
    seq: 0,
    wireColor: 0,
    selected: null,   // { kind: 'part', id } | { kind: 'wire', id } | { kind: 'clip', wireId, end } | { kind: 'term', partId, term }
    showFlow: false,
    done: {}
  };
  var view = { W: BASE_WIDTH, H: 620 };
  var result = C.solve([], []);
  var drag = null;
  var nearTerm = null;
  var hintsShown = {};
  var toastTimer = null;
  var justDone = null;

  function $(id) { return document.getElementById(id); }
  var svg = $('table');
  var stage = $('stage');
  var layers = {
    parts: $('layerParts'),
    glow: $('layerGlow'),
    terms: $('layerTerms'),
    wires: $('layerWires'),
    clips: $('layerClips')
  };
  var actionbar = $('actionbar');
  var statusEl = $('status');
  var toastEl = $('toast');
  var toastText = $('toastText');
  var toastAction = $('toastAction');
  var emptyHint = $('emptyHint');
  var toolList = $('toolList');
  var missionList = $('missionList');
  var progressEl = $('progress');

  /* ---------- 기본 계산 ---------- */

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function norm(deg) { return ((deg % 360) + 360) % 360; }
  function rotate(x, y, deg) {
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return { x: x * c - y * s, y: x * s + y * c };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function fmt(n) { return Math.round(n * 10) / 10; }

  // 돌린 부품이 차지하는 가로·세로 반폭
  function extents(p) {
    var b = TYPES[p.type].box;
    var ex = 0, ey = 0;
    [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].forEach(function (c) {
      var q = rotate(c[0], c[1], p.rot);
      ex = Math.max(ex, Math.abs(q.x));
      ey = Math.max(ey, Math.abs(q.y));
    });
    return { x: ex, y: ey };
  }
  function keepOnTable(p) {
    var e = extents(p);
    var mx = Math.min(e.x + CLIP_ROOM, view.W / 2), my = Math.min(e.y + CLIP_ROOM, view.H / 2);
    p.x = clamp(p.x, mx, view.W - mx);
    p.y = clamp(p.y, my, view.H - my);
  }

  function nextId(prefix) { state.seq += 1; return prefix + state.seq; }
  function findPart(id) {
    for (var i = 0; i < state.parts.length; i++) if (state.parts[i].id === id) return state.parts[i];
    return null;
  }
  function findWire(id) {
    for (var i = 0; i < state.wires.length; i++) if (state.wires[i].id === id) return state.wires[i];
    return null;
  }
  function onTableCount(type) {
    if (type === 'wire') return state.wires.length;
    return state.parts.filter(function (p) { return p.type === type; }).length;
  }

  // 끼우개에 끼운 전지·전구는 끼우개가 대신 그리고, 따로 단자를 내놓지 않는다
  function isTucked(p) {
    return (p.type === 'battery' && p.holderId) || (p.type === 'bulb' && p.socketId);
  }
  function termPos(p, term) {
    var t = TYPES[p.type].terms[term];
    var q = rotate(t.x, t.y, p.rot);
    return { x: p.x + q.x, y: p.y + q.y };
  }
  function activeTerms() {
    var list = [];
    state.parts.forEach(function (p) {
      if (isTucked(p)) return;
      Object.keys(TYPES[p.type].terms).forEach(function (term) {
        list.push({ part: p, term: term, pos: termPos(p, term) });
      });
    });
    return list;
  }
  function nearestTerm(pos, maxDist, onlyPart) {
    var best = null, bestD = maxDist;
    activeTerms().forEach(function (t) {
      if (onlyPart && t.part !== onlyPart) return;
      var d = dist(pos, t.pos);
      if (d <= bestD) { best = t; bestD = d; }
    });
    return best;
  }

  function endPos(w, i) {
    var e = w.ends[i];
    if (e.attach) {
      var p = findPart(e.attach.partId);
      if (p) return termPos(p, e.attach.term);
    }
    return { x: e.x, y: e.y };
  }

  // 집게 끝이 향하는 방향(도). 단자에 물린 집게는 단자 바깥쪽에서 다가오고, 한 단자에 여럿이면 부채꼴로 벌린다.
  function clipAngles() {
    var angles = {};
    var groups = {};
    state.wires.forEach(function (w) {
      w.ends.forEach(function (e, i) {
        if (!e.attach) return;
        var k = e.attach.partId + ':' + e.attach.term;
        (groups[k] = groups[k] || []).push(w.id + ':' + i);
      });
    });
    Object.keys(groups).forEach(function (k) {
      var parts = k.split(':');
      var p = findPart(parts[0]);
      if (!p) return;
      var base = TYPES[p.type].terms[parts[1]].out + p.rot + 180;
      var list = groups[k];
      list.forEach(function (key, idx) {
        angles[key] = base + (idx - (list.length - 1) / 2) * 30;
      });
    });
    state.wires.forEach(function (w) {
      [0, 1].forEach(function (i) {
        var key = w.id + ':' + i;
        if (angles[key] !== undefined) return;
        var a = endPos(w, i), b = endPos(w, 1 - i);
        angles[key] = dist(a, b) < 1 ? (i === 0 ? 180 : 0) : Math.atan2(a.y - b.y, a.x - b.x) * 180 / Math.PI;
      });
    });
    return angles;
  }

  function wireGeom(w, angles) {
    var ends = [0, 1].map(function (i) {
      var tip = endPos(w, i);
      var a = angles[w.id + ':' + i] * Math.PI / 180;
      var u = { x: Math.cos(a), y: Math.sin(a) };
      return { tip: tip, angle: angles[w.id + ':' + i], u: u, back: { x: tip.x - u.x * P.CLIP_LENGTH, y: tip.y - u.y * P.CLIP_LENGTH } };
    });
    var d = dist(ends[0].back, ends[1].back);
    var k = clamp(d * 0.4, 24, 110);
    var sag = 8 + d * 0.12;
    var c0 = { x: ends[0].back.x - ends[0].u.x * k, y: ends[0].back.y - ends[0].u.y * k + sag };
    var c1 = { x: ends[1].back.x - ends[1].u.x * k, y: ends[1].back.y - ends[1].u.y * k + sag };
    function pt(p) { return fmt(p.x) + ' ' + fmt(p.y); }
    return {
      ends: ends,
      path: 'M' + pt(ends[0].back) + 'C' + pt(c0) + ' ' + pt(c1) + ' ' + pt(ends[1].back),
      reversed: 'M' + pt(ends[1].back) + 'C' + pt(c1) + ' ' + pt(c0) + ' ' + pt(ends[0].back),
      mid: { x: (ends[0].back.x + ends[1].back.x) / 2, y: (ends[0].back.y + ends[1].back.y) / 2 + sag * 0.75 }
    };
  }

  /* ---------- 회로 판단 ---------- */

  function litBulbs(r) {
    return state.parts.filter(function (p) { return p.type === 'bulb' && r.bulbs[p.id] && r.bulbs[p.id].lit; });
  }

  // 불이 켜진 전구가 꼭 2개일 때 두 전구가 직렬인지 병렬인지
  function pairShape(r) {
    var lit = litBulbs(r);
    if (lit.length !== 2 || r.shorted) return null;
    var a = r.bulbNets[lit[0].id], b = r.bulbNets[lit[1].id];
    var shared = a.filter(function (n) { return b.indexOf(n) >= 0; }).length;
    if (shared === 2) return 'parallel';
    if (shared === 1 && Math.abs(r.bulbs[lit[0].id].current - r.bulbs[lit[1].id].current) < 0.01) return 'series';
    return null;
  }

  /* ---------- 부품 다루기 ---------- */

  function findSpot(radius) {
    var stepX = 220, stepY = 135;
    for (var row = 0; row < 10; row++) {
      for (var col = 0; col < 10; col++) {
        var x = 165 + col * stepX, y = 100 + row * stepY;
        if (x > view.W - Math.min(radius + CLIP_ROOM, view.W / 2) || y > view.H - 70) continue;
        var busy = state.parts.some(function (p) {
          return !isTucked(p) && Math.abs(p.x - x) < 160 && Math.abs(p.y - y) < 95;
        }) || state.wires.some(function (w) {
          return [0, 1].some(function (i) { var e = endPos(w, i); return Math.abs(e.x - x) < 110 && Math.abs(e.y - y) < 60; });
        });
        if (!busy) return { x: x, y: y };
      }
    }
    return { x: view.W / 2 + (Math.random() - 0.5) * 120, y: view.H / 2 + (Math.random() - 0.5) * 90 };
  }

  function addFromToolbox(type) {
    if (onTableCount(type) >= TYPES[type].max) return;
    if (type === 'wire') {
      var spot = findSpot(110);
      var w = {
        id: nextId('wire'),
        color: WIRE_COLORS[state.wireColor % WIRE_COLORS.length],
        ends: [
          { x: spot.x - 70, y: spot.y, attach: null },
          { x: spot.x + 70, y: spot.y, attach: null }
        ]
      };
      state.wireColor += 1;
      state.wires.push(w);
      state.selected = null;
    } else {
      var s = findSpot(TYPES[type].radius);
      var p = { id: nextId(type), type: type, x: s.x, y: s.y, rot: 0 };
      if (type === 'battery') { p.holderId = null; p.flipped = false; }
      if (type === 'holder') p.batteryId = null;
      if (type === 'bulb') p.socketId = null;
      if (type === 'socket') p.bulbId = null;
      if (type === 'switch') p.closed = false;
      keepOnTable(p);
      state.parts.push(p);
      state.selected = { kind: 'part', id: p.id };
    }
    if (!hintsShown[type]) {
      hintsShown[type] = true;
      toast(FIRST_HINTS[type]);
    }
    update();
  }

  function bringToTop(p) {
    state.parts = state.parts.filter(function (q) { return q !== p; });
    state.parts.push(p);
  }

  // 부품에서 집게를 떼어 낸다. 떨어진 집게는 단자 바로 바깥에 놓인다.
  function detachAt(partId) {
    var p = findPart(partId);
    state.wires.forEach(function (w) {
      w.ends.forEach(function (e) {
        if (!e.attach || e.attach.partId !== partId) return;
        var pos = p ? termPos(p, e.attach.term) : { x: e.x, y: e.y };
        var out = p ? (TYPES[p.type].terms[e.attach.term].out + p.rot) * Math.PI / 180 : 0;
        e.x = clamp(pos.x + Math.cos(out) * 22, 10, view.W - 10);
        e.y = clamp(pos.y + Math.sin(out) * 22, 10, view.H - 10);
        e.attach = null;
      });
    });
  }

  function canInsert(item, box) {
    if (!item || !box || item === box) return false;
    if (item.type === 'battery' && box.type === 'holder') return !item.holderId && !box.batteryId;
    if (item.type === 'bulb' && box.type === 'socket') return !item.socketId && !box.bulbId;
    return false;
  }

  function insertTarget(item) {
    var best = null, bestD = Infinity;
    state.parts.forEach(function (box) {
      if (!canInsert(item, box)) return;
      var slot = { x: box.x, y: box.y };
      if (box.type === 'socket') {
        var q = rotate(P.SOCKET_SLOT.x, P.SOCKET_SLOT.y, box.rot);
        slot = { x: box.x + q.x, y: box.y + q.y };
      }
      var d = dist(item, slot);
      var limit = box.type === 'holder' ? 70 : 55;
      if (d < limit && d < bestD) { best = box; bestD = d; }
    });
    return best;
  }

  function insert(item, box) {
    detachAt(item.id);
    if (item.type === 'battery') {
      item.flipped = norm(item.rot - box.rot) === 180;
      item.holderId = box.id;
      box.batteryId = item.id;
    } else {
      item.socketId = box.id;
      box.bulbId = item.id;
    }
    item.x = box.x; item.y = box.y; item.rot = box.rot;
    bringToTop(box);
    toast(item.type === 'battery'
      ? (item.flipped ? '전지를 거꾸로 끼웠어요. (+)극 방향을 확인해 보세요.' : '전지를 전지 끼우개에 끼웠어요.')
      : '꼬마전구를 전구 끼우개에 끼웠어요.');
  }

  function eject(box) {
    var item, off;
    if (box.type === 'holder' && box.batteryId) {
      item = findPart(box.batteryId);
      off = rotate(0, 64, box.rot);
      item.rot = norm(box.rot + (item.flipped ? 180 : 0));
      item.flipped = false;
      item.holderId = null;
      box.batteryId = null;
    } else if (box.type === 'socket' && box.bulbId) {
      item = findPart(box.bulbId);
      off = rotate(100, -40, box.rot);
      item.rot = 0;
      item.socketId = null;
      box.bulbId = null;
    } else {
      return;
    }
    item.x = box.x + off.x;
    item.y = box.y + off.y;
    keepOnTable(item);
    bringToTop(item);
    state.selected = { kind: 'part', id: item.id };
  }

  function removePart(p) {
    var ids = [p.id];
    if (p.type === 'holder' && p.batteryId) ids.push(p.batteryId);
    if (p.type === 'socket' && p.bulbId) ids.push(p.bulbId);
    ids.forEach(detachAt);
    state.parts = state.parts.filter(function (q) { return ids.indexOf(q.id) < 0; });
  }

  function attachEnd(w, i, t) {
    w.ends[i].attach = { partId: t.part.id, term: t.term };
  }

  function freeWire() {
    for (var i = state.wires.length - 1; i >= 0; i--) {
      var w = state.wires[i];
      if (!w.ends[0].attach && !w.ends[1].attach) return w;
    }
    return null;
  }

  function termRef(partId, term) {
    var p = findPart(partId);
    return p ? { part: p, term: term, pos: termPos(p, term) } : null;
  }

  /* ---------- 누르기 ---------- */

  function tapTerm(partId, term) {
    var sel = state.selected;
    var t = termRef(partId, term);
    if (!t) return;
    if (sel && sel.kind === 'clip') {
      var w = findWire(sel.wireId);
      if (w) attachEnd(w, sel.end, t);
      state.selected = null;
      hideToast();
      return;
    }
    if (sel && sel.kind === 'term') {
      if (sel.partId === partId && sel.term === term) { state.selected = null; return; }
      var from = termRef(sel.partId, sel.term);
      state.selected = null;
      if (!from) return;
      var fw = freeWire();
      if (!fw) {
        toast(onTableCount('wire') < TYPES.wire.max
          ? '실험 도구에서 ‘집게 달린 전선’을 눌러 테이블에 먼저 올려 주세요.'
          : '남은 집게 달린 전선이 없어요. 쓰지 않는 전선을 치워 보세요.');
        return;
      }
      attachEnd(fw, 0, from);
      attachEnd(fw, 1, t);
      toast('집게 달린 전선으로 이었어요.');
      return;
    }
    state.selected = { kind: 'term', partId: partId, term: term };
    toast('이어 줄 다른 금속 부분을 누르세요.');
  }

  function tap(d) {
    var sel = state.selected;
    if (d.kind === 'bg') {
      state.selected = null;
      return;
    }
    if (d.kind === 'part') {
      var p = findPart(d.partId);
      if (!p) return;
      if (sel && sel.kind === 'part' && canInsert(findPart(sel.id), p)) {
        insert(findPart(sel.id), p);
        state.selected = { kind: 'part', id: p.id };
        return;
      }
      if (sel && (sel.kind === 'clip' || sel.kind === 'term')) {
        var t = nearestTerm(d.pt, Infinity, p);
        if (t) { tapTerm(t.part.id, t.term); return; }
      }
      if (p.type === 'switch') p.closed = !p.closed;
      state.selected = { kind: 'part', id: p.id };
      return;
    }
    if (d.kind === 'term') {
      tapTerm(d.partId, d.term);
      return;
    }
    if (d.kind === 'clip') {
      var w = findWire(d.wireId);
      if (!w) return;
      var e = w.ends[d.end];
      var same = sel && sel.kind === 'clip' && sel.wireId === d.wireId && sel.end === d.end;
      if (same) { state.selected = null; return; }
      if (sel && (sel.kind === 'clip' || sel.kind === 'term') && e.attach) {
        tapTerm(e.attach.partId, e.attach.term);
        return;
      }
      state.selected = { kind: 'clip', wireId: d.wireId, end: d.end };
      toast('집게를 물릴 금속 부분을 누르세요.');
      return;
    }
    if (d.kind === 'wire') {
      state.selected = { kind: 'wire', id: d.wireId };
    }
  }

  /* ---------- 끌기 ---------- */

  function toTable(e) {
    var m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    var pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    var q = pt.matrixTransform(m.inverse());
    return { x: q.x, y: q.y };
  }

  function readTarget(el) {
    if (!el) return { kind: 'bg' };
    return {
      kind: el.getAttribute('data-kind'),
      partId: el.getAttribute('data-part'),
      term: el.getAttribute('data-term'),
      wireId: el.getAttribute('data-wire'),
      end: el.hasAttribute('data-end') ? Number(el.getAttribute('data-end')) : null
    };
  }

  svg.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (drag) return;
    var d = readTarget(e.target.closest('[data-kind]'));
    var pt = toTable(e);
    d.pointerId = e.pointerId;
    d.sx = e.clientX; d.sy = e.clientY;
    d.pt = pt;
    d.moved = false;
    if (d.kind === 'part' || d.kind === 'term') {
      var p = findPart(d.partId);
      if (!p) return;
      d.dx = p.x - pt.x; d.dy = p.y - pt.y;
    } else if (d.kind === 'clip') {
      var w = findWire(d.wireId);
      if (!w) return;
      var pos = endPos(w, d.end);
      d.dx = pos.x - pt.x; d.dy = pos.y - pt.y;
    } else if (d.kind === 'wire') {
      d.last = pt;
    }
    drag = d;
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 포인터를 잡지 못해도 끌기는 동작한다 */ }
  });

  svg.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < DRAG_START) return;
      drag.moved = true;
      beginDrag();
    }
    var pt = toTable(e);
    if (drag.kind === 'part' || drag.kind === 'term') {
      var p = findPart(drag.partId);
      p.x = pt.x + drag.dx;
      p.y = pt.y + drag.dy;
      keepOnTable(p);
    } else if (drag.kind === 'clip') {
      var end = findWire(drag.wireId).ends[drag.end];
      end.x = clamp(pt.x + drag.dx, 10, view.W - 10);
      end.y = clamp(pt.y + drag.dy, 10, view.H - 10);
      nearTerm = nearestTerm(end, SNAP);
    } else if (drag.kind === 'wire') {
      var dx = pt.x - drag.last.x, dy = pt.y - drag.last.y;
      findWire(drag.wireId).ends.forEach(function (en) {
        if (en.attach) return;
        en.x = clamp(en.x + dx, 10, view.W - 10);
        en.y = clamp(en.y + dy, 10, view.H - 10);
      });
      drag.last = pt;
    }
    update();
  });

  function beginDrag() {
    svg.classList.add('dragging');
    if (drag.kind === 'part' || drag.kind === 'term') {
      drag.kind = 'part';
      var p = findPart(drag.partId);
      bringToTop(p);
      state.selected = { kind: 'part', id: p.id };
    } else if (drag.kind === 'clip') {
      var w = findWire(drag.wireId);
      var e = w.ends[drag.end];
      if (e.attach) {
        var pos = endPos(w, drag.end);
        e.x = pos.x; e.y = pos.y;
        e.attach = null;
      }
      state.selected = null;
    } else if (drag.kind === 'wire') {
      state.selected = { kind: 'wire', id: drag.wireId };
    }
  }

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var d = drag;
    drag = null;
    svg.classList.remove('dragging');
    if (cancelled) {
      nearTerm = null;
    } else if (d.moved) {
      if (d.kind === 'part') {
        var p = findPart(d.partId);
        var box = p && insertTarget(p);
        if (box) {
          insert(p, box);
          state.selected = { kind: 'part', id: box.id };
        }
      } else if (d.kind === 'clip') {
        var w = findWire(d.wireId);
        if (w && nearTerm) attachEnd(w, d.end, nearTerm);
        nearTerm = null;
      }
    } else {
      tap(d);
    }
    update();
  }

  svg.addEventListener('pointerup', function (e) { endDrag(e, false); });
  svg.addEventListener('pointercancel', function (e) { endDrag(e, true); });

  /* ---------- 키보드 ---------- */

  svg.addEventListener('keydown', function (e) {
    var el = e.target.closest ? e.target.closest('[data-kind]') : null;
    var sel = state.selected;
    if ((e.key === 'Enter' || e.key === ' ') && el) {
      e.preventDefault();
      var d = readTarget(el);
      if (d.kind === 'part') {
        var p = findPart(d.partId);
        d.pt = p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
      }
      tap(d);
      update();
      return;
    }
    if (e.key === 'Escape') {
      state.selected = null;
      update();
      return;
    }
    if (!sel) return;
    if (sel.kind === 'part') {
      var part = findPart(sel.id);
      var step = e.shiftKey ? 40 : 10;
      var moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) {
        e.preventDefault();
        part.x += moves[e.key][0];
        part.y += moves[e.key][1];
        keepOnTable(part);
        update();
        return;
      }
      if (e.key === 'r' || e.key === 'R') { doAction('rotate'); return; }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      doAction('remove');
    }
  });

  /* ---------- 선택한 것에 대한 단추 ---------- */

  function actionsFor(sel) {
    if (!sel) return [];
    if (sel.kind === 'part') {
      var p = findPart(sel.id);
      if (!p) return [];
      var list = [];
      if (p.type === 'switch') list.push(['toggle', p.closed ? '스위치 끄기' : '스위치 켜기']);
      list.push(['rotate', '돌리기']);
      if (p.type === 'holder' && p.batteryId) {
        list.push(['flip', '전지 방향 바꾸기']);
        list.push(['eject', '전지 빼기']);
      }
      if (p.type === 'socket' && p.bulbId) list.push(['eject', '전구 빼기']);
      list.push(['remove', '치우기']);
      return list;
    }
    if (sel.kind === 'wire') {
      var w = findWire(sel.id);
      if (!w) return [];
      var acts = [];
      if (w.ends[0].attach || w.ends[1].attach) acts.push(['unclip', '집게 모두 빼기']);
      acts.push(['remove', '치우기']);
      return acts;
    }
    return [];
  }

  function doAction(act) {
    var sel = state.selected;
    if (!sel) return;
    if (sel.kind === 'part') {
      var p = findPart(sel.id);
      if (!p) return;
      if (act === 'rotate') { p.rot = norm(p.rot + 90); keepOnTable(p); }
      if (act === 'toggle' && p.type === 'switch') p.closed = !p.closed;
      if (act === 'flip' && p.batteryId) {
        var bat = findPart(p.batteryId);
        bat.flipped = !bat.flipped;
        toast(bat.flipped ? '전지를 거꾸로 끼웠어요.' : '전지를 바르게 끼웠어요.');
      }
      if (act === 'eject') eject(p);
      if (act === 'remove') { removePart(p); state.selected = null; }
    } else if (sel.kind === 'wire') {
      var w = findWire(sel.id);
      if (!w) return;
      if (act === 'unclip') {
        w.ends.forEach(function (e, i) {
          if (!e.attach) return;
          var pos = endPos(w, i);
          e.x = clamp(pos.x + (i === 0 ? -30 : 30), 10, view.W - 10);
          e.y = clamp(pos.y + 30, 10, view.H - 10);
          e.attach = null;
        });
      }
      if (act === 'remove') {
        state.wires = state.wires.filter(function (x) { return x !== w; });
        state.selected = null;
      }
    }
    update();
  }

  actionbar.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (btn) doAction(btn.getAttribute('data-act'));
  });

  /* ---------- 그리기 ---------- */

  function partLabel(p) {
    var name = TYPES[p.type].name;
    if (p.type === 'holder') return name + (p.batteryId ? ', 전지 끼움' : ', 비어 있음');
    if (p.type === 'socket') {
      if (!p.bulbId) return name + ', 비어 있음';
      return name + ', 꼬마전구 끼움, ' + (result.bulbs[p.bulbId].lit ? '불 켜짐' : '불 꺼짐');
    }
    if (p.type === 'bulb') return name + ', ' + (result.bulbs[p.id].lit ? '불 켜짐' : '불 꺼짐');
    if (p.type === 'switch') return name + ', ' + (p.closed ? '켜짐' : '꺼짐');
    return name;
  }

  function brightnessOf(id) {
    var b = result.bulbs[id];
    return b && b.lit ? b.brightness : 0;
  }

  function renderParts() {
    var sel = state.selected;
    var dragged = drag && drag.moved && drag.kind === 'part' ? findPart(drag.partId) : null;
    var dropBox = dragged ? insertTarget(dragged) : null;
    var selPart = sel && sel.kind === 'part' ? findPart(sel.id) : null;

    layers.parts.innerHTML = state.parts.map(function (p) {
      if (isTucked(p)) return '';
      var opts = {};
      if (p.type === 'battery') opts.heat = result.batteries[p.id] && result.batteries[p.id].shorted;
      if (p.type === 'holder' && p.batteryId) {
        var bat = findPart(p.batteryId);
        opts.battery = { flipped: bat.flipped, heat: result.batteries[bat.id] && result.batteries[bat.id].shorted };
      }
      if (p.type === 'bulb') opts.brightness = brightnessOf(p.id);
      if (p.type === 'socket' && p.bulbId) opts.bulb = { brightness: brightnessOf(p.bulbId) };
      if (p.type === 'switch') opts.closed = p.closed;

      var cls = 'part';
      if (selPart === p) cls += ' is-selected';
      if (p === dropBox || (selPart && canInsert(selPart, p))) cls += ' is-target';
      var box = TYPES[p.type].box;
      return '<g class="' + cls + '" data-kind="part" data-part="' + p.id + '" data-key="part:' + p.id + '"' +
        ' tabindex="0" role="button" aria-label="' + partLabel(p) + '"' +
        ' transform="translate(' + fmt(p.x) + ' ' + fmt(p.y) + ') rotate(' + p.rot + ')">' +
        '<rect class="select-box" x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" rx="10"/>' +
        P.draw(p.type, opts) + '</g>';
    }).join('');
  }

  function renderGlow() {
    var out = '';
    state.parts.forEach(function (p) {
      if (p.type !== 'bulb') return;
      var b = brightnessOf(p.id);
      if (!b) return;
      var host = p.socketId ? findPart(p.socketId) : p;
      var local = p.socketId
        ? { x: P.SOCKET_SLOT.x + P.GLOBE.x, y: P.SOCKET_SLOT.y + P.GLOBE.y }
        : P.GLOBE;
      var q = rotate(local.x, local.y, host.rot);
      var s = Math.sqrt(Math.min(b, 4));
      // 직렬(약 0.25배)과 병렬(약 1배)의 밝기 차이가 눈에 띄도록 크기와 진하기를 함께 바꾼다
      out += '<circle cx="' + fmt(host.x + q.x) + '" cy="' + fmt(host.y + q.y) + '" r="' + fmt(18 + 40 * s) +
        '" fill="url(#gGlow)" opacity="' + Math.min(1, 0.05 + 0.85 * s).toFixed(2) + '"/>';
    });
    layers.glow.innerHTML = out;
  }

  function renderTerms() {
    var sel = state.selected;
    var armed = (sel && (sel.kind === 'clip' || sel.kind === 'term')) || (drag && drag.moved && drag.kind === 'clip');
    layers.terms.innerHTML = activeTerms().map(function (t) {
      var isSel = sel && sel.kind === 'term' && sel.partId === t.part.id && sel.term === t.term;
      var isNear = nearTerm && nearTerm.part === t.part && nearTerm.term === t.term;
      var ring = 'term-ring' + (isSel ? ' is-selected' : isNear ? ' is-near' : armed ? ' is-armed' : '');
      var key = 'term:' + t.part.id + ':' + t.term;
      return '<circle class="term" data-kind="term" data-part="' + t.part.id + '" data-term="' + t.term + '" data-key="' + key + '"' +
        ' tabindex="0" role="button" aria-label="' + TYPES[t.part.type].terms[t.term].label + '"' +
        ' cx="' + fmt(t.pos.x) + '" cy="' + fmt(t.pos.y) + '" r="16"/>' +
        '<circle class="' + ring + '" cx="' + fmt(t.pos.x) + '" cy="' + fmt(t.pos.y) + '" r="11"/>';
    }).join('');
  }

  function renderWires(angles) {
    var sel = state.selected;
    var wiresOut = '';
    var clipsOut = '';
    state.wires.forEach(function (w) {
      var g = wireGeom(w, angles);
      var info = result.wires[w.id] || { current: 0, from: 0 };
      var selected = sel && sel.kind === 'wire' && sel.id === w.id;
      var flow = '';
      if (state.showFlow && info.current > 0.005) {
        var dur = clamp(0.12 / info.current, 0.25, 3).toFixed(2);
        flow = '<path class="flow" d="' + (info.from === 0 ? g.path : g.reversed) + '" style="--flow-dur:' + dur + 's"/>';
      }
      var hot = info.current > C.constants.SHORT_CURRENT ? '<path class="wire-hot" d="' + g.path + '" stroke-width="11" opacity=".55"/>' : '';
      wiresOut += '<g class="wire' + (selected ? ' is-selected' : '') + '" data-kind="wire" data-wire="' + w.id + '">' +
        '<path class="wire-select" d="' + g.path + '" stroke-width="14"/>' +
        '<path d="' + g.path + '" fill="none" stroke="#000000" stroke-opacity=".25" stroke-width="7" transform="translate(2 3)"/>' +
        hot +
        '<path d="' + g.path + '" fill="none" stroke="' + w.color + '" stroke-width="6" stroke-linecap="round"/>' +
        '<path d="' + g.path + '" fill="none" stroke="#ffffff" stroke-opacity=".3" stroke-width="1.6" transform="translate(-.8 -1.6)"/>' +
        flow +
        '<path class="wire-hit" d="' + g.path + '" stroke-width="18"/>' +
        '</g>';

      g.ends.forEach(function (end, i) {
        var isSel = sel && sel.kind === 'clip' && sel.wireId === w.id && sel.end === i;
        var where = w.ends[i].attach ? '물려 있음' : '비어 있음';
        clipsOut += '<g class="clip' + (isSel ? ' is-selected' : '') + '" data-kind="clip" data-wire="' + w.id + '" data-end="' + i + '"' +
          ' data-key="clip:' + w.id + ':' + i + '" tabindex="0" role="button" aria-label="집게 달린 전선의 집게, ' + where + '"' +
          ' transform="translate(' + fmt(end.tip.x) + ' ' + fmt(end.tip.y) + ') rotate(' + fmt(end.angle) + ')">' +
          '<circle class="clip-hit" cx="-24" cy="0" r="15"/>' +
          '<circle class="clip-ring" cx="-18" cy="0" r="19"/>' +
          P.clip(w.color) + '</g>';
      });
    });
    layers.wires.innerHTML = wiresOut;
    layers.clips.innerHTML = clipsOut;
  }

  function renderTools() {
    toolList.querySelectorAll('.tool').forEach(function (btn) {
      var type = btn.getAttribute('data-type');
      var left = TYPES[type].max - onTableCount(type);
      btn.disabled = left <= 0;
      btn.setAttribute('aria-label', TYPES[type].name + ' 테이블에 올리기, 남은 개수 ' + left + '개');
      btn.querySelector('.tool-count').textContent = left > 0 ? '남은 개수 ' + left : '모두 꺼냈어요';
    });
  }

  function renderStatus() {
    var tone = 'idle', text;
    var bulbs = state.parts.filter(function (p) { return p.type === 'bulb'; });
    var lit = litBulbs(result);
    if (!state.parts.length && !state.wires.length) {
      text = '테이블이 비어 있어요.';
    } else if (result.shorted) {
      tone = 'danger';
      text = '합선! 전구를 거치지 않고 전지의 두 극이 바로 이어졌어요. 실제로는 전지와 전선이 뜨거워져 위험해요.';
    } else if (lit.length) {
      tone = 'lit';
      text = lit.length === bulbs.length
        ? '꼬마전구 ' + lit.length + '개에 불이 켜졌어요.'
        : '꼬마전구 ' + bulbs.length + '개 중 ' + lit.length + '개에 불이 켜졌어요.';
    } else if (!bulbs.length) {
      text = '꼬마전구를 테이블에 올려 보세요.';
    } else {
      text = '아직 불이 켜지지 않았어요. 전기가 흐르는 길이 끊긴 곳은 없는지 살펴보세요.';
    }
    if (statusEl.textContent !== text) statusEl.textContent = text;
    statusEl.setAttribute('data-tone', tone);
    emptyHint.hidden = state.parts.length > 0 || state.wires.length > 0;
  }

  function renderActionbar() {
    var acts = drag && drag.moved ? [] : actionsFor(state.selected);
    if (!acts.length) {
      actionbar.hidden = true;
      actionbar.removeAttribute('data-sig');
      return;
    }
    var sig = acts.map(function (a) { return a.join('='); }).join('|');
    if (actionbar.getAttribute('data-sig') !== sig) {
      actionbar.innerHTML = acts.map(function (a) {
        return '<button type="button" data-act="' + a[0] + '">' + a[1] + '</button>';
      }).join('');
      actionbar.setAttribute('data-sig', sig);
    }
    actionbar.hidden = false;

    var top, bottom, cx;
    var sel = state.selected;
    if (sel.kind === 'part') {
      var p = findPart(sel.id);
      var b = TYPES[p.type].box;
      var ys = [], xs = [];
      [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].forEach(function (c) {
        var q = rotate(c[0], c[1], p.rot);
        xs.push(p.x + q.x); ys.push(p.y + q.y);
      });
      cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
      top = Math.min.apply(null, ys);
      bottom = Math.max.apply(null, ys);
    } else {
      var g = wireGeom(findWire(sel.id), clipAngles());
      cx = g.mid.x; top = g.mid.y - 14; bottom = g.mid.y + 14;
    }
    var m = svg.getScreenCTM();
    var sr = stage.getBoundingClientRect();
    if (!m) return;
    function screen(x, y) {
      var pt = svg.createSVGPoint();
      pt.x = x; pt.y = y;
      var q = pt.matrixTransform(m);
      return { x: q.x - sr.left, y: q.y - sr.top };
    }
    var a = screen(cx, top), z = screen(cx, bottom);
    var bw = actionbar.offsetWidth, bh = actionbar.offsetHeight;
    var left = clamp(a.x - bw / 2, 8, Math.max(8, sr.width - bw - 8));
    var y = a.y - bh - 10;
    if (y < 8) y = Math.min(z.y + 10, sr.height - bh - 8);
    actionbar.style.left = left + 'px';
    actionbar.style.top = y + 'px';
  }

  function renderMissions() {
    var count = 0;
    missionList.innerHTML = MISSIONS.map(function (m, i) {
      var done = !!state.done[m.id];
      if (done) count += 1;
      return '<li class="mission' + (done ? ' is-done' : '') + (justDone === m.id ? ' just-done' : '') + '">' +
        '<span class="mission-num" aria-hidden="true">' + (done ? '✓' : i + 1) + '</span>' +
        '<h3>' + m.title + '</h3>' +
        '<p>' + m.body + '</p>' +
        '<p class="think"><b>생각해 보기</b> ' + m.think + '</p>' +
        '<span class="mission-state">' + (done ? '성공' : '도전 중') + '</span>' +
        '</li>';
    }).join('');
    progressEl.textContent = count + ' / ' + MISSIONS.length;
    justDone = null;
  }

  function checkMissions() {
    var changed = false;
    MISSIONS.forEach(function (m, i) {
      if (state.done[m.id]) return;
      if (m.check(result)) {
        state.done[m.id] = true;
        changed = true;
        justDone = m.id;
        toast('활동 ' + (i + 1) + ' 성공: ' + m.title, { tone: 'ok', duration: 3200 });
      }
    });
    return changed;
  }

  function update() {
    var focusedKey = document.activeElement && document.activeElement.getAttribute
      ? document.activeElement.getAttribute('data-key') : null;

    result = C.solve(state.parts, state.wires);
    var angles = clipAngles();
    renderParts();
    renderGlow();
    renderTerms();
    renderWires(angles);
    renderTools();
    renderStatus();
    if (checkMissions()) renderMissions();
    renderActionbar();

    if (focusedKey) {
      var el = svg.querySelector('[data-key="' + focusedKey + '"]');
      if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    }
  }

  /* ---------- 알림 ---------- */

  function toast(text, opt) {
    opt = opt || {};
    toastText.textContent = text;
    toastEl.setAttribute('data-tone', opt.tone || '');
    if (opt.action) {
      toastAction.textContent = opt.action.label;
      toastAction.onclick = function () { opt.action.run(); hideToast(); };
      toastAction.hidden = false;
    } else {
      toastAction.hidden = true;
      toastAction.onclick = null;
    }
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opt.duration || 2600);
  }
  function hideToast() { toastEl.hidden = true; }

  /* ---------- 화면 크기 ---------- */

  function layout() {
    var w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    var zoom = clamp(w / BASE_WIDTH, 0.62, 1.2);
    view.W = w / zoom;
    view.H = h / zoom;
    svg.setAttribute('viewBox', '0 0 ' + fmt(view.W) + ' ' + fmt(view.H));
    ['mat', 'matMinor', 'matMajor'].forEach(function (id) {
      $(id).setAttribute('width', fmt(view.W));
      $(id).setAttribute('height', fmt(view.H));
    });
    state.parts.forEach(keepOnTable);
    state.wires.forEach(function (w) {
      w.ends.forEach(function (e) {
        e.x = clamp(e.x, 10, view.W - 10);
        e.y = clamp(e.y, 10, view.H - 10);
      });
    });
    update();
  }

  /* ---------- 시작 ---------- */

  function init() {
    $('defs').innerHTML = P.DEFS;

    toolList.innerHTML = TOOL_ORDER.map(function (type) {
      return '<li><button type="button" class="tool" data-type="' + type + '">' +
        '<span class="tool-art">' + P.icon(type) + '</span>' +
        '<span><span class="tool-name">' + TYPES[type].name + '</span><span class="tool-count"></span></span>' +
        '</button></li>';
    }).join('');
    toolList.addEventListener('click', function (e) {
      var btn = e.target.closest('.tool');
      if (btn && !btn.disabled) addFromToolbox(btn.getAttribute('data-type'));
    });

    $('flowToggle').addEventListener('change', function (e) {
      state.showFlow = e.target.checked;
      update();
    });

    $('clearBtn').addEventListener('click', function () {
      if (!state.parts.length && !state.wires.length) return;
      var snapshot = JSON.stringify({ parts: state.parts, wires: state.wires });
      state.parts = [];
      state.wires = [];
      state.selected = null;
      update();
      toast('테이블을 모두 치웠어요.', {
        duration: 6000,
        action: {
          label: '되돌리기',
          run: function () {
            var s = JSON.parse(snapshot);
            state.parts = s.parts;
            state.wires = s.wires;
            update();
          }
        }
      });
    });

    var dialog = $('helpDialog');
    $('helpBtn').addEventListener('click', function () {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
    $('helpClose').addEventListener('click', function () {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    });

    $('resetMissions').addEventListener('click', function () {
      state.done = {};
      renderMissions();
      update();
    });

    renderMissions();
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(layout).observe(stage);
    } else {
      window.addEventListener('resize', layout);
    }
    layout();
  }

  init();
})();
