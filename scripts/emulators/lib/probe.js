/* P1-F08 lane probe: injected into every HTML page the lane proxy serves. Test-only; reports what the
   page itself received (secure context, typed code, touch streams, visibility) to /__lane/r. */
(function () {
  if (window.__jjLaneProbe) return;
  window.__jjLaneProbe = true;
  var queue = [];
  var seq = 0;
  var busy = false;
  // Keep an event queued until the collector has acknowledged it (a request made while the page is being
  // backgrounded or resumed can fail), and send in order.
  function flush() {
    if (busy || !queue.length) return;
    busy = true;
    var ev = queue[0];
    try {
      fetch('/__lane/r', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(ev) })
        .then(function (r) { if (r.ok) queue.shift(); busy = false; flush(); })
        .catch(function () { busy = false; });
    } catch (e) { busy = false; }
  }
  function send(kind, data) {
    queue.push({ seq: ++seq, kind: kind, at: Date.now(), vis: document.visibilityState, data: data || {} });
    flush();
  }
  var touchIds = {}, pointerIds = {}, maxTouches = 0, maxPointers = 0, active = {}, sent2 = false;
  function onTouch(e) {
    var n = e.touches.length;
    if (n > maxTouches) maxTouches = n;
    for (var i = 0; i < e.changedTouches.length; i++) touchIds[e.changedTouches[i].identifier] = 1;
    if (!sent2 && n >= 2) {
      sent2 = true;
      var ids = [];
      for (var j = 0; j < e.touches.length; j++) ids.push(e.touches[j].identifier);
      send('touch2', { touchIdentifiers: ids, stream: 'touch', maxSimultaneous: n });
    }
  }
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (t) {
    document.addEventListener(t, onTouch, { capture: true, passive: true });
  });
  var zoneDown = { drive: 0, action: 0 }, zoneOf = {}, zoneBoth = false, downs = [];
  document.addEventListener('pointerdown', function (e) {
    if (downs.length < 20) downs.push([e.pointerId, Math.round(e.clientX), Math.round(e.clientY)]);
    var z = e.target && e.target.closest && e.target.closest('[data-box^=zone-]');
    if (z) { var k = z.getAttribute('data-box').slice(5); zoneDown[k] = (zoneDown[k] || 0) + 1; zoneOf[e.pointerId] = k; }
    pointerIds[e.pointerId] = 1; active[e.pointerId] = 1;
    var ks = {}; for (var id in active) if (zoneOf[id]) ks[zoneOf[id]] = 1;
    if (ks.drive && ks.action) zoneBoth = true;
    var n = Object.keys(active).length; if (n > maxPointers) maxPointers = n;
  }, true);
  ['pointerup', 'pointercancel'].forEach(function (t) {
    document.addEventListener(t, function (e) { delete active[e.pointerId]; }, true);
  });
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el && el.id === 'code' && el.value) send('typed', { value: el.value });
  }, true);
  var resumeAt = 0;
  document.addEventListener('visibilitychange', function () {
    var s = document.visibilityState;
    if (s === 'visible') resumeAt = Date.now();
    send(s === 'hidden' ? 'hidden' : (hiddenSeen ? 'visible-after-hidden' : 'visible'), { state: s });
    if (s === 'hidden') hiddenSeen = true;
  });
  var hiddenSeen = false;
  window.addEventListener('pagehide', function () { send('pagehide', {}); });
  window.addEventListener('pageshow', function () { flush(); });
  // Re-flush when foregrounded: events queued while the page was frozen.
  setInterval(flush, 500);
  // Periodic summary so the lane can read distinct ids even when pointer events were cancelled.
  setInterval(function () {
    send('touch-summary', {
      distinctTouchIdentifiers: Object.keys(touchIds).length, maxSimultaneousTouches: maxTouches,
      distinctPointerIds: Object.keys(pointerIds).length, maxSimultaneousPointers: maxPointers,
      zoneDown: zoneDown, bothZonesAtOnce: zoneBoth, downs: downs,
    });
  }, 1000);

  // Controller page readout (P1-C02/C03/G03): the page's own test surface `window.__jjController`, reported when
  // its phase, seat or sticks change, plus the visual viewport (zoom) and scroll, which must stay put.
  var lastCtl = '', maxStick = { steer: 0, throttle: 0, brake: 0 }, vvMin = 1, vvMax = 1, scrollMax = 0;
  setInterval(function () {
    try {
      var vv = window.visualViewport;
      if (vv) { vvMin = Math.min(vvMin, vv.scale); vvMax = Math.max(vvMax, vv.scale); }
      scrollMax = Math.max(scrollMax, Math.abs(window.scrollY || 0), Math.abs(window.scrollX || 0));
      var c = window.__jjController; if (!c) return;
      var i = c.inspect(), d = i.drive || {};
      maxStick.steer = Math.max(maxStick.steer, Math.abs(d.steer || 0));
      maxStick.throttle = Math.max(maxStick.throttle, Math.abs(d.throttle || 0));
      maxStick.brake = Math.max(maxStick.brake, Math.abs(d.brake || 0));
      var snap = JSON.stringify({ phase: i.phase, number: i.you && i.you.number, endpoint: i.link && i.link.endpointId,
        linkState: i.link && i.link.state, pc: i.link && i.link.pc, ice: i.link && i.link.ice, ch: i.link && i.link.channels && i.link.channels.state, roomPhase: i.roomPhase,
        steer: Math.round((d.steer || 0) * 20) / 20, throttle: Math.round((d.throttle || 0) * 20) / 20, brake: Math.round((d.brake || 0) * 20) / 20 });
      if (snap !== lastCtl) {
        lastCtl = snap;
        send('ctl', { phase: i.phase, you: i.you, link: i.link, roomPhase: i.roomPhase, drive: i.drive, hud: i.hud && true, stats: i.stats,
          vvScale: vv ? vv.scale : null, scrollY: window.scrollY, maxStick: maxStick, vvMin: vvMin, vvMax: vvMax, scrollMax: scrollMax });
      }
    } catch (e) {}
  }, 100);
  // Where the controls are, in CSS px, so the emulator drivers can aim their touches (re-sent when they move).
  // After a resume, report the controller's state every 100 ms for 5 s (C03: how long until the same seat is back).
  setInterval(function () {
    if (!resumeAt || Date.now() - resumeAt > 5000) return;
    try { var c = window.__jjController; if (!c) return; var i = c.inspect();
      send('resume-ctl', { sinceVisibleMs: Date.now() - resumeAt, phase: i.phase, number: i.you && i.you.number, endpoint: i.link && i.link.endpointId, linkState: i.link && i.link.state, ch: i.link && i.link.channels && i.link.channels.state }); } catch (e) {}
  }, 100);
  var lastRects = '';
  setInterval(function () {
    var q = function (sel) { var e = document.querySelector(sel); if (!e) return null; var r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    var rs = { join: q('.join-card button[type=submit]'), drive: q('[data-box=zone-drive]'), action: q('[data-box=zone-action]'), code: q('#code'), skip: q('[data-act=skip]'), upright: q('[data-act=upright]'), done: q('[data-act=done]'),
      vw: innerWidth, vh: innerHeight };
    var j = JSON.stringify(rs);
    if (j !== lastRects) { lastRects = j; send('rects', rs); }
  }, 300);
  function load() {
    send('load', {
      isSecureContext: window.isSecureContext === true,
      origin: location.origin, path: location.pathname,
      userAgent: navigator.userAgent, innerWidth: innerWidth, innerHeight: innerHeight,
      devicePixelRatio: devicePixelRatio, maxTouchPoints: navigator.maxTouchPoints,
      cryptoSubtle: !!(window.crypto && window.crypto.subtle),
      codeField: !!document.getElementById('code'),
    });
  }
  if (document.readyState === 'complete') load(); else window.addEventListener('load', load);
})();
