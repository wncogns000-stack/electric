const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../game/bomb.js');
const P = require('../js/parts.js').LabParts;

const LAYOUTS = ['wide', 'tall'];

function playRun(seed, layout, bombs) {
  const run = B.createRun(seed);
  const list = [];
  for (let n = 1; n <= bombs; n++) list.push(run.next(layout));
  return list;
}

function rotate(x, y, deg) {
  const r = deg * Math.PI / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

function bounds(p) {
  const b = P.TYPES[p.type].box;
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => rotate(x, y, p.rot));
  return {
    left: p.x + Math.min(...pts.map((q) => q.x)), right: p.x + Math.max(...pts.map((q) => q.x)),
    top: p.y + Math.min(...pts.map((q) => q.y)), bottom: p.y + Math.max(...pts.map((q) => q.y))
  };
}

test('모든 폭탄은 처음에 멈춰 있지 않고, 고장을 모두 고쳐야 멈춘다', () => {
  for (const layout of LAYOUTS) {
    for (let seed = 1; seed <= 25; seed++) {
      for (const pz of playRun(seed, layout, 24)) {
        assert.ok(pz.faults.length >= 1);
        assert.equal(B.defused(pz), false, `seed ${seed} bomb ${pz.bombNo}`);
        const fixed = B.clone(pz);
        pz.faults.forEach((f) => B.applyFix(fixed, f));
        assert.equal(B.defused(fixed), true, `seed ${seed} bomb ${pz.bombNo}`);
        pz.faults.forEach((f) => {
          assert.equal(B.isFixed(pz, f), false);
          assert.equal(B.isFixed(fixed, f), true);
        });
        // 고장 하나만 남겨도 멈추지 않는다
        pz.faults.forEach((f, i) => {
          const partial = B.clone(pz);
          pz.faults.forEach((g, j) => { if (j !== i) B.applyFix(partial, g); });
          assert.equal(B.defused(partial), false);
        });
      }
    }
  }
});

test('같은 고장이 두 폭탄 잇달아 나오지 않는다', () => {
  for (const layout of LAYOUTS) {
    for (let seed = 1; seed <= 40; seed++) {
      let prev = [];
      for (const pz of playRun(seed, layout, 30)) {
        const types = pz.faults.map((f) => f.type);
        assert.equal(new Set(types).size, types.length);
        assert.ok(!types.some((t) => prev.includes(t)), `seed ${seed} bomb ${pz.bombNo}: ${types} after ${prev}`);
        prev = types;
      }
    }
  }
});

test('처음 세 폭탄은 쉬운 고장만 나오고, 16번째 폭탄까지 모든 고장이 한 번 이상 나온다', () => {
  const easy = Object.keys(B.FAULTS).filter((k) => B.FAULTS[k].tier === 1);
  for (let seed = 1; seed <= 40; seed++) {
    const list = playRun(seed, 'wide', 16);
    list.slice(0, 3).forEach((pz) => pz.faults.forEach((f) => assert.ok(easy.includes(f.type))));
    const seen = new Set(list.flatMap((pz) => pz.faults.map((f) => f.type)));
    assert.equal(seen.size, Object.keys(B.FAULTS).length, `seed ${seed}: ${[...seen]}`);
  }
});

test('제한 시간은 60초에서 줄어 20초에서 멈추고, 고장이 많으면 늘어난다', () => {
  assert.equal(B.timeLimit(1, 1), 60);
  assert.equal(B.timeLimit(2, 1), 56);
  assert.equal(B.timeLimit(11, 1), 20);
  assert.equal(B.timeLimit(30, 1), 20);
  assert.equal(B.timeLimit(30, 2), 30);
  for (let n = 2; n <= 30; n++) assert.ok(B.timeLimit(n, 1) <= B.timeLimit(n - 1, 1));
});

test('부품은 판 안에 놓이고 서로 겹치지 않으며, 떨어진 집게도 판 안에 있다', () => {
  for (const layout of LAYOUTS) {
    for (let seed = 1; seed <= 25; seed++) {
      for (const pz of playRun(seed, layout, 24)) {
        const b = pz.board;
        const shown = pz.parts.filter((p) => !(p.type === 'battery' && p.holderId) && !(p.type === 'bulb' && p.socketId));
        shown.forEach((p) => {
          const q = bounds(p);
          assert.ok(q.left >= b.x && q.right <= b.x + b.w && q.top >= b.y && q.bottom <= b.y + b.h,
            `seed ${seed} bomb ${pz.bombNo} ${p.id} ${JSON.stringify(q)}`);
        });
        for (let i = 0; i < shown.length; i++) {
          for (let j = i + 1; j < shown.length; j++) {
            const a = shown[i], c = shown[j];
            if (a.joinNext === c.id || c.joinNext === a.id) continue;
            const qa = bounds(a), qc = bounds(c);
            const overlap = qa.left < qc.right && qc.left < qa.right && qa.top < qc.bottom && qc.top < qa.bottom;
            assert.ok(!overlap, `seed ${seed} bomb ${pz.bombNo}: ${a.id} overlaps ${c.id}`);
          }
        }
        pz.wires.forEach((w) => w.ends.forEach((e) => {
          if (e.attach) return;
          assert.ok(e.x >= b.x && e.x <= b.x + b.w && e.y >= b.y && e.y <= b.y + b.h);
        }));
      }
    }
  }
});

test('같은 고장이라도 폭탄마다 배치가 달라진다', () => {
  // 여러 판에서 ‘빠진 집게’ 폭탄을 모아 정지 램프 위치와 부품 구성을 비교한다
  const shapes = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    for (const pz of playRun(seed, 'wide', 12)) {
      if (!pz.faults.some((f) => f.type === 'detach')) continue;
      const sock = pz.parts.find((p) => p.id === pz.stopSocketId);
      const kinds = pz.parts.map((p) => p.type + p.rot).sort().join(',');
      shapes.add(Math.round(sock.x / 40) + ':' + Math.round(sock.y / 40) + '|' + kinds);
    }
  }
  assert.ok(shapes.size >= 20, `배치 종류가 ${shapes.size}가지뿐이다`);
});
