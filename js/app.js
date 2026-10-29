/*
 * 실험 테이블 화면
 *
 * 상태(state)를 고치면 update()를 불러 회로를 다시 계산하고 화면 전체를 다시 그린다.
 * 끌기는 SVG 루트가 포인터를 잡아서 처리하므로 다시 그려도 끌기가 끊기지 않는다.
 * 차시(탭)마다 실험 테이블을 따로 둔다.
 */
(function () {
  'use strict';

  var P = window.LabParts;
  var C = window.LabCircuit;
  var LESSONS = window.LabLessons;
  var TYPES = P.TYPES;

  var WIRE_COLORS = ['#d2382d', '#26292c', '#e2b21c', '#2f6fd0', '#2e9a58'];
  var SNAP = 34;          // 집게를 놓았을 때 단자에 물리는 거리 (테이블 좌표)
  var JOIN_SNAP = 46;     // 전지 끼우개끼리 붙는 거리
  var DRAG_START = 6;     // 이만큼(px) 움직여야 끌기로 본다
  var BASE_WIDTH = 1000;  // 화면 폭이 이만큼일 때 1배로 그린다
  var CLIP_ROOM = 36;     // 테이블 가장자리와 부품 사이에 집게가 들어갈 여유
  var RING_REACH = 95;    // 전자석 끝과 둥근 철 고리 더미 사이가 이보다 가까우면 고리가 붙는다
  var COMPASS_REACH = 170;
  var EARTH = 1.5e-5;     // 나침반을 북쪽(화면 위)으로 돌리는 지구 자기장의 세기 (전자석과 같은 단위)
  var LOADS = ['bulb', 'motor', 'buzzer', 'magnet'];

  var FIRST_HINTS = {
    battery: '전지는 전지 끼우개 위로 끌어다 놓으면 끼워져요.',
    holder: '전지를 전지 끼우개 위로 끌어다 놓으면 끼워져요. 전지 끼우개끼리 끝을 맞대면 서로 붙어요.',
    bulb: '전구는 전구 끼우개 위로 끌어다 놓으면 끼워져요.',
    socket: '전구를 전구 끼우개 위로 끌어다 놓으면 끼워져요.',
    switch: '스위치를 누르면 닫히고, 한 번 더 누르면 열려요.',
    wire: '집게를 끌어서 금속 부분에 물려 보세요.',
    rodPlastic: '막대의 양쪽 끝에 집게를 물려 보세요.',
    rodRubber: '막대의 양쪽 끝에 집게를 물려 보세요.',
    rodMetal: '막대의 양쪽 끝에 집게를 물려 보세요.',
    motor: '전동기의 양쪽 단자에 집게를 물려 보세요.',
    buzzer: '버저의 빨간색 전선은 (+)극 쪽에, 검은색 전선은 (−)극 쪽에 연결해요.',
    magnet: '전자석 양쪽의 에나멜선 끝에 집게를 물려 보세요.',
    rings: '전자석의 끝부분을 둥근 철 고리에 가까이 가져가 보세요.',
    compass: '나침반을 전자석의 끝부분 가까이에 놓아 보세요.'
  };

  var lessonById = {};
  LESSONS.forEach(function (l) { lessonById[l.id] = l; });

  var state = {
    lessonId: LESSONS[0].id,
    tables: {},       // 차시 id → { parts, wires }
    parts: [],
    wires: [],
    seq: 0,
    wireColor: 0,
    selected: null,   // { kind: 'part', id } | { kind: 'wire', id } | { kind: 'clip', wireId, end } | { kind: 'term', partId, term }
    actionsOpen: false, // 선택한 것을 눌렀을 때만 단추 줄을 보여 준다 (끌고 난 뒤에는 숨긴다)
    showFlow: false,
    sound: true,
    steps: {},        // '활동 id:관찰 id' → true
    memo: {}          // 활동 id → 활동이 기억할 것
  };
  var view = { W: BASE_WIDTH, H: 620 };
  var result = C.solve([], []);
  var fx = { attached: [], ringsLeft: {}, needles: {}, strong: {}, magnets: [] };
  var drag = null;
  var nearTerm = null;
  var hintsShown = {};
  var toastTimer = null;
  var justDone = null;
  var rotorAngle = {};
  var animId = null;
  var animLast = null;
  var audio = null;

  function $(id) { return document.getElementById(id); }
  var svg = $('table');
  var stage = $('stage');
  var layers = {
    parts: $('layerParts'),
    glow: $('layerGlow'),
    fx: $('layerFx'),
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
  var lessonTabs = $('lessonTabs');
  var lessonTitle = $('lessonTitle');
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
  function lesson() { return lessonById[state.lessonId]; }
  // 받침이 있으면 ‘을’, 없으면 ‘를’ (전자석을, 전구를)
  function objectParticle(word) {
    var code = word.charCodeAt(word.length - 1) - 0xac00;
    return word + (code >= 0 && code < 11172 && code % 28 ? '을' : '를');
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
  function partsOf(type) { return state.parts.filter(function (p) { return p.type === type; }); }
  // 볼트로 만든 전자석은 볼트를 꺼낸 것으로 센다
  function onTableCount(type) {
    if (type === 'wire') return state.wires.length;
    if (type === 'bolt') return state.parts.filter(function (p) { return p.fromBolt; }).length;
    if (type === 'magnet') return state.parts.filter(function (p) { return p.type === 'magnet' && !p.fromBolt; }).length;
    return partsOf(type).length;
  }
  // 에나멜선 양쪽 끝부분의 코팅을 사포로 다 벗겼는지 (따로 만들지 않은 전자석은 벗긴 것으로 본다)
  function sanded(p) { return !p.sand || (p.sand[0] >= 1 && p.sand[1] >= 1); }

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

  // 붙어 있는 전지 끼우개는 한 덩어리로 움직인다
  function chainOf(p) {
    if (!p || p.type !== 'holder') return p ? [p] : [];
    var head = p, guard = 0;
    while (head.joinPrev && findPart(head.joinPrev) && guard++ < 20) head = findPart(head.joinPrev);
    var list = [], cur = head;
    guard = 0;
    while (cur && guard++ < 20) {
      list.push(cur);
      cur = cur.joinNext ? findPart(cur.joinNext) : null;
    }
    return list;
  }

  // 덩어리 전체가 테이블 안에 머물도록 이동량을 줄여서 옮긴다
  function moveGroup(group, dx, dy) {
    var lo = { x: -Infinity, y: -Infinity }, hi = { x: Infinity, y: Infinity };
    group.forEach(function (m) {
      var e = extents(m);
      var mx = Math.min(e.x + CLIP_ROOM, view.W / 2), my = Math.min(e.y + CLIP_ROOM, view.H / 2);
      lo.x = Math.max(lo.x, mx - m.x); hi.x = Math.min(hi.x, view.W - mx - m.x);
      lo.y = Math.max(lo.y, my - m.y); hi.y = Math.min(hi.y, view.H - my - m.y);
    });
    if (lo.x <= hi.x) dx = clamp(dx, lo.x, hi.x);
    if (lo.y <= hi.y) dy = clamp(dy, lo.y, hi.y);
    group.forEach(function (m) { m.x += dx; m.y += dy; });
  }
  function keepOnTable(p) { moveGroup(chainOf(p), 0, 0); }

  // 끼우개에 끼운 전지·전구는 끼우개가 대신 그리고, 따로 단자를 내놓지 않는다
  function isTucked(p) {
    return (p.type === 'battery' && p.holderId) || (p.type === 'bulb' && p.socketId);
  }
  function termHidden(p, term) {
    return p.type === 'holder' && ((term === 'a' && p.joinPrev) || (term === 'b' && p.joinNext));
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
        if (!termHidden(p, term)) list.push({ part: p, term: term, pos: termPos(p, term) });
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

  function wiredTerms(partId) {
    var seen = {};
    state.wires.forEach(function (w) {
      w.ends.forEach(function (e) {
        if (e.attach && e.attach.partId === partId) seen[e.attach.term] = true;
      });
    });
    return seen;
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
      var bits = k.split(':');
      var p = findPart(bits[0]);
      if (!p) return;
      var base = TYPES[p.type].terms[bits[1]].out + p.rot + 180;
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

  /* ---------- 회로 결과 읽기 ---------- */

  // 부품에 걸린 전압으로 전지 몇 개에 해당하는지 판단한다 (전지 1개 ≈ 1.4 V, 2개 ≈ 2.8 V)
  function cellLevel(v) {
    v = Math.abs(v);
    if (v >= 2.4 && v < 3.4) return 'two';
    if (v >= 1.0 && v < 2.0) return 'one';
    return null;
  }

  function litBulbs(r) {
    return partsOf('bulb').filter(function (p) { return r.bulbs[p.id] && r.bulbs[p.id].lit; });
  }
  function motorSpeed(id) {
    var m = result.motors[id];
    return m ? m.voltage / 1.5 * 1.1 : 0;  // 초당 회전수. 전지 1개일 때 약 1바퀴
  }
  function buzzerLoudness(id) {
    var b = result.buzzers[id];
    return b && b.on ? clamp(b.voltage / 3, 0.2, 1.3) : 0;
  }

  // 에나멜선을 많이 감을수록 전자석이 세진다. 100번 감은 전자석을 1로 보고, 50번이면 절반, 200번이면 두 배
  function coilFactor(m) {
    return clamp((m.turns === undefined ? 100 : m.turns) / 100, 0.5, 2);
  }

  // 전자석, 둥근 철 고리, 나침반
  function computeFx() {
    var out = { attached: [], ringsLeft: {}, needles: {}, strong: {}, magnets: [] };
    var piles = partsOf('rings');
    piles.forEach(function (r) { out.ringsLeft[r.id] = P.RING_TOTAL; });
    var poles = [];

    partsOf('magnet').forEach(function (m) {
      var I = result.magnets[m.id] ? result.magnets[m.id].current : 0;
      var on = Math.abs(I) > 0.05;
      var strength = I * coilFactor(m);
      var ends = P.MAGNET_ENDS.map(function (e) {
        var q = rotate(e.x, e.y, m.rot);
        return { x: m.x + q.x, y: m.y + q.y };
      });
      var dirs = [rotate(-1, 0, m.rot), rotate(1, 0, m.rot)];
      var info = { part: m, current: I, on: on, nearRings: false, level: on ? cellLevel(I * C.constants.R_MAGNET) : null };
      ends.forEach(function (e, k) {
        var pile = null, best = RING_REACH;
        piles.forEach(function (r) {
          var d = dist(e, r);
          if (d < best) { pile = r; best = d; }
        });
        if (!pile) return;
        info.nearRings = true;
        if (!on) return;
        var n = Math.min(Math.min(8, Math.round(Math.abs(strength) * 4.4)), out.ringsLeft[pile.id]);
        out.ringsLeft[pile.id] -= n;
        out.attached.push({ pos: e, dir: dirs[k], count: n });
      });
      if (on) {
        // 전류가 a → b로 흐르면 [1] 쪽 끝이 N극
        poles.push({ pos: ends[1], q: strength });
        poles.push({ pos: ends[0], q: -strength });
      }
      info.ends = ends;
      out.magnets.push(info);
    });

    partsOf('compass').forEach(function (c) {
      var bx = 0, by = 0;
      poles.forEach(function (pl) {
        var dx = c.x - pl.pos.x, dy = c.y - pl.pos.y;
        var r2 = Math.max(dx * dx + dy * dy, 400);
        var k = pl.q / (r2 * Math.sqrt(r2));
        bx += k * dx; by += k * dy;
      });
      out.needles[c.id] = Math.atan2(by - EARTH, bx) * 180 / Math.PI;
      out.strong[c.id] = Math.hypot(bx, by) > 2 * EARTH;
    });
    return out;
  }

  // lessons.js의 활동이 쓰는 도우미
  var ctx = {
    madeMagnet: function () {
      return partsOf('magnet').some(function (p) { return p.fromBolt && sanded(p); });
    },
    litWithSwitch: function () {
      return litBulbs(result).length > 0 && partsOf('switch').some(function (s) {
        return s.closed && result.switches[s.id].current > 0.02;
      });
    },
    testedRods: function () {
      var litCount = function (r) { return litBulbs(r).length; };
      return state.parts.filter(function (p) {
        if (!/^rod/.test(p.type)) return false;
        var w = wiredTerms(p.id);
        if (!w.a || !w.b) return false;
        var as = function (type) {
          return C.solve(state.parts.map(function (q) { return q === p ? Object.assign({}, q, { type: type }) : q; }), state.wires);
        };
        // 막대가 전기를 통할 때와 통하지 않을 때 불이 켜진 전구 수가 다르면 막대를 시험해 본 것이다
        return litCount(as('rodMetal')) > litCount(as('rodPlastic'));
      }).map(function (p) { return p.type; });
    },
    levels: function (kind) {
      var seen = [];
      partsOf(kind).forEach(function (p) {
        var v = 0;
        if (kind === 'bulb' && result.bulbs[p.id].lit) v = result.bulbs[p.id].voltage;
        if (kind === 'motor' && Math.abs(result.motors[p.id].voltage) > 0.3) v = result.motors[p.id].voltage;
        if (kind === 'buzzer' && result.buzzers[p.id].on) v = result.buzzers[p.id].voltage;
        var lv = cellLevel(v);
        if (lv && seen.indexOf(lv) < 0) seen.push(lv);
      });
      return seen;
    },
    magnetRings: function () {
      var seen = [];
      fx.magnets.forEach(function (m) {
        if (!m.nearRings) return;
        var w = wiredTerms(m.part.id);
        // 코팅을 벗기지 않아 전기가 흐를 수 없는 전자석은 ‘스위치를 닫기 전’으로 치지 않는다
        if (!m.on && w.a && w.b && sanded(m.part)) seen.push('off');
        if (m.on && m.level) seen.push(m.level);
      });
      return seen;
    },
    compassSides: function (memo) {
      var seen = [];
      fx.magnets.forEach(function (m) {
        if (!m.on) return;
        var near = partsOf('compass').some(function (c) {
          return fx.strong[c.id] && m.ends.some(function (e) { return dist(e, c) < COMPASS_REACH; });
        });
        if (!near) return;
        var sign = m.current > 0 ? 1 : -1;
        if (!memo.first) memo.first = sign;
        var id = sign === memo.first ? 'fwd' : 'rev';
        if (seen.indexOf(id) < 0) seen.push(id);
      });
      return seen;
    }
  };

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
      state.wires.push({
        id: nextId('wire'),
        color: WIRE_COLORS[state.wireColor % WIRE_COLORS.length],
        ends: [
          { x: spot.x - 70, y: spot.y, attach: null },
          { x: spot.x + 70, y: spot.y, attach: null }
        ]
      });
      state.wireColor += 1;
      state.selected = null;
    } else {
      var s = findSpot(TYPES[type].radius);
      var p = { id: nextId(type), type: type, x: s.x, y: s.y, rot: 0 };
      if (type === 'battery') { p.holderId = null; p.flipped = false; }
      if (type === 'holder') { p.batteryId = null; p.joinPrev = null; p.joinNext = null; }
      if (type === 'bulb') p.socketId = null;
      if (type === 'socket') p.bulbId = null;
      if (type === 'switch') p.closed = false;
      if (type === 'bolt') { p.fromBolt = true; p.paper = false; p.tape = false; p.turns = 0; p.cut = false; p.sand = [0, 0]; }
      state.parts.push(p);
      keepOnTable(p);
      state.selected = { kind: 'part', id: p.id };
      state.actionsOpen = false;
    }
    if (FIRST_HINTS[type] && !hintsShown[type]) {
      hintsShown[type] = true;
      toast(FIRST_HINTS[type]);
    }
    update();
    // 볼트를 꺼내면 바로 작업대에서 전자석을 만든다
    if (type === 'bolt') openBench(p);
  }

  /* ---------- 전자석 만들기 작업대 ---------- */

  function openBench(p) {
    state.selected = { kind: 'part', id: p.id };
    state.actionsOpen = false;
    hideToast();
    update();
    window.LabBench.open(p, { onChange: update, onClose: finishBench });
  }

  // 작업대를 닫으면 다 감고 자른 볼트는 전자석이 되고, 다시 감으려고 푼 전자석은 볼트로 돌아간다
  function finishBench(p) {
    if (findPart(p.id) !== p) return;
    var ready = window.LabBench.ready(p);
    if (ready && p.type === 'bolt') {
      p.type = 'magnet';
      keepOnTable(p);
      toast('전자석을 테이블에 놓았어요. 양쪽 에나멜선 끝에 집게를 물려 보세요.');
    } else if (!ready && p.type === 'magnet') {
      detachAt(p.id);
      p.type = 'bolt';
      keepOnTable(p);
      toast('에나멜선을 다시 감아야 해요. 볼트를 누르고 ‘전자석 만들기’를 눌러요.');
    } else if (!ready) {
      toast('볼트를 누르고 ‘전자석 만들기’를 누르면 이어서 만들 수 있어요.');
    }
    update();
    var el = svg.querySelector('[data-key="part:' + p.id + '"]');
    if (el) el.focus({ preventScroll: true });
  }

  function bringToTop(group) {
    state.parts = state.parts.filter(function (q) { return group.indexOf(q) < 0; }).concat(group);
  }

  // 집게를 떼어 낸다. 떨어진 집게는 단자 바로 바깥에 놓인다.
  function detachWhere(test) {
    state.wires.forEach(function (w) {
      w.ends.forEach(function (e) {
        if (!e.attach || !test(e.attach)) return;
        var p = findPart(e.attach.partId);
        var pos = p ? termPos(p, e.attach.term) : { x: e.x, y: e.y };
        var out = p ? (TYPES[p.type].terms[e.attach.term].out + p.rot) * Math.PI / 180 : 0;
        e.x = clamp(pos.x + Math.cos(out) * 22, 10, view.W - 10);
        e.y = clamp(pos.y + Math.sin(out) * 22, 10, view.H - 10);
        e.attach = null;
      });
    });
  }
  function detachAt(partId) { detachWhere(function (a) { return a.partId === partId; }); }
  function detachTerm(partId, term) { detachWhere(function (a) { return a.partId === partId && a.term === term; }); }

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
    bringToTop(chainOf(box));
    toast(item.type === 'battery'
      ? (item.flipped ? '전지를 거꾸로 끼웠어요. (+)극 방향을 확인해 보세요.' : '전지를 전지 끼우개에 끼웠어요.')
      : '전구를 전구 끼우개에 끼웠어요.');
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
    bringToTop([item]);
    state.selected = { kind: 'part', id: item.id };
  }

  // 끌고 있는 전지 끼우개 덩어리의 끝이 다른 끼우개의 반대쪽 끝에 닿았는지
  function joinTarget(group) {
    var head = group[0], tail = group[group.length - 1];
    if (!head || head.type !== 'holder') return null;
    var best = null;
    state.parts.forEach(function (o) {
      if (o.type !== 'holder' || group.indexOf(o) >= 0 || o.rot !== head.rot) return;
      if (!o.joinNext) {
        var d = dist(termPos(head, 'a'), termPos(o, 'b'));
        if (d < JOIN_SNAP && (!best || d < best.d)) best = { d: d, other: o, after: true };
      }
      if (!o.joinPrev) {
        var d2 = dist(termPos(tail, 'b'), termPos(o, 'a'));
        if (d2 < JOIN_SNAP && (!best || d2 < best.d)) best = { d: d2, other: o, after: false };
      }
    });
    return best;
  }

  function join(group, t) {
    var u = rotate(P.JOIN_GAP, 0, t.other.rot);
    var head = group[0], tail = group[group.length - 1];
    var dx, dy;
    if (t.after) {
      // 다른 끼우개의 (+)쪽 끝에 이 덩어리의 (−)쪽 끝을 붙인다
      dx = t.other.x + u.x - head.x; dy = t.other.y + u.y - head.y;
      group.forEach(function (m) { m.x += dx; m.y += dy; });
      detachTerm(t.other.id, 'b'); detachTerm(head.id, 'a');
      t.other.joinNext = head.id; head.joinPrev = t.other.id;
    } else {
      dx = t.other.x - u.x - tail.x; dy = t.other.y - u.y - tail.y;
      group.forEach(function (m) { m.x += dx; m.y += dy; });
      detachTerm(tail.id, 'b'); detachTerm(t.other.id, 'a');
      tail.joinNext = t.other.id; t.other.joinPrev = tail.id;
    }
    var all = chainOf(head);
    moveGroup(all, 0, 0);
    bringToTop(all);
    toast('전지 끼우개를 이어 붙였어요.');
  }

  function unjoin(p) {
    var prev = p.joinPrev ? findPart(p.joinPrev) : null;
    var next = p.joinNext ? findPart(p.joinNext) : null;
    if (prev) prev.joinNext = null;
    if (next) next.joinPrev = null;
    p.joinPrev = null; p.joinNext = null;
    var off = rotate(0, 74, p.rot);
    p.x += off.x; p.y += off.y;
    keepOnTable(p);
  }

  function rotateGroup(group, center) {
    group.forEach(function (m) {
      var q = rotate(m.x - center.x, m.y - center.y, 90);
      m.x = center.x + q.x; m.y = center.y + q.y;
      m.rot = norm(m.rot + 90);
    });
    moveGroup(group, 0, 0);
  }

  function removePart(p) {
    if (p.type === 'holder') {
      var prev = p.joinPrev ? findPart(p.joinPrev) : null;
      var next = p.joinNext ? findPart(p.joinNext) : null;
      if (prev) prev.joinNext = null;
      if (next) next.joinPrev = null;
    }
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
      state.actionsOpen = true;
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
      state.actionsOpen = true;
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
    if (drag.kind === 'part') {
      var p = findPart(drag.partId);
      moveGroup(drag.group, pt.x + drag.dx - p.x, pt.y + drag.dy - p.y);
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
    state.actionsOpen = false;
    if (drag.kind === 'part' || drag.kind === 'term') {
      drag.kind = 'part';
      var p = findPart(drag.partId);
      drag.group = chainOf(p);
      bringToTop(drag.group);
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
        var jt = p && p.type === 'holder' ? joinTarget(d.group) : null;
        if (box) {
          insert(p, box);
          state.selected = { kind: 'part', id: box.id };
        } else if (jt) {
          join(d.group, jt);
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
        moveGroup(chainOf(part), moves[e.key][0], moves[e.key][1]);
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
      if (p.type === 'bolt') list.push(['bench', '전자석 만들기']);
      if (p.type === 'magnet' && p.fromBolt) list.push(['bench', '작업대 열기']);
      if (p.type === 'switch') list.push(['toggle', p.closed ? '스위치 열기' : '스위치 닫기']);
      if (p.type !== 'rings' && p.type !== 'compass') list.push(['rotate', '돌리기']);
      if (p.type === 'holder' && p.batteryId) {
        list.push(['flip', '전지 방향 바꾸기']);
        list.push(['eject', '전지 빼기']);
      }
      if (p.type === 'holder' && (p.joinPrev || p.joinNext)) list.push(['unjoin', '끼우개 떼기']);
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
      if (act === 'rotate' && p.type !== 'rings' && p.type !== 'compass') rotateGroup(chainOf(p), { x: p.x, y: p.y });
      if (act === 'toggle' && p.type === 'switch') p.closed = !p.closed;
      if (act === 'flip' && p.batteryId) {
        var bat = findPart(p.batteryId);
        bat.flipped = !bat.flipped;
        toast(bat.flipped ? '전지를 거꾸로 끼웠어요.' : '전지를 바르게 끼웠어요.');
      }
      if (act === 'eject') eject(p);
      if (act === 'unjoin') unjoin(p);
      if (act === 'bench' && p.fromBolt) { openBench(p); return; }
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
    if (p.type === 'holder') return name + (p.batteryId ? ', 전지 끼움' : ', 비어 있음') + (p.joinPrev || p.joinNext ? ', 다른 끼우개와 붙어 있음' : '');
    if (p.type === 'socket') {
      if (!p.bulbId) return name + ', 비어 있음';
      return name + ', 전구 끼움, ' + (result.bulbs[p.bulbId].lit ? '불 켜짐' : '불 꺼짐');
    }
    if (p.type === 'bulb') return name + ', ' + (result.bulbs[p.id].lit ? '불 켜짐' : '불 꺼짐');
    if (p.type === 'switch') return name + ', ' + (p.closed ? '닫힘' : '열림');
    if (p.type === 'motor') return name + ', ' + (Math.abs(motorSpeed(p.id)) > 0.05 ? '도는 중' : '멈춤');
    if (p.type === 'buzzer') return name + ', ' + (result.buzzers[p.id].on ? '울리는 중' : '조용함');
    if (p.type === 'magnet') {
      if (!sanded(p)) return name + ', 에나멜선 끝의 코팅을 다 벗기지 않음';
      return name + ', ' + (Math.abs(result.magnets[p.id].current) > 0.05 ? '전기가 흐름' : '전기가 흐르지 않음');
    }
    if (p.type === 'bolt') return name + ', ' + (p.turns > 0 ? '에나멜선 ' + Math.floor(p.turns) + '번 감음' : p.paper ? '종이를 감음' : '아무것도 감지 않음');
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
    var joinBox = dragged && dragged.type === 'holder' ? joinTarget(drag.group) : null;
    var selPart = sel && sel.kind === 'part' ? findPart(sel.id) : null;
    var selGroup = selPart ? chainOf(selPart) : [];

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
      if (p.type === 'motor') {
        opts.id = p.id;
        opts.angle = rotorAngle[p.id] || 0;
        opts.fast = Math.abs(motorSpeed(p.id)) > 1.6;
      }
      if (p.type === 'buzzer') opts.loudness = buzzerLoudness(p.id);
      if (p.fromBolt) {
        opts.paper = p.paper; opts.tape = p.tape; opts.turns = p.turns; opts.cut = p.cut;
        opts.sand = p.sand;
      }
      if (p.type === 'rings') opts.count = fx.ringsLeft[p.id];
      if (p.type === 'compass') opts.needle = (fx.needles[p.id] === undefined ? -90 : fx.needles[p.id]) - p.rot;

      var cls = 'part';
      if (selPart === p) cls += ' is-selected';
      else if (selGroup.indexOf(p) >= 0) cls += ' is-grouped';
      if (p === dropBox || (joinBox && p === joinBox.other) || (selPart && canInsert(selPart, p))) cls += ' is-target';
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
    partsOf('bulb').forEach(function (p) {
      var b = brightnessOf(p.id);
      if (!b) return;
      var host = p.socketId ? findPart(p.socketId) : p;
      var local = p.socketId
        ? { x: P.SOCKET_SLOT.x + P.GLOBE.x, y: P.SOCKET_SLOT.y + P.GLOBE.y }
        : P.GLOBE;
      var q = rotate(local.x, local.y, host.rot);
      var s = Math.sqrt(Math.min(b, 4));
      // 전지 1개와 2개의 밝기 차이가 눈에 띄도록 크기와 진하기를 함께 바꾼다
      out += '<circle cx="' + fmt(host.x + q.x) + '" cy="' + fmt(host.y + q.y) + '" r="' + fmt(18 + 40 * s) +
        '" fill="url(#gGlow)" opacity="' + Math.min(1, 0.05 + 0.85 * s).toFixed(2) + '"/>';
    });
    layers.glow.innerHTML = out;
  }

  // 전자석 끝에 붙은 둥근 철 고리
  function renderFx() {
    var out = '';
    fx.attached.forEach(function (a) {
      var perp = { x: -a.dir.y, y: a.dir.x };
      for (var j = 0; j < a.count; j++) {
        var along = 4 + j * 7;
        var side = (j % 2 ? 1 : -1) * (3 + (j % 3));
        out += P.ring(fmt(a.pos.x + a.dir.x * along + perp.x * side), fmt(a.pos.y + a.dir.y * along + perp.y * side + j * 1.5));
      }
    });
    layers.fx.innerHTML = out;
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

  function buildTools() {
    toolList.innerHTML = lesson().tools.map(function (type) {
      return '<li><button type="button" class="tool" data-type="' + type + '">' +
        '<span class="tool-art">' + P.icon(type) + '</span>' +
        '<span class="tool-text"><span class="tool-name">' + TYPES[type].name + '</span><span class="tool-count"></span></span>' +
        '</button></li>';
    }).join('');
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
    var bulbs = partsOf('bulb');
    var lit = litBulbs(result);
    var spinning = partsOf('motor').filter(function (p) { return Math.abs(motorSpeed(p.id)) > 0.05; });
    var ringing = partsOf('buzzer').filter(function (p) { return result.buzzers[p.id].on; });
    var reversedBuzzer = partsOf('buzzer').some(function (p) { return result.buzzers[p.id].voltage < -0.5; });
    var magnets = partsOf('magnet').filter(function (p) { return Math.abs(result.magnets[p.id].current) > 0.05; });
    var loads = state.parts.filter(function (p) { return LOADS.indexOf(p.type) >= 0; });
    // 코팅만 벗기면 전기가 흐를 전자석
    var unsanded = partsOf('magnet').filter(function (p) {
      if (sanded(p)) return false;
      var r = C.solve(state.parts.map(function (q) { return q === p ? Object.assign({}, q, { sand: null }) : q; }), state.wires);
      return Math.abs(r.magnets[p.id].current) > 0.05;
    });
    var pieces = [];
    if (lit.length) pieces.push(lit.length === bulbs.length ? '전구 ' + lit.length + '개에 불이 켜졌어요' : '전구 ' + bulbs.length + '개 중 ' + lit.length + '개에 불이 켜졌어요');
    if (spinning.length) pieces.push('전동기가 돌아요');
    if (ringing.length) pieces.push('버저가 울려요');
    if (magnets.length) pieces.push('전자석에 전기가 흘러요');

    if (!state.parts.length && !state.wires.length) {
      text = '테이블이 비어 있어요.';
    } else if (result.shorted) {
      tone = 'danger';
      text = '합선! 전지의 (+)극과 (−)극이 전선으로만 바로 이어졌어요. 실제로는 전지와 전선이 뜨거워져 위험해요.';
    } else if (pieces.length) {
      tone = 'lit';
      text = pieces.join(' · ') + '.';
    } else if (unsanded.length) {
      text = '전자석에 전기가 흐르지 않아요. 에나멜선 끝의 코팅된 부분을 사포로 다 벗겼는지 확인해 보세요.';
    } else if (reversedBuzzer) {
      text = '버저가 울리지 않아요. 버저의 빨간색·검은색 전선이 어느 극 쪽에 이어졌는지 확인해 보세요.';
    } else if (!loads.length && partsOf('bolt').length) {
      text = '볼트를 누르고 ‘전자석 만들기’를 눌러 전자석을 마저 만들어 보세요.';
    } else if (!loads.length) {
      var names = lesson().tools.filter(function (t) { return LOADS.indexOf(t) >= 0; }).map(function (t) { return TYPES[t].name; });
      if (!names.length) text = '둥근 머리 볼트를 테이블에 올려 전자석을 만들어 보세요.';
      else text = names.length > 1 ? names.join(', ') + ' 중 하나를 테이블에 올려 보세요.' : objectParticle(names[0]) + ' 테이블에 올려 보세요.';
    } else {
      text = '아직 전기가 흐르지 않아요. 전지의 (+)극부터 (−)극까지 끊어진 곳은 없는지 살펴보세요.';
    }
    if (statusEl.textContent !== text) statusEl.textContent = text;
    statusEl.setAttribute('data-tone', tone);
    emptyHint.hidden = state.parts.length > 0 || state.wires.length > 0;
  }

  function renderActionbar() {
    var acts = !state.actionsOpen || (drag && drag.moved) ? [] : actionsFor(state.selected);
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

  function renderLessonTabs() {
    lessonTabs.innerHTML = LESSONS.map(function (l) {
      var on = l.id === state.lessonId;
      return '<button type="button" role="tab" class="lesson-tab" id="tab-' + l.id + '" data-lesson="' + l.id + '"' +
        ' aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' + l.tab + '</button>';
    }).join('');
  }

  function missionDone(m) {
    return m.steps.every(function (s) { return state.steps[m.id + ':' + s.id]; });
  }

  function renderMissions() {
    var l = lesson();
    lessonTitle.textContent = l.pages ? l.title + ' (교과서 ' + l.pages + ')' : l.title;
    if (!l.missions.length) {
      missionList.innerHTML = '<li class="mission-note">' + l.note + '</li>';
      progressEl.textContent = '';
      $('resetMissions').hidden = true;
      return;
    }
    $('resetMissions').hidden = false;
    var count = 0;
    missionList.innerHTML = l.missions.map(function (m, i) {
      var done = missionDone(m);
      if (done) count += 1;
      var steps = m.steps.length > 1 || !done ? '<ul class="steps" aria-label="관찰한 것">' + m.steps.map(function (s) {
        var seen = state.steps[m.id + ':' + s.id];
        return '<li class="step' + (seen ? ' is-seen' : '') + '">' + s.label + '<span class="visually-hidden">' + (seen ? ', 관찰함' : ', 아직') + '</span></li>';
      }).join('') + '</ul>' : '';
      return '<li class="mission' + (done ? ' is-done' : '') + (justDone === m.id ? ' just-done' : '') + '">' +
        '<span class="mission-num" aria-hidden="true">' + (done ? '✓' : i + 1) + '</span>' +
        '<div class="mission-body">' +
        '<h3>' + m.title + '</h3>' +
        '<p>' + m.body + '</p>' +
        (m.tip ? '<p class="tip"><b>도우미</b> ' + m.tip + '</p>' : '') +
        steps +
        '<p class="think"><b>생각해 보기</b> ' + m.think + '</p>' +
        '<span class="mission-state">' + (done ? '성공' : '도전 중') + '</span>' +
        '</div></li>';
    }).join('');
    progressEl.textContent = count + ' / ' + l.missions.length;
    justDone = null;
  }

  function checkMissions() {
    var changed = false;
    lesson().missions.forEach(function (m, i) {
      if (missionDone(m)) return;
      var memo = state.memo[m.id] = state.memo[m.id] || {};
      var seen = m.observe(ctx, memo) || [];
      var fresh = seen.filter(function (id) { return !state.steps[m.id + ':' + id]; });
      if (!fresh.length) return;
      fresh.forEach(function (id) { state.steps[m.id + ':' + id] = true; });
      changed = true;
      if (missionDone(m)) {
        justDone = m.id;
        toast('성공! ' + m.title.replace(/^실험 \d+ /, ''), { tone: 'ok', duration: 3200 });
      } else {
        var labels = m.steps.filter(function (s) { return fresh.indexOf(s.id) >= 0; }).map(function (s) { return s.label; });
        toast('관찰했어요: ' + labels.join(', '), { tone: 'ok' });
      }
    });
    return changed;
  }

  /* ---------- 소리와 움직임 ---------- */

  // 버저 소리. 소리는 누르기나 끌기처럼 사용자가 무언가를 한 뒤에만 시작한다.
  function setBuzz(loud) {
    if (!state.sound) loud = 0;
    if (loud > 0 && !audio) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        var ac = new AC();
        var osc = ac.createOscillator();
        var gain = ac.createGain();
        osc.type = 'square';
        osc.frequency.value = 2100;
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start();
        audio = { ctx: ac, gain: gain };
      } catch (err) {
        return;
      }
    }
    if (!audio) return;
    if (loud > 0 && audio.ctx.state === 'suspended' && audio.ctx.resume) {
      audio.ctx.resume().catch(function () { /* 다음 누르기 때 다시 시도한다 */ });
    }
    audio.gain.gain.setTargetAtTime(loud > 0 ? 0.06 * loud * loud : 0, audio.ctx.currentTime, 0.015);
  }

  function animate(t) {
    var dt = animLast === null ? 0 : Math.min(0.1, (t - animLast) / 1000);
    animLast = t;
    var any = false;
    partsOf('motor').forEach(function (p) {
      var sp = motorSpeed(p.id);
      if (Math.abs(sp) < 0.05) return;
      any = true;
      rotorAngle[p.id] = ((rotorAngle[p.id] || 0) + sp * 360 * dt) % 360;
      var el = layers.parts.querySelector('[data-rotor="' + p.id + '"]');
      if (el) el.setAttribute('transform', 'rotate(' + rotorAngle[p.id].toFixed(1) + ')');
    });
    if (any) {
      animId = requestAnimationFrame(animate);
    } else {
      animId = null;
      animLast = null;
    }
  }

  function update() {
    var focusedKey = document.activeElement && document.activeElement.getAttribute
      ? document.activeElement.getAttribute('data-key') : null;

    result = C.solve(state.parts, state.wires);
    fx = computeFx();
    var angles = clipAngles();
    renderParts();
    renderGlow();
    renderFx();
    renderTerms();
    renderWires(angles);
    renderTools();
    renderStatus();
    if (checkMissions()) renderMissions();
    renderActionbar();

    var loud = 0;
    partsOf('buzzer').forEach(function (p) { loud = Math.max(loud, buzzerLoudness(p.id)); });
    setBuzz(document.hidden ? 0 : loud);
    if (!animId && partsOf('motor').some(function (p) { return Math.abs(motorSpeed(p.id)) >= 0.05; })) {
      animId = requestAnimationFrame(animate);
    }

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

  /* ---------- 차시 바꾸기 ---------- */

  function switchLesson(id, fromHash) {
    if (!lessonById[id] || id === state.lessonId) return;
    state.tables[state.lessonId] = { parts: state.parts, wires: state.wires };
    var t = state.tables[id] || { parts: [], wires: [] };
    state.parts = t.parts;
    state.wires = t.wires;
    state.lessonId = id;
    state.selected = null;
    nearTerm = null;
    hideToast();
    if (!fromHash) {
      try { history.replaceState(null, '', '#' + id); } catch (err) { location.hash = id; }
    }
    renderLessonTabs();
    buildTools();
    renderMissions();
    layout();
  }

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
    state.wires.forEach(function (wire) {
      wire.ends.forEach(function (e) {
        e.x = clamp(e.x, 10, view.W - 10);
        e.y = clamp(e.y, 10, view.H - 10);
      });
    });
    update();
  }

  /* ---------- 시작 ---------- */

  function init() {
    $('defs').innerHTML = P.DEFS;

    var fromHash = location.hash.replace('#', '');
    if (lessonById[fromHash]) state.lessonId = fromHash;
    renderLessonTabs();
    buildTools();

    lessonTabs.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-lesson]');
      if (btn) switchLesson(btn.getAttribute('data-lesson'));
    });
    lessonTabs.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = LESSONS.findIndex(function (l) { return l.id === state.lessonId; });
      var next = LESSONS[(i + (e.key === 'ArrowRight' ? 1 : LESSONS.length - 1)) % LESSONS.length];
      switchLesson(next.id);
      $('tab-' + next.id).focus();
    });
    window.addEventListener('hashchange', function () {
      var id = location.hash.replace('#', '');
      if (lessonById[id]) switchLesson(id, true);
    });

    toolList.addEventListener('click', function (e) {
      var btn = e.target.closest('.tool');
      if (btn && !btn.disabled) addFromToolbox(btn.getAttribute('data-type'));
    });

    $('flowToggle').addEventListener('change', function (e) {
      state.showFlow = e.target.checked;
      update();
    });
    $('soundToggle').addEventListener('change', function (e) {
      state.sound = e.target.checked;
      update();
    });
    document.addEventListener('visibilitychange', function () { update(); });

    $('clearBtn').addEventListener('click', function () {
      if (!state.parts.length && !state.wires.length) return;
      var snapshot = JSON.stringify({ parts: state.parts, wires: state.wires });
      var lessonId = state.lessonId;
      state.parts = [];
      state.wires = [];
      state.selected = null;
      update();
      toast('테이블을 모두 치웠어요.', {
        duration: 6000,
        action: {
          label: '되돌리기',
          run: function () {
            if (state.lessonId !== lessonId) return;
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
      lesson().missions.forEach(function (m) {
        m.steps.forEach(function (s) { delete state.steps[m.id + ':' + s.id]; });
        delete state.memo[m.id];
      });
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
