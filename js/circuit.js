/*
 * 회로 계산기 (절점 해석법)
 *
 * 화면의 부품 상태를 받아 각 단자의 전위와 각 부품에 흐르는 전류를 계산한다.
 * 브라우저에서는 window.LabCircuit, Node(테스트)에서는 module.exports 로 쓴다.
 *
 * 모델
 *  - 전지: 기전력 1.5 V, 내부 저항 0.1 Ω (노턴 등가: 전류원 + 컨덕턴스)
 *  - 꼬마전구: 6 Ω 저항. 밝기는 소비 전력을 "전지 1개 + 전구 1개" 회로의 전력으로 나눈 값
 *  - 집게 달린 전선, 닫힌 스위치: 0.01 Ω
 *  - 전지 끼우개, 전구 끼우개: 끼운 전지·전구의 극과 끼우개 단자를 같은 절점으로 합친다
 */
(function (root) {
  'use strict';

  var EMF = 1.5;
  var R_INTERNAL = 0.1;
  var R_BULB = 6;
  var R_WIRE = 0.01;
  var G_MIN = 1e-9;          // 떠 있는 절점이 행렬을 특이하게 만들지 않도록 접지로 거는 아주 작은 컨덕턴스
  var LIT_THRESHOLD = 0.03;  // 기준 밝기의 3 % 이하는 꺼진 것으로 본다
  var SHORT_CURRENT = 2;     // 전지 전류가 2 A를 넘으면 합선으로 본다 (정상 회로는 1 A 미만)

  var REF_POWER = (function () {
    var i = EMF / (R_BULB + R_INTERNAL);
    return i * i * R_BULB;
  })();

  function makeUnionFind() {
    var parent = {};
    function find(k) {
      if (parent[k] === undefined) parent[k] = k;
      while (parent[k] !== k) {
        parent[k] = parent[parent[k]];
        k = parent[k];
      }
      return k;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
    return { find: find, union: union };
  }

  // 부분 피벗 가우스 소거. A는 n×n, b는 길이 n. A와 b를 덮어쓴다.
  function solveLinear(A, b) {
    var n = b.length;
    for (var col = 0; col < n; col++) {
      var pivot = col;
      for (var r = col + 1; r < n; r++) {
        if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
      }
      if (Math.abs(A[pivot][col]) < 1e-15) continue;
      if (pivot !== col) {
        var tmp = A[pivot]; A[pivot] = A[col]; A[col] = tmp;
        var tb = b[pivot]; b[pivot] = b[col]; b[col] = tb;
      }
      for (var r2 = col + 1; r2 < n; r2++) {
        var f = A[r2][col] / A[col][col];
        if (f === 0) continue;
        for (var c = col; c < n; c++) A[r2][c] -= f * A[col][c];
        b[r2] -= f * b[col];
      }
    }
    var x = new Array(n).fill(0);
    for (var i = n - 1; i >= 0; i--) {
      if (Math.abs(A[i][i]) < 1e-15) { x[i] = 0; continue; }
      var s = b[i];
      for (var j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
  }

  /*
   * parts: [{ id, type, ... }]
   *   battery: { holderId, flipped }   단자 p(+), n(−)
   *   holder:  { batteryId }           단자 a(−쪽), b(+쪽)
   *   bulb:    { socketId }            단자 tip(꼭지), thread(꼭지쇠)
   *   socket:  { bulbId }              단자 a, b
   *   switch:  { closed }              단자 a, b
   * wires: [{ id, ends: [{ attach: { partId, term } | null }, …] }]
   *
   * 반환값: { bulbs, batteries, wires, switches, bulbNets, shorted }
   *   bulbs[id]     = { current, brightness, lit }
   *   batteries[id] = { current, shorted }   current는 (+)극에서 밖으로 나가는 전류
   *   wires[id]     = { current, from }      from: 전류가 들어오는 끝(0 또는 1)
   *   switches[id]  = { current }
 *   bulbNets[id]  = [꼭지 쪽 묶음, 꼭지쇠 쪽 묶음]  두 전구가 묶음 하나를 같이 쓰면 직렬, 둘 다 같이 쓰면 병렬
   */
  function solve(parts, wires) {
    var byId = {};
    parts.forEach(function (p) { byId[p.id] = p; });

    var uf = makeUnionFind();
    function key(partId, term) { return partId + ':' + term; }

    parts.forEach(function (p) {
      if (p.type === 'holder' && p.batteryId && byId[p.batteryId]) {
        var bat = byId[p.batteryId];
        // 바르게 끼우면 전지 (+)극이 끼우개의 + 표시 쪽(b)에 닿는다
        uf.union(key(p.id, 'b'), key(bat.id, bat.flipped ? 'n' : 'p'));
        uf.union(key(p.id, 'a'), key(bat.id, bat.flipped ? 'p' : 'n'));
      }
      if (p.type === 'socket' && p.bulbId && byId[p.bulbId]) {
        var bulb = byId[p.bulbId];
        uf.union(key(p.id, 'a'), key(bulb.id, 'thread'));
        uf.union(key(p.id, 'b'), key(bulb.id, 'tip'));
      }
    });

    var nodeIndex = {};
    var nodeCount = 0;
    function node(partId, term) {
      var k = uf.find(key(partId, term));
      if (nodeIndex[k] === undefined) nodeIndex[k] = nodeCount++;
      return nodeIndex[k];
    }

    var conductors = [];  // { a, b, g, kind, id, ends? }
    var sources = [];     // { p, n, g, emf, id }

    parts.forEach(function (p) {
      if (p.type === 'battery') {
        sources.push({ id: p.id, p: node(p.id, 'p'), n: node(p.id, 'n'), g: 1 / R_INTERNAL, emf: EMF });
      } else if (p.type === 'bulb') {
        conductors.push({ kind: 'bulb', id: p.id, a: node(p.id, 'tip'), b: node(p.id, 'thread'), g: 1 / R_BULB });
      } else if (p.type === 'switch') {
        node(p.id, 'a'); node(p.id, 'b');
        if (p.closed) {
          conductors.push({ kind: 'switch', id: p.id, a: node(p.id, 'a'), b: node(p.id, 'b'), g: 1 / R_WIRE });
        }
      }
    });

    wires.forEach(function (w) {
      var e0 = w.ends[0].attach, e1 = w.ends[1].attach;
      if (!e0 || !e1 || !byId[e0.partId] || !byId[e1.partId]) return;
      conductors.push({ kind: 'wire', id: w.id, a: node(e0.partId, e0.term), b: node(e1.partId, e1.term), g: 1 / R_WIRE });
    });

    var n = nodeCount;
    var A = [];
    for (var i = 0; i < n; i++) {
      A.push(new Array(n).fill(0));
      A[i][i] = G_MIN;
    }
    var rhs = new Array(n).fill(0);

    function stamp(a, b, g) {
      A[a][a] += g; A[b][b] += g;
      A[a][b] -= g; A[b][a] -= g;
    }
    conductors.forEach(function (c) { if (c.a !== c.b) stamp(c.a, c.b, c.g); });
    sources.forEach(function (s) {
      if (s.p !== s.n) stamp(s.p, s.n, s.g);
      var is = s.emf * s.g;
      rhs[s.p] += is;
      rhs[s.n] -= is;
    });

    var V = n > 0 ? solveLinear(A, rhs) : [];

    // 전선과 닫힌 스위치로 이어진 절점끼리 묶은 "도선 묶음". 직렬·병렬 판단에 쓴다.
    var nets = makeUnionFind();
    conductors.forEach(function (c) {
      if (c.kind !== 'bulb') nets.union(c.a, c.b);
    });

    var result = { bulbs: {}, batteries: {}, wires: {}, switches: {}, bulbNets: {}, shorted: false };
    conductors.forEach(function (c) {
      if (c.kind === 'bulb') result.bulbNets[c.id] = [nets.find(c.a), nets.find(c.b)];
    });

    sources.forEach(function (s) {
      var current = s.g * (s.emf - (V[s.p] - V[s.n]));
      if (Math.abs(current) < 1e-6) current = 0;
      var shorted = Math.abs(current) > SHORT_CURRENT;
      if (shorted) result.shorted = true;
      result.batteries[s.id] = { current: current, shorted: shorted };
    });

    conductors.forEach(function (c) {
      var current = c.a === c.b ? 0 : (V[c.a] - V[c.b]) * c.g;
      if (Math.abs(current) < 1e-6) current = 0;
      if (c.kind === 'bulb') {
        var power = current * current * R_BULB;
        var brightness = power / REF_POWER;
        result.bulbs[c.id] = { current: Math.abs(current), brightness: brightness, lit: brightness > LIT_THRESHOLD };
      } else if (c.kind === 'wire') {
        result.wires[c.id] = { current: Math.abs(current), from: current >= 0 ? 0 : 1 };
      } else if (c.kind === 'switch') {
        result.switches[c.id] = { current: Math.abs(current) };
      }
    });

    parts.forEach(function (p) {
      if (p.type === 'bulb' && !result.bulbs[p.id]) result.bulbs[p.id] = { current: 0, brightness: 0, lit: false };
      if (p.type === 'switch' && !result.switches[p.id]) result.switches[p.id] = { current: 0 };
    });
    wires.forEach(function (w) {
      if (!result.wires[w.id]) result.wires[w.id] = { current: 0, from: 0 };
    });

    return result;
  }

  var api = {
    solve: solve,
    constants: { EMF: EMF, R_INTERNAL: R_INTERNAL, R_BULB: R_BULB, R_WIRE: R_WIRE, SHORT_CURRENT: SHORT_CURRENT, LIT_THRESHOLD: LIT_THRESHOLD }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LabCircuit = api;
})(this);
