const test = require('node:test');
const assert = require('node:assert/strict');
const { solve } = require('../js/circuit.js');

let seq = 0;
function wire(a, aTerm, b, bTerm) {
  seq += 1;
  return {
    id: 'w' + seq,
    ends: [
      { attach: a ? { partId: a, term: aTerm } : null },
      { attach: b ? { partId: b, term: bTerm } : null }
    ]
  };
}

test('전지와 전구를 전선 2개로 이으면 전구가 켜진다', () => {
  const parts = [
    { id: 'bat', type: 'battery', holderId: null, flipped: false },
    { id: 'bulb', type: 'bulb', socketId: null }
  ];
  const wires = [wire('bat', 'p', 'bulb', 'tip'), wire('bulb', 'thread', 'bat', 'n')];
  const r = solve(parts, wires);
  assert.equal(r.bulbs.bulb.lit, true);
  assert.ok(Math.abs(r.bulbs.bulb.brightness - 1) < 0.01);
  assert.equal(r.shorted, false);
});

test('전선 하나가 빠지면 전구가 꺼진다', () => {
  const parts = [
    { id: 'bat', type: 'battery', holderId: null, flipped: false },
    { id: 'bulb', type: 'bulb', socketId: null }
  ];
  const wires = [wire('bat', 'p', 'bulb', 'tip'), wire('bulb', 'thread', null, null)];
  const r = solve(parts, wires);
  assert.equal(r.bulbs.bulb.lit, false);
});

test('전구의 꼭지 한 곳에만 두 전선을 물리면 전구가 켜지지 않는다', () => {
  const parts = [
    { id: 'bat', type: 'battery', holderId: null, flipped: false },
    { id: 'bulb', type: 'bulb', socketId: null }
  ];
  const wires = [wire('bat', 'p', 'bulb', 'tip'), wire('bulb', 'tip', 'bat', 'n')];
  const r = solve(parts, wires);
  assert.equal(r.bulbs.bulb.lit, false);
  assert.equal(r.shorted, true);
});

test('끼우개를 쓰고 스위치를 열면 꺼지고 닫으면 켜진다', () => {
  const parts = [
    { id: 'bat', type: 'battery', holderId: 'h', flipped: false },
    { id: 'h', type: 'holder', batteryId: 'bat' },
    { id: 'bulb', type: 'bulb', socketId: 's' },
    { id: 's', type: 'socket', bulbId: 'bulb' },
    { id: 'sw', type: 'switch', closed: false }
  ];
  const wires = [wire('h', 'b', 'sw', 'a'), wire('sw', 'b', 's', 'a'), wire('s', 'b', 'h', 'a')];
  assert.equal(solve(parts, wires).bulbs.bulb.lit, false);
  parts[4].closed = true;
  const r = solve(parts, wires);
  assert.equal(r.bulbs.bulb.lit, true);
  assert.ok(r.switches.sw.current > 0.2);
});

test('빈 전지 끼우개로는 전구가 켜지지 않는다', () => {
  const parts = [
    { id: 'h', type: 'holder', batteryId: null },
    { id: 'bulb', type: 'bulb', socketId: null }
  ];
  const wires = [wire('h', 'b', 'bulb', 'tip'), wire('bulb', 'thread', 'h', 'a')];
  assert.equal(solve(parts, wires).bulbs.bulb.lit, false);
});

test('직렬연결한 전구 2개는 병렬연결보다 어둡다', () => {
  const base = () => [
    { id: 'bat', type: 'battery', holderId: null, flipped: false },
    { id: 'b1', type: 'bulb', socketId: null },
    { id: 'b2', type: 'bulb', socketId: null }
  ];
  const series = solve(base(), [
    wire('bat', 'p', 'b1', 'tip'),
    wire('b1', 'thread', 'b2', 'tip'),
    wire('b2', 'thread', 'bat', 'n')
  ]);
  const parallel = solve(base(), [
    wire('bat', 'p', 'b1', 'tip'),
    wire('b1', 'tip', 'b2', 'tip'),
    wire('bat', 'n', 'b1', 'thread'),
    wire('b1', 'thread', 'b2', 'thread')
  ]);
  assert.equal(series.bulbs.b1.lit, true);
  assert.equal(series.bulbs.b2.lit, true);
  assert.ok(series.bulbs.b1.brightness < 0.5);
  assert.ok(parallel.bulbs.b1.brightness > 0.9);
  assert.ok(parallel.bulbs.b2.brightness > 0.9);
  // 직렬: 전지 전류 = 각 전구 전류, 병렬: 전지 전류 = 두 전구 전류의 합
  assert.ok(Math.abs(series.batteries.bat.current - series.bulbs.b1.current) < 1e-3);
  assert.ok(Math.abs(parallel.batteries.bat.current - parallel.bulbs.b1.current - parallel.bulbs.b2.current) < 1e-3);

});

