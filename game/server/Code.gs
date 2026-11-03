/*
 * 시한폭탄 처리반 학급 기록판 (Google Apps Script)
 *
 * 구글 시트에 붙여 웹 앱으로 배포하면, 게임이 이 주소로 기록을 보내고 학급 순위와 도전 시간을 받아 간다.
 * 설치 방법은 game/server/README.md에 있다.
 *
 * 시트 탭
 *   기록       학생이 한 판을 마칠 때마다 한 줄씩 쌓인다 (시각, 이름, 해체한 폭탄, 판 번호, 기기)
 *   도전 시간  이 시각 사이에만 도전할 수 있다 (시작, 끝, 메모). 끝이 비어 있으면 닫을 때까지 열려 있다
 *   설정       교사 암호, 학생 화면에 보여 줄 안내 문구
 *
 * 요청은 모두 GET이다 (?action=status | submit | admin). 답은 JSON으로 돌려준다.
 */

var SHEET_RECORDS = '기록';
var SHEET_WINDOWS = '도전 시간';
var SHEET_SETTINGS = '설정';
var GRACE_MINUTES = 10;   // 도전 시간이 끝난 뒤에도 이만큼은 하던 판의 기록을 받는다
var BOARD_SIZE = 30;      // 학생 화면에 보내는 순위 수
var NAME_MAX = 12;
var SCORE_MAX = 500;
var CACHE_KEY = 'state-v1';
var CACHE_SECONDS = 10;   // 시트를 직접 고치면 이만큼 지나서 게임에 반영된다
var PIN_TRIES = 5;        // 교사 암호를 이만큼 틀리면 10분 동안 막는다

/* ---------- 처음 한 번: 편집기에서 setup을 실행한다 ---------- */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  recordsSheet();
  windowsSheet();
  settingsSheet();
}

/* ---------- 요청 받기 ---------- */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    if (p.action === 'submit') out = submit(p);
    else if (p.action === 'admin') out = admin(p);
    else out = status(p.name);
  } catch (err) {
    out = fail('server', '기록판에 문제가 생겼어요. (' + (err && err.message ? err.message : err) + ')');
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function fail(code, message) {
  return { ok: false, error: code, message: message };
}

/* ---------- 시트 ---------- */

function book() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
}

// 탭이 없으면 만든다. 서식은 처음 만들 때 한 번만 정한다
function ensureSheet(name, header, widths, init) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
    widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    if (init) init(sh);
  }
  return sh;
}

function recordsSheet() {
  return ensureSheet(SHEET_RECORDS, ['시각', '이름', '해체한 폭탄', '판 번호', '기기'], [150, 140, 90, 120, 80], function (sh) {
    sh.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sh.getRange('B:B').setNumberFormat('@');
  });
}

function windowsSheet() {
  return ensureSheet(SHEET_WINDOWS, ['시작', '끝', '메모'], [150, 150, 200], function (sh) {
    sh.getRange('A:B').setNumberFormat('yyyy-mm-dd hh:mm');
  });
}

function settingsSheet() {
  return ensureSheet(SHEET_SETTINGS, ['항목', '값', '설명'], [110, 200, 380], function (sh) {
    sh.getRange('B:B').setNumberFormat('@');
    sh.appendRow(['교사 암호', '', '게임의 ‘교사용’ 화면에서 넣는 암호예요. 학생에게 알려 주지 마세요.']);
    sh.appendRow(['안내 문구', '', '학생 화면의 도전 시간 아래에 보여 줄 한 줄 안내예요. 비워 두어도 돼요.']);
  });
}

function settings() {
  var map = {};
  settingsSheet().getDataRange().getValues().slice(1).forEach(function (r) {
    map[String(r[0]).trim()] = String(r[1] === null || r[1] === undefined ? '' : r[1]).trim();
  });
  return map;
}

function toTime(v) {
  return v instanceof Date && !isNaN(v.getTime()) ? v.getTime() : null;
}

// 도전 시간 목록. 시작이 날짜·시각이 아닌 줄은 건너뛴다
function readWindows() {
  var sh = windowsSheet();
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 3).getValues().map(function (r, i) {
    return { row: i + 2, start: toTime(r[0]), end: toTime(r[1]), memo: String(r[2] || '') };
  }).filter(function (w) { return w.start !== null; });
}

/* ---------- 이름과 순위 ---------- */

// 줄바꿈 같은 보이지 않는 글자를 빼고, 시트에서 수식으로 읽히지 않게 맨 앞의 = + - @를 뗀다
function cleanName(raw) {
  return String(raw === null || raw === undefined ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[=+\-@]+/, '')
    .trim()
    .slice(0, NAME_MAX);
}

