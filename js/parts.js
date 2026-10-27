/*
 * 실험 도구 그림과 치수
 *
 * 모든 부품은 자기 중심을 (0, 0)으로 하는 좌표로 그린다.
 * terms: 집게를 물릴 수 있는 금속 단자의 위치와, 집게가 다가오는 바깥쪽 방향(out, 도)
 */
(function (root) {
  'use strict';

  var TYPES = {
    battery: {
      name: '전지',
      max: 4,
      radius: 64,
      box: { x: -66, y: -20, w: 132, h: 40 },
      terms: {
        p: { x: 60, y: 0, out: 0, label: '전지의 (+)극' },
        n: { x: -63, y: 0, out: 180, label: '전지의 (−)극' }
      }
    },
    holder: {
      name: '전지 끼우개',
      max: 4,
      radius: 100,
      box: { x: -104, y: -30, w: 208, h: 64 },
      terms: {
        a: { x: -93, y: 0, out: 180, label: '전지 끼우개의 (−)쪽 단자' },
        b: { x: 93, y: 0, out: 0, label: '전지 끼우개의 (+)쪽 단자' }
      }
    },
    bulb: {
      name: '꼬마전구',
      max: 4,
      radius: 40,
      box: { x: -24, y: -40, w: 48, h: 80 },
      terms: {
        tip: { x: 0, y: 32, out: 90, label: '꼬마전구의 꼭지' },
        thread: { x: 9, y: 12, out: 0, label: '꼬마전구의 꼭지쇠' }
      }
    },
    socket: {
      name: '전구 끼우개',
      max: 4,
      radius: 76,
      box: { x: -76, y: -76, w: 152, h: 112 },
      terms: {
        a: { x: -65, y: 14, out: 180, label: '전구 끼우개의 왼쪽 단자' },
        b: { x: 65, y: 14, out: 0, label: '전구 끼우개의 오른쪽 단자' }
      }
    },
    switch: {
      name: '스위치',
      max: 3,
      radius: 90,
      box: { x: -92, y: -32, w: 184, h: 64 },
      terms: {
        a: { x: -81, y: 0, out: 180, label: '스위치의 왼쪽 단자' },
        b: { x: 81, y: 0, out: 0, label: '스위치의 오른쪽 단자' }
      }
    },
    wire: {
      name: '집게 달린 전선',
      max: 10
    }
  };

  // 끼운 꼬마전구가 놓이는 자리 (전구 끼우개 좌표)
  var SOCKET_SLOT = { x: 0, y: -34 };
  // 꼬마전구 유리구의 중심 (꼬마전구 좌표)
  var GLOBE = { x: 0, y: -17 };
  // 집게 끝에서 전선이 붙는 곳까지의 거리
  var CLIP_LENGTH = 36;

  var DEFS = [
    '<linearGradient id="gMetal" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#f5f6f7"/><stop offset=".45" stop-color="#b9bec4"/>',
    '<stop offset=".7" stop-color="#9aa0a7"/><stop offset="1" stop-color="#dfe2e6"/></linearGradient>',
    '<linearGradient id="gBrass" x1="0" y1="0" x2="1" y2="0">',
    '<stop offset="0" stop-color="#b98a2e"/><stop offset=".5" stop-color="#f0d07a"/><stop offset="1" stop-color="#a87a22"/></linearGradient>',
    '<linearGradient id="gBatBody" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#3d6488"/><stop offset=".3" stop-color="#284766"/><stop offset="1" stop-color="#132536"/></linearGradient>',
    '<linearGradient id="gBatBand" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#eaa34f"/><stop offset=".35" stop-color="#c47326"/><stop offset="1" stop-color="#7a4212"/></linearGradient>',
    '<linearGradient id="gTray" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#43484e"/><stop offset="1" stop-color="#1d2024"/></linearGradient>',
    '<linearGradient id="gCream" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#f7f2e6"/><stop offset="1" stop-color="#d9cfb9"/></linearGradient>',
    '<linearGradient id="gCreamSide" x1="0" y1="0" x2="1" y2="0">',
    '<stop offset="0" stop-color="#cfc4ac"/><stop offset=".45" stop-color="#f4eee1"/><stop offset="1" stop-color="#c3b89f"/></linearGradient>',
    '<linearGradient id="gWood" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#ddb37a"/><stop offset="1" stop-color="#b5833f"/></linearGradient>',
    '<radialGradient id="gGlass" cx=".4" cy=".35" r=".7">',
    '<stop offset="0" stop-color="#ffffff" stop-opacity=".85"/><stop offset=".6" stop-color="#dbe9f2" stop-opacity=".45"/>',
    '<stop offset="1" stop-color="#b9cfdc" stop-opacity=".55"/></radialGradient>',
    '<radialGradient id="gGlow">',
    '<stop offset="0" stop-color="#fffbe0" stop-opacity="1"/><stop offset=".22" stop-color="#ffe680" stop-opacity=".9"/>',
    '<stop offset=".55" stop-color="#ffc533" stop-opacity=".35"/><stop offset="1" stop-color="#ffb000" stop-opacity="0"/></radialGradient>',
    '<radialGradient id="gHeat">',
    '<stop offset="0" stop-color="#ff5a36" stop-opacity=".75"/><stop offset="1" stop-color="#ff2a00" stop-opacity="0"/></radialGradient>',
    '<pattern id="gridMinor" width="20" height="20" patternUnits="userSpaceOnUse">',
    '<path d="M20 0H0V20" class="mat-line" fill="none" stroke-width="1"/></pattern>',
    '<pattern id="gridMajor" width="100" height="100" patternUnits="userSpaceOnUse">',
    '<path d="M100 0H0V100" class="mat-line-major" fill="none" stroke-width="1.4"/></pattern>',
    '<clipPath id="socketClip" clipPathUnits="userSpaceOnUse"><rect x="-40" y="-120" width="80" height="99"/></clipPath>'
  ].join('');

  function battery(opts) {
    opts = opts || {};
    return [
      '<rect x="-64" y="-14" width="7" height="28" rx="2" fill="url(#gMetal)"/>',
      '<rect x="-58" y="-17" width="110" height="34" rx="5" fill="url(#gBatBody)"/>',
      '<path d="M14 -17H47a5 5 0 0 1 5 5V12a5 5 0 0 1 -5 5H14Z" fill="url(#gBatBand)"/>',
      '<rect x="51" y="-8" width="9" height="16" rx="2.5" fill="url(#gMetal)"/>',
      '<text x="-20" y="5.5" class="svg-label bat-volt">1.5V</text>',
      '<text x="33" y="6.5" class="svg-label bat-sign">+</text>',
      '<text x="-46" y="6.5" class="svg-label bat-sign">−</text>',
      // 합선되면 전지가 달아오른다
      opts.heat ? '<rect x="-64" y="-17" width="124" height="34" rx="6" fill="#ff4a26" class="heat" opacity=".45"/>' : ''
    ].join('');
  }

  function holder(opts) {
    opts = opts || {};
    var inner = '';
    if (opts.battery) {
      inner = '<g transform="rotate(' + (opts.battery.flipped ? 180 : 0) + ')">' + battery({ heat: opts.battery.heat }) + '</g>';
    }
    return [
      opts.battery && opts.battery.heat ? '<ellipse cx="0" cy="0" rx="130" ry="62" fill="url(#gHeat)" class="heat"/>' : '',
      '<rect x="-101" y="-6" width="18" height="12" rx="2" fill="url(#gMetal)"/>',
      '<circle cx="-93" cy="0" r="2.4" fill="#6b7177"/>',
      '<rect x="83" y="-6" width="18" height="12" rx="2" fill="url(#gMetal)"/>',
      '<circle cx="93" cy="0" r="2.4" fill="#6b7177"/>',
      '<rect x="-86" y="-26" width="172" height="52" rx="8" fill="url(#gTray)"/>',
      '<rect x="-74" y="-20" width="148" height="40" rx="5" fill="#4a5056"/>',
      '<path d="M-73 -11l6 4-6 4 6 4-6 4 6 4" fill="none" stroke="#c9ced3" stroke-width="2.2" stroke-linejoin="round"/>',
      '<rect x="68" y="-12" width="5" height="24" rx="1.5" fill="url(#gMetal)"/>',
      '<text x="-93" y="25" class="svg-label mat-sign">−</text>',
      '<text x="93" y="25" class="svg-label mat-sign">+</text>',
      inner
    ].join('');
  }

  function bulb(opts) {
    opts = opts || {};
    var b = opts.brightness || 0;
    var lit = b > 0.03;
    var filament = lit ? (b > 0.5 ? '#fff6c2' : '#ffb347') : '#5f6266';
    return [
      '<path d="M-5 4L-6 -12M5 4L6 -12" stroke="#8b9096" stroke-width="1.3" fill="none"/>',
      '<path d="M-6 -12q1.5 -4 3 0t3 0t3 0t3 0" stroke="' + filament + '" stroke-width="' + (lit ? 2 : 1.4) + '" fill="none" stroke-linecap="round"/>',
      '<path d="M-7 3C-7 -2 -19 -6 -19 -18A19 19 0 1 1 19 -18C19 -6 7 -2 7 3Z" fill="url(#gGlass)" stroke="#ffffff" stroke-opacity=".75" stroke-width="1.2"/>',
      lit ? '<circle cx="0" cy="-15" r="' + (8 + Math.min(b, 3) * 3).toFixed(1) + '" fill="#fff3b0" opacity="' + Math.min(0.85, 0.25 + b * 0.5).toFixed(2) + '"/>' : '',
      '<path d="M-11 -27A12 12 0 0 1 -2 -33" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".85"/>',
      '<rect x="-9" y="2" width="18" height="21" rx="2" fill="url(#gMetal)"/>',
      '<path d="M-9 7L9 5M-9 12L9 10M-9 17L9 15M-9 22L9 20" stroke="#868c92" stroke-width="1.2"/>',
      '<rect x="-6" y="23" width="12" height="4" fill="#2b2b2b"/>',
      '<path d="M-4 27h8v2a4 4 0 0 1 -8 0Z" fill="url(#gBrass)"/>'
    ].join('');
  }

  function socket(opts) {
    opts = opts || {};
    var withBulb = '';
    if (opts.bulb) {
      withBulb = '<g clip-path="url(#socketClip)"><g transform="translate(' + SOCKET_SLOT.x + ' ' + SOCKET_SLOT.y + ')">' +
        bulb({ brightness: opts.bulb.brightness }) + '</g></g>';
    }
    return [
      '<rect x="-73" y="8" width="18" height="12" rx="2" fill="url(#gMetal)"/>',
      '<circle cx="-65" cy="14" r="2.4" fill="#6b7177"/>',
      '<rect x="55" y="8" width="18" height="12" rx="2" fill="url(#gMetal)"/>',
      '<circle cx="65" cy="14" r="2.4" fill="#6b7177"/>',
      '<rect x="-58" y="-4" width="116" height="36" rx="8" fill="url(#gCream)" stroke="#b3a88f" stroke-width="1"/>',
      '<circle cx="-42" cy="14" r="5.5" fill="url(#gMetal)"/><path d="M-45.5 14h7" stroke="#7b8187" stroke-width="1.4"/>',
      '<circle cx="42" cy="14" r="5.5" fill="url(#gMetal)"/><path d="M38.5 14h7" stroke="#7b8187" stroke-width="1.4"/>',
      '<path d="M-36 14H-17M17 14H36" stroke="#a9aeb4" stroke-width="2.5"/>',
      '<rect x="-17" y="-22" width="34" height="32" rx="4" fill="url(#gCreamSide)" stroke="#b3a88f" stroke-width="1"/>',
      '<ellipse cx="0" cy="-22" rx="17" ry="4.5" fill="#e9e2d2" stroke="#b3a88f" stroke-width="1"/>',
      '<ellipse cx="0" cy="-22" rx="10" ry="2.8" fill="#7f858b"/>',
      withBulb
    ].join('');
  }

  function switchPart(opts) {
    opts = opts || {};
    var angle = opts.closed ? 0 : -34;
    return [
      '<rect x="-89" y="-6" width="18" height="12" rx="2" fill="url(#gMetal)"/>',
      '<circle cx="-81" cy="0" r="2.4" fill="#6b7177"/>',
      '<rect x="71" y="-6" width="18" height="12" rx="2" fill="url(#gMetal)"/>',
      '<circle cx="81" cy="0" r="2.4" fill="#6b7177"/>',
      '<rect x="-73" y="-27" width="146" height="54" rx="7" fill="url(#gWood)" stroke="#8a6230" stroke-width="1"/>',
      '<path d="M-60 -18q30 4 60 0t60 2M-62 19q34 -3 64 1t58 -2" stroke="#a87a3d" stroke-width="1" fill="none" opacity=".6"/>',
      '<rect x="-73" y="-3" width="30" height="6" fill="url(#gMetal)"/>',
      '<rect x="43" y="-3" width="30" height="6" fill="url(#gMetal)"/>',
      '<rect x="37" y="-10" width="13" height="5" rx="1" fill="url(#gMetal)"/>',
      '<rect x="37" y="5" width="13" height="5" rx="1" fill="url(#gMetal)"/>',
      '<rect x="-47" y="-10" width="12" height="20" rx="2" fill="url(#gMetal)"/>',
      '<g transform="rotate(' + angle + ' -41 0)" class="blade">',
      '<rect x="-44" y="-3.5" width="94" height="7" rx="2" fill="url(#gMetal)" stroke="#7b8187" stroke-width=".6"/>',
      '<rect x="49" y="-7" width="24" height="14" rx="6" fill="#c8372d"/>',
      '<rect x="52" y="-5" width="16" height="3" rx="1.5" fill="#ffffff" opacity=".35"/>',
      '</g>',
      '<circle cx="-41" cy="0" r="3" fill="#6b7177"/>',
      '<text x="-4" y="22" class="svg-label switch-state">' + (opts.closed ? '켜짐' : '꺼짐') + '</text>'
    ].join('');
  }

  // 집게: 끝(무는 곳)이 (0, 0)이고 +x 방향을 향한다
  function clip(color) {
    return [
      '<path d="M-36 -7.5H-17l3 2.5V5l-3 2.5H-36a3.5 3.5 0 0 1 -3.5 -3.5V-4A3.5 3.5 0 0 1 -36 -7.5Z" fill="' + color + '"/>',
      '<path d="M-35 -5.5H-19" stroke="#ffffff" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round"/>',
      '<path d="M-14 -6L2 -2.2V2.2L-14 6Z" fill="url(#gMetal)" stroke="#80868c" stroke-width=".6"/>',
      '<path d="M-13 0H2" stroke="#5c6166" stroke-width=".9"/>'
    ].join('');
  }

  var DRAW = { battery: battery, holder: holder, bulb: bulb, socket: socket, switch: switchPart };

  function draw(type, opts) {
    return DRAW[type](opts);
  }

  // 실험 도구 칸에 쓰는 작은 그림
  function icon(type) {
    if (type === 'wire') {
      return '<svg viewBox="-110 -40 220 80" aria-hidden="true" focusable="false">' +
        '<path d="M-58 4C-30 40 30 40 58 4" stroke="#d2382d" stroke-width="6" fill="none" stroke-linecap="round"/>' +
        '<g transform="translate(-94 4) rotate(180)">' + clip('#d2382d') + '</g>' +
        '<g transform="translate(94 4)">' + clip('#d2382d') + '</g></svg>';
    }
    var vb = {
      battery: '-70 -24 140 48',
      holder: '-106 -34 212 68',
      bulb: '-30 -42 60 80',
      socket: '-78 -74 156 112',
      switch: '-94 -34 188 68'
    }[type];
    var opts = type === 'switch' ? { closed: false } : {};
    return '<svg viewBox="' + vb + '" aria-hidden="true" focusable="false">' + draw(type, opts) + '</svg>';
  }

  root.LabParts = {
    TYPES: TYPES,
    DEFS: DEFS,
    SOCKET_SLOT: SOCKET_SLOT,
    GLOBE: GLOBE,
    CLIP_LENGTH: CLIP_LENGTH,
    draw: draw,
    clip: clip,
    icon: icon
  };
})(this);