test('직렬연결에서 전구 하나를 빼면 나머지도 꺼지고, 병렬연결에서는 켜진 채로 있다', () => {
  const parts = () => [
    { id: 'bat', type: 'battery', holderId: null, flipped: false },
    { id: 'b1', type: 'bulb', socketId: null },
    { id: 's1', type: 'socket', bulbId: null },
    { id: 's2', type: 'socket', bulbId: 'b2' },
    { id: 'b2', type: 'bulb', socketId: 's2' }
  ];
  const series = solve(parts(), [
    wire('bat', 'p', 's1', 'b'),
    wire('s1', 'a', 's2', 'b'),
    wire('s2', 'a', 'bat', 'n')
  ]);
  assert.equal(series.bulbs.b2.lit, false);

  const parallel = solve(parts(), [
    wire('bat', 'p', 's1', 'b'),
    wire('s1', 'b', 's2', 'b'),
    wire('bat', 'n', 's1', 'a'),
    wire('s1', 'a', 's2', 'a')
  ]);
  assert.equal(parallel.bulbs.b2.lit, true);
});

test('전지 2개를 같은 방향으로 이으면 더 밝고, 반대로 이으면 꺼진다', () => {
  const parts = (flipped) => [
    { id: 'bat1', type: 'battery', holderId: 'h1', flipped: false },
    { id: 'h1', type: 'holder', batteryId: 'bat1' },
    { id: 'bat2', type: 'battery', holderId: 'h2', flipped },
    { id: 'h2', type: 'holder', batteryId: 'bat2' },
    { id: 'bulb', type: 'bulb', socketId: null }
  ];
  const wires = () => [
    wire('h1', 'b', 'h2', 'a'),
    wire('h2', 'b', 'bulb', 'tip'),
    wire('bulb', 'thread', 'h1', 'a')
  ];
  const same = solve(parts(false), wires());
  assert.ok(same.bulbs.bulb.brightness > 3);
  const opposite = solve(parts(true), wires());
  assert.equal(opposite.bulbs.bulb.lit, false);
});

test('전구 없이 전지의 두 극을 바로 이으면 합선으로 판단한다', () => {
  const parts = [
    { id: 'bat', type: 'battery', holderId: null, flipped: false },
    { id: 'bulb', type: 'bulb', socketId: null }
  ];
  const wires = [
    wire('bat', 'p', 'bulb', 'tip'),
    wire('bulb', 'thread', 'bat', 'n'),
    wire('bat', 'p', 'bat', 'n')
  ];
  const r = solve(parts, wires);
  assert.equal(r.shorted, true);
  assert.equal(r.batteries.bat.shorted, true);
  assert.equal(r.bulbs.bulb.lit, false);
});

test('전선 전류의 방향은 (+)극에서 나와 (−)극으로 들어간다', () => {
  const parts = [
    { id: 'bat', type: 'battery', holderId: null, flipped: false },
    { id: 'bulb', type: 'bulb', socketId: null }
  ];
  const w1 = wire('bulb', 'tip', 'bat', 'p'); // 끝 1이 (+)극
  const w2 = wire('bulb', 'thread', 'bat', 'n');
  const r = solve(parts, [w1, w2]);
  assert.equal(r.wires[w1.id].from, 1);
  assert.equal(r.wires[w2.id].from, 0);
});

test('스위치 대신 금속 막대를 이으면 켜지고, 플라스틱·고무 막대를 이으면 켜지지 않는다', () => {
  for (const [rod, lit] of [['rodMetal', true], ['rodPlastic', false], ['rodRubber', false]]) {
    const parts = [
      { id: 'bat', type: 'battery', holderId: 'h', flipped: false },
      { id: 'h', type: 'holder', batteryId: 'bat', joinNext: null },
      { id: 'bulb', type: 'bulb', socketId: 's' },
      { id: 's', type: 'socket', bulbId: 'bulb' },
      { id: 'rod', type: rod }
    ];
    const wires = [wire('h', 'b', 'rod', 'a'), wire('rod', 'b', 's', 'b'), wire('s', 'a', 'h', 'a')];
    assert.equal(solve(parts, wires).bulbs.bulb.lit, lit, rod);
  }
});