// 띄어쓰기와 대소문자가 달라도 같은 사람으로 본다
function nameKey(name) {
  return cleanName(name).replace(/\s+/g, '').toLowerCase();
}

// 사람마다 가장 많이 해체한 판을 모아 순위를 매긴다. 같은 기록은 같은 순위이고, 먼저 세운 사람이 위에 온다
function rankPlayers(rows) {
  var byKey = {};
  rows.forEach(function (r) {
    var name = cleanName(r[1]);
    if (!name) return;
    var score = Math.max(0, Math.floor(Number(r[2]) || 0));
    var at = toTime(r[0]) || 0;
    var key = nameKey(name);
    var p = byKey[key] || (byKey[key] = { name: name, best: -1, at: 0, tries: 0 });
    p.tries += 1;
    if (score > p.best || (score === p.best && at < p.at)) {
      p.best = score;
      p.at = at;
    }
  });
  var list = Object.keys(byKey).map(function (k) { return byKey[k]; });
  list.sort(function (a, b) { return b.best - a.best || a.at - b.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
  var rank = 0;
  list.forEach(function (p, i) {
    if (i === 0 || p.best !== list[i - 1].best) rank = i + 1;
    p.rank = rank;
  });
  return list.map(function (p) { return { rank: p.rank, name: p.name, best: p.best, tries: p.tries }; });
}

/* ---------- 지금 상태 (잠깐 저장해 두고 같이 쓴다) ---------- */

function readState() {
  var sh = recordsSheet();
  var n = sh.getLastRow();
  var rows = n < 2 ? [] : sh.getRange(2, 1, n - 1, 3).getValues().filter(function (r) { return cleanName(r[1]); });
  return {
    windows: readWindows(),
    notice: settings()['안내 문구'] || '',
    players: rankPlayers(rows),
    runs: rows.length
  };
}

function state(fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) {
    var hit = cache.get(CACHE_KEY);
    if (hit) return JSON.parse(hit);
  }
  var st = readState();
  try { cache.put(CACHE_KEY, JSON.stringify(st), CACHE_SECONDS); } catch (err) { /* 너무 크면 저장하지 않고 매번 읽는다 */ }
  return st;
}

function forget() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

// 지금 열려 있는 도전 시간. 여럿이면 가장 늦게 끝나는 것 (끝이 비어 있으면 닫을 때까지)
function currentWindow(windows, now) {
  var cur = null;
  windows.forEach(function (w) {
    if (w.start > now || (w.end !== null && now >= w.end)) return;
    if (!cur || w.end === null || (cur.end !== null && w.end > cur.end)) cur = w;
  });
  return cur;
}

function nextWindow(windows, now) {
  var next = null;
  windows.forEach(function (w) {
    if (w.start > now && (!next || w.start < next.start)) next = w;
  });
  return next;
}

// 도전 시간 안이거나, 끝난 지 GRACE_MINUTES가 안 지났으면 기록을 받는다
function acceptsRecords(windows, now) {
  return windows.some(function (w) {
    return w.start <= now && (w.end === null || now < w.end + GRACE_MINUTES * 60000);
  });
}

function statusPayload(st, name) {
  var now = Date.now();
  var cur = currentWindow(st.windows, now);
  var next = nextWindow(st.windows, now);
  var key = name ? nameKey(name) : '';
  var me = null;
  if (key) {
    st.players.some(function (p) {
      if (nameKey(p.name) === key) { me = p; return true; }
      return false;
    });
  }
  return {
    ok: true,
    now: now,
    open: !!cur,
    until: cur ? cur.end : null,
    next: next ? next.start : null,
    notice: st.notice,
    board: st.players.slice(0, BOARD_SIZE),
    me: me,
    players: st.players.length,
    runs: st.runs
  };
}

/* ---------- 학생 ---------- */

function status(name) {
  return statusPayload(state(false), name);
}

function submit(p) {
  var name = cleanName(p.name);
  if (!name) return fail('bad_name', '이름이 없어서 기록하지 못했어요.');
  var raw = String(p.score === undefined ? '' : p.score).trim();
  var score = Number(raw);
  if (!/^\d{1,3}$/.test(raw) || score > SCORE_MAX) return fail('bad_score', '기록이 올바르지 않아요.');
  var run = String(p.run || '').replace(/[^\w-]/g, '').slice(0, 40);
  if (!run) return fail('bad_run', '판 번호가 없어서 기록하지 못했어요.');
  var device = String(p.device || '').replace(/[^\w-]/g, '').slice(0, 12);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail('busy', '기록판이 바빠요. 잠시 뒤에 다시 보낼게요.');
  var saved = false;
  try {
    var now = Date.now();
    var sh = recordsSheet();
    // 같은 판을 다시 보내면(연결이 끊겨 다시 보낼 때) 한 번만 적는다
    var dup = sh.getLastRow() >= 2 && sh.getRange(2, 4, sh.getLastRow() - 1, 1).createTextFinder(run).matchEntireCell(true).findNext();
    if (!dup) {
      if (!acceptsRecords(readWindows(), now)) return fail('closed', '도전 시간이 아니어서 기록되지 않았어요.');
      sh.appendRow([new Date(now), name, score, run, device]);
      saved = true;
      forget();
    }
  } finally {
    lock.releaseLock();
  }
  var out = statusPayload(state(false), name);
  out.saved = saved;
  return out;
}

/* ---------- 교사 ---------- */

function admin(p) {
  var cache = CacheService.getScriptCache();
  var misses = Number(cache.get('pin-misses') || 0);
  if (misses >= PIN_TRIES) return fail('locked', '암호를 여러 번 틀려서 10분 동안 쓸 수 없어요.');
  var pin = settings()['교사 암호'] || '';
  if (!pin) return fail('no_pin', '구글 시트의 ‘설정’ 탭에서 교사 암호를 먼저 정해 주세요.');
  if (String(p.pin || '').trim() !== pin) {
    cache.put('pin-misses', String(misses + 1), 600);
    return fail('bad_pin', '암호가 맞지 않아요.');
  }
  cache.remove('pin-misses');

  var op = String(p.op || 'status');
  if (op !== 'status') {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return fail('busy', '기록판이 바빠요. 잠시 뒤에 다시 해 주세요.');
    try {
      var done = change(op, p, Date.now());
      if (done !== true) return done;
      forget();
    } finally {
      lock.releaseLock();
    }
  }
  return adminPayload();
}

// 도전 시간 열기·닫기·예약, 기록판 새로 시작. 잘못된 요청이면 fail(...)을 돌려준다
function change(op, p, now) {
  var sh = windowsSheet();
  if (op === 'open') {
    var minutes = Math.floor(Number(p.minutes) || 0);
    if (minutes < 0 || minutes > 600) return fail('bad_time', '여는 시간이 올바르지 않아요.');
    sh.appendRow([new Date(now), minutes ? new Date(now + minutes * 60000) : '', '지금 열기']);
    return true;
  }
  if (op === 'close') {
    readWindows().forEach(function (w) {
      if (w.start <= now && (w.end === null || w.end > now)) sh.getRange(w.row, 2).setValue(new Date(now));
    });
    return true;
  }
  if (op === 'add') {
    var start = Math.floor(Number(p.start));
    var end = Math.floor(Number(p.end));
    if (!(start > 0 && end > start)) return fail('bad_time', '끝나는 시각이 시작 시각보다 늦어야 해요.');
    if (end <= now) return fail('bad_time', '이미 지난 시각이에요.');
    if (end - start > 31 * 24 * 3600000) return fail('bad_time', '한 번에 31일보다 길게 열 수는 없어요.');
    sh.appendRow([new Date(start), new Date(end), String(p.memo || '예약').slice(0, 40)]);
    return true;
  }
  if (op === 'remove') {
    var row = Math.floor(Number(p.row));
    var target = null;
    readWindows().forEach(function (w) { if (w.row === row) target = w; });
    // 그사이 시트가 바뀌어 다른 줄을 지우는 일이 없도록 시작 시각까지 맞는지 본다
    if (!target || target.start !== Math.floor(Number(p.start))) return fail('stale', '그사이 도전 시간이 바뀌었어요. 다시 불러올게요.');
    sh.deleteRow(row);
    return true;
  }
  if (op === 'reset') {
    var rec = recordsSheet();
    var n = rec.getLastRow();
    if (n >= 2) {
      var ss = book();
      var label = '보관 ' + Utilities.formatDate(new Date(now), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm');
      var name = label, k = 2;
      while (ss.getSheetByName(name)) name = label + ' (' + (k++) + ')';
      rec.copyTo(ss).setName(name);
      rec.getRange(2, 1, n - 1, rec.getLastColumn()).clearContent();
    }
    return true;
  }
  return fail('bad_op', '알 수 없는 요청이에요.');
}

function adminPayload() {
  var st = state(true);
  var out = statusPayload(st, '');
  var now = out.now;
  // 지금 열려 있거나 앞으로 열릴 도전 시간, 그리고 오늘 끝난 것
  out.windows = st.windows.filter(function (w) {
    return w.end === null || w.end > now - 12 * 3600000;
  }).sort(function (a, b) { return a.start - b.start; });
  out.sheetUrl = book().getUrl();
  return out;
}
