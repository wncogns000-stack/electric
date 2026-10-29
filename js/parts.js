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
      name: '전구',
      max: 4,
      radius: 40,
      box: { x: -24, y: -40, w: 48, h: 80 },
      terms: {
        tip: { x: 0, y: 32, out: 90, label: '전구의 꼭지' },
        thread: { x: 9, y: 12, out: 0, label: '전구의 꼭지쇠' }
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
      max: 12
    },
    rodPlastic: rodType('플라스틱 막대'),
    rodRubber: rodType('고무 막대'),
    rodMetal: rodType('금속 막대'),
    motor: {
      name: '전동기',
      max: 2,
      radius: 58,
      box: { x: -60, y: -40, w: 120, h: 80 },
      terms: {
        a: { x: -51, y: 0, out: 180, label: '전동기의 빨간 점 쪽 단자' },
        b: { x: 51, y: 0, out: 0, label: '전동기의 오른쪽 단자' }
      }
    },
    buzzer: {
      name: '버저',
      max: 2,
      radius: 54,
      box: { x: -56, y: -34, w: 112, h: 64 },
      terms: {
        red: { x: -47, y: 20, out: 180, label: '버저의 빨간색 전선' },
        black: { x: 47, y: 20, out: 0, label: '버저의 검은색 전선' }
      }
    },
    magnet: {
      name: '전자석',
      max: 1,
      radius: 84,
      box: { x: -86, y: -20, w: 164, h: 58 },
      terms: {
        a: { x: -46, y: 31, out: 90, label: '전자석의 왼쪽 에나멜선 끝' },
        b: { x: 46, y: 31, out: 90, label: '전자석의 오른쪽 에나멜선 끝' }
      }
    },
    // 아직 전자석이 되지 않은 볼트. 작업대에서 에나멜선을 감으면 magnet이 된다
    bolt: {
      name: '둥근 머리 볼트',
      max: 1,
      radius: 84,
      box: { x: -86, y: -20, w: 164, h: 40 },
      terms: {}
    },
    rings: {
      name: '둥근 철 고리',
      max: 1,
      radius: 46,
      box: { x: -46, y: -34, w: 92, h: 70 },
      terms: {}
    },
    compass: {
      name: '나침반',
      max: 2,
      radius: 38,
      box: { x: -38, y: -38, w: 76, h: 76 },
      terms: {}
    }
  };

  function rodType(name) {
    return {
      name: name,
      max: 1,
      radius: 80,
      box: { x: -80, y: -16, w: 160, h: 32 },
      terms: {
        a: { x: -70, y: 0, out: 180, label: name + '의 왼쪽 끝' },
        b: { x: 70, y: 0, out: 0, label: name + '의 오른쪽 끝' }
      }
    };
  }

  // 끼운 전구가 놓이는 자리 (전구 끼우개 좌표)
  var SOCKET_SLOT = { x: 0, y: -34 };
  // 전구 유리구의 중심 (전구 좌표)
  var GLOBE = { x: 0, y: -17 };
  // 끝끼리 붙인 전지 끼우개 두 개의 중심 사이 거리
  var JOIN_GAP = 184;
  // 전자석 볼트의 양 끝. 전류가 a → b로 흐르면 [1] 쪽이 N극
  var MAGNET_ENDS = [{ x: -82, y: 0 }, { x: 72, y: 0 }];
  // 둥근 철 고리 더미에 놓인 고리 자리
  var RING_SPOTS = [
    [-24, -16], [-9, -22], [7, -18], [22, -12], [-30, 0], [-15, -5], [1, -3], [16, 2],
    [30, 9], [-22, 14], [-7, 10], [9, 15], [23, 22], [-12, 25], [3, 27], [-28, 22]
  ];
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
    '<clipPath id="socketClip" clipPathUnits="userSpaceOnUse"><rect x="-40" y="-120" width="80" height="99"/></clipPath>',
    '<linearGradient id="gPlastic" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#eaf6ff"/><stop offset=".5" stop-color="#9fd0f2"/><stop offset="1" stop-color="#c7e5f8"/></linearGradient>',
    '<linearGradient id="gRubber" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#55585c"/><stop offset=".5" stop-color="#232527"/><stop offset="1" stop-color="#3a3c3f"/></linearGradient>',
    '<linearGradient id="gMount" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#e9edf1"/><stop offset="1" stop-color="#b9c2cb"/></linearGradient>',
    '<radialGradient id="gCan" cx=".38" cy=".35" r=".75">',
    '<stop offset="0" stop-color="#f7f8f9"/><stop offset=".6" stop-color="#b4b9bf"/><stop offset="1" stop-color="#868c93"/></radialGradient>',
    '<radialGradient id="gBuzz" cx=".38" cy=".35" r=".75">',
    '<stop offset="0" stop-color="#55595e"/><stop offset="1" stop-color="#111315"/></radialGradient>',
    '<pattern id="coil" width="3.2" height="22" patternUnits="userSpaceOnUse">',
    '<rect width="3.2" height="22" fill="#c27433"/><rect width="1" height="22" fill="#8a4a1c"/><rect x="1.4" width=".8" height="22" fill="#e9a463"/></pattern>'
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

  // broken: 필라멘트가 끊어진 전구 (1, 2는 끊어진 쪽만 다르다)
  function bulb(opts) {
    opts = opts || {};
    var b = opts.brightness || 0;
    var lit = b > 0.03;
    var filament = lit ? (b > 0.5 ? '#fff6c2' : '#ffb347') : '#5f6266';
    var wire = '<path d="M-6 -12q1.5 -4 3 0t3 0t3 0t3 0" stroke="' + filament + '" stroke-width="' + (lit ? 2 : 1.4) + '" fill="none" stroke-linecap="round"/>';
    if (opts.broken) {
      wire = '<g' + (opts.broken === 2 ? ' transform="scale(-1 1)"' : '') + '>' +
        '<path d="M-6 -12q1.5 -4 3 0t1.4 0" stroke="#5f6266" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
        '<path d="M6 -12q-1.5 -4 -3 0l-1.6 5.5" stroke="#5f6266" stroke-width="1.4" fill="none" stroke-linecap="round"/></g>' +
        '<ellipse cx="3" cy="-25" rx="10" ry="6" fill="#3b342c" opacity=".38"/>';
    }
    return [
      '<path d="M-5 4L-6 -12M5 4L6 -12" stroke="#8b9096" stroke-width="1.3" fill="none"/>',
      wire,
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
        bulb({ brightness: opts.bulb.brightness, broken: opts.bulb.broken }) + '</g></g>';
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
      '<text x="-4" y="22" class="svg-label switch-state">' + (opts.closed ? '닫힘' : '열림') + '</text>'
    ].join('');
  }

  var RODS = {
    rodPlastic: { fill: 'url(#gPlastic)', ink: '#1f5279', rx: 8, label: '플라스틱' },
    rodRubber: { fill: 'url(#gRubber)', ink: '#e6e6e6', rx: 8, label: '고무' },
    rodMetal: { fill: 'url(#gMetal)', ink: '#3f454b', rx: 3, label: '금속' }
  };

  function rod(type) {
    var r = RODS[type];
    return '<rect x="-74" y="-8" width="148" height="16" rx="' + r.rx + '" fill="' + r.fill + '" stroke="#000000" stroke-opacity=".25" stroke-width="1"/>' +
      '<text x="0" y="4" class="svg-label rod-label" fill="' + r.ink + '">' + r.label + ' 막대</text>';
  }

  // 위에서 내려다본 전동기. 날개(rotor)는 app.js가 돌린다.
  function motor(opts) {
    opts = opts || {};
    var blades = '';
    for (var k = 0; k < 3; k++) {
      blades += '<path d="M0 -4C10 -7 27 -9 33 -2C34 2 30 6 24 6C14 6 6 5 0 4Z" fill="#e8742f" stroke="#a9481a" stroke-width=".8" transform="rotate(' + k * 120 + ')"/>';
    }
    return [
      '<rect x="-59" y="-6" width="18" height="12" rx="2" fill="url(#gMetal)"/>',
      '<circle cx="-51" cy="0" r="2.4" fill="#6b7177"/>',
      '<rect x="41" y="-6" width="18" height="12" rx="2" fill="url(#gMetal)"/>',
      '<circle cx="51" cy="0" r="2.4" fill="#6b7177"/>',
      '<rect x="-44" y="-32" width="88" height="64" rx="10" fill="url(#gMount)" stroke="#8d98a3" stroke-width="1"/>',
      '<path d="M-44 0H-24M24 0H44" stroke="#aab0b6" stroke-width="3"/>',
      '<circle cx="-33" cy="-19" r="4" fill="#d2382d"/>',
      '<circle r="24" fill="url(#gCan)" stroke="#7b8187" stroke-width="1"/>',
      '<circle r="15" fill="#c3c8cd" stroke="#9aa0a7" stroke-width="1"/>',
      opts.fast ? '<circle r="34" fill="#e8742f" opacity=".16"/>' : '',
      '<g class="rotor" data-rotor="' + (opts.id || '') + '" transform="rotate(' + (opts.angle || 0).toFixed(1) + ')">',
      blades,
      '<circle r="6" fill="#c45a1e"/><circle r="2" fill="#7a3510"/>',
      '</g>'
    ].join('');
  }

  function buzzer(opts) {
    opts = opts || {};
    var loud = opts.loudness || 0;
    var waves = '';
    if (loud > 0) {
      var n = loud > 0.75 ? 3 : 2;
      for (var k = 0; k < n; k++) {
        var r = 26 + k * 9;
        waves += '<path class="wave" style="animation-delay:' + (k * 0.15) + 's" d="M' + (r * 0.5).toFixed(1) + ' ' + (-4 - r * 0.87).toFixed(1) +
          'A' + r + ' ' + r + ' 0 0 1 ' + r + ' -4" fill="none" stroke="#fff3b0" stroke-width="' + (1.5 + loud * 2).toFixed(1) +
          '" stroke-linecap="round" opacity="' + Math.min(1, 0.35 + loud * 0.6).toFixed(2) + '"/>';
      }
    }
    return [
      '<path d="M-12 14C-18 22 -30 22 -40 20" stroke="#d2382d" stroke-width="3.6" fill="none" stroke-linecap="round"/>',
      '<path d="M12 14C18 22 30 22 40 20" stroke="#26292c" stroke-width="3.6" fill="none" stroke-linecap="round"/>',
      '<rect x="-50" y="18" width="11" height="4" rx="1.5" fill="url(#gMetal)"/>',
      '<rect x="39" y="18" width="11" height="4" rx="1.5" fill="url(#gMetal)"/>',
      '<rect x="-28" y="-28" width="56" height="44" rx="8" fill="url(#gCream)" stroke="#b3a88f" stroke-width="1"/>',
      '<circle cx="0" cy="-6" r="18" fill="url(#gBuzz)"/>',
      '<circle cx="0" cy="-6" r="3.2" fill="#000000"/>',
      '<text x="-21" y="12" class="svg-label buzz-sign">+</text>',
      waves
    ].join('');
  }

  // 전자석과 볼트가 함께 쓰는 그림: 볼트, 종이, 셀로판테이프, 감은 에나멜선
  // turns: 감은 횟수 (100번에 한 겹), 한 겹이 넘으면 오른쪽에서 왼쪽으로 두 번째 겹을 감는다
  var COIL_LAYER = 100;
  function coilFront(turns) {
    if (turns <= COIL_LAYER) return -56 + 110 * turns / COIL_LAYER;
    return 54 - 110 * Math.min(1, (turns - COIL_LAYER) / COIL_LAYER);
  }
  function boltBody(opts) {
    var turns = opts.turns || 0;
    var out = [
      '<rect x="-70" y="-5" width="140" height="10" rx="2" fill="url(#gMetal)"/>',
      '<path d="M58 -5V5M61.5 -5V5M65 -5V5" stroke="#868c92" stroke-width="1"/>',
      '<path d="M-70 -13H-76A6 13 0 0 0 -76 13H-70Z" fill="url(#gMetal)" stroke="#868c92" stroke-width=".8"/>'
    ];
    if (opts.paper) out.push('<rect x="-58" y="-8" width="114" height="16" rx="2" fill="#f4f1e8" stroke="#d3cbb8" stroke-width=".8"/>');
    if (opts.tape) {
      out.push('<rect x="-60" y="-10" width="9" height="20" rx="1.5" fill="#cfe6ff" opacity=".7"/>');
      out.push('<rect x="49" y="-10" width="9" height="20" rx="1.5" fill="#cfe6ff" opacity=".7"/>');
    }
    if (turns > 0) {
      var len1 = 110 * Math.min(1, Math.max(0.06, turns / COIL_LAYER));
      out.push('<rect x="-56" y="-11" width="' + len1.toFixed(1) + '" height="22" rx="4" fill="url(#coil)"/>');
      out.push('<rect x="-56" y="-11" width="' + len1.toFixed(1) + '" height="7" rx="3" fill="#ffffff" opacity=".18"/>');
      if (turns > COIL_LAYER) {
        var len2 = 110 * Math.min(1, (turns - COIL_LAYER) / COIL_LAYER);
        out.push('<rect x="' + (54 - len2).toFixed(1) + '" y="-13" width="' + len2.toFixed(1) + '" height="26" rx="5" fill="url(#coil)"/>');
        out.push('<rect x="' + (54 - len2).toFixed(1) + '" y="-13" width="' + len2.toFixed(1) + '" height="26" rx="5" fill="#5a2a0c" opacity=".2"/>');
      }
    }
    return out.join('');
  }

  // 에나멜선 끝: 겉면이 남아 있으면 검붉고, 사포로 벗기면 구리색으로 반짝인다 (amount 0~1)
  function leadTip(x, amount) {
    var a = Math.max(0, Math.min(1, amount));
    var mix = function (c0, c1) { return Math.round(c0 + (c1 - c0) * a); };
    var color = 'rgb(' + mix(110, 242) + ',' + mix(44, 178) + ',' + mix(16, 120) + ')';
    return '<path d="M' + x + ' 25V33" stroke="' + color + '" stroke-width="2.6" stroke-linecap="round"/>' +
      (a >= 1 ? '<circle cx="' + (x + 2) + '" cy="27" r="1.2" fill="#ffffff" opacity=".9"/>' : '');
  }

  // 작업대에서 만들고 있는 볼트. 자르기 전에는 감던 에나멜선 끝이 볼트 위로 늘어져 있다
  function bolt(opts) {
    opts = opts || {};
    if (opts.cut) return magnet(opts);
    var out = boltBody(opts);
    if (opts.turns > 0) {
      var front = coilFront(opts.turns);
      out += '<path d="M' + front.toFixed(1) + ' -11C' + (front + 3).toFixed(1) + ' -20 ' + (front + 12).toFixed(1) + ' -22 ' + (front + 20).toFixed(1) + ' -19"' +
        ' stroke="#b8692e" stroke-width="2" fill="none" stroke-linecap="round"/>';
    }
    return out;
  }

  // 준비된 전자석은 100번 감고 양 끝을 벗긴 것으로 그린다
  function magnet(opts) {
    opts = opts || {};
    var turns = opts.turns === undefined ? 100 : opts.turns;
    var sand = opts.sand || [1, 1];
    var front = coilFront(turns);
    return [
      boltBody({ turns: turns, paper: opts.paper, tape: opts.tape }),
      '<path d="M-53 9C-56 18 -48 22 -46 26" stroke="#8a3a14" stroke-width="2" fill="none"/>',
      '<path d="M' + front.toFixed(1) + ' 10C' + (front + 2).toFixed(1) + ' 20 48 20 46 26" stroke="#8a3a14" stroke-width="2" fill="none"/>',
      leadTip(-46, sand[0]),
      leadTip(46, sand[1])
    ].join('');
  }

  function ring(x, y) {
    return '<circle cx="' + x + '" cy="' + y + '" r="7" fill="none" stroke="#4f565c" stroke-width="3.6"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="7" fill="none" stroke="#c9ced3" stroke-width="1.8"/>';
  }

  function rings(opts) {
    opts = opts || {};
    var count = opts.count === undefined ? RING_SPOTS.length : opts.count;
    return '<rect x="-46" y="-34" width="92" height="70" rx="20" fill="#000000" opacity=".08"/>' +
      RING_SPOTS.slice(0, count).map(function (s) { return ring(s[0], s[1]); }).join('');
  }

  // needle: 바늘의 N극(빨간 쪽)이 가리키는 방향(도, 이 부품 좌표)
  function compass(opts) {
    opts = opts || {};
    var ticks = '';
    for (var k = 0; k < 12; k++) {
      ticks += '<path d="M0 -27V' + (k % 3 === 0 ? -22 : -24.5) + '" stroke="#7b8187" stroke-width="1.2" transform="rotate(' + k * 30 + ')"/>';
    }
    var a = opts.needle === undefined ? -90 : opts.needle;
    return [
      '<circle r="34" fill="url(#gMetal)" stroke="#868c92" stroke-width="1"/>',
      '<circle r="29" fill="#fbfaf4" stroke="#a7adb3" stroke-width="1"/>',
      ticks,
      '<text x="0" y="-12" class="svg-label compass-n">N</text>',
      '<g transform="rotate(' + a.toFixed(1) + ')">',
      '<path d="M0 -4.5L24 0L0 4.5Z" fill="#d2382d"/>',
      '<path d="M0 -4.5L-24 0L0 4.5Z" fill="#9aa0a7"/>',
      '</g>',
      '<circle r="3.4" fill="#4a5056"/>',
      '<path d="M-18 -18A25 25 0 0 1 4 -27" stroke="#ffffff" stroke-width="3" fill="none" opacity=".7" stroke-linecap="round"/>'
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

  var DRAW = {
    battery: battery, holder: holder, bulb: bulb, socket: socket, switch: switchPart,
    rodPlastic: function () { return rod('rodPlastic'); },
    rodRubber: function () { return rod('rodRubber'); },
    rodMetal: function () { return rod('rodMetal'); },
    motor: motor, buzzer: buzzer, magnet: magnet, bolt: bolt, rings: rings, compass: compass
  };

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
      switch: '-94 -34 188 68',
      rodPlastic: '-80 -24 160 48',
      rodRubber: '-80 -24 160 48',
      rodMetal: '-80 -24 160 48',
      motor: '-62 -42 124 84',
      buzzer: '-56 -34 112 64',
      magnet: '-86 -30 164 70',
      bolt: '-86 -30 164 60',
      rings: '-44 -34 88 68',
      compass: '-38 -38 76 76'
    }[type];
    var opts = type === 'switch' ? { closed: false } : {};
    return '<svg viewBox="' + vb + '" aria-hidden="true" focusable="false">' + draw(type, opts) + '</svg>';
  }

  root.LabParts = {
    TYPES: TYPES,
    DEFS: DEFS,
    SOCKET_SLOT: SOCKET_SLOT,
    GLOBE: GLOBE,
    JOIN_GAP: JOIN_GAP,
    MAGNET_ENDS: MAGNET_ENDS,
    COIL_LAYER: COIL_LAYER,
    RING_TOTAL: RING_SPOTS.length,
    ring: ring,
    CLIP_LENGTH: CLIP_LENGTH,
    draw: draw,
    clip: clip,
    icon: icon
  };
})(this);
