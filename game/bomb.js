/*
 * 시한폭탄 처리반: 고장 난 정지 회로 만들기
 *
 * 폭탄마다 전구(정지 램프)에 불이 켜지는 회로를 무작위 배치로 만든 뒤 고장을 넣는다.
 * 고장마다 고치는 방법을 데이터로 남기고, 회로 계산기로 다음을 확인한 회로만 내보낸다.
 *  1) 처음에는 정지 램프가 꺼져 있다
 *  2) 고장을 모두 고치면 켜진다
 *  3) 고장이 하나라도 남아 있으면 꺼져 있다
 *
 * 브라우저에서는 window.LabBomb, Node(테스트)에서는 module.exports 로 쓴다.
 */
(function (root) {
  'use strict';

  var P = root.LabParts || require('../js/parts.js').LabParts;
  var C = root.LabCircuit || require('../js/circuit.js');
  var TYPES = P.TYPES;

  // 폭탄 한 개의 화면 크기. 가로 화면은 wide, 세로 화면은 tall
  var LAYOUTS = {
    wide: { W: 1120, H: 724, board: { x: 40, y: 124, w: 1040, h: 430 }, tray: { x: 40, y: 596, w: 1040, h: 106 }, cols: 3, rows: 3 },
    tall: { W: 720, H: 1150, board: { x: 30, y: 124, w: 660, h: 820 }, tray: { x: 30, y: 988, w: 660, h: 136 }, cols: 2, rows: 5 }
  };

  var WIRE_COLORS = ['#d2382d', '#26292c', '#e2b21c', '#2f6fd0', '#2e9a58', '#ebe7dc'];

  // 집게를 잘못 물리기 쉬운 부도체 자리 (부품 좌표). out: 집게가 다가오는 바깥쪽 방향(도)
  var INSUL = {
    holder: [
      { x: -52, y: -26, out: -90 }, { x: -18, y: -26, out: -90 }, { x: 18, y: -26, out: -90 }, { x: 52, y: -26, out: -90 },
      { x: -52, y: 26, out: 90 }, { x: -18, y: 26, out: 90 }, { x: 18, y: 26, out: 90 }, { x: 52, y: 26, out: 90 }
    ],
    socket: [{ x: -44, y: 32, out: 90 }, { x: -24, y: 32, out: 90 }, { x: 24, y: 32, out: 90 }, { x: 44, y: 32, out: 90 }],
    switch: [
      { x: -56, y: 27, out: 90 }, { x: -26, y: 27, out: 90 }, { x: 26, y: 27, out: 90 }, { x: 56, y: 27, out: 90 },
      { x: -56, y: -27, out: -90 }, { x: 56, y: -27, out: -90 }
    ]
  };

  // 고장 종류. tier: 처음 나오는 단계 (1: 1~3번째 폭탄, 2: 4~7번째, 3: 8번째부터)
  var FAULTS = {
    detach: { tier: 1, label: '빠진 집게' },
    switchOpen: { tier: 1, label: '열린 스위치' },
    noBattery: { tier: 1, label: '빠진 전지' },
    noBulb: { tier: 1, label: '빠진 전구' },
    insulator: { tier: 2, label: '부도체에 물린 집게' },
    sameHolder: { tier: 2, label: '한쪽 극에만 이은 전선' },
    brokenBulb: { tier: 2, label: '끊어진 필라멘트' },
    brokenWire: { tier: 2, label: '끊어진 전선' },
    insulatingRod: { tier: 2, label: '전기가 안 통하는 막대' },
    sameSocket: { tier: 3, label: '전구를 건너뛴 전선' },
    reversedCell: { tier: 3, label: '거꾸로 넣은 전지' },
    shortWire: { tier: 3, label: '합선 전선' }
  };

  // 한 폭탄에 같이 넣지 않는 고장 (같은 부품을 건드리거나 원인이 겹친다)
  var CONFLICTS = [
    ['noBulb', 'brokenBulb'], ['noBattery', 'reversedCell'], ['sameHolder', 'shortWire'],
    ['sameHolder', 'reversedCell'], ['sameSocket', 'shortWire'], ['sameSocket', 'noBulb']
  ];

  // 회로를 바꾸는 고장부터 넣어야 다른 고장이 엉뚱한 전선을 고르지 않는다
  var ORDER = ['reversedCell', 'sameHolder', 'sameSocket', 'brokenWire', 'detach', 'insulator',
    'switchOpen', 'noBattery', 'noBulb', 'brokenBulb', 'insulatingRod', 'shortWire'];

  var CLIP_ROOM = 40;

  /* ---------- 작은 도구 ---------- */

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, list) { return list[Math.floor(r() * list.length)]; }
  function chance(r, p) { return r() < p; }
  function shuffle(r, list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
    return list;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function rotate(x, y, deg) {
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return { x: x * c - y * s, y: x * s + y * c };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clone(s) { return JSON.parse(JSON.stringify(s)); }
  function find(s, id) {
    for (var i = 0; i < s.parts.length; i++) if (s.parts[i].id === id) return s.parts[i];
    return null;
  }
  function findWire(s, id) {
    for (var i = 0; i < s.wires.length; i++) if (s.wires[i].id === id) return s.wires[i];
    return null;
  }

  function termPos(p, term) {
    var t = TYPES[p.type].terms[term];
    var q = rotate(t.x, t.y, p.rot);
    return { x: p.x + q.x, y: p.y + q.y };
  }
  function termOut(p, term) { return TYPES[p.type].terms[term].out + p.rot; }
  function spotPos(p, k) {
    var s = INSUL[p.type][k];
    var q = rotate(s.x, s.y, p.rot);
    return { x: p.x + q.x, y: p.y + q.y };
  }
  function spotOut(p, k) { return INSUL[p.type][k].out + p.rot; }

  function tierOf(n) { return n <= 3 ? 1 : n <= 7 ? 2 : 3; }

  // 제한 시간(초): 처음 60초에서 폭탄마다 4초씩 줄어 20초까지. 고장이 하나 늘 때마다 10초 더
  function timeLimit(n, faultCount) {
    return Math.max(20, 60 - 4 * (n - 1)) + 10 * (faultCount - 1);
  }

  /* ---------- 회로 판정 ---------- */

  // 화면 상태를 회로 계산기가 읽는 모양으로 바꾼다: 끊어진 전구·전선과 부도체에 물린 집게는 전기가 통하지 않는다
  function electrical(s) {
    return {
      parts: s.parts.map(function (p) {
        return p.type === 'bulb' && p.broken ? Object.assign({}, p, { type: 'bulbBroken' }) : p;
      }),
      wires: s.wires.filter(function (w) { return !w.broken; }).map(function (w) {
        return { id: w.id, ends: w.ends.map(function (e) { return { attach: e.attach && e.attach.term ? e.attach : null }; }) };
      })
    };
  }

  function solveState(s) {
    var e = electrical(s);
    return C.solve(e.parts, e.wires);
  }

  // 정지 램프에 불이 켜지고 합선이 없으면 폭탄이 멈춘다
  function defused(s, res) {
    res = res || solveState(s);
    var sock = find(s, s.stopSocketId);
    var bulb = sock && sock.bulbId ? res.bulbs[sock.bulbId] : null;
    return !!(bulb && bulb.lit) && !res.shorted;
  }

  /* ---------- 고장 고치기 (확인과 정답 보기에 쓴다) ---------- */

  var END_FAULTS = { detach: true, insulator: true, sameHolder: true, sameSocket: true };

  function applyFix(s, f) {
    var w, p;
    if (END_FAULTS[f.type]) {
      w = findWire(s, f.wireId);
      if (w) {
        w.ends[f.end].attach = { partId: f.to.partId, term: f.to.term };
        delete w.ends[f.end].angle;
      }
    } else if (f.type === 'switchOpen') {
      find(s, f.partId).closed = true;
    } else if (f.type === 'noBattery') {
      p = find(s, f.holderId);
      s.parts.push({ id: 'fixBattery' + f.holderId, type: 'battery', holderId: p.id, flipped: false, x: p.x, y: p.y, rot: p.rot });
      p.batteryId = 'fixBattery' + f.holderId;
    } else if (f.type === 'noBulb') {
      p = find(s, f.socketId);
      s.parts.push({ id: 'fixBulb' + f.socketId, type: 'bulb', socketId: p.id, broken: 0, x: p.x, y: p.y, rot: p.rot });
      p.bulbId = 'fixBulb' + f.socketId;
    } else if (f.type === 'brokenBulb') {
      find(s, f.bulbId).broken = 0;
    } else if (f.type === 'brokenWire') {
      findWire(s, f.wireId).broken = false;
    } else if (f.type === 'insulatingRod') {
      find(s, f.rodId).type = 'rodMetal';
    } else if (f.type === 'reversedCell') {
      p = find(s, f.batteryId);
      p.flipped = !p.flipped;
    } else if (f.type === 'shortWire') {
      s.wires = s.wires.filter(function (x) { return x.id !== f.wireId; });
    }
    return s;
  }

  // 지금 화면에서 이 고장이 고쳐졌는지 (힌트가 남은 고장을 가리킬 때 쓴다)
  function isFixed(s, f) {
    var w, p;
    if (END_FAULTS[f.type]) {
      w = findWire(s, f.wireId);
      var a = w && w.ends[f.end].attach;
      return !!(a && a.partId === f.to.partId && a.term === f.to.term);
    }
    if (f.type === 'switchOpen') return find(s, f.partId).closed;
    if (f.type === 'noBattery') return !!find(s, f.holderId).batteryId;
    if (f.type === 'noBulb') return !!find(s, f.socketId).bulbId;
    if (f.type === 'brokenBulb') {
      p = find(s, f.socketId);
      return !!(p.bulbId && !find(s, p.bulbId).broken);
    }
    if (f.type === 'brokenWire') {
      w = findWire(s, f.wireId);
      return !w || !w.broken;
    }
    if (f.type === 'insulatingRod') return find(s, f.rodId).type === 'rodMetal';
    if (f.type === 'reversedCell') {
      p = find(s, f.batteryId);
      return !p || p.flipped !== f.faultFlipped;
    }
    if (f.type === 'shortWire') {
      w = findWire(s, f.wireId);
      return !w || !w.ends[0].attach || !w.ends[1].attach;
    }
    return false;
  }

  // 힌트·정답 보기에서 표시할 곳: { partId } 또는 { wireId, end }
  function faultTarget(s, f) {
    if (END_FAULTS[f.type]) return { wireId: f.wireId, end: f.end };
    if (f.type === 'switchOpen') return { partId: f.partId };
    if (f.type === 'noBattery') return { partId: f.holderId };
    if (f.type === 'noBulb' || f.type === 'brokenBulb') return { partId: f.socketId };
    if (f.type === 'brokenWire' || f.type === 'shortWire') return { wireId: f.wireId };
    if (f.type === 'insulatingRod') return { partId: f.rodId };
    if (f.type === 'reversedCell') return { partId: f.holderId };
    return {};
  }

  function explain(f) {
    switch (f.type) {
      case 'detach':
        return '집게 하나가 금속 부분에서 빠져 있었어요. 전지의 (+)극부터 (−)극까지 끊어진 곳 없이 이어야 해요.';
      case 'insulator':
        return (f.material === 'wood' ? '집게가 스위치의 나무판에' : '집게가 플라스틱 부분에') +
          ' 물려 있었어요. 전기가 잘 흐르지 않는 부도체라서, 집게는 금속(도체) 부분에 물려야 해요.';
      case 'sameHolder':
        return '전선 두 개가 전지 끼우개의 한쪽 단자에만 이어져 있었어요. 전지의 (+)극 쪽과 (−)극 쪽에 하나씩 이어야 해요.';
      case 'sameSocket':
        return '전선 두 개가 전구 끼우개의 한쪽 단자에만 이어져 있었어요. 전기가 전구를 거치지 않고 흘러서 합선이 됐어요.';
      case 'switchOpen':
        return '스위치가 열려 있었어요. 스위치를 닫아야 전기가 흘러요.';
      case 'noBattery':
        return '전지 끼우개에 전지가 없었어요. 전지는 전기 회로에 전기 에너지를 공급해요.';
      case 'noBulb':
        return '전구 끼우개에 전구가 없었어요. 정지 램프에 전구를 끼워야 해요.';
      case 'brokenBulb':
        return '전구 속 필라멘트가 끊어져 있었어요. 새 전구로 바꿔야 해요.';
      case 'brokenWire':
        return '전선 한 가닥이 끊어져 있었어요. 새 전선으로 바꿔야 해요.';
      case 'insulatingRod':
        return (f.material === 'rodRubber' ? '고무' : '플라스틱') + ' 막대는 전기가 잘 흐르지 않는 부도체예요. 금속 막대로 바꿔야 해요.';
      case 'reversedCell':
        return '전지 하나의 방향이 맞지 않았어요. 전지 두 개를 직렬연결할 때는 한 전지의 (+)극을 다른 전지의 (−)극에 이어야 해요.';
      case 'shortWire':
        return '전지의 두 극을 바로 잇는 전선이 있었어요. 전기가 전구를 거치지 않고 흘러서 합선이 됐어요.';
    }
    return '';
  }

  /* ---------- 회로 만들기 ---------- */

  // 부품이 차지하는 크기(집게 여유 포함): 가로 화면용 [폭, 높이]
  function footprint(kind) {
    return {
      holder: [266, 64], socket: [210, 134], switch: [242, 64], rod: [220, 32], chain: [450, 64]
    }[kind];
  }

  function build(r, tier, types, L) {
    var s = { parts: [], wires: [], seq: 0 };
    function nextId(prefix) { s.seq += 1; return prefix + s.seq; }
    function has(t) { return types.indexOf(t) >= 0; }

    var cells = has('reversedCell') ? 2 : tier === 1 ? 1 : chance(r, tier === 2 ? 0.3 : 0.5) ? 2 : 1;
    var joined = cells === 2 && !has('reversedCell') ? chance(r, 0.6) : cells === 2 && chance(r, 0.5);
    var nSwitch = (has('switchOpen') ? 1 : 0) + (chance(r, tier === 1 ? 0.5 : 0.45) ? 1 : 0);
    nSwitch = Math.min(nSwitch, tier === 3 ? 2 : 1);
    var nRod = has('insulatingRod') ? 1 : tier >= 2 && chance(r, tier === 2 ? 0.3 : 0.45) ? 1 : 0;

    // 격자 칸에 자리 잡기. shape: one(한 칸), vert(세로 두 칸), wide(가로 두 칸)
    var cw = L.board.w / L.cols, ch = L.board.h / L.rows;
    var used = [];
    for (var i = 0; i < L.cols * L.rows; i++) used.push(false);
    function cellFree(c, rw) { return c >= 0 && rw >= 0 && c < L.cols && rw < L.rows && !used[rw * L.cols + c]; }
    function take(shape) {
      var spots = [];
      for (var rw = 0; rw < L.rows; rw++) {
        for (var c = 0; c < L.cols; c++) {
          if (shape === 'one' && cellFree(c, rw)) spots.push([c, rw]);
          if (shape === 'wide' && cellFree(c, rw) && cellFree(c + 1, rw)) spots.push([c, rw]);
          if (shape === 'vert' && cellFree(c, rw) && cellFree(c, rw + 1)) spots.push([c, rw]);
        }
      }
      if (!spots.length) return null;
      var sp = pick(r, spots);
      var cells2 = shape === 'one' ? [sp] : shape === 'wide' ? [sp, [sp[0] + 1, sp[1]]] : [sp, [sp[0], sp[1] + 1]];
      cells2.forEach(function (k) { used[k[1] * L.cols + k[0]] = true; });
      var x0 = L.board.x + sp[0] * cw, y0 = L.board.y + sp[1] * ch;
      var w = shape === 'wide' ? cw * 2 : cw, h = shape === 'vert' ? ch * 2 : ch;
      return { x: x0, y: y0, w: w, h: h, cx: x0 + w / 2, cy: y0 + h / 2, shape: shape, cells: cells2 };
    }
    function jitter(region, fw, fh) {
      return {
        x: region.cx + (r() - 0.5) * Math.max(0, region.w - fw) * 0.7,
        y: region.cy + (r() - 0.5) * Math.max(0, region.h - fh) * 0.7
      };
    }

    function addHolder(x, y, rot) {
      var h = { id: nextId('holder'), type: 'holder', x: x, y: y, rot: rot, batteryId: null, joinPrev: null, joinNext: null };
      var b = { id: nextId('battery'), type: 'battery', holderId: h.id, flipped: false, x: x, y: y, rot: rot };
      h.batteryId = b.id;
      s.parts.push(h, b);
      return h;
    }

    // 전지: 한 개, 끝끼리 붙인 두 개, 전선으로 이은 두 개
    var nodes = [];
    var meta = { holderIds: [], switchIds: [], rodIds: [], loopWireIds: [], pair: null };
    var region, pos, rot;
    if (cells === 1) {
      var vertical = tier >= 2 && chance(r, 0.3);
      region = take(vertical ? 'vert' : 'one') || take('one');
      if (!region) return null;
      rot = region.shape === 'vert' ? pick(r, [90, 270]) : tier === 1 ? 0 : pick(r, [0, 180]);
      pos = region.shape === 'vert' ? jitter(region, 64, 266) : jitter(region, 266, 64);
      var h1 = addHolder(pos.x, pos.y, rot);
      meta.holderIds.push(h1.id);
      nodes.push({ t: [{ partId: h1.id, term: 'a' }, { partId: h1.id, term: 'b' }], c: pos });
    } else if (joined) {
      region = take('wide');
      if (!region) return null;
      rot = pick(r, [0, 180]);
      pos = jitter(region, 450, 64);
      var u = rotate(P.JOIN_GAP / 2, 0, rot);
      var head = addHolder(pos.x - u.x, pos.y - u.y, rot);
      var tail = addHolder(pos.x + u.x, pos.y + u.y, rot);
      head.joinNext = tail.id; tail.joinPrev = head.id;
      meta.holderIds.push(head.id, tail.id);
      nodes.push({ t: [{ partId: head.id, term: 'a' }, { partId: tail.id, term: 'b' }], c: pos });
    } else {
      region = (chance(r, 0.5) && take('vert')) || take('wide') || take('vert');
      if (!region) return null;
      var c1 = region.shape === 'wide' ? { cx: region.x + region.w / 4, cy: region.cy } : { cx: region.cx, cy: region.y + region.h / 4 };
      var c2 = region.shape === 'wide' ? { cx: region.x + region.w * 3 / 4, cy: region.cy } : { cx: region.cx, cy: region.y + region.h * 3 / 4 };
      var p1 = addHolder(c1.cx + (r() - 0.5) * 20, c1.cy + (r() - 0.5) * 16, 0);
      var p2 = addHolder(c2.cx + (r() - 0.5) * 20, c2.cy + (r() - 0.5) * 16, 0);
      meta.holderIds.push(p1.id, p2.id);
      var inner = { id: nextId('wire'), color: pick(r, WIRE_COLORS), broken: false,
        ends: [{ x: 0, y: 0, attach: { partId: p1.id, term: 'b' } }, { x: 0, y: 0, attach: { partId: p2.id, term: 'a' } }] };
      s.wires.push(inner);
      meta.loopWireIds.push(inner.id);
      meta.pair = { first: p1.id, second: p2.id, innerWireId: inner.id };
      nodes.push({ t: [{ partId: p1.id, term: 'a' }, { partId: p2.id, term: 'b' }], c: { x: region.cx, y: region.cy } });
    }
    meta.outerA = nodes[0].t[0];
    meta.outerB = nodes[0].t[1];

    // 정지 램프(전구 끼우개 + 전구)
    region = take('one');
    if (!region) return null;
    pos = jitter(region, 210, 134);
    var sock = { id: nextId('socket'), type: 'socket', x: pos.x, y: pos.y + 9, rot: 0, bulbId: null };
    var bulb = { id: nextId('bulb'), type: 'bulb', socketId: sock.id, broken: 0, x: sock.x, y: sock.y, rot: 0 };
    sock.bulbId = bulb.id;
    s.parts.push(sock, bulb);
    s.stopSocketId = sock.id;
    nodes.push({ t: [{ partId: sock.id, term: 'a' }, { partId: sock.id, term: 'b' }], c: { x: sock.x, y: sock.y } });

    function addTwoTerm(type, kind, extra) {
      var vertical = tier >= 2 && chance(r, 0.3);
      var reg = take(vertical ? 'vert' : 'one') || take('one');
      if (!reg) return null;
      var f = footprint(kind);
      var rr = reg.shape === 'vert' ? pick(r, [90, 270]) : tier === 1 ? 0 : pick(r, [0, 180]);
      var ps = reg.shape === 'vert' ? jitter(reg, f[1], f[0]) : jitter(reg, f[0], f[1]);
      var part = Object.assign({ id: nextId(kind), type: type, x: ps.x, y: ps.y, rot: rr }, extra || {});
      s.parts.push(part);
      return part;
    }
    for (var k = 0; k < nSwitch; k++) {
      var sw = addTwoTerm('switch', 'switch', { closed: true });
      if (!sw) return null;
      meta.switchIds.push(sw.id);
      nodes.push({ t: [{ partId: sw.id, term: 'a' }, { partId: sw.id, term: 'b' }], c: sw });
    }
    for (k = 0; k < nRod; k++) {
      var rod = addTwoTerm('rodMetal', 'rod');
      if (!rod) return null;
      meta.rodIds.push(rod.id);
      nodes.push({ t: [{ partId: rod.id, term: 'a' }, { partId: rod.id, term: 'b' }], c: rod });
    }

    // 고리 순서: 판 가운데를 중심으로 각도 순. 높은 단계에서는 가끔 순서를 섞어 전선이 꼬이게 한다
    var bcx = L.board.x + L.board.w / 2, bcy = L.board.y + L.board.h / 2;
    nodes.sort(function (a, b) { return Math.atan2(a.c.y - bcy, a.c.x - bcx) - Math.atan2(b.c.y - bcy, b.c.x - bcx); });
    if (tier === 3 && nodes.length >= 4 && chance(r, 0.35)) {
      var i1 = Math.floor(r() * nodes.length), i2 = (i1 + 2) % nodes.length;
      var tmp = nodes[i1]; nodes[i1] = nodes[i2]; nodes[i2] = tmp;
    }

    // 부품마다 어느 단자로 들어오고 나갈지: 전선이 짧고 단자 뒤로 돌아가지 않게 고른다
    function termInfo(t) {
      var p = find(s, t.partId);
      var a = termOut(p, t.term) * Math.PI / 180;
      return { pos: termPos(p, t.term), dir: { x: Math.cos(a), y: Math.sin(a) } };
    }
    function wireCost(a, b) {
      var A = termInfo(a), Bt = termInfo(b);
      var cost = dist(A.pos, Bt.pos);
      if (A.dir.x * (Bt.pos.x - A.pos.x) + A.dir.y * (Bt.pos.y - A.pos.y) < 0) cost += 140;
      if (Bt.dir.x * (A.pos.x - Bt.pos.x) + Bt.dir.y * (A.pos.y - Bt.pos.y) < 0) cost += 140;
      return cost;
    }
    var n = nodes.length;
    var best = null, bestCost = Infinity;
    var messy = tier === 3 && chance(r, 0.4);
    for (var mask = 0; mask < (1 << n); mask++) {
      var cost = 0;
      for (var w = 0; w < n; w++) {
        var from = nodes[w].t[(mask >> w) & 1 ? 0 : 1];
        var to = nodes[(w + 1) % n].t[(mask >> ((w + 1) % n)) & 1 ? 1 : 0];
        cost += wireCost(from, to);
      }
      if (messy) cost = r();
      if (cost < bestCost) { bestCost = cost; best = mask; }
    }
    for (w = 0; w < n; w++) {
      var a2 = nodes[w].t[(best >> w) & 1 ? 0 : 1];
      var b2 = nodes[(w + 1) % n].t[(best >> ((w + 1) % n)) & 1 ? 1 : 0];
      var wire = { id: nextId('wire'), color: pick(r, WIRE_COLORS), broken: false,
        ends: [{ x: 0, y: 0, attach: { partId: a2.partId, term: a2.term } }, { x: 0, y: 0, attach: { partId: b2.partId, term: b2.term } }] };
      s.wires.push(wire);
      meta.loopWireIds.push(wire.id);
    }

    return { s: s, meta: meta, used: used, cw: cw, ch: ch, nextId: nextId };
  }

  /* ---------- 고장 넣기 ---------- */

  function makeCtx(r, tier, built, L) {
    var c = {
      r: r, tier: tier, s: built.s, meta: built.meta, L: L,
      usedEnds: {}, usedWires: {}, usedParts: {},
      useEnd: function (wire, end) { c.usedEnds[wire.id + ':' + end] = true; },
      endFree: function (wire, end) { return !c.usedEnds[wire.id + ':' + end] && !c.usedWires[wire.id]; }
    };
    return c;
  }

  // 고리 전선 가운데 단자에 물린 끝 하나 고르기
  function pickLoopEnd(c, test) {
    var list = [];
    c.meta.loopWireIds.forEach(function (id) {
      var w = findWire(c.s, id);
      if (!w) return;
      w.ends.forEach(function (e, i) {
        if (e.attach && e.attach.term && c.endFree(w, i) && test(e, w)) list.push({ wire: w, end: i });
      });
    });
    return list.length ? pick(c.r, list) : null;
  }

  function endsAt(c, t) {
    var list = [];
    c.s.wires.forEach(function (w) {
      w.ends.forEach(function (e, i) {
        if (e.attach && e.attach.partId === t.partId && e.attach.term === t.term) list.push({ wire: w, end: i });
      });
    });
    return list;
  }

  function onBoard(c, p, margin) {
    var b = c.L.board;
    return { x: clamp(p.x, b.x + margin, b.x + b.w - margin), y: clamp(p.y, b.y + margin, b.y + b.h - margin) };
  }

  function moveEnd(c, e, target) {
    var end = e.wire.ends[e.end];
    var from = end.attach;
    end.attach = { partId: target.partId, term: target.term };
    return from;
  }

  var INJECT = {
    detach: function (c) {
      var e = pickLoopEnd(c, function () { return true; });
      if (!e) return null;
      var end = e.wire.ends[e.end];
      var p = find(c.s, end.attach.partId);
      var pos = termPos(p, end.attach.term);
      var out = termOut(p, end.attach.term);
      // 단계가 오를수록 단자 가까이에 떨어져 있어 찾기 어렵다
      var gap = c.tier === 1 ? 62 + c.r() * 20 : c.tier === 2 ? 36 + c.r() * 14 : 22 + c.r() * 10;
      var ang = out + (c.r() - 0.5) * 60;
      var spot = onBoard(c, { x: pos.x + Math.cos(ang * Math.PI / 180) * gap, y: pos.y + Math.sin(ang * Math.PI / 180) * gap }, 14);
      var to = end.attach;
      end.attach = null;
      end.x = spot.x; end.y = spot.y;
      end.angle = ang + 180 + (c.r() - 0.5) * 40;
      c.useEnd(e.wire, e.end);
      return { type: 'detach', wireId: e.wire.id, end: e.end, to: to };
    },
    insulator: function (c) {
      var e = pickLoopEnd(c, function (end) { return !!INSUL[find(c.s, end.attach.partId).type]; });
      if (!e) return null;
      var end = e.wire.ends[e.end];
      var p = find(c.s, end.attach.partId);
      var tx = TYPES[p.type].terms[end.attach.term].x;
      var all = INSUL[p.type].map(function (sp, i) { return i; });
      var near = all.filter(function (i) { return (INSUL[p.type][i].x < 0) === (tx < 0); });
      var k = pick(c.r, near.length ? near : all);
      var to = end.attach;
      end.attach = { partId: p.id, spot: k };
      c.useEnd(e.wire, e.end);
      return { type: 'insulator', wireId: e.wire.id, end: e.end, to: to, material: p.type === 'switch' ? 'wood' : 'plastic' };
    },
    sameHolder: function (c) {
      var A = c.meta.outerA, Bt = c.meta.outerB;
      var ea = endsAt(c, A), eb = endsAt(c, Bt);
      if (ea.length !== 1 || eb.length !== 1) return null;
      if (!c.endFree(ea[0].wire, ea[0].end) || !c.endFree(eb[0].wire, eb[0].end)) return null;
      var moveB = chance(c.r, 0.5);
      var e = moveB ? eb[0] : ea[0];
      var to = moveEnd(c, e, moveB ? A : Bt);
      c.useEnd(ea[0].wire, ea[0].end); c.useEnd(eb[0].wire, eb[0].end);
      return { type: 'sameHolder', wireId: e.wire.id, end: e.end, to: to };
    },
    sameSocket: function (c) {
      var A = { partId: c.s.stopSocketId, term: 'a' }, Bt = { partId: c.s.stopSocketId, term: 'b' };
      var ea = endsAt(c, A), eb = endsAt(c, Bt);
      if (ea.length !== 1 || eb.length !== 1) return null;
      if (!c.endFree(ea[0].wire, ea[0].end) || !c.endFree(eb[0].wire, eb[0].end)) return null;
      var moveB = chance(c.r, 0.5);
      var e = moveB ? eb[0] : ea[0];
      var to = moveEnd(c, e, moveB ? A : Bt);
      c.useEnd(ea[0].wire, ea[0].end); c.useEnd(eb[0].wire, eb[0].end);
      return { type: 'sameSocket', wireId: e.wire.id, end: e.end, to: to };
    },
    switchOpen: function (c) {
      var ids = c.meta.switchIds.filter(function (id) { return !c.usedParts[id]; });
      if (!ids.length) return null;
      var id = pick(c.r, ids);
      find(c.s, id).closed = false;
      c.usedParts[id] = true;
      return { type: 'switchOpen', partId: id };
    },
    noBattery: function (c) {
      var ids = c.meta.holderIds.filter(function (id) { return !c.usedParts[id]; });
      if (!ids.length) return null;
      var h = find(c.s, pick(c.r, ids));
      c.s.parts = c.s.parts.filter(function (p) { return p.id !== h.batteryId; });
      h.batteryId = null;
      c.usedParts[h.id] = true;
      return { type: 'noBattery', holderId: h.id };
    },
    noBulb: function (c) {
      var sock = find(c.s, c.s.stopSocketId);
      c.s.parts = c.s.parts.filter(function (p) { return p.id !== sock.bulbId; });
      sock.bulbId = null;
      return { type: 'noBulb', socketId: sock.id };
    },
    brokenBulb: function (c) {
      var sock = find(c.s, c.s.stopSocketId);
      var bulb = find(c.s, sock.bulbId);
      bulb.broken = chance(c.r, 0.5) ? 1 : 2;
      return { type: 'brokenBulb', socketId: sock.id, bulbId: bulb.id };
    },
    brokenWire: function (c) {
      var ids = c.meta.loopWireIds.filter(function (id) {
        var w = findWire(c.s, id);
        return w && c.endFree(w, 0) && c.endFree(w, 1);
      });
      if (!ids.length) return null;
      var w = findWire(c.s, pick(c.r, ids));
      w.broken = true;
      w.cutAt = 0.35 + c.r() * 0.3;
      c.usedWires[w.id] = true;
      return { type: 'brokenWire', wireId: w.id };
    },
    insulatingRod: function (c) {
      var ids = c.meta.rodIds.filter(function (id) { return !c.usedParts[id]; });
      if (!ids.length) return null;
      var rod = find(c.s, pick(c.r, ids));
      rod.type = chance(c.r, 0.5) ? 'rodPlastic' : 'rodRubber';
      c.usedParts[rod.id] = true;
      return { type: 'insulatingRod', rodId: rod.id, material: rod.type };
    },
    reversedCell: function (c) {
      if (c.meta.holderIds.length !== 2) return null;
      var pair = c.meta.pair;
      if (pair && chance(c.r, 0.5)) {
        // 전선으로 이은 두 전지의 (+)극끼리 잇는다
        var inner = findWire(c.s, pair.innerWireId);
        var loopEnds = endsAt(c, { partId: pair.second, term: 'b' });
        if (loopEnds.length !== 1) return null;
        inner.ends[1].attach = { partId: pair.second, term: 'b' };
        loopEnds[0].wire.ends[loopEnds[0].end].attach = { partId: pair.second, term: 'a' };
        c.useEnd(inner, 1); c.useEnd(loopEnds[0].wire, loopEnds[0].end);
        c.meta.outerB = { partId: pair.second, term: 'a' };
        var h2 = find(c.s, pair.second);
        c.usedParts[h2.id] = true;
        return { type: 'reversedCell', batteryId: h2.batteryId, holderId: h2.id, faultFlipped: false };
      }
      var h = find(c.s, pick(c.r, c.meta.holderIds));
      var bat = find(c.s, h.batteryId);
      bat.flipped = true;
      c.usedParts[h.id] = true;
      return { type: 'reversedCell', batteryId: bat.id, holderId: h.id, faultFlipped: true };
    },
    shortWire: function (c) {
      var A = c.meta.outerA, Bt = c.meta.outerB;
      var w = { id: 'trap' + c.s.seq, color: pick(c.r, WIRE_COLORS), broken: false,
        ends: [{ x: 0, y: 0, attach: { partId: A.partId, term: A.term } }, { x: 0, y: 0, attach: { partId: Bt.partId, term: Bt.term } }] };
      c.s.seq += 1;
      c.s.wires.push(w);
      c.usedWires[w.id] = true;
      return { type: 'shortWire', wireId: w.id };
    }
  };

  /* ---------- 헷갈리게 하는 것들 ---------- */

  function addDecoys(r, tier, built, faults, L) {
    var s = built.s;
    var freeCells = [];
    built.used.forEach(function (u, i) { if (!u) freeCells.push(i); });
    shuffle(r, freeCells);
    function cellCenter(i) {
      var c = i % L.cols, rw = Math.floor(i / L.cols);
      return { x: L.board.x + (c + 0.5) * built.cw + (r() - 0.5) * 40, y: L.board.y + (rw + 0.5) * built.ch + (r() - 0.5) * 30 };
    }
    // 아무 데도 물리지 않은 전선
    if (tier >= 2 && freeCells.length && chance(r, 0.45)) {
      var at = cellCenter(freeCells.pop());
      s.wires.push({ id: built.nextId('wire'), color: pick(r, WIRE_COLORS), broken: false,
        ends: [{ x: at.x - 62, y: at.y, attach: null }, { x: at.x + 62, y: at.y + (r() - 0.5) * 30, attach: null }] });
    }
    if (tier === 3) {
      if (freeCells.length && chance(r, 0.35)) {
        var p1 = cellCenter(freeCells.pop());
        s.parts.push({ id: built.nextId('switch'), type: 'switch', x: p1.x, y: p1.y, rot: pick(r, [0, 180]), closed: chance(r, 0.5) });
      }
      if (freeCells.length && chance(r, 0.35)) {
        var p2 = cellCenter(freeCells.pop());
        s.parts.push({ id: built.nextId('rod'), type: pick(r, ['rodMetal', 'rodPlastic', 'rodRubber']), x: p2.x, y: p2.y, rot: pick(r, [0, 180]) });
      }
      // 고장과 상관없는 고리 전선 옆에 같은 곳을 잇는 전선 한 가닥 더
      if (chance(r, 0.35)) {
        var touched = {};
        faults.forEach(function (f) { if (f.wireId) touched[f.wireId] = true; });
        var ids = built.meta.loopWireIds.filter(function (id) {
          var w = findWire(s, id);
          return w && !touched[id] && w.ends[0].attach && w.ends[0].attach.term && w.ends[1].attach && w.ends[1].attach.term;
        });
        if (ids.length) {
          var src = findWire(s, pick(r, ids));
          s.wires.push({ id: built.nextId('wire'), color: pick(r, WIRE_COLORS), broken: false,
            ends: [{ x: 0, y: 0, attach: Object.assign({}, src.ends[0].attach) }, { x: 0, y: 0, attach: Object.assign({}, src.ends[1].attach) }] });
        }
      }
    }
  }

  /* ---------- 확인 ---------- */

  function verify(s, faults) {
    if (defused(s)) return false;
    var all = clone(s);
    faults.forEach(function (f) { applyFix(all, f); });
    if (!defused(all)) return false;
    // 고장 하나만 남겨도 멈추지 않아야 한다
    for (var i = 0; i < faults.length; i++) {
      var partial = clone(s);
      faults.forEach(function (f, j) { if (j !== i) applyFix(partial, f); });
      if (defused(partial)) return false;
    }
    return true;
  }

  function generate(r, n, types, layoutKind) {
    var L = LAYOUTS[layoutKind] || LAYOUTS.wide;
    var tier = tierOf(n);
    var ordered = ORDER.filter(function (t) { return types.indexOf(t) >= 0; });
    for (var attempt = 0; attempt < 80; attempt++) {
      var built = build(r, tier, ordered, L);
      if (!built) continue;
      var c = makeCtx(r, tier, built, L);
      var faults = [];
      var ok = ordered.every(function (t) {
        var f = INJECT[t](c);
        if (f) faults.push(f);
        return !!f;
      });
      if (!ok) continue;
      addDecoys(r, tier, built, faults, L);
      if (!verify(built.s, faults)) continue;
      var s = built.s;
      return {
        layout: layoutKind, W: L.W, H: L.H, board: L.board, tray: L.tray,
        parts: s.parts, wires: s.wires, seq: s.seq, stopSocketId: s.stopSocketId,
        faults: faults, tier: tier, bombNo: n, timeLimit: timeLimit(n, faults.length),
        spares: { battery: 1, bulb: 1, rodMetal: 1, wire: 1 }
      };
    }
    return null;
  }

  /* ---------- 한 판 (폭탄을 차례로 내준다) ---------- */

  function faultCount(r, n) {
    if (n >= 20 && chance(r, 0.25)) return 3;
    if (n >= 14) return chance(r, 0.6) ? 2 : 1;
    if (n >= 9) return chance(r, 0.35) ? 2 : 1;
    return 1;
  }

  function conflicts(a, list) {
    return list.some(function (b) {
      return CONFLICTS.some(function (c) { return (c[0] === a && c[1] === b) || (c[1] === a && c[0] === b); });
    });
  }

  // 같은 고장이 잇달아 나오지 않게: 처음 보는 고장을 먼저 내고,
  // 그다음에는 가장 오래 안 나온 고장 세 가지 가운데 하나를 고른다
  function createRun(seed, startAt) {
    var r = rng(seed);
    var n = startAt || 0;
    var recent = [], lastUsed = {};

    function draw(tier, chosen) {
      var pool = Object.keys(FAULTS).filter(function (k) { return FAULTS[k].tier <= tier; });
      function ok(k) { return chosen.indexOf(k) < 0 && recent.indexOf(k) < 0 && !conflicts(k, chosen); }
      var cand = pool.filter(ok);
      if (!cand.length) cand = pool.filter(function (k) { return chosen.indexOf(k) < 0 && !conflicts(k, chosen); });
      var fresh = cand.filter(function (k) { return lastUsed[k] === undefined; });
      var k;
      if (fresh.length) {
        k = pick(r, fresh);
      } else {
        shuffle(r, cand).sort(function (a, b) { return lastUsed[a] - lastUsed[b]; });
        k = pick(r, cand.slice(0, 3));
      }
      lastUsed[k] = n;
      return k;
    }

    return {
      next: function (layoutKind) {
        n += 1;
        var tier = tierOf(n);
        var count = faultCount(r, n);
        var types = [];
        for (var i = 0; i < count; i++) types.push(draw(tier, types));
        var puzzle = generate(r, n, types, layoutKind);
        // 드물게 조합이 맞지 않으면 고장 수를 줄여서 다시 만든다
        while (!puzzle && types.length > 1) {
          types.pop();
          puzzle = generate(r, n, types, layoutKind);
        }
        if (!puzzle) puzzle = generate(r, n, ['detach'], layoutKind);
        recent = puzzle.faults.map(function (f) { return f.type; });
        return puzzle;
      },
      bombNo: function () { return n; }
    };
  }

  var api = {
    LAYOUTS: LAYOUTS,
    INSUL: INSUL,
    FAULTS: FAULTS,
    createRun: createRun,
    tierOf: tierOf,
    timeLimit: timeLimit,
    solveState: solveState,
    defused: defused,
    applyFix: applyFix,
    isFixed: isFixed,
    faultTarget: faultTarget,
    explain: explain,
    termPos: termPos,
    termOut: termOut,
    spotPos: spotPos,
    spotOut: spotOut,
    clone: clone
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LabBomb = api;
})(this);
