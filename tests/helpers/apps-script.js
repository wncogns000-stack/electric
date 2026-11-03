/*
 * game/server/Code.gs를 Node에서 돌려 보기 위한 가짜 Google Apps Script 환경
 *
 * 시트는 2차원 배열로 흉내 내고, 시계(clock.now)는 테스트가 정한다.
 * Code.gs 안에서 만든 날짜는 이 환경의 Date(ctx.Date)이므로, 시트에 날짜를 직접 넣을 때도 ctx.Date를 쓴다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'server', 'Code.gs'), 'utf8');

function blank(v) { return v === '' || v === null || v === undefined; }

function makeSheet(name) {
  const sh = {
    name,
    rows: [],
    getName() { return sh.name; },
    setName(n) { sh.name = n; return sh; },
    setFrozenRows() { return sh; },
    setColumnWidth() { return sh; },
    getLastRow() {
      for (let i = sh.rows.length - 1; i >= 0; i--) if ((sh.rows[i] || []).some((v) => !blank(v))) return i + 1;
      return 0;
    },
    getLastColumn() { return sh.rows.reduce((m, r) => Math.max(m, (r || []).length), 0); },
    appendRow(row) { sh.rows[sh.getLastRow()] = row.slice(); return sh; },
    deleteRow(r) { sh.rows.splice(r - 1, 1); return sh; },
    getDataRange() { return sh.getRange(1, 1, Math.max(1, sh.getLastRow()), Math.max(1, sh.getLastColumn())); },
    getRange(row, col, numRows, numCols) {
      if (typeof row === 'string') return { setNumberFormat() { return this; } };
      numRows = numRows || 1;
      numCols = numCols || 1;
      const cell = (r, c) => {
        const line = sh.rows[r - 1];
        return line && !blank(line[c - 1]) ? line[c - 1] : '';
      };
      const range = {
        getValues() {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const line = [];
            for (let c = 0; c < numCols; c++) line.push(cell(row + r, col + c));
            out.push(line);
          }
          return out;
        },
        setValues(vals) {
          vals.forEach((line, r) => line.forEach((v, c) => {
            const i = row + r - 1;
            sh.rows[i] = sh.rows[i] || [];
            sh.rows[i][col + c - 1] = v;
          }));
          return range;
        },
        setValue(v) { return range.setValues([[v]]); },
        clearContent() {
          for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) {
            const line = sh.rows[row + r - 1];
            if (line) line[col + c - 1] = '';
          }
          return range;
        },
        setNumberFormat() { return range; },
        setFontWeight() { return range; },
        createTextFinder(text) {
          return {
            matchEntireCell() { return this; },
            findNext() {
              for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) {
                if (String(cell(row + r, col + c)) === String(text)) return { getRow: () => row + r };
              }
              return null;
            }
          };
        }
      };
      return range;
    },
    copyTo(ss) {
      const copy = makeSheet(sh.name + ' 사본');
      copy.rows = sh.rows.map((r) => (r || []).slice());
      ss._sheets.push(copy);
      return copy;
    }
  };
  return sh;
}

function load() {
  const clock = { now: Date.UTC(2026, 10, 4, 0, 0) };   // 2026-11-04 09:00 (서울)
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(clock.now); }
    static now() { return clock.now; }
  }

  const ss = {
    _sheets: [makeSheet('시트1')],
    getSheetByName(name) { return ss._sheets.find((s) => s.name === name) || null; },
    insertSheet(name) { const s = makeSheet(name); ss._sheets.push(s); return s; },
    getId() { return 'SHEET-ID'; },
    getUrl() { return 'https://docs.google.com/spreadsheets/d/SHEET-ID/edit'; },
    getSpreadsheetTimeZone() { return 'Asia/Seoul'; }
  };

  const cacheStore = new Map();
  const props = new Map();
  const ctx = {
    Date: FakeDate,
    Math, JSON, String, Number, Object, Array, isNaN,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ setProperty: (k, v) => props.set(k, v), getProperty: (k) => props.get(k) || null }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cacheStore.has(k) ? cacheStore.get(k) : null),
        put: (k, v) => { cacheStore.set(k, String(v)); },
        remove: (k) => { cacheStore.delete(k); }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, mime: '', setMimeType(m) { this.mime = m; return this; } })
    },
    Utilities: {
      formatDate(date, tz, fmt) {
        const d = new Date(date.getTime() + 9 * 3600000);
        const two = (n) => String(n).padStart(2, '0');
        return fmt.replace('yyyy', d.getUTCFullYear()).replace('MM', two(d.getUTCMonth() + 1)).replace('dd', two(d.getUTCDate()))
          .replace('HH', two(d.getUTCHours())).replace('mm', two(d.getUTCMinutes()));
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'Code.gs' });

  // 웹 앱에 GET으로 요청한 것처럼 부르고 JSON 답을 돌려준다
  function get(params) {
    const out = ctx.doGet({ parameter: Object.assign({}, params) });
    return JSON.parse(out.text);
  }
  function sheet(name) { return ss.getSheetByName(name); }
  function setSetting(label, value) {
    const sh = sheet('설정');
    const i = sh.rows.findIndex((r) => r && r[0] === label);
    sh.rows[i][1] = value;
    cacheStore.clear();
  }
  return { ctx, ss, clock, get, sheet, setSetting, clearCache: () => cacheStore.clear() };
}

module.exports = { load };
