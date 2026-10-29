/*
 * 회로 계산기 (절점 해석법)
 *
 * 화면의 부품 상태를 받아 각 부품에 걸린 전압과 흐르는 전류를 계산한다.
 * 브라우저에서는 window.LabCircuit, Node(테스트)에서는 module.exports 로 쓴다.
 *
 * 모델
 *  - 전지: 기전력 1.5 V, 내부 저항 0.1 Ω (노턴 등가: 전류원 + 컨덕턴스)
 *  - 전구: 6 Ω. 밝기는 소비 전력을 "전지 1개 + 전구 1개" 회로의 전력으로 나눈 값
 *  - 전동기: 5 Ω. 전류 방향이 바뀌면 반대로 돈다
 *  - 버저: 100 Ω. 빨간색 전선 쪽 전위가 더 높을 때만 전기가 흐르고 소리가 난다
 *  - 전자석: 2 Ω. 전류가 a → b로 흐르면 b 쪽 끝이 N극
 *  - 집게 달린 전선, 닫힌 스위치, 금속 막대: 0.01 Ω
 *  - 플라스틱 막대, 고무 막대, 열린 스위치: 전기가 흐르지 않음
 *  - 전지 끼우개, 전구 끼우개: 끼운 전지·전구의 극과 끼우개 단자를 같은 절점으로 합친다
 *  - 끝끼리 붙인 전지 끼우개: 앞 끼우개의 (+)쪽 단자와 뒤 끼우개의 (−)쪽 단자를 합친다
 */
