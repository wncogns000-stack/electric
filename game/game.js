/*
 * 시한폭탄 처리반 화면
 *
 * 폭탄마다 bomb.js가 고장 난 정지 회로를 만들어 준다. 학생이 회로를 고쳐 정지 램프(전구)에
 * 불이 켜지면 폭탄이 멈추고, 제한 시간이 다 되면 터져서 한 판이 끝난다.
 * 기록은 이 기기의 브라우저(localStorage)에만 남는다.
 *
 * 상태를 고치면 update()를 불러 회로를 다시 계산하고 판을 다시 그린다 (실험실 화면과 같은 방식).
 */
(function () {
  'use strict';

  var P = window.LabParts;
  var B = window.LabBomb;
  var TYPES = P.TYPES;

  var SNAP = 34;          // 집게를 놓았을 때 단자에 물리는 거리 (판 좌표)
  var DRAG_START = 6;     // 이만큼(px) 움직여야 끌기로 본다
  var PENALTY = 5;        // 합선을 만들거나 힌트를 쓰면 줄어드는 시간(초)
  var NEXT_DELAY = 5;     // 해체한 뒤 다음 폭탄까지 기다리는 시간(초)
  var HINT_SHOW = 4000;
  var STORE_KEY = 'bomb-squad-v1';
  var MAX_RECORDS = 10;
  var WIRE_COLORS = ['#d2382d', '#26292c', '#e2b21c', '#2f6fd0', '#2e9a58'];
  var SPARES = [
    { item: 'battery', label: '새 전지' },
    { item: 'bulb', label: '새 전구' },
    { item: 'rodMetal', label: '금속 막대' },
    { item: 'wire', label: '새 전선' }
  ];
  var CANNOT = {
    battery: '새 전지는 빈 전지 끼우개에 넣을 수 있어요.',
    bulb: '새 전구는 전구 끼우개에 끼울 수 있어요.',
    rodMetal: '금속 막대는 플라스틱 막대나 고무 막대와 바꿀 수 있어요.',
    wire: '새 전선은 전선 위나 판의 빈 곳에 놓을 수 있어요.'
  };

  var G = {
    phase: 'intro',      // intro | playing | cleared | over
    run: null,
    seed: 0,
    puzzle: null,
    score: 0,
    remaining: 0,
    name: '',
    selected: null,      // { kind: 'clip', wireId, end } | { kind: 'term', partId, term } | { kind: 'spare', item } | { kind: 'part', id } | { kind: 'wire', id }
    actionsOpen: false,
    wasShorted: false,
    shortPenalized: false,
    hint: null,          // { target, until }
    endReason: '',
    newBest: false,
    rank: -1
  };
  var store = loadStore();
  var result = null;
  var drag = null;
  var nearTerm = null;
  var carry = null;
  var rafId = null;
  var lastFrame = null;
  var nextTimer = null;
  var hintTimer = null;
  var toastTimer = null;
  var clearArmed = null;
  var audio = null;

  function $(id) { return document.getElementById(id); }
  var svg = $('bomb');
  var stage = $('stage');
  var layers = {
    casing: $('casing'), timer: $('timer'), parts: $('layerParts'), glow: $('layerGlow'), tags: $('layerTags'),
    wires: $('layerWires'), terms: $('layerTerms'), clips: $('layerClips'), tray: $('layerTray'),
    hint: $('layerHint'), carry: $('layerCarry')
  };
  var actionbar = $('actionbar');
  var toastEl = $('toast');
  var boomEl = $('boom');
  var introEl = $('intro');
  var clearedEl = $('cleared');
  var overEl = $('gameover');
  var nameInput = $('playerName');
  var hintBtn = $('hintBtn');
  var soundBtn = $('soundBtn');
  var quitBtn = $('quitBtn');

  /* ---------- 기록 ---------- */

  function loadStore() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (err) { s = null; }
    s = s && typeof s === 'object' ? s : {};
    if (!Array.isArray(s.records)) s.records = [];
    if (typeof s.sound !== 'boolean') s.sound = true;
    if (typeof s.name !== 'string') s.name = '';
    return s;
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (err) { /* 저장할 수 없는 브라우저에서는 이 화면을 닫기 전까지만 기록이 남는다 */ }
  }
  function bestScore() { return store.records.length ? store.records[0].score : 0; }
  function addRecord(name, score) {
    var rec = { name: name || '이름 없음', score: score, at: Date.now() };
    store.records.push(rec);
    store.records.sort(function (a, b) { return b.score - a.score || a.at - b.at; });
    store.records = store.records.slice(0, MAX_RECORDS);
    saveStore();
    return store.records.indexOf(rec);
  }
  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 기본 계산 ---------- */

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function rotate(x, y, deg) {
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return { x: x * c - y * s, y: x * s + y * c };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function fmt(n) { return Math.round(n * 10) / 10; }
  function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

  function findPart(id) {
    var list = G.puzzle.parts;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function findWire(id) {
    var list = G.puzzle.wires;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function partsOf(type) { return G.puzzle.parts.filter(function (p) { return p.type === type; }); }
  function newId(prefix) { G.puzzle.seq += 1; return 'x' + prefix + G.puzzle.seq; }

  function isTucked(p) {
    return (p.type === 'battery' && p.holderId) || (p.type === 'bulb' && p.socketId);
  }
  function termHidden(p, term) {
    return p.type === 'holder' && ((term === 'a' && p.joinPrev) || (term === 'b' && p.joinNext));
  }
  function activeTerms() {
    var list = [];
    G.puzzle.parts.forEach(function (p) {
      if (isTucked(p)) return;
      Object.keys(TYPES[p.type].terms).forEach(function (term) {
        if (!termHidden(p, term)) list.push({ part: p, term: term, pos: B.termPos(p, term) });
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
      if (p) return e.attach.term ? B.termPos(p, e.attach.term) : B.spotPos(p, e.attach.spot);
    }
    return { x: e.x, y: e.y };
  }

  // 집게 끝이 향하는 방향(도). 물린 집게는 바깥에서 다가오고, 한 곳에 여럿이면 부채꼴로 벌린다.
  function clipAngles() {
    var angles = {}, groups = {};
    G.puzzle.wires.forEach(function (w) {
      w.ends.forEach(function (e, i) {
        if (!e.attach) return;
        var k = e.attach.partId + ':' + (e.attach.term || 'spot' + e.attach.spot);
        (groups[k] = groups[k] || []).push({ key: w.id + ':' + i, attach: e.attach });
      });
    });
    Object.keys(groups).forEach(function (k) {
      var list = groups[k];
      var a = list[0].attach;
      var p = findPart(a.partId);
      if (!p) return;
      var base = (a.term ? B.termOut(p, a.term) : B.spotOut(p, a.spot)) + 180;
      list.forEach(function (item, idx) { angles[item.key] = base + (idx - (list.length - 1) / 2) * 30; });
    });
    G.puzzle.wires.forEach(function (w) {
      [0, 1].forEach(function (i) {
        var key = w.id + ':' + i;
        if (angles[key] !== undefined) return;
        if (w.ends[i].angle !== undefined) { angles[key] = w.ends[i].angle; return; }
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
    return {
      ends: ends, p: [ends[0].back, c0, c1, ends[1].back],
      path: curve([ends[0].back, c0, c1, ends[1].back]),
      mid: pointAt([ends[0].back, c0, c1, ends[1].back], 0.5)
    };
  }
  function pt(p) { return fmt(p.x) + ' ' + fmt(p.y); }
  function curve(c) { return 'M' + pt(c[0]) + 'C' + pt(c[1]) + ' ' + pt(c[2]) + ' ' + pt(c[3]); }
  function split(c, t) {
    var a = lerp(c[0], c[1], t), b = lerp(c[1], c[2], t), d = lerp(c[2], c[3], t);
    var e = lerp(a, b, t), f = lerp(b, d, t), g = lerp(e, f, t);
    return [[c[0], a, e, g], [g, f, d, c[3]]];
  }
  function pointAt(c, t) { return split(c, t)[0][3]; }

  /* ---------- 회로 상태 ---------- */

  function stopSocket() { return findPart(G.puzzle.stopSocketId); }

  function brightnessOf(id) {
    var b = result && result.bulbs[id];
    return b && b.lit ? b.brightness : 0;
  }

  /* ---------- 소리 ---------- */

  // 소리는 ‘출동’처럼 학생이 무언가를 누른 뒤에만 낼 수 있다
  function unlockAudio() {
    if (!store.sound) return null;
    if (!audio) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { audio = new AC(); } catch (err) { return null; }
    }
    if (audio.state === 'suspended' && audio.resume) audio.resume().catch(function () { /* 다음 누르기 때 다시 시도한다 */ });
    return audio;
  }
  function beep(freq, dur, type, gain, delay) {
    var a = store.sound ? audio : null;
    if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    var t0 = a.currentTime + (delay || 0);
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }
  function tickSound(sec) {
    if (sec <= 10) beep(1560, 0.08, 'square', 0.05);
    else beep(1040, 0.04, 'square', 0.025);
  }
  function chimeSound() {
    [660, 880, 1320].forEach(function (f, i) { beep(f, 0.22, 'sine', 0.14, i * 0.1); });
  }
  function zapSound() { beep(160, 0.3, 'sawtooth', 0.07); }
  function boomSound() {
    var a = store.sound ? audio : null;
    if (!a) return;
    var len = Math.floor(a.sampleRate * 1.1);
    var buf = a.createBuffer(1, len, a.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    var src = a.createBufferSource();
    var filter = a.createBiquadFilter();
    var g = a.createGain();
    src.buffer = buf;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, a.currentTime);
    filter.frequency.exponentialRampToValueAtTime(70, a.currentTime + 1);
    g.gain.value = 0.55;
    src.connect(filter);
    filter.connect(g);
    g.connect(a.destination);
    src.start();
    beep(70, 0.6, 'sine', 0.35);
  }

  /* ---------- 그리기 ---------- */

  var GAME_DEFS = [
    '<linearGradient id="gSteel" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#4a535d"/><stop offset=".08" stop-color="#363d45"/><stop offset="1" stop-color="#1f2429"/></linearGradient>',
    '<radialGradient id="gBolt" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="#9aa3ad"/><stop offset="1" stop-color="#3b4249"/></radialGradient>',
    '<pattern id="hazard" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">',
    '<rect width="28" height="28" fill="#1b1405"/><rect width="14" height="28" fill="#ffc21a"/></pattern>'
  ].join('');

  function traySlot(i) {
    var t = G.puzzle.tray;
    var w = (t.w - 20 - 30) / 4;
    return { x: t.x + 10 + i * (w + 10), y: t.y + 10, w: w, h: t.h - 20 };
  }

  function renderCasing() {
    var pz = G.puzzle, W = pz.W, H = pz.H, b = pz.board, t = pz.tray;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var bolts = [[30, 30], [W - 30, 30], [30, H - 30], [W - 30, H - 30]].map(function (c) {
      return '<g transform="translate(' + c[0] + ' ' + c[1] + ')"><circle r="9" class="bolt"/><path d="M-5 -5L5 5M5 -5L-5 5" class="bolt-cross"/></g>';
    }).join('');
    var faults = pz.faults.length;
    layers.casing.innerHTML = [
      '<rect class="case" x="4" y="4" width="' + (W - 8) + '" height="' + (H - 8) + '" rx="30"/>',
      '<rect class="case-edge" x="14" y="14" width="' + (W - 28) + '" height="' + (H - 28) + '" rx="22"/>',
      bolts,
      '<rect x="' + (b.x - 9) + '" y="' + (b.y - 9) + '" width="' + (b.w + 18) + '" height="' + (b.h + 18) + '" rx="14" fill="url(#hazard)"/>',
      '<rect class="mat" x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="8"/>',
      '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="8" fill="url(#gridMinor)"/>',
      '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="8" fill="url(#gridMajor)"/>',
      '<text class="plate" x="' + (b.x + 2) + '" y="' + (b.y - 20) + '">정지 회로</text>',
      '<text class="plate-note" x="' + (b.x + 92) + '" y="' + (b.y - 21) + '">' + (G.phase === 'intro' ? '' : pz.bombNo + '번째 폭탄 · 고장 ' + faults + '곳') + '</text>',
      '<text class="plate" x="' + (t.x + 2) + '" y="' + (t.y - 8) + '">부품 상자</text>',
      '<rect class="tray-bg" x="' + t.x + '" y="' + t.y + '" width="' + t.w + '" height="' + t.h + '" rx="14"/>'
    ].join('');
  }

  // 7세그먼트 숫자: 세그먼트 a~g
  var SEG = { a: [6, 0, 22, 6], b: [28, 5, 6, 23], c: [28, 32, 6, 23], d: [6, 54, 22, 6], e: [0, 32, 6, 23], f: [0, 5, 6, 23], g: [6, 27, 22, 6] };
  var DIGIT = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
  function digitSvg(n, x) {
    var on = DIGIT[n];
    return '<g transform="translate(' + x + ' 0) skewX(-7)">' + Object.keys(SEG).map(function (k) {
      var s = SEG[k];
      return '<rect class="seg' + (on.indexOf(k) >= 0 ? ' on' : '') + '" x="' + s[0] + '" y="' + s[1] + '" width="' + s[2] + '" height="' + s[3] + '" rx="2.5"/>';
    }).join('') + '</g>';
  }

  var shownTimer = '';
  function renderTimer() {
    var pz = G.puzzle;
    if (!pz) { layers.timer.innerHTML = ''; return; }
    var secs = Math.max(0, Math.ceil(G.remaining / 1000));
    var mm = Math.floor(secs / 60), ss = secs % 60;
    var state = G.phase === 'intro' ? 'is-idle'
      : G.phase === 'cleared' ? 'is-safe'
        : G.phase === 'over' ? (G.endReason === 'boom' ? 'is-dead' : 'is-idle')
          : secs <= 10 ? 'is-urgent' : '';
    var label = G.phase === 'cleared' ? '해체 완료' : G.phase === 'over' && G.endReason === 'boom' ? '폭발' : '남은 시간';
    var sig = [pz.W, secs, state, label].join('|');
    if (sig === shownTimer) return;
    shownTimer = sig;
    var mw = 300, mx = pz.W / 2 - mw / 2;
    layers.timer.innerHTML = '<g class="timer ' + state + '" transform="translate(' + mx + ' 22)">' +
      '<rect class="timer-box" width="' + mw + '" height="86" rx="12"/>' +
      '<text class="timer-label" x="38" y="38">' + label + '</text>' +
      '<circle class="timer-led" cx="38" cy="58" r="7"/>' +
      '<rect class="timer-screen" x="76" y="10" width="212" height="66" rx="6"/>' +
      '<g transform="translate(92 14) scale(0.9)">' +
      digitSvg(Math.floor(mm / 10), 0) + digitSvg(mm % 10, 42) +
      '<circle class="seg on" cx="91" cy="19" r="4"/><circle class="seg on" cx="89" cy="41" r="4"/>' +
      digitSvg(Math.floor(ss / 10), 104) + digitSvg(ss % 10, 146) +
      '</g></g>';
  }

  function partLabel(p) {
    var name = TYPES[p.type].name;
    if (p.type === 'holder') return name + (p.batteryId ? ', 전지 끼움' + (findPart(p.batteryId).flipped ? ', 거꾸로' : '') : ', 비어 있음');
    if (p.type === 'socket') {
      if (!p.bulbId) return name + ', 비어 있음' + (p.id === G.puzzle.stopSocketId ? ', 정지 램프' : '');
      return name + ', 전구 끼움' + (findPart(p.bulbId).broken ? ', 필라멘트 끊어짐' : '') + (p.id === G.puzzle.stopSocketId ? ', 정지 램프' : '');
    }
    if (p.type === 'switch') return name + ', ' + (p.closed ? '닫힘' : '열림');
    return name;
  }

  function spareTargetsFor(item) {
    var ids = {};
    if (!item) return ids;
    G.puzzle.parts.forEach(function (p) {
      if (item === 'battery' && p.type === 'holder' && !p.batteryId) ids[p.id] = true;
      if (item === 'bulb' && p.type === 'socket') ids[p.id] = true;
      if (item === 'rodMetal' && (p.type === 'rodPlastic' || p.type === 'rodRubber')) ids[p.id] = true;
    });
    return ids;
  }

  function activeSpare() {
    if (carry) return carry.item;
    return G.selected && G.selected.kind === 'spare' ? G.selected.item : null;
  }

  function renderParts() {
    var sel = G.selected;
    var selPart = sel && sel.kind === 'part' ? findPart(sel.id) : null;
    var targets = spareTargetsFor(activeSpare());
    var hover = carry && carry.target && carry.target.kind === 'part' ? carry.target.id : null;

    layers.parts.innerHTML = G.puzzle.parts.map(function (p) {
      if (isTucked(p)) return '';
      var opts = {};
      if (p.type === 'battery') opts.heat = result.batteries[p.id] && result.batteries[p.id].shorted;
      if (p.type === 'holder' && p.batteryId) {
        var bat = findPart(p.batteryId);
        opts.battery = { flipped: bat.flipped, heat: result.batteries[bat.id] && result.batteries[bat.id].shorted };
      }
      if (p.type === 'bulb') opts.brightness = brightnessOf(p.id);
      if (p.type === 'socket' && p.bulbId) {
        var bulb = findPart(p.bulbId);
        opts.bulb = { brightness: brightnessOf(p.bulbId), broken: bulb.broken };
      }
      if (p.type === 'switch') opts.closed = p.closed;

      var cls = 'part';
      if (p.type === 'switch' || (p.type === 'holder' && p.batteryId) || targets[p.id]) cls += ' is-tappable';
      if (selPart === p) cls += ' is-selected';
      if (targets[p.id] && (!carry || hover === p.id)) cls += ' is-target';
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
      var local = p.socketId ? { x: P.SOCKET_SLOT.x + P.GLOBE.x, y: P.SOCKET_SLOT.y + P.GLOBE.y } : P.GLOBE;
      var q = rotate(local.x, local.y, host.rot);
      var s = Math.sqrt(Math.min(b, 4));
      out += '<circle cx="' + fmt(host.x + q.x) + '" cy="' + fmt(host.y + q.y) + '" r="' + fmt(18 + 40 * s) +
        '" fill="url(#gGlow)" opacity="' + Math.min(1, 0.05 + 0.85 * s).toFixed(2) + '"/>';
    });
    layers.glow.innerHTML = out;
  }

  function renderTags() {
    var s = stopSocket();
    layers.tags.innerHTML = s ? '<g class="tag" transform="translate(' + fmt(s.x) + ' ' + fmt(s.y + 51) + ')">' +
      '<rect x="-40" y="-11" width="80" height="22" rx="5"/><text y="4.5">정지 램프</text></g>' : '';
  }

  function renderTerms() {
    var sel = G.selected;
    var armed = (sel && (sel.kind === 'clip' || sel.kind === 'term')) || (drag && drag.moved && drag.kind === 'clip');
    layers.terms.innerHTML = activeTerms().map(function (t) {
      var isSel = sel && sel.kind === 'term' && sel.partId === t.part.id && sel.term === t.term;
      var isNear = nearTerm && nearTerm.part === t.part && nearTerm.term === t.term;
      var ring = 'term-ring' + (isSel ? ' is-selected' : isNear ? ' is-near' : armed ? ' is-armed' : '');
      return '<circle class="term" data-kind="term" data-part="' + t.part.id + '" data-term="' + t.term + '"' +
        ' data-key="term:' + t.part.id + ':' + t.term + '" tabindex="0" role="button" aria-label="' + TYPES[t.part.type].terms[t.term].label + '"' +
        ' cx="' + fmt(t.pos.x) + '" cy="' + fmt(t.pos.y) + '" r="16"/>' +
        '<circle class="' + ring + '" cx="' + fmt(t.pos.x) + '" cy="' + fmt(t.pos.y) + '" r="11"/>';
    }).join('');
  }

  function strands(at, dir) {
    var out = '';
    [-28, 0, 28].forEach(function (deg) {
      var a = Math.atan2(dir.y, dir.x) + deg * Math.PI / 180;
      out += '<path d="M' + pt(at) + 'l' + fmt(Math.cos(a) * 7) + ' ' + fmt(Math.sin(a) * 7) + '" stroke="#d08a3c" stroke-width="1.6" stroke-linecap="round"/>';
    });
    return out;
  }

  function renderWires(angles) {
    var sel = G.selected;
    var spare = activeSpare();
    var hover = carry && carry.target && carry.target.kind === 'wire' ? carry.target.id : null;
    var wiresOut = '', clipsOut = '';
    G.puzzle.wires.forEach(function (w) {
      var g = wireGeom(w, angles);
      var cls = 'wire';
      if (sel && sel.kind === 'wire' && sel.id === w.id) cls += ' is-selected';
      if (spare === 'wire' && (hover === w.id || (!carry && w.broken === undefined))) cls += ' is-target';
      var hot = result.wires[w.id] && result.wires[w.id].current > 4 ? '<path class="wire-hot" d="' + g.path + '" stroke-width="11" opacity=".55"/>' : '';
      var body;
      if (w.broken) {
        // 끊어진 전선: 가운데가 벌어지고 구리선이 삐져나와 있다
        var t = w.cutAt || 0.5;
        var left = split(g.p, t - 0.035)[0];
        var right = split(g.p, t + 0.035)[1];
        var dl = { x: left[3].x - left[2].x, y: left[3].y - left[2].y };
        var dr = { x: right[0].x - right[1].x, y: right[0].y - right[1].y };
        body = [left, right].map(function (c) {
          return '<path d="' + curve(c) + '" fill="none" stroke="#000000" stroke-opacity=".25" stroke-width="7" transform="translate(2 3)"/>' +
            '<path d="' + curve(c) + '" fill="none" stroke="' + w.color + '" stroke-width="6" stroke-linecap="butt"/>' +
            '<path d="' + curve(c) + '" fill="none" stroke="#ffffff" stroke-opacity=".3" stroke-width="1.6" transform="translate(-.8 -1.6)"/>';
        }).join('') + strands(left[3], dl) + strands(right[0], dr);
      } else {
        body = '<path d="' + g.path + '" fill="none" stroke="#000000" stroke-opacity=".25" stroke-width="7" transform="translate(2 3)"/>' +
          '<path d="' + g.path + '" fill="none" stroke="' + w.color + '" stroke-width="6" stroke-linecap="round"/>' +
          '<path d="' + g.path + '" fill="none" stroke="#ffffff" stroke-opacity=".3" stroke-width="1.6" transform="translate(-.8 -1.6)"/>';
      }
      wiresOut += '<g class="' + cls + '" data-kind="wire" data-wire="' + w.id + '"' + (w.broken ? ' data-broken="true"' : '') + '>' +
        '<path class="wire-select" d="' + g.path + '" stroke-width="14"/>' + hot + body +
        '<path class="wire-hit" d="' + g.path + '" stroke-width="18"/>' +
        '</g>';

      g.ends.forEach(function (end, i) {
        var e = w.ends[i];
        var isSel = sel && sel.kind === 'clip' && sel.wireId === w.id && sel.end === i;
        var where = !e.attach ? '비어 있음' : e.attach.term ? '금속 단자에 물림' : '부도체 부분에 물림';
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

  function spareArt(item) {
    if (item === 'battery') return { svg: P.draw('battery', {}), w: 132, h: 40, cy: 0 };
    if (item === 'bulb') return { svg: P.draw('bulb', {}), w: 48, h: 80, cy: 0 };
    if (item === 'rodMetal') return { svg: P.draw('rodMetal', {}), w: 160, h: 32, cy: 0 };
    return {
      svg: '<path d="M-58 -6C-30 30 30 30 58 -6" stroke="#2f6fd0" stroke-width="6" fill="none" stroke-linecap="round"/>' +
        '<g transform="translate(-94 -6) rotate(180)">' + P.clip('#2f6fd0') + '</g>' +
        '<g transform="translate(94 -6)">' + P.clip('#2f6fd0') + '</g>',
      w: 220, h: 60, cy: -8
    };
  }

  function renderTray() {
    var sel = G.selected;
    layers.tray.innerHTML = SPARES.map(function (s, i) {
      var cell = traySlot(i);
      var left = G.puzzle.spares[s.item];
      var isSel = sel && sel.kind === 'spare' && sel.item === s.item;
      var art = spareArt(s.item);
      var areaH = cell.h - 26;
      var scale = Math.min(1, (cell.w - 24) / art.w, (areaH - 8) / art.h);
      var cx = cell.x + cell.w / 2, cy = cell.y + areaH / 2 + 4 - art.cy * scale;
      var hidden = carry && carry.item === s.item;
      return '<g class="spare' + (left ? '' : ' is-empty') + (isSel ? ' is-selected' : '') + '" data-kind="spare" data-item="' + s.item + '"' +
        ' data-key="spare:' + s.item + '" tabindex="' + (left ? 0 : -1) + '" role="button"' +
        ' aria-label="부품 상자의 ' + s.label + (left ? ', 고장 난 부품 위로 끌어다 놓으면 바꿔 끼워져요' : ', 다 썼어요') + '">' +
        '<rect class="spare-hit" x="' + fmt(cell.x) + '" y="' + fmt(cell.y) + '" width="' + fmt(cell.w) + '" height="' + fmt(cell.h) + '" rx="10"/>' +
        (left && !hidden ? '<g transform="translate(' + fmt(cx) + ' ' + fmt(cy) + ') scale(' + scale.toFixed(3) + ')">' + art.svg + '</g>' : '') +
        '<text class="spare-label" x="' + fmt(cx) + '" y="' + fmt(cell.y + cell.h - 9) + '">' + s.label + (left ? '' : ' · 다 썼어요') + '</text>' +
        '</g>';
    }).join('');
  }

  function renderCarry() {
    if (!carry) { layers.carry.innerHTML = ''; return; }
    var art = spareArt(carry.item);
    layers.carry.innerHTML = '<g class="carry" transform="translate(' + fmt(carry.x) + ' ' + fmt(carry.y) + ') scale(.85)">' + art.svg + '</g>';
  }

  function targetCenter(target, angles) {
    if (target.partId) {
      var p = findPart(target.partId);
      if (!p) return null;
      if (p.type === 'socket') return { x: p.x, y: p.y - 22, r: 82 };
      var b = TYPES[p.type].box;
      return { x: p.x, y: p.y, r: Math.max(b.w, b.h) / 2 + 10 };
    }
    var w = findWire(target.wireId);
    if (!w) return null;
    if (target.end !== undefined) {
      var e = wireGeom(w, angles).ends[target.end];
      return { x: e.tip.x - e.u.x * 16, y: e.tip.y - e.u.y * 16, r: 34 };
    }
    var g = wireGeom(w, angles);
    var at = w.broken ? pointAt(g.p, w.cutAt || 0.5) : g.mid;
    return { x: at.x, y: at.y, r: 34 };
  }

  function renderHint(angles) {
    var out = '';
    if (G.hint && G.phase === 'playing') {
      var c = targetCenter(G.hint.target, angles);
      if (c) out += '<circle class="hint-ring" cx="' + fmt(c.x) + '" cy="' + fmt(c.y) + '" r="' + fmt(c.r) + '"/>';
    }
    if (G.phase === 'over' && G.endReason === 'boom') {
      G.puzzle.faults.forEach(function (f, i) {
        if (B.isFixed(G.puzzle, f)) return;
        var c2 = targetCenter(B.faultTarget(G.puzzle, f), angles);
        if (!c2) return;
        out += '<circle class="reveal-ring" cx="' + fmt(c2.x) + '" cy="' + fmt(c2.y) + '" r="' + fmt(c2.r) + '"/>' +
          '<g class="reveal-num" transform="translate(' + fmt(c2.x + c2.r * 0.72) + ' ' + fmt(c2.y - c2.r * 0.72) + ')">' +
          '<circle r="13"/><text y="5">' + (i + 1) + '</text></g>';
      });
    }
    layers.hint.innerHTML = out;
  }

  function actionsFor(sel) {
    if (!sel || !G.actionsOpen) return [];
    if (sel.kind === 'part') {
      var p = findPart(sel.id);
      if (p && p.type === 'holder' && p.batteryId) return [['flip', '전지 방향 바꾸기']];
    }
    if (sel.kind === 'wire' && findWire(sel.id)) return [['remove', '전선 빼기']];
    return [];
  }

  function renderActionbar(angles) {
    var acts = G.phase === 'playing' && !(drag && drag.moved) ? actionsFor(G.selected) : [];
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
    var sel = G.selected, cx, top, bottom;
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
      var g = wireGeom(findWire(sel.id), angles);
      cx = g.mid.x; top = g.mid.y - 14; bottom = g.mid.y + 14;
    }
    var m = svg.getScreenCTM();
    if (!m) return;
    var sr = stage.getBoundingClientRect();
    function screen(x, y) {
      var q = svg.createSVGPoint();
      q.x = x; q.y = y;
      var r = q.matrixTransform(m);
      return { x: r.x - sr.left, y: r.y - sr.top };
    }
    var a = screen(cx, top), z = screen(cx, bottom);
    var bw = actionbar.offsetWidth, bh = actionbar.offsetHeight;
    var y = a.y - bh - 10;
    if (y < 8) y = Math.min(z.y + 10, sr.height - bh - 8);
    actionbar.style.left = clamp(a.x - bw / 2, 8, Math.max(8, sr.width - bw - 8)) + 'px';
    actionbar.style.top = y + 'px';
  }

  function renderHud() {
    $('score').textContent = G.score;
    $('best').textContent = Math.max(bestScore(), G.phase === 'intro' ? 0 : G.score);
    var playing = G.phase === 'playing';
    hintBtn.disabled = !playing || G.remaining < (PENALTY + 1) * 1000 || !!G.hint;
    quitBtn.hidden = !(playing || G.phase === 'cleared');
    soundBtn.setAttribute('aria-pressed', String(store.sound));
    soundBtn.textContent = store.sound ? '소리 켜짐' : '소리 꺼짐';
  }

  /* ---------- 한 번 그리기 ---------- */

  function update() {
    if (!G.puzzle) return;
    var focusedKey = document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-key') : null;

    result = B.solveState(G.puzzle);
    if (G.phase === 'playing') {
      if (result.shorted && !G.wasShorted && !G.shortPenalized) {
        G.shortPenalized = true;
        G.remaining = Math.max(0, G.remaining - PENALTY * 1000);
        zapSound();
        toast('합선! 전지의 두 극이 전선으로만 이어져 뜨거워졌어요. 시간 −' + PENALTY + '초', 'danger');
      }
      G.wasShorted = result.shorted;
      if (B.defused(G.puzzle, result)) onDefused();
    }

    var angles = clipAngles();
    renderParts();
    renderGlow();
    renderTags();
    renderWires(angles);
    renderTerms();
    renderTray();
    renderHint(angles);
    renderCarry();
    renderTimer();
    renderActionbar(angles);
    renderHud();

    if (focusedKey) {
      var el = svg.querySelector('[data-key="' + focusedKey + '"]');
      if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    }
  }

  /* ---------- 부품 상자 ---------- */

  function spareTargetAt(item, at) {
    var best = null, bestD = Infinity;
    if (item === 'wire') {
      var angles = clipAngles();
      G.puzzle.wires.forEach(function (w) {
        var g = wireGeom(w, angles);
        for (var i = 0; i <= 24; i++) {
          var d = dist(at, pointAt(g.p, i / 24));
          if (d < 30 && d < bestD) { best = { kind: 'wire', id: w.id }; bestD = d; }
        }
      });
      return best;
    }
    var ok = spareTargetsFor(item);
    G.puzzle.parts.forEach(function (p) {
      if (!ok[p.id]) return;
      var anchor = { x: p.x, y: p.y };
      if (p.type === 'socket') {
        var q = rotate(P.SOCKET_SLOT.x, P.SOCKET_SLOT.y, p.rot);
        anchor = { x: p.x + q.x, y: p.y + q.y };
      }
      var d = dist(at, anchor);
      if (d < 85 && d < bestD) { best = { kind: 'part', id: p.id }; bestD = d; }
    });
    return best;
  }

  function insideBoard(at) {
    var b = G.puzzle.board;
    return at.x > b.x + 20 && at.x < b.x + b.w - 20 && at.y > b.y + 20 && at.y < b.y + b.h - 20;
  }

  function applySpare(item, target) {
    var pz = G.puzzle;
    if (!pz.spares[item] || !target) return false;
    if (item === 'battery' && target.kind === 'part') {
      var h = findPart(target.id);
      if (!h || h.type !== 'holder' || h.batteryId) return false;
      var bid = newId('battery');
      pz.parts.push({ id: bid, type: 'battery', holderId: h.id, flipped: false, x: h.x, y: h.y, rot: h.rot });
      h.batteryId = bid;
      toast('새 전지를 넣었어요.');
    } else if (item === 'bulb' && target.kind === 'part') {
      var s = findPart(target.id);
      if (!s || s.type !== 'socket') return false;
      if (s.bulbId) pz.parts = pz.parts.filter(function (p) { return p.id !== s.bulbId; });
      var nb = newId('bulb');
      pz.parts.push({ id: nb, type: 'bulb', socketId: s.id, broken: 0, x: s.x, y: s.y, rot: 0 });
      s.bulbId = nb;
      toast('새 전구를 끼웠어요.');
    } else if (item === 'rodMetal' && target.kind === 'part') {
      var r = findPart(target.id);
      if (!r || (r.type !== 'rodPlastic' && r.type !== 'rodRubber')) return false;
      r.type = 'rodMetal';
      toast('금속 막대로 바꿨어요.');
    } else if (item === 'wire' && target.kind === 'wire') {
      var w = findWire(target.id);
      if (!w) return false;
      w.broken = false;
      delete w.cutAt;
      toast('새 전선으로 바꿨어요.');
    } else if (item === 'wire' && target.kind === 'board') {
      pz.wires.push({
        id: newId('wire'), color: WIRE_COLORS[pz.seq % WIRE_COLORS.length], broken: false,
        ends: [{ x: target.at.x - 60, y: target.at.y, attach: null }, { x: target.at.x + 60, y: target.at.y, attach: null }]
      });
      toast('새 전선을 꺼냈어요. 집게를 금속 부분에 물려 보세요.');
    } else {
      return false;
    }
    pz.spares[item] -= 1;
    return true;
  }

  /* ---------- 누르기 ---------- */

  function termRef(partId, term) {
    var p = findPart(partId);
    return p ? { part: p, term: term, pos: B.termPos(p, term) } : null;
  }

  function freeWire() {
    for (var i = G.puzzle.wires.length - 1; i >= 0; i--) {
      var w = G.puzzle.wires[i];
      if (!w.ends[0].attach && !w.ends[1].attach) return w;
    }
    return null;
  }

  function attachEnd(w, i, t) {
    w.ends[i].attach = { partId: t.part.id, term: t.term };
    delete w.ends[i].angle;
  }

  function tapTerm(partId, term) {
    var sel = G.selected;
    var t = termRef(partId, term);
    if (!t) return;
    if (sel && sel.kind === 'clip') {
      var w = findWire(sel.wireId);
      if (w) attachEnd(w, sel.end, t);
      G.selected = null;
      return;
    }
    if (sel && sel.kind === 'term') {
      if (sel.partId === partId && sel.term === term) { G.selected = null; return; }
      var from = termRef(sel.partId, sel.term);
      G.selected = null;
      var fw = freeWire();
      if (!from) return;
      if (!fw) { toast('물리지 않은 전선이 없어요. 집게를 끌어서 옮겨 보세요.'); return; }
      attachEnd(fw, 0, from);
      attachEnd(fw, 1, t);
      return;
    }
    G.selected = { kind: 'term', partId: partId, term: term };
  }

  function tap(d) {
    var sel = G.selected;
    G.actionsOpen = false;
    if (d.kind === 'spare') {
      if (!G.puzzle.spares[d.item]) return;
      var same = sel && sel.kind === 'spare' && sel.item === d.item;
      G.selected = same ? null : { kind: 'spare', item: d.item };
      if (!same) toast('바꿔 끼울 곳을 누르세요.');
      return;
    }
    if (sel && sel.kind === 'spare') {
      var target = null;
      if (d.kind === 'wire' || d.kind === 'clip') target = { kind: 'wire', id: d.wireId };
      else if (d.kind === 'part' || d.kind === 'term') target = { kind: 'part', id: d.partId };
      else if (d.kind === 'bg' && sel.item === 'wire' && insideBoard(d.pt)) target = { kind: 'board', at: d.pt };
      if (target && applySpare(sel.item, target)) G.selected = null;
      else if (d.kind === 'bg') G.selected = null;
      else toast(CANNOT[sel.item]);
      return;
    }
    if (d.kind === 'bg') {
      G.selected = null;
      return;
    }
    if (d.kind === 'part') {
      var p = findPart(d.partId);
      if (!p) return;
      if (sel && (sel.kind === 'clip' || sel.kind === 'term')) {
        var t = nearestTerm(d.pt, Infinity, p);
        if (t) { tapTerm(t.part.id, t.term); return; }
      }
      if (p.type === 'switch') {
        p.closed = !p.closed;
        G.selected = null;
        return;
      }
      if (p.type === 'holder' && p.batteryId) {
        G.selected = { kind: 'part', id: p.id };
        G.actionsOpen = true;
        return;
      }
      G.selected = null;
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
      if (sel && sel.kind === 'clip' && sel.wireId === d.wireId && sel.end === d.end) { G.selected = null; return; }
      if (sel && (sel.kind === 'clip' || sel.kind === 'term') && e.attach && e.attach.term) {
        tapTerm(e.attach.partId, e.attach.term);
        return;
      }
      G.selected = { kind: 'clip', wireId: d.wireId, end: d.end };
      return;
    }
    if (d.kind === 'wire') {
      G.selected = { kind: 'wire', id: d.wireId };
      G.actionsOpen = true;
    }
  }

  function doAction(act) {
    var sel = G.selected;
    if (!sel || G.phase !== 'playing') return;
    if (act === 'flip' && sel.kind === 'part') {
      var h = findPart(sel.id);
      if (h && h.batteryId) {
        var bat = findPart(h.batteryId);
        bat.flipped = !bat.flipped;
      }
    }
    if (act === 'remove' && sel.kind === 'wire') {
      G.puzzle.wires = G.puzzle.wires.filter(function (w) { return w.id !== sel.id; });
      G.selected = null;
      G.actionsOpen = false;
    }
    update();
  }

  actionbar.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (btn) doAction(btn.getAttribute('data-act'));
  });

  /* ---------- 끌기 ---------- */

  function toTable(e) {
    var m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    var q = svg.createSVGPoint();
    q.x = e.clientX; q.y = e.clientY;
    var r = q.matrixTransform(m.inverse());
    return { x: r.x, y: r.y };
  }

  function readTarget(el) {
    if (!el) return { kind: 'bg' };
    return {
      kind: el.getAttribute('data-kind'),
      partId: el.getAttribute('data-part'),
      term: el.getAttribute('data-term'),
      wireId: el.getAttribute('data-wire'),
      end: el.hasAttribute('data-end') ? Number(el.getAttribute('data-end')) : null,
      item: el.getAttribute('data-item')
    };
  }

  svg.addEventListener('pointerdown', function (e) {
    if (G.phase !== 'playing' || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    unlockAudio();
    var d = readTarget(e.target.closest('[data-kind]'));
    var at = toTable(e);
    d.pointerId = e.pointerId;
    d.sx = e.clientX; d.sy = e.clientY;
    d.pt = at;
    d.moved = false;
    if (d.kind === 'clip') {
      var w = findWire(d.wireId);
      if (!w) return;
      var pos = endPos(w, d.end);
      d.dx = pos.x - at.x; d.dy = pos.y - at.y;
    } else if (d.kind === 'wire') {
      d.last = at;
    } else if (d.kind === 'spare' && !G.puzzle.spares[d.item]) {
      return;
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
    var at = toTable(e);
    var b = G.puzzle.board;
    if (drag.kind === 'clip') {
      var end = findWire(drag.wireId).ends[drag.end];
      end.x = clamp(at.x + drag.dx, b.x + 6, b.x + b.w - 6);
      end.y = clamp(at.y + drag.dy, b.y + 6, b.y + b.h - 6);
      nearTerm = nearestTerm(end, SNAP);
    } else if (drag.kind === 'wire') {
      var dx = at.x - drag.last.x, dy = at.y - drag.last.y;
      findWire(drag.wireId).ends.forEach(function (en) {
        if (en.attach) return;
        en.x = clamp(en.x + dx, b.x + 6, b.x + b.w - 6);
        en.y = clamp(en.y + dy, b.y + 6, b.y + b.h - 6);
        delete en.angle;
      });
      drag.last = at;
    } else if (drag.kind === 'spare') {
      carry = { item: drag.item, x: at.x, y: at.y, target: spareTargetAt(drag.item, at) };
    }
    update();
  });

  function beginDrag() {
    svg.classList.add('dragging');
    G.actionsOpen = false;
    if (drag.kind === 'clip') {
      var w = findWire(drag.wireId);
      var e = w.ends[drag.end];
      if (e.attach) {
        var pos = endPos(w, drag.end);
        e.x = pos.x; e.y = pos.y;
        e.attach = null;
      }
      delete e.angle;
      G.selected = null;
    } else if (drag.kind === 'spare') {
      G.selected = null;
    }
  }

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var d = drag;
    drag = null;
    svg.classList.remove('dragging');
    if (G.phase !== 'playing') { carry = null; nearTerm = null; return; }
    if (cancelled) {
      nearTerm = null;
      carry = null;
    } else if (d.moved) {
      if (d.kind === 'clip') {
        var w = findWire(d.wireId);
        if (w && nearTerm) attachEnd(w, d.end, nearTerm);
        nearTerm = null;
      } else if (d.kind === 'spare' && carry) {
        var target = carry.target || (carry.item === 'wire' && insideBoard(carry) ? { kind: 'board', at: { x: carry.x, y: carry.y } } : null);
        if (!applySpare(carry.item, target)) toast(CANNOT[carry.item]);
        carry = null;
      }
    } else {
      tap(d);
    }
    update();
  }

  svg.addEventListener('pointerup', function (e) { endDrag(e, false); });
  svg.addEventListener('pointercancel', function (e) { endDrag(e, true); });

  svg.addEventListener('keydown', function (e) {
    if (G.phase !== 'playing') return;
    var el = e.target.closest ? e.target.closest('[data-kind]') : null;
    if ((e.key === 'Enter' || e.key === ' ') && el) {
      e.preventDefault();
      unlockAudio();
      var d = readTarget(el);
      if (d.kind === 'part') {
        var p = findPart(d.partId);
        d.pt = p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
      }
      tap(d);
      update();
    } else if (e.key === 'Escape') {
      G.selected = null;
      G.actionsOpen = false;
      update();
    }
  });

  /* ---------- 알림 ---------- */

  function toast(text, tone) {
    toastEl.textContent = text;
    toastEl.setAttribute('data-tone', tone || '');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, tone === 'danger' ? 3200 : 2400);
  }

  /* ---------- 시간 ---------- */

  function frame(now) {
    if (G.phase !== 'playing') { rafId = null; return; }
    // 다른 화면으로 갔다 오면 그동안은 세지 않는다
    var dt = lastFrame === null ? 0 : Math.min(250, now - lastFrame);
    lastFrame = now;
    var before = Math.ceil(G.remaining / 1000);
    G.remaining -= dt;
    var after = Math.ceil(G.remaining / 1000);
    if (after !== before && after > 0) tickSound(after);
    renderTimer();
    if (G.remaining < (PENALTY + 1) * 1000 && !hintBtn.disabled) renderHud();
    if (G.remaining <= 0) { explode(); return; }
    rafId = requestAnimationFrame(frame);
  }
  function startClock() {
    lastFrame = null;
    if (!rafId) rafId = requestAnimationFrame(frame);
  }
  function stopClock() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  /* ---------- 한 판의 흐름 ---------- */

  function layoutKind() {
    var w = stage.clientWidth, h = stage.clientHeight;
    return w >= h * 1.05 ? 'wide' : 'tall';
  }

  function hideOverlays() {
    introEl.hidden = true;
    clearedEl.hidden = true;
    overEl.hidden = true;
    stage.classList.remove('is-over');
  }

  function startGame() {
    unlockAudio();
    G.name = nameInput.value.trim().slice(0, 12);
    store.name = G.name;
    saveStore();
    G.seed = Math.floor(Math.random() * 1e9);
    G.run = B.createRun(G.seed);
    G.score = 0;
    G.newBest = false;
    G.rank = -1;
    nextBomb();
  }

  function nextBomb() {
    clearInterval(nextTimer);
    nextTimer = null;
    G.puzzle = G.run.next(layoutKind());
    G.remaining = G.puzzle.timeLimit * 1000;
    G.phase = 'playing';
    G.selected = null;
    G.actionsOpen = false;
    G.hint = null;
    G.shortPenalized = false;
    G.endReason = '';
    carry = null;
    nearTerm = null;
    G.wasShorted = B.solveState(G.puzzle).shorted;
    hideOverlays();
    renderCasing();
    update();
    startClock();
    toast(G.puzzle.bombNo + '번째 폭탄! 제한 시간 ' + G.puzzle.timeLimit + '초', 'danger');
  }

  function causesHtml(faults, markMissed) {
    return faults.map(function (f, i) {
      var missed = markMissed && !B.isFixed(G.puzzle, f);
      return '<li class="cause' + (missed ? ' is-missed' : '') + '">' +
        '<span class="cause-chip">' + (markMissed ? '<span class="cause-num">' + (i + 1) + '</span>' : '') + B.FAULTS[f.type].label + '</span>' +
        '<span>' + B.explain(f) + '</span></li>';
    }).join('');
  }

  function onDefused() {
    G.phase = 'cleared';
    G.score += 1;
    G.selected = null;
    G.actionsOpen = false;
    G.hint = null;
    carry = null;
    stopClock();
    chimeSound();
    var left = Math.max(0, Math.ceil(G.remaining / 1000));
    $('clearedTime').textContent = left + '초 남기고 멈췄어요. 고장 원인을 확인해 보세요.';
    $('clearedCauses').innerHTML = causesHtml(G.puzzle.faults, false);
    clearedEl.hidden = false;
    var wait = NEXT_DELAY;
    $('nextCount').textContent = '(' + wait + ')';
    clearInterval(nextTimer);
    nextTimer = setInterval(function () {
      wait -= 1;
      $('nextCount').textContent = '(' + wait + ')';
      if (wait <= 0) nextBomb();
    }, 1000);
  }

  function explode() {
    G.remaining = 0;
    G.phase = 'over';
    G.endReason = 'boom';
    G.selected = null;
    G.actionsOpen = false;
    G.hint = null;
    drag = null;
    carry = null;
    stopClock();
    boomSound();
    stage.classList.add('is-boom');
    boomEl.hidden = false;
    update();
    setTimeout(function () {
      boomEl.hidden = true;
      stage.classList.remove('is-boom');
      finishRun();
    }, 1100);
  }

  function quit() {
    if (G.phase !== 'playing' && G.phase !== 'cleared') return;
    stopClock();
    clearInterval(nextTimer);
    nextTimer = null;
    G.phase = 'over';
    G.endReason = 'quit';
    finishRun();
  }

  function finishRun() {
    var best = bestScore();
    G.rank = G.score > 0 ? addRecord(G.name, G.score) : -1;
    G.newBest = G.score > 0 && G.score > best;
    var boom = G.endReason === 'boom';
    $('overEyebrow').textContent = boom ? '폭발' : '작전 종료';
    $('overTitle').textContent = boom ? '펑! 폭탄이 터졌어요' : '작전을 마쳤어요';
    $('finalScore').textContent = G.score;
    $('newBest').hidden = !G.newBest;
    $('overCauses').innerHTML = boom
      ? '<p class="sub">빨간 동그라미가 이 폭탄의 고장 난 곳이에요.</p><ul class="causes">' + causesHtml(G.puzzle.faults, true) + '</ul>'
      : '';
    $('overRecords').innerHTML = recordsHtml(G.rank);
    hideOverlays();
    overEl.hidden = false;
    stage.classList.add('is-over');
    update();
    $('againBtn').focus({ preventScroll: true });
  }

  function recordsHtml(highlight) {
    if (!store.records.length) return '<p class="records-empty">아직 기록이 없어요. 첫 기록을 세워 보세요!</p>';
    return '<h3>이 기기 기록</h3><ol>' + store.records.map(function (r, i) {
      var d = new Date(r.at);
      return '<li' + (i === highlight ? ' class="is-me"' : '') + '><span class="rank">' + (i + 1) + '</span>' +
        '<span class="who">' + esc(r.name) + '</span><span class="pts">' + r.score + '개</span>' +
        '<span class="when">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span></li>';
    }).join('') + '</ol>';
  }

  function showIntro() {
    stopClock();
    clearInterval(nextTimer);
    nextTimer = null;
    G.phase = 'intro';
    G.score = 0;
    G.endReason = '';
    // 첫 화면 뒤에는 예시 폭탄을 깔아 둔다
    G.puzzle = B.createRun(20261028).next(layoutKind());
    G.remaining = G.puzzle.timeLimit * 1000;
    nameInput.value = store.name;
    $('introRecords').innerHTML = recordsHtml(-1) +
      (store.records.length ? '<div class="records-tools"><button type="button" class="link-btn" id="clearRecords">이 기기 기록 지우기</button></div>' : '');
    hideOverlays();
    introEl.hidden = false;
    renderCasing();
    update();
  }

  /* ---------- 단추 ---------- */

  $('startForm').addEventListener('submit', function (e) {
    e.preventDefault();
    startGame();
  });
  $('nextBtn').addEventListener('click', function () { if (G.phase === 'cleared') nextBomb(); });
  $('againBtn').addEventListener('click', function () { nameInput.value = G.name; startGame(); });
  $('homeBtn').addEventListener('click', showIntro);
  quitBtn.addEventListener('click', quit);

  hintBtn.addEventListener('click', function () {
    if (G.phase !== 'playing' || G.hint) return;
    var left = G.puzzle.faults.filter(function (f) { return !B.isFixed(G.puzzle, f); });
    if (!left.length) return;
    G.remaining = Math.max(1000, G.remaining - PENALTY * 1000);
    G.hint = { target: B.faultTarget(G.puzzle, left[0]) };
    toast('반짝이는 곳을 살펴보세요. 시간 −' + PENALTY + '초');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { G.hint = null; update(); }, HINT_SHOW);
    update();
  });

  soundBtn.addEventListener('click', function () {
    store.sound = !store.sound;
    saveStore();
    if (store.sound) unlockAudio();
    renderHud();
  });

  // 기록 지우기는 두 번 눌러야 한다
  introEl.addEventListener('click', function (e) {
    var btn = e.target.closest('#clearRecords');
    if (!btn) return;
    if (clearArmed) {
      clearTimeout(clearArmed);
      clearArmed = null;
      store.records = [];
      saveStore();
      showIntro();
      return;
    }
    btn.textContent = '한 번 더 누르면 기록이 모두 지워져요';
    clearArmed = setTimeout(function () {
      clearArmed = null;
      btn.textContent = '이 기기 기록 지우기';
    }, 3000);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && G.phase === 'playing') startClock();
  });

  /* ---------- 화면 크기 ---------- */

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function () { if (G.puzzle) update(); }).observe(stage);
  } else {
    window.addEventListener('resize', function () { if (G.puzzle) update(); });
  }

  /* ---------- 시작 ---------- */

  $('defs').innerHTML = P.DEFS + GAME_DEFS;
  showIntro();

  // claude.ai에서 새 판이 올라와도 하던 판을 이어 갈 수 있게 상태를 넘겨준다
  var hot = window.claude && window.claude.hot;
  function resume(saved) {
    if (!saved || !saved.puzzle) return;
    G.name = saved.name || '';
    G.seed = saved.seed;
    G.score = saved.score;
    G.run = B.createRun(saved.seed + saved.puzzle.bombNo, saved.puzzle.bombNo);
    G.puzzle = saved.puzzle;
    G.remaining = saved.remaining;
    G.phase = 'playing';
    G.wasShorted = B.solveState(G.puzzle).shorted;
    hideOverlays();
    renderCasing();
    update();
    startClock();
  }
  try {
    if (hot && typeof hot.snapshot === 'function') {
      hot.snapshot(function () {
        return G.phase === 'playing' ? { game: { name: G.name, seed: G.seed, score: G.score, remaining: G.remaining, puzzle: G.puzzle } } : {};
      });
    }
    if (hot && typeof hot.ready === 'function') hot.ready(function (data) { if (data && data.game) resume(data.game); });
    else if (hot && hot.data && hot.data.game) resume(hot.data.game);
  } catch (err) { /* 이어 하기를 못 해도 새 판으로 시작하면 된다 */ }
})();
