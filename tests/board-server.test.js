// 학급 기록판(game/server/Code.gs)을 가짜 Apps Script 환경에서 돌려 본다
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/apps-script');

const MIN = 60000;

function ready(pin) {
  const env = load();
  env.ctx.setup();
  if (pin !== undefined) env.setSetting('교사 암호', pin);
  return env;
}

test('setup은 기록·도전 시간·설정 탭을 만든다', () => {
  const env = ready();
  assert.deepEqual(env.sheet('기록').rows[0], ['시각', '이름', '해체한 폭탄', '판 번호', '기기']);
  assert.deepEqual(env.sheet('도전 시간').rows[0], ['시작', '끝', '메모']);
  const labels = env.sheet('설정').rows.map((r) => r[0]);
  assert.ok(labels.includes('교사 암호') && labels.includes('안내 문구'));
});

test('도전 시간이 없으면 닫혀 있고 기록을 받지 않는다', () => {
  const env = ready();
  const st = env.get({ action: 'status' });
  assert.equal(st.ok, true);
  assert.equal(st.open, false);
  assert.equal(st.next, null);
  const res = env.get({ action: 'submit', name: '하늘', score: 3, run: 'r1' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'closed');
  assert.equal(env.sheet('기록').getLastRow(), 1);
});

test('교사 암호가 없거나 틀리면 교사용 요청을 막고, 여러 번 틀리면 잠근다', () => {
  const env = ready();
  assert.equal(env.get({ action: 'admin', pin: '', op: 'status' }).error, 'no_pin');
  env.setSetting('교사 암호', '2468');
  for (let i = 0; i < 5; i++) assert.equal(env.get({ action: 'admin', pin: '1111', op: 'open' }).error, 'bad_pin');
  assert.equal(env.get({ action: 'admin', pin: '2468', op: 'status' }).error, 'locked');
  assert.equal(env.get({ action: 'status' }).open, false);
});

test('지금 열기와 지금 닫기, 닫은 뒤 10분까지는 하던 판의 기록을 받는다', () => {
  const env = ready('2468');
  const t0 = env.clock.now;
  const opened = env.get({ action: 'admin', pin: '2468', op: 'open', minutes: 40 });
  assert.equal(opened.open, true);
  assert.equal(opened.until, t0 + 40 * MIN);

  env.clock.now = t0 + 5 * MIN;
  assert.equal(env.get({ action: 'admin', pin: '2468', op: 'close' }).open, false);
  assert.equal(env.get({ action: 'status' }).open, false);

  env.clock.now = t0 + 14 * MIN;
  assert.equal(env.get({ action: 'submit', name: '하늘', score: 4, run: 'late-ok' }).saved, true);
  env.clock.now = t0 + 16 * MIN;
  assert.equal(env.get({ action: 'submit', name: '하늘', score: 9, run: 'too-late' }).error, 'closed');
  assert.equal(env.sheet('기록').getLastRow(), 2);
});

test('닫을 때까지 열어 두면 끝 시각이 비어 있고 계속 열려 있다', () => {
  const env = ready('2468');
  const st = env.get({ action: 'admin', pin: '2468', op: 'open', minutes: 0 });
  assert.equal(st.open, true);
  assert.equal(st.until, null);
  env.clock.now += 3 * 24 * 60 * MIN;
  env.clearCache();
  assert.equal(env.get({ action: 'status' }).open, true);
});

test('같은 사람은 가장 좋은 기록 하나로 순위를 매기고, 같은 기록은 같은 순위다', () => {
  const env = ready('2468');
  env.get({ action: 'admin', pin: '2468', op: 'open', minutes: 40 });
  const send = (name, score, run) => {
    env.clock.now += MIN;
    return env.get({ action: 'submit', name, score, run });
  };
  send('김하늘', 3, 'a1');
  send('이 바다', 7, 'b1');
  send('김 하늘', 7, 'a2');   // 띄어쓰기가 달라도 같은 사람
  send('박별', 2, 'c1');
  const last = send('박별', 1, 'c2');

  assert.equal(last.players, 3);
  assert.equal(last.runs, 5);
  assert.deepEqual(last.board.map((p) => [p.rank, p.name, p.best, p.tries]), [
    [1, '이 바다', 7, 1],
    [1, '김하늘', 7, 2],
    [3, '박별', 2, 2]
  ]);
  assert.deepEqual(last.me, { rank: 3, name: '박별', best: 2, tries: 2 });
  assert.equal(env.get({ action: 'status', name: '김하늘' }).me.rank, 1);
});

test('같은 판을 다시 보내면 한 번만 적는다', () => {
  const env = ready('2468');
  env.get({ action: 'admin', pin: '2468', op: 'open', minutes: 40 });
  assert.equal(env.get({ action: 'submit', name: '하늘', score: 5, run: 'same' }).saved, true);
  const again = env.get({ action: 'submit', name: '하늘', score: 5, run: 'same' });
  assert.equal(again.ok, true);
  assert.equal(again.saved, false);
  assert.equal(again.runs, 1);
});

test('이름과 점수를 고르게 다듬고, 잘못된 기록은 받지 않는다', () => {
  const env = ready('2468');
  env.get({ action: 'admin', pin: '2468', op: 'open', minutes: 40 });
  const res = env.get({ action: 'submit', name: '=HYPERLINK("x")\n하늘이름이아주아주길어요', score: 2, run: 'n1' });
  assert.equal(res.saved, true);
  const stored = env.sheet('기록').rows[1][1];
  assert.equal(stored[0] === '=', false);
  assert.ok(stored.length <= 12);
  assert.equal(/[\n\r]/.test(stored), false);

  assert.equal(env.get({ action: 'submit', name: '   ', score: 2, run: 'n2' }).error, 'bad_name');
  for (const score of [-1, 501, 'abc', '']) {
    assert.equal(env.get({ action: 'submit', name: '하늘', score, run: 'n3' }).error, 'bad_score');
  }
  assert.equal(env.get({ action: 'submit', name: '하늘', score: 1, run: '' }).error, 'bad_run');
});

test('예약한 도전 시간에만 열리고, 다음에 열리는 시각을 알려 준다', () => {
  const env = ready('2468');
  const t0 = env.clock.now;
  const start = t0 + 60 * MIN;
  const end = t0 + 100 * MIN;
  const st = env.get({ action: 'admin', pin: '2468', op: 'add', start, end });
  assert.equal(st.open, false);
  assert.equal(st.next, start);
  assert.equal(st.windows.length, 1);

  env.clock.now = start + MIN;
  env.clearCache();
  const during = env.get({ action: 'status' });
  assert.equal(during.open, true);
  assert.equal(during.until, end);

  env.clock.now = end + MIN;
  env.clearCache();
  assert.equal(env.get({ action: 'status' }).open, false);

  assert.equal(env.get({ action: 'admin', pin: '2468', op: 'add', start: end, end: start }).error, 'bad_time');
  assert.equal(env.get({ action: 'admin', pin: '2468', op: 'add', start: t0 - 90 * MIN, end: t0 - 60 * MIN }).error, 'bad_time');
});

test('도전 시간을 지울 때 그사이 줄이 바뀌었으면 지우지 않는다', () => {
  const env = ready('2468');
  const t0 = env.clock.now;
  env.get({ action: 'admin', pin: '2468', op: 'add', start: t0 + 60 * MIN, end: t0 + 90 * MIN });
  const st = env.get({ action: 'admin', pin: '2468', op: 'add', start: t0 + 120 * MIN, end: t0 + 150 * MIN });
  const w = st.windows[1];
  assert.equal(env.get({ action: 'admin', pin: '2468', op: 'remove', row: w.row, start: w.start + 1 }).error, 'stale');
  const after = env.get({ action: 'admin', pin: '2468', op: 'remove', row: w.row, start: w.start });
  assert.equal(after.windows.length, 1);
  assert.equal(after.next, t0 + 60 * MIN);
});

test('시트에서 직접 적은 도전 시간도 읽는다 (끝이 비어 있으면 닫을 때까지)', () => {
  const env = ready('2468');
  const D = env.ctx.Date;
  env.sheet('도전 시간').appendRow([new D(env.clock.now - MIN), '', '시트에서 직접']);
  env.clearCache();
  const st = env.get({ action: 'status' });
  assert.equal(st.open, true);
  assert.equal(st.until, null);
});

test('기록판을 새로 시작하면 지금까지의 기록을 보관 탭으로 옮긴다', () => {
  const env = ready('2468');
  env.get({ action: 'admin', pin: '2468', op: 'open', minutes: 40 });
  env.get({ action: 'submit', name: '하늘', score: 5, run: 'k1' });
  env.get({ action: 'submit', name: '바다', score: 6, run: 'k2' });
  const st = env.get({ action: 'admin', pin: '2468', op: 'reset' });
  assert.equal(st.players, 0);
  assert.equal(st.runs, 0);
  const archive = env.ss._sheets.find((s) => /^보관 2026-11-04 09:00/.test(s.name));
  assert.ok(archive, '보관 탭이 있어야 한다');
  assert.equal(archive.getLastRow(), 3);
  // 비운 뒤에도 새 기록이 첫 줄부터 쌓인다
  env.get({ action: 'submit', name: '별', score: 1, run: 'k3' });
  assert.equal(env.sheet('기록').getLastRow(), 2);
  assert.equal(env.sheet('기록').rows[1][1], '별');
});

test('안내 문구를 학생 화면에 보낸다', () => {
  const env = ready('2468');
  env.setSetting('안내 문구', '6학년 2반 도전 시간이에요');
  assert.equal(env.get({ action: 'status' }).notice, '6학년 2반 도전 시간이에요');
});