test('끝끼리 붙인 전지 끼우개 2개는 전선 없이도 직렬로 이어진다', () => {
  const parts = [
    { id: 'bat1', type: 'battery', holderId: 'h1', flipped: false },
    { id: 'h1', type: 'holder', batteryId: 'bat1', joinNext: 'h2' },
    { id: 'bat2', type: 'battery', holderId: 'h2', flipped: false },
    { id: 'h2', type: 'holder', batteryId: 'bat2', joinNext: null },
    { id: 'bulb', type: 'bulb', socketId: null }
  ];
  const wires = [wire('h2', 'b', 'bulb', 'tip'), wire('bulb', 'thread', 'h1', 'a')];
  const r = solve(parts, wires);
  assert.ok(r.bulbs.bulb.voltage > 2.7);
  assert.ok(r.bulbs.bulb.brightness > 3);
});

test('버저는 빨간색 전선을 (+)극 쪽에 이었을 때만 울린다', () => {
  const parts = [
    { id: 'bat', type: 'battery', holderId: null, flipped: false },
    { id: 'bz', type: 'buzzer' }
  ];
  const right = solve(parts, [wire('bat', 'p', 'bz', 'red'), wire('bz', 'black', 'bat', 'n')]);
  assert.equal(right.buzzers.bz.on, true);
  assert.ok(right.buzzers.bz.voltage > 1.4);
  const reversed = solve(parts, [wire('bat', 'p', 'bz', 'black'), wire('bz', 'red', 'bat', 'n')]);
  assert.equal(reversed.buzzers.bz.on, false);
  assert.equal(reversed.batteries.bat.current, 0);
});

test('버저를 거꾸로 이어도 같은 회로의 다른 부품에는 영향이 없다', () => {
  const parts = [
    { id: 'bat', type: 'battery', holderId: null, flipped: false },
    { id: 'bz', type: 'buzzer' },
    { id: 'bulb', type: 'bulb', socketId: null }
  ];
  // 전구와 버저를 병렬로: 버저만 거꾸로
  const r = solve(parts, [
    wire('bat', 'p', 'bulb', 'tip'), wire('bulb', 'thread', 'bat', 'n'),
    wire('bulb', 'tip', 'bz', 'black'), wire('bz', 'red', 'bulb', 'thread')
  ]);
  assert.equal(r.bulbs.bulb.lit, true);
  assert.equal(r.buzzers.bz.on, false);
});

test('전동기는 전지를 반대로 이으면 반대 방향으로 돈다', () => {
  const parts = [
    { id: 'bat', type: 'battery', holderId: null, flipped: false },
    { id: 'm', type: 'motor' }
  ];
  const fwd = solve(parts, [wire('bat', 'p', 'm', 'a'), wire('m', 'b', 'bat', 'n')]);
  const rev = solve(parts, [wire('bat', 'p', 'm', 'b'), wire('m', 'a', 'bat', 'n')]);
  assert.ok(fwd.motors.m.voltage > 1.4);
  assert.ok(rev.motors.m.voltage < -1.4);
});

test('전자석은 전지 2개를 직렬연결하면 전류가 더 크고, 합선으로 보지 않는다', () => {
  const make = (cells) => {
    const parts = [{ id: 'mag', type: 'magnet' }];
    for (let i = 1; i <= cells; i++) {
      parts.push({ id: 'b' + i, type: 'battery', holderId: 'h' + i, flipped: false });
      parts.push({ id: 'h' + i, type: 'holder', batteryId: 'b' + i, joinNext: i < cells ? 'h' + (i + 1) : null });
    }
    return solve(parts, [wire('h' + cells, 'b', 'mag', 'a'), wire('mag', 'b', 'h1', 'a')]);
  };
  const one = make(1), two = make(2), four = make(4);
  assert.ok(one.magnets.mag.current > 0.6);
  assert.ok(two.magnets.mag.current > one.magnets.mag.current * 1.8);
  assert.equal(two.shorted, false);
  assert.equal(four.shorted, false);
});

test('전지 2개를 직렬로 이은 채 양 끝을 전선으로 바로 이으면 합선이다', () => {
  const parts = [
    { id: 'b1', type: 'battery', holderId: 'h1', flipped: false },
    { id: 'h1', type: 'holder', batteryId: 'b1', joinNext: 'h2' },
    { id: 'b2', type: 'battery', holderId: 'h2', flipped: false },
    { id: 'h2', type: 'holder', batteryId: 'b2', joinNext: null }
  ];
  assert.equal(solve(parts, [wire('h2', 'b', 'h1', 'a')]).shorted, true);
});

test('열린 스위치만 있는 회로는 합선이 아니고, 닫으면 합선이다', () => {
  const parts = [
    { id: 'bat', type: 'battery', holderId: null, flipped: false },
    { id: 'sw', type: 'switch', closed: false }
  ];
  const wires = [wire('bat', 'p', 'sw', 'a'), wire('sw', 'b', 'bat', 'n')];
  assert.equal(solve(parts, wires).shorted, false);
  parts[1].closed = true;
  assert.equal(solve(parts, wires).shorted, true);
});
