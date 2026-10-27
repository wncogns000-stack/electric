/*
 * 차시별 실험 도구와 실험 활동
 *
 * 교과서 과학 6-2 「3. 전기의 이용」의 탐구 활동을 따른다.
 * 활동 문구나 순서를 바꾸려면 이 파일만 고치면 된다.
 *
 * 활동(mission)
 *   steps:   관찰해야 할 것. 모두 관찰하면 ‘성공’이 된다.
 *   observe: 지금 테이블에서 관찰되는 step id 목록을 돌려준다. ctx는 app.js가 넘겨준다.
 *     ctx.litWithSwitch()        스위치를 닫아 전구에 불이 켜졌는지
 *     ctx.testedRods()           불이 켜지는 회로에 이어 본 막대 종류 목록
 *     ctx.levels(kind)           전구·전동기·버저가 전지 한 개('one')/두 개('two')로 동작한 목록
 *     ctx.magnetRings()          둥근 철 고리 옆에서 전자석이 꺼져 있음('off')/전지 한 개·두 개로 켜짐('one', 'two')
 *     ctx.compassSides(memo)     전자석 옆 나침반으로 관찰한 전류 방향 ('fwd', 'rev')
 */
(function (root) {
  'use strict';

  var ONE_TWO = [
    { id: 'one', label: '전지 한 개' },
    { id: 'two', label: '전지 두 개 직렬연결' }
  ];

  var LESSONS = [
    {
      id: 'lesson1',
      tab: '1. 전구에 불 켜기',
      title: '전구에 불을 켜려면 어떻게 해야 할까?',
      pages: '60~61쪽',
      tools: ['battery', 'holder', 'bulb', 'socket', 'switch', 'wire', 'rodPlastic', 'rodRubber', 'rodMetal'],
      missions: [
        {
          id: 'l1-light',
          title: '실험 1 전구에 불 켜기',
          body: '전지, 전구, 전선, 스위치를 연결하고, 스위치를 닫아 전구에 불을 켜 보세요.',
          think: '전구에 불이 켜지는 전기 회로와 불이 켜지지 않는 전기 회로는 무엇이 다른가요?',
          steps: [{ id: 'lit', label: '스위치를 닫아 불 켜기' }],
          observe: function (ctx) { return ctx.litWithSwitch() ? ['lit'] : []; }
        },
        {
          id: 'l1-material',
          title: '실험 2 전기가 흐르는 물질 확인하기',
          body: '전구에 불이 켜지는 회로에서 스위치 대신 플라스틱 막대, 고무 막대, 금속 막대를 각각 연결해 전구에 불이 켜지는지 확인해 보세요.',
          think: '새로 산 마우스의 전지 칸에 비닐이 끼워져 있는 까닭은 무엇일까요?',
          steps: [
            { id: 'rodPlastic', label: '플라스틱 막대' },
            { id: 'rodRubber', label: '고무 막대' },
            { id: 'rodMetal', label: '금속 막대' }
          ],
          observe: function (ctx) { return ctx.testedRods(); }
        }
      ]
    },
    {
      id: 'lesson2',
      tab: '2. 전지의 직렬연결',
      title: '전기 회로에 전지 한 개를 더 연결하면 어떻게 될까?',
      pages: '62~63쪽',
      tools: ['battery', 'holder', 'bulb', 'socket', 'switch', 'wire', 'motor', 'buzzer'],
      missions: [
        {
          id: 'l2-bulb',
          title: '실험 1 전구의 밝기 비교하기',
          body: '전지 한 개를 연결한 전기 회로와 전지 두 개를 직렬연결한 전기 회로를 만들고, 스위치를 닫아 전구의 밝기를 비교해 보세요.',
          tip: '전지 끼우개를 다른 전지 끼우개의 끝에 끌어다 대면 서로 붙어서 직렬로 이어져요.',
          think: '전기 기구에 전지 두 개를 엇갈리게 넣는 것은 전지의 직렬연결 방법일까요?',
          steps: ONE_TWO,
          observe: function (ctx) { return ctx.levels('bulb'); }
        },
        {
          id: 'l2-motor',
          title: '실험 2 전동기 비교하기',
          body: '두 전기 회로에서 전구 대신 전동기를 연결하고, 스위치를 닫아 전동기가 도는 모습을 비교해 보세요.',
          think: '전동기에 연결한 전지의 방향을 바꾸면 어떻게 될까요?',
          steps: ONE_TWO,
          observe: function (ctx) { return ctx.levels('motor'); }
        },
        {
          id: 'l2-buzzer',
          title: '실험 2 버저 비교하기',
          body: '두 전기 회로에서 전구 대신 버저를 연결하고, 스위치를 닫아 버저 소리를 비교해 보세요.',
          tip: '버저의 빨간색 전선은 전지의 (+)극 쪽에, 검은색 전선은 전지의 (−)극 쪽에 연결해요.',
          think: '전지의 개수에 따라 버저 소리는 어떻게 달라지나요?',
          steps: ONE_TWO,
          observe: function (ctx) { return ctx.levels('buzzer'); }
        }
      ]
    },
    {
      id: 'lesson3',
      tab: '3. 전자석',
      title: '전자석의 성질이 궁금해!',
      pages: '64~66쪽',
      tools: ['battery', 'holder', 'switch', 'wire', 'magnet', 'rings', 'compass'],
      missions: [
        {
          id: 'l3-make',
          title: '실험 1 전자석 만들기',
          body: '전자석을 전기 회로에 연결하고, 전자석 끝부분을 둥근 철 고리에 가까이 한 채 스위치를 닫기 전과 닫은 뒤를 비교해 보세요.',
          think: '스위치를 다시 열면 둥근 철 고리는 어떻게 되나요?',
          steps: [
            { id: 'off', label: '스위치를 닫기 전' },
            { id: 'on', label: '스위치를 닫은 뒤' }
          ],
          observe: function (ctx) {
            var seen = ctx.magnetRings();
            var out = [];
            if (seen.indexOf('off') >= 0) out.push('off');
            if (seen.indexOf('one') >= 0 || seen.indexOf('two') >= 0) out.push('on');
            return out;
          }
        },
        {
          id: 'l3-strength',
          title: '실험 2 전지의 개수와 전자석의 세기',
          body: '전자석에 연결한 전지의 개수를 달리하며 스위치를 닫은 뒤, 전자석의 끝부분을 둥근 철 고리에 가까이 해 보세요.',
          think: '세기가 아주 센 전자석을 만들 수 있는 방법은 무엇일까요?',
          steps: ONE_TWO,
          observe: function (ctx) {
            return ctx.magnetRings().filter(function (s) { return s === 'one' || s === 'two'; });
          }
        },
        {
          id: 'l3-pole',
          title: '실험 2 전지의 방향과 전자석의 극',
          body: '전자석의 양쪽 끝에 나침반을 놓고, 전자석에 연결한 전지의 방향을 바꾸며 스위치를 닫은 뒤 나침반 바늘의 움직임을 관찰해 보세요.',
          tip: '전지 끼우개를 누르고 ‘전지 방향 바꾸기’를 누르면 전지의 방향이 바뀌어요.',
          think: '영구 자석과 전자석의 극은 어떤 점이 다른가요?',
          steps: [
            { id: 'fwd', label: '전지의 방향을 바꾸기 전' },
            { id: 'rev', label: '전지의 방향을 바꾼 뒤' }
          ],
          observe: function (ctx, memo) { return ctx.compassSides(memo); }
        }
      ]
    },
    {
      id: 'free',
      tab: '자유 탐구',
      title: '자유 탐구',
      pages: '',
      note: '모든 실험 도구를 꺼내 쓸 수 있어요. 궁금한 전기 회로를 직접 만들어 보세요.',
      tools: ['battery', 'holder', 'bulb', 'socket', 'switch', 'wire', 'motor', 'buzzer',
        'rodPlastic', 'rodRubber', 'rodMetal', 'magnet', 'rings', 'compass'],
      missions: []
    }
  ];

  root.LabLessons = LESSONS;
})(this);