(function (root) {
  'use strict';

  var EMF = 1.5;
  var R_INTERNAL = 0.1;
  var R_BULB = 6;
  var R_MOTOR = 5;
  var R_BUZZER = 100;
  var R_MAGNET = 2;
  var R_WIRE = 0.01;
  var G_MIN = 1e-9;          // 떠 있는 절점이 행렬을 특이하게 만들지 않도록 접지로 거는 아주 작은 컨덕턴스
  var LIT_THRESHOLD = 0.03;  // 기준 밝기의 3 % 이하는 꺼진 것으로 본다
  var SHORT_CURRENT = 4;     // 전지 전류가 4 A를 넘으면 합선으로 본다 (부품을 거치는 회로는 3 A 미만)

  var REF_POWER = (function () {
    var i = EMF / (R_BULB + R_INTERNAL);
    return i * i * R_BULB;
  })();

  // 두 단자 사이에 저항처럼 들어가는 부품: [첫 단자, 둘째 단자, 저항]
  var LOADS = {
    bulb: ['tip', 'thread', R_BULB],
    motor: ['a', 'b', R_MOTOR],
    buzzer: ['red', 'black', R_BUZZER],
    magnet: ['a', 'b', R_MAGNET]
  };

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

  // 부분 피벗 가우스 소거. A와 b를 덮어쓴다.
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
   *   battery: { holderId, flipped }        단자 p(+), n(−)
   *   holder:  { batteryId, joinNext }      단자 a(−쪽), b(+쪽). joinNext: b쪽에 붙인 끼우개 id
   *   bulb:    { socketId }                 단자 tip(꼭지), thread(꼭지쇠)
   *   socket:  { bulbId }                   단자 a, b
   *   switch:  { closed }                   단자 a, b
   *   motor, magnet                         단자 a, b
   *     magnet.sand: [왼쪽, 오른쪽] 에나멜선 끝을 벗긴 정도(0~1). 없으면 다 벗긴 것으로 본다
   *   buzzer                                단자 red, black
   *   rodPlastic, rodRubber, rodMetal       단자 a, b
   * wires: [{ id, ends: [{ attach: { partId, term } | null }, …] }]
   *
   * 반환값
   *   bulbs[id]     = { current, voltage, brightness, lit }
   *   motors[id]    = { current, voltage }     a → b 방향이 양수
   *   buzzers[id]   = { current, voltage, on } 빨간색 → 검은색 방향 전압
   *   magnets[id]   = { current }              a → b 방향이 양수
   *   switches[id], rods[id] = { current }
   *   wires[id]     = { current, from }        from: 전류가 들어오는 끝(0 또는 1)
   *   batteries[id] = { current, shorted }     current는 (+)극에서 밖으로 나가는 전류
   *   shorted       = 합선된 전지가 하나라도 있는지
   */
  function solve(parts, wires) {
    var byId = {};
    parts.forEach(function (p) { byId[p.id] = p; });

    var uf = makeUnionFind();
    function key(partId, term) { return partId + ':' + term; }

    parts.forEach(function (p) {
      if (p.type === 'holder') {
        if (p.batteryId && byId[p.batteryId]) {
          var bat = byId[p.batteryId];
          // 바르게 끼우면 전지 (+)극이 끼우개의 + 표시 쪽(b)에 닿는다
          uf.union(key(p.id, 'b'), key(bat.id, bat.flipped ? 'n' : 'p'));
          uf.union(key(p.id, 'a'), key(bat.id, bat.flipped ? 'p' : 'n'));
        }
        if (p.joinNext && byId[p.joinNext]) uf.union(key(p.id, 'b'), key(p.joinNext, 'a'));
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

    var conductors = [];  // { kind, id, a, b, g, oneWay }
    var sources = [];     // { id, p, n, g, emf }

    parts.forEach(function (p) {
      if (p.type === 'battery') {
        sources.push({ id: p.id, p: node(p.id, 'p'), n: node(p.id, 'n'), g: 1 / R_INTERNAL, emf: EMF });
      } else if (LOADS[p.type]) {
        // 에나멜선 끝의 코팅(전기가 잘 흐르지 않는 물질)을 사포로 다 벗기지 않은 전자석에는 전기가 흐르지 않는다
        if (p.type === 'magnet' && p.sand && !(p.sand[0] >= 1 && p.sand[1] >= 1)) return;
        var L = LOADS[p.type];
        conductors.push({ kind: p.type, id: p.id, a: node(p.id, L[0]), b: node(p.id, L[1]), g: 1 / L[2], oneWay: p.type === 'buzzer' });
      } else if ((p.type === 'switch' && p.closed) || p.type === 'rodMetal') {
        conductors.push({ kind: p.type === 'switch' ? 'switch' : 'rod', id: p.id, a: node(p.id, 'a'), b: node(p.id, 'b'), g: 1 / R_WIRE });
      }
    });

    wires.forEach(function (w) {
      var e0 = w.ends[0].attach, e1 = w.ends[1].attach;
      if (!e0 || !e1 || !byId[e0.partId] || !byId[e1.partId]) return;
      conductors.push({ kind: 'wire', id: w.id, a: node(e0.partId, e0.term), b: node(e1.partId, e1.term), g: 1 / R_WIRE });
    });

    var n = nodeCount;
    var V = [];
    var blocked = {};  // 거꾸로 연결되어 전기가 흐르지 않는 버저

    function run() {
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
      conductors.forEach(function (c) {
        if (c.a !== c.b && !(c.oneWay && blocked[c.id])) stamp(c.a, c.b, c.g);
      });
      sources.forEach(function (s) {
        if (s.p !== s.n) stamp(s.p, s.n, s.g);
        var is = s.emf * s.g;
        rhs[s.p] += is;
        rhs[s.n] -= is;
      });
      return n > 0 ? solveLinear(A, rhs) : [];
    }

    // 버저는 한쪽으로만 전기가 흐르므로 방향이 맞을 때까지 몇 번 다시 푼다
    for (var iter = 0; iter < 6; iter++) {
      V = run();
      var changed = false;
      conductors.forEach(function (c) {
        if (!c.oneWay) return;
        var forward = V[c.a] - V[c.b];
        if (!blocked[c.id] && forward < -1e-6) { blocked[c.id] = true; changed = true; }
        else if (blocked[c.id] && forward > 1e-4) { delete blocked[c.id]; changed = true; }
      });
      if (!changed) break;
    }

    // 전선, 닫힌 스위치, 금속 막대만으로 이어진 묶음. 전지의 두 극이 같은 묶음이면 합선이다.
    var nets = makeUnionFind();
    conductors.forEach(function (c) {
      if (c.kind === 'wire' || c.kind === 'switch' || c.kind === 'rod') nets.union(c.a, c.b);
    });

    var result = { bulbs: {}, motors: {}, buzzers: {}, magnets: {}, switches: {}, rods: {}, wires: {}, batteries: {}, shorted: false };

    function clean(x) { return Math.abs(x) < 1e-6 ? 0 : x; }

    sources.forEach(function (s) {
      var current = clean(s.g * (s.emf - (V[s.p] - V[s.n])));
      var shorted = nets.find(s.p) === nets.find(s.n) || Math.abs(current) > SHORT_CURRENT;
      if (shorted) result.shorted = true;
      result.batteries[s.id] = { current: current, shorted: shorted };
    });

    conductors.forEach(function (c) {
      var voltage = c.a === c.b ? 0 : clean(V[c.a] - V[c.b]);
      var current = c.oneWay && blocked[c.id] ? 0 : clean(voltage * c.g);
      if (c.kind === 'bulb') {
        var brightness = current * current * R_BULB / REF_POWER;
        result.bulbs[c.id] = { current: Math.abs(current), voltage: Math.abs(voltage), brightness: brightness, lit: brightness > LIT_THRESHOLD };
      } else if (c.kind === 'motor') {
        result.motors[c.id] = { current: current, voltage: voltage };
      } else if (c.kind === 'buzzer') {
        result.buzzers[c.id] = { current: current, voltage: voltage, on: current > 0.005 };
      } else if (c.kind === 'magnet') {
        result.magnets[c.id] = { current: current };
      } else if (c.kind === 'wire') {
        result.wires[c.id] = { current: Math.abs(current), from: current >= 0 ? 0 : 1 };
      } else if (c.kind === 'switch') {
        result.switches[c.id] = { current: Math.abs(current) };
      } else if (c.kind === 'rod') {
        result.rods[c.id] = { current: Math.abs(current) };
      }
    });

    parts.forEach(function (p) {
      if (p.type === 'magnet' && !result.magnets[p.id]) result.magnets[p.id] = { current: 0 };
      if (p.type === 'switch' && !result.switches[p.id]) result.switches[p.id] = { current: 0 };
      if (/^rod/.test(p.type) && !result.rods[p.id]) result.rods[p.id] = { current: 0 };
    });
    wires.forEach(function (w) {
      if (!result.wires[w.id]) result.wires[w.id] = { current: 0, from: 0 };
    });

    return result;
  }

  var api = {
    solve: solve,
    constants: {
      EMF: EMF, R_INTERNAL: R_INTERNAL, R_BULB: R_BULB, R_MOTOR: R_MOTOR, R_BUZZER: R_BUZZER,
      R_MAGNET: R_MAGNET, R_WIRE: R_WIRE, SHORT_CURRENT: SHORT_CURRENT, LIT_THRESHOLD: LIT_THRESHOLD
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LabCircuit = api;
})(this);
