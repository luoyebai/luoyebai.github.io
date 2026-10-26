/* Built-in, trusted physics tools. No engine downloads until the reader opts in. */
(function () {
  'use strict';
  document.querySelectorAll('[data-mujoco-tool="ankle"]').forEach(function (panel) {
    var load = panel.querySelector('[data-mujoco-load]');
    var unload = panel.querySelector('[data-mujoco-unload]');
    var mount = panel.querySelector('[data-mujoco-mount]');
    var intro = panel.querySelector('.mujoco-embed-intro');
    var link = panel.querySelector('[data-mujoco-link]');
    var frame = null, observer = null;
    window.addEventListener('message', function (event) {
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.origin !== new URL(link.href).origin && !(window.PREVIEW_CONFIG && event.origin === 'null')) return;
      if (event.data && event.data.type === 'mujoco-size' && Number.isFinite(event.data.height)) {
        frame.style.height = Math.max(320, Math.min(2600, Math.ceil(event.data.height))) + 'px';
      }
    });
    function activity() {
      if (!frame) return;
      var rect = panel.getBoundingClientRect();
      frame.contentWindow.postMessage({ type: 'mujoco-activity', active: !document.hidden && rect.bottom > 0 && rect.top < innerHeight }, window.PREVIEW_CONFIG ? '*' : new URL(link.href).origin);
    }
    load.addEventListener('click', function () {
      if (frame) return;
      var url = new URL(link.href, document.baseURI);
      url.searchParams.set('embed', '1'); url.searchParams.set('autoload', '1');
      url.searchParams.set('mode', document.documentElement.getAttribute('data-mode') === 'light' ? 'light' : 'dark');
      frame = document.createElement('iframe');
      frame.title = '并联踝 MuJoCo：电机驱动闭环机构';
      frame.src = url.href; frame.allow = 'fullscreen';
      frame.addEventListener('load', activity);
      mount.appendChild(frame); mount.hidden = false; intro.hidden = true; unload.hidden = false;
      if (window.IntersectionObserver) { observer = new IntersectionObserver(activity); observer.observe(panel); }
    });
    unload.addEventListener('click', function () {
      if (observer) observer.disconnect(); observer = null;
      if (frame) frame.remove(); frame = null;
      mount.hidden = true; intro.hidden = false; unload.hidden = true; load.focus();
    });
    document.addEventListener('visibilitychange', activity);
  });
})();
