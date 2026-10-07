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
  document.addEventListener('pointerdown', function (e) {
    pointerIds[e.pointerId] = 1; active[e.pointerId] = 1;
    var n = Object.keys(active).length; if (n > maxPointers) maxPointers = n;
  }, true);
  ['pointerup', 'pointercancel'].forEach(function (t) {
    document.addEventListener(t, function (e) { delete active[e.pointerId]; }, true);
  });
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el && el.id === 'code' && el.value) send('typed', { value: el.value });
  }, true);
  document.addEventListener('visibilitychange', function () {
    var s = document.visibilityState;
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
    });
  }, 1000);
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
