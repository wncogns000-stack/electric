/*
 * 전자석 만들기 작업대
 *
 * 교과서 64쪽 준비물(둥근 머리 볼트, 에나멜선, 종이, 셀로판테이프, 사포)로 전자석을 만든다.
 *  1) 볼트에 종이를 감고 셀로판테이프로 붙인다
 *  2) 볼트 머리의 손잡이를 돌려 에나멜선을 감고, 다 감으면 자른다
 *  3) 에나멜선 양 끝을 사포로 문질러 겉면(부도체)을 벗긴다
 * 교과서에는 만드는 순서가 나오지 않아(『실험관찰』 40쪽에 있음) 준비물로 미루어 이 순서로 정했다.
 * 작업 상태는 볼트 부품에 그대로 적는다: paper, tape, turns, cut, sand[왼쪽 끝, 오른쪽 끝]
 * 작업대를 닫으면 app.js가 볼트를 전자석으로 바꾼다.
 */
(function (root) {
  'use strict';

  var MIN_TURNS = 50;      // 이만큼은 감아야 자를 수 있다
  var GOOD_TURNS = 100;
  var MAX_TURNS = 200;     // 볼트에 두 겹까지 감을 수 있다
  var TURNS_PER_REV = 10;  // 손잡이를 한 바퀴 돌리면 감기는 횟수 (실제보다 많이 감긴다)
  var SAND_WORK = 420;     // 사포를 이만큼(작업대 좌표) 문지르면 겉면이 다 벗겨진다
  var LAYER = 100;         // 한 겹에 감기는 횟수 (parts.js와 같다)

  // 작업대 그림 좌표 (viewBox 800 × 360)
  var HEAD = { x: 122, y: 140 };
  var DIAL_R = 64;
  var COIL = { x: 176, w: 428 };
  var TIP_Y = 268;
  var SAND_HOME = { x: 420, y: 330 };
  var SPOOL = { x: 716, y: 246 };

  function $(id) { return document.getElementById(id); }
  var dialog = $('benchDialog');
  var svg = $('benchSvg');
  var scene = $('benchScene');
  var stepsEl = $('benchSteps');
  var ctrlEl = $('benchControls');
  var tipEl = $('benchTip');
  var placeBtn = $('benchPlace');

  var part = null;
  var hooks = null;
  var drag = null;
  var sandAt = null;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fmt(n) { return Math.round(n * 10) / 10; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // 지금 할 단계: 1 종이, 2 감기, 3 벗기기, 4 다 만듦
  function stage() {
    if (!part.paper || !part.tape) return 1;
    if (!part.cut) return 2;
    if (part.sand[0] < 1 || part.sand[1] < 1) return 3;
    return 4;
  }

  // 에나멜선이 감기고 있는 곳의 x (두 번째 겹은 오른쪽에서 왼쪽으로 감는다)
  function front() {
    var t = part.turns;
    if (t <= LAYER) return COIL.x + COIL.w * t / LAYER;
    return COIL.x + COIL.w - COIL.w * Math.min(1, (t - LAYER) / LAYER);
  }

  function tips() {
    return [{ x: 150, y: TIP_Y }, { x: clamp(front() + 40, 240, 680), y: TIP_Y }];
  }

  function tipColor(amount) {
    var a = clamp(amount, 0, 1);
    var mix = function (c0, c1) { return Math.round(c0 + (c1 - c0) * a); };
    return 'rgb(' + mix(110, 242) + ',' + mix(44, 178) + ',' + mix(16, 120) + ')';
  }

  function lead(fromX, fromY, tip, amount) {
    return '<path d="M' + fmt(fromX) + ' ' + fromY + 'C' + fmt(fromX) + ' 222 ' + fmt(tip.x) + ' 214 ' + fmt(tip.x) + ' ' + (tip.y - 28) + '"' +
      ' fill="none" stroke="#8a3a14" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M' + fmt(tip.x) + ' ' + (tip.y - 28) + 'V' + tip.y + '" stroke="' + tipColor(amount) + '" stroke-width="6" stroke-linecap="round"/>' +
      (amount >= 1 ? '<circle cx="' + fmt(tip.x + 2) + '" cy="' + (tip.y - 18) + '" r="2" fill="#ffffff" opacity=".9"/>' : '');
  }

  function tipLabel(tip, amount) {
    var text = amount >= 1 ? '벗김' : amount > 0 ? Math.round(amount * 100) + '%' : '겉면 그대로';
    return '<text class="bench-tip-label" x="' + fmt(tip.x) + '" y="' + (tip.y + 24) + '">' + text + '</text>';
  }

  function renderScene() {
    var st = stage();
    var t = part.turns;
    var fx = front();
    var tp = tips();
    var out = [
      '<rect class="bench-mat" width="800" height="360" rx="14"/>',
      '<rect width="800" height="360" rx="14" fill="url(#gridMinor)"/>',
      '<rect width="800" height="360" rx="14" fill="url(#gridMajor)"/>'
    ];

    // 손잡이: 볼트 머리를 잡고 돌린다
    var ang = (t / TURNS_PER_REV) * Math.PI * 2 - Math.PI / 2;
    var knob = { x: HEAD.x + Math.cos(ang) * DIAL_R, y: HEAD.y + Math.sin(ang) * DIAL_R };
    out.push('<g class="dial' + (st === 2 ? ' is-active' : '') + '" data-bench="dial">' +
      '<circle class="dial-hit" cx="' + HEAD.x + '" cy="' + HEAD.y + '" r="100"/>' +
      '<circle class="dial-ring" cx="' + HEAD.x + '" cy="' + HEAD.y + '" r="' + DIAL_R + '"/>' +
      (st === 2 ? '<path class="dial-arrow" d="M' + (HEAD.x + 46) + ' ' + (HEAD.y - 70) + 'A84 84 0 0 1 ' + (HEAD.x + 82) + ' ' + (HEAD.y - 22) + '"/>' +
        '<path class="dial-arrow-head" d="M' + (HEAD.x + 74) + ' ' + (HEAD.y - 30) + 'l9 9l5 -12z"/>' : '') +
      '<path class="dial-arm" d="M' + HEAD.x + ' ' + HEAD.y + 'L' + fmt(knob.x) + ' ' + fmt(knob.y) + '"/>' +
      '<circle class="dial-knob" cx="' + fmt(knob.x) + '" cy="' + fmt(knob.y) + '" r="15"/>' +
      '</g>');

    // 둥근 머리 볼트
    out.push('<rect x="140" y="124" width="500" height="32" rx="4" fill="url(#gMetal)" stroke="#868c92" stroke-width="1"/>');
    out.push('<path d="M606 124V156M614 124V156M622 124V156M630 124V156" stroke="#868c92" stroke-width="1.5"/>');
    out.push('<path d="M142 104H128A30 36 0 0 0 128 176H142Z" fill="url(#gMetal)" stroke="#868c92" stroke-width="1.2"/>');
    if (part.paper) {
      out.push('<rect x="170" y="117" width="440" height="46" rx="4" fill="#f4f1e8" stroke="#d3cbb8"/>');
      out.push('<path d="M186 128H594M186 152H594" stroke="#e2dccb" stroke-width="1"/>');
    }
    if (part.tape) {
      out.push('<rect x="166" y="110" width="30" height="60" rx="3" fill="#cfe6ff" opacity=".65" stroke="#ffffff" stroke-opacity=".8"/>');
      out.push('<rect x="584" y="110" width="30" height="60" rx="3" fill="#cfe6ff" opacity=".65" stroke="#ffffff" stroke-opacity=".8"/>');
    }

    // 감은 에나멜선
    if (st === 2) out.push('<text class="bench-count" x="' + (COIL.x + COIL.w / 2) + '" y="94">' + Math.floor(t) + '번 감음</text>');
    if (t > 0) {
      var len1 = COIL.w * Math.min(1, Math.max(0.03, t / LAYER));
      out.push('<rect x="' + COIL.x + '" y="114" width="' + fmt(len1) + '" height="52" rx="6" fill="url(#benchCoil)"/>');
      out.push('<rect x="' + COIL.x + '" y="116" width="' + fmt(len1) + '" height="12" rx="5" fill="#ffffff" opacity=".2"/>');
      if (t > LAYER) {
        var len2 = COIL.w * Math.min(1, (t - LAYER) / LAYER);
        out.push('<rect x="' + fmt(COIL.x + COIL.w - len2) + '" y="108" width="' + fmt(len2) + '" height="64" rx="8" fill="url(#benchCoil)"/>');
        out.push('<rect x="' + fmt(COIL.x + COIL.w - len2) + '" y="108" width="' + fmt(len2) + '" height="64" rx="8" fill="#5a2a0c" opacity=".22"/>');
      }
      out.push(lead(COIL.x + 6, 166, tp[0], part.sand[0]));
      if (part.cut) out.push(lead(fx, t > LAYER ? 172 : 166, tp[1], part.sand[1]));
      else {
        // 아직 자르지 않은 에나멜선은 타래까지 이어져 있다
        var bottom = t > LAYER ? 172 : 166;
        out.push('<path d="M' + fmt(fx) + ' ' + bottom + 'C' + fmt(fx + 20) + ' ' + (bottom + 60) + ' ' + (SPOOL.x - 140) + ' ' + (SPOOL.y - 8) + ' ' + (SPOOL.x - 30) + ' ' + (SPOOL.y - 8) + '"' +
          ' fill="none" stroke="#b8692e" stroke-width="3"/>');
      }
      if (part.cut) {
        out.push(tipLabel(tp[0], part.sand[0]));
        out.push(tipLabel(tp[1], part.sand[1]));
        if (st === 3) {
          tp.forEach(function (tip, k) {
            if (part.sand[k] < 1) out.push('<circle class="bench-target" cx="' + fmt(tip.x) + '" cy="' + (tip.y - 16) + '" r="27"/>');
          });
        }
      }
    }

    // 에나멜선 타래
    out.push('<g transform="translate(' + SPOOL.x + ' ' + SPOOL.y + ')">' +
      '<rect x="-38" y="-36" width="76" height="10" rx="3" fill="#6b5a45"/>' +
      '<rect x="-38" y="26" width="76" height="10" rx="3" fill="#6b5a45"/>' +
      '<rect x="-30" y="-26" width="60" height="52" fill="url(#benchCoil)"/>' +
      '<text class="bench-label" y="56">에나멜선</text></g>');

    // 사포
    var sp = sandAt || SAND_HOME;
    out.push('<g class="sandpaper' + (st >= 3 ? '' : ' is-off') + '" data-bench="sandpaper" transform="translate(' + fmt(sp.x) + ' ' + fmt(sp.y) + ')">' +
      '<rect x="-48" y="-24" width="96" height="48" rx="5" fill="#d8b47a" stroke="#a8834c" stroke-width="1.5"/>' +
      '<rect x="-48" y="-24" width="96" height="48" rx="5" fill="url(#grit)"/>' +
      '<text class="bench-label bench-label-dark" y="6">사포</text></g>');

    scene.innerHTML = out.join('');
  }

  function pct(v) { return v >= 1 ? '다 벗김' : Math.round(v * 100) + '%'; }

  function renderSteps() {
    var st = stage();
    var items = [
      { n: 1, title: '종이 감기', text: part.tape ? '종이를 감고 셀로판테이프로 붙였어요.' : '볼트에 종이를 감고 셀로판테이프로 붙여요.' },
      { n: 2, title: '에나멜선 감기', text: '감은 횟수 <strong>' + Math.floor(part.turns) + '</strong>번' + (st <= 2 && part.turns < GOOD_TURNS ? ' · ' + GOOD_TURNS + '번 이상 감아 보세요' : '') },
      { n: 3, title: '양 끝 벗기기', text: '왼쪽 끝 ' + pct(part.sand[0]) + ' · 오른쪽 끝 ' + pct(part.sand[1]) }
    ];
    stepsEl.innerHTML = items.map(function (it) {
      var cls = st > it.n ? ' is-done' : st === it.n ? ' is-current' : '';
      return '<li class="bench-step' + cls + '"><span class="bench-num" aria-hidden="true">' + (st > it.n ? '✓' : it.n) + '</span>' +
        '<span class="bench-step-text"><b>' + it.title + '</b><span>' + it.text + '</span></span></li>';
    }).join('');
  }

  function renderControls() {
    var st = stage();
    var btns = [];
    if (st === 1) btns.push(part.paper ? ['tape', '셀로판테이프 붙이기', false, true] : ['paper', '종이 감기', false, true]);
    if (st === 2) {
      btns.push(['wind', '한 바퀴 감기', part.turns >= MAX_TURNS]);
      btns.push(['cut', '다 감았어요 · 자르기', part.turns < MIN_TURNS, true]);
    }
    if (st === 3) {
      btns.push(['sand0', '왼쪽 끝 문지르기', part.sand[0] >= 1]);
      btns.push(['sand1', '오른쪽 끝 문지르기', part.sand[1] >= 1]);
    }
    if (st >= 3) btns.push(['redo', '에나멜선 풀고 다시 감기']);
    var sig = JSON.stringify(btns);
    if (ctrlEl.getAttribute('data-sig') !== sig) {
      ctrlEl.innerHTML = btns.map(function (b) {
        return '<button type="button" class="btn' + (b[3] ? ' btn-primary' : '') + '" data-bench-act="' + b[0] + '"' + (b[2] ? ' disabled' : '') + '>' + b[1] + '</button>';
      }).join('');
      ctrlEl.setAttribute('data-sig', sig);
    }
    placeBtn.disabled = !part.cut;
  }

  function renderTip() {
    var st = stage(), text;
    if (st === 1) text = part.paper ? '종이가 풀리지 않게 셀로판테이프로 붙여요.' : '먼저 볼트에 종이를 감아요.';
    else if (st === 2 && part.turns < MIN_TURNS) text = '볼트 머리의 손잡이를 잡고 화살표 방향으로 빙글빙글 돌려요. 한 바퀴에 ' + TURNS_PER_REV + '번씩 감기고, 반대로 돌리면 풀려요.';
    else if (st === 2 && part.turns < GOOD_TURNS) text = '더 감아도 돼요. 다 감았으면 ‘다 감았어요 · 자르기’를 눌러요.';
    else if (st === 2 && part.turns >= MAX_TURNS) text = '볼트에 더 감을 자리가 없어요. ‘다 감았어요 · 자르기’를 눌러 에나멜선을 잘라요.';
    else if (st === 2) text = '잘 감았어요! 더 감거나 ‘다 감았어요 · 자르기’를 눌러 에나멜선을 잘라요.';
    else if (st === 3) text = '에나멜선은 구리 선에 전기가 잘 흐르지 않는 물질을 얇게 입힌 전선이에요. 사포를 끌어 양 끝을 문질러 겉면을 벗겨요.';
    else text = '전자석을 다 만들었어요! ‘테이블에 놓기’를 누르고 전기 회로에 연결해 보세요.';
    if (tipEl.textContent !== text) tipEl.textContent = text;
  }

  function render() {
    renderScene();
    renderSteps();
    renderControls();
    renderTip();
  }

  // 지금 할 일 단추로 초점을 옮긴다. 다 만들었으면 ‘테이블에 놓기’
  function focusNext() {
    var next = stage() === 4 ? placeBtn
      : ctrlEl.querySelector('.btn-primary:not([disabled])') || ctrlEl.querySelector('button:not([disabled])');
    if (next) next.focus({ preventScroll: true });
  }

  function changed() {
    if (hooks && hooks.onChange) hooks.onChange(part);
  }

  function wind(n) { part.turns = clamp(part.turns + n, 0, MAX_TURNS); }
  function sandBy(k, amount) { part.sand[k] = clamp(part.sand[k] + amount, 0, 1); }

  function toLocal(e) {
    var m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    var p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    var q = p.matrixTransform(m.inverse());
    return { x: q.x, y: q.y };
  }

  ctrlEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-bench-act]');
    if (!b || b.disabled || !part) return;
    var act = b.getAttribute('data-bench-act');
    if (act === 'paper') part.paper = true;
    if (act === 'tape') part.tape = true;
    if (act === 'wind') wind(TURNS_PER_REV);
    if (act === 'cut' && part.turns >= MIN_TURNS) part.cut = true;
    if (act === 'sand0') sandBy(0, 0.25);
    if (act === 'sand1') sandBy(1, 0.25);
    // 자른 에나멜선은 이어 감을 수 없으므로 풀어 내고 처음부터 다시 감는다
    if (act === 'redo') { part.turns = 0; part.cut = false; part.sand = [0, 0]; }
    render();
    changed();
    // 단추를 다시 그려도 누르던 단추에 초점을 둔다 (‘한 바퀴 감기’를 이어서 누를 수 있게)
    var same = ctrlEl.querySelector('[data-bench-act="' + act + '"]:not([disabled])');
    if (stage() === 4 || !same) focusNext();
    else if (document.activeElement !== same) same.focus({ preventScroll: true });
  });

  svg.addEventListener('pointerdown', function (e) {
    if (!part || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var at = toLocal(e);
    var el = e.target.closest('[data-bench]');
    var kind = el ? el.getAttribute('data-bench') : null;
    var st = stage();
    if (kind === 'sandpaper' && st >= 3) {
      drag = { mode: 'sand', id: e.pointerId, last: at };
      sandAt = at;
    } else if (kind === 'dial' && st === 2) {
      drag = { mode: 'crank', id: e.pointerId, angle: Math.atan2(at.y - HEAD.y, at.x - HEAD.x) };
    } else {
      return;
    }
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 포인터를 잡지 못해도 끌기는 동작한다 */ }
    e.preventDefault();
    render();
  });

  svg.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var at = toLocal(e);
    if (drag.mode === 'crank') {
      var a = Math.atan2(at.y - HEAD.y, at.x - HEAD.x);
      var d = a - drag.angle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      drag.angle = a;
      // 손잡이 한가운데에서는 각도가 흔들리므로 세지 않는다
      if (dist(at, HEAD) > 14) wind(d / (2 * Math.PI) * TURNS_PER_REV);
    } else {
      var moved = dist(at, drag.last);
      drag.last = at;
      sandAt = at;
      tips().forEach(function (tip, k) {
        if (dist(at, { x: tip.x, y: tip.y - 16 }) < 46) sandBy(k, moved / SAND_WORK);
      });
    }
    render();
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    sandAt = null;
    render();
    changed();
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  function finish() {
    var p = part, h = hooks;
    part = null;
    hooks = null;
    drag = null;
    if (p && h && h.onClose) h.onClose(p);
  }

  function close() {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else { dialog.removeAttribute('open'); finish(); }
  }

  dialog.addEventListener('close', finish);
  placeBtn.addEventListener('click', close);
  $('benchClose').addEventListener('click', close);

  $('benchDefs').innerHTML = [
    '<pattern id="benchCoil" width="6" height="64" patternUnits="userSpaceOnUse">',
    '<rect width="6" height="64" fill="#c27433"/><rect width="1.6" height="64" fill="#8a4a1c"/><rect x="2.6" width="1.4" height="64" fill="#eaa767"/></pattern>',
    '<pattern id="grit" width="7" height="7" patternUnits="userSpaceOnUse">',
    '<circle cx="2" cy="2" r=".9" fill="#8f6b3a"/><circle cx="5.5" cy="5" r=".7" fill="#7a5a30"/></pattern>'
  ].join('');

  // part: 작업할 볼트. hooks.onChange(part): 작업할 때마다, hooks.onClose(part): 작업대를 닫을 때
  function open(p, h) {
    part = p;
    hooks = h || {};
    if (!part.sand) part.sand = [0, 0];
    if (part.turns === undefined) part.turns = 0;
    drag = null;
    sandAt = null;
    ctrlEl.removeAttribute('data-sig');
    render();
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    focusNext();
  }

  root.LabBench = {
    open: open,
    MIN_TURNS: MIN_TURNS,
    // 전자석으로 쓸 수 있을 만큼 감고 잘랐는지
    ready: function (p) { return !!p.cut && p.turns >= MIN_TURNS; }
  };
})(this);
