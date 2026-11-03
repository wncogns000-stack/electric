/*
 * 학급 기록판과 주고받기 (game/server/Code.gs)
 *
 * 요청은 모두 GET으로 보낸다. 구글 Apps Script 웹 앱은 다른 주소의 화면에서 보낸 GET 요청에 가장 잘 답한다.
 * 기록은 먼저 이 기기에 적어 두었다가 기록판이 받으면 지운다. 연결이 끊겨 못 보낸 기록은 다음에 다시 보낸다.
 */
(function (root) {
  'use strict';

  var OUTBOX_KEY = 'bomb-squad-outbox';
  var DEVICE_KEY = 'bomb-squad-device';
  var TIMEOUT = 12000;
  var OUTBOX_MAX = 20;
  var RETRY = { busy: true, server: true };   // 기록판이 이 까닭으로 거절한 기록은 나중에 다시 보낸다

  // 주소창의 ?board= 가 config.js보다 먼저다. 구글 Apps Script 웹 앱 주소(또는 배포 ID)만 받는다
  function boardUrl() {
    var raw = '';
    try { raw = new URLSearchParams(root.location.search).get('board') || ''; } catch (err) { raw = ''; }
    if (!raw && root.BOMB_CONFIG && root.BOMB_CONFIG.board) raw = String(root.BOMB_CONFIG.board);
    raw = raw.trim();
    if (/^[\w-]{20,}$/.test(raw)) raw = 'https://script.google.com/macros/s/' + raw + '/exec';
    return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(raw) ? raw : '';
  }

  var url = boardUrl();
  var offset = 0;   // 기록판 시계 − 이 기기 시계 (도전 시간이 열리고 닫히는 때를 맞춘다)

  function read(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (err) {
      return fallback;
    }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* 저장하지 못하면 이번 화면에서만 다시 보낼 수 있다 */ }
  }

  // 누가 어느 기기에서 했는지 교사가 시트에서 볼 수 있게 기기마다 짧은 이름을 붙인다
  function deviceId() {
    var id = read(DEVICE_KEY, '');
    if (!id) {
      id = Math.random().toString(36).slice(2, 8);
      write(DEVICE_KEY, id);
    }
    return id;
  }

  function call(params) {
    var query = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    return fetch(url + '?' + query + '&_=' + Date.now(), { redirect: 'follow', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.json();
      })
      .then(function (data) {
        clearTimeout(timer);
        if (!data || typeof data !== 'object') throw new Error('bad reply');
        if (typeof data.now === 'number') offset = data.now - Date.now();
        return data;
      }, function (err) {
        clearTimeout(timer);
        throw err;
      });
  }

  function outbox() { return read(OUTBOX_KEY, []); }
  function forget(run) {
    write(OUTBOX_KEY, outbox().filter(function (item) { return item.run !== run; }));
  }

  function send(item) {
    return call({ action: 'submit', name: item.name, score: item.score, run: item.run, device: item.device }).then(function (data) {
      if (data.ok || !RETRY[data.error]) forget(item.run);
      return data;
    });
  }

  // 한 판의 기록을 보낸다. 연결이 끊겨도 기기에 남아 있다가 flush()로 다시 간다
  function submit(rec) {
    var item = { name: rec.name, score: rec.score, run: rec.run, device: deviceId() };
    write(OUTBOX_KEY, outbox().concat([item]).slice(-OUTBOX_MAX));
    return send(item);
  }

  var flushing = null;
  function flush() {
    if (flushing) return flushing;
    flushing = outbox().reduce(function (chain, item) {
      return chain.then(function () { return send(item).catch(function () { /* 다음에 다시 보낸다 */ }); });
    }, Promise.resolve()).then(function () { flushing = null; });
    return flushing;
  }

  function admin(pin, op, args) {
    var params = { action: 'admin', pin: pin, op: op };
    Object.keys(args || {}).forEach(function (k) { params[k] = args[k]; });
    return call(params);
  }

  root.BombBoard = {
    enabled: !!url,
    status: function (name) { return call({ action: 'status', name: name || '' }); },
    submit: submit,
    flush: flush,
    pending: function () { return outbox().length; },
    admin: admin,
    now: function () { return Date.now() + offset; }
  };
})(this);
