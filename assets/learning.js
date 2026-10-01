(function () {
  'use strict';
  var controls = document.querySelector('[data-route-controls]');
  if (!controls) return;
  var paths = Array.prototype.slice.call(document.querySelectorAll('[data-learning-path]'));
  var keys = paths.map(function (p) { return p.getAttribute('data-learning-path'); });
  function show(key) {
    if (key !== 'all' && keys.indexOf(key) < 0) key = 'all';
    paths.forEach(function (path) { path.hidden = key !== 'all' && path.getAttribute('data-learning-path') !== key; });
    controls.querySelectorAll('[data-route-filter]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-route-filter') === key));
    });
  }
  controls.hidden = false;
  show(location.hash.slice(1));
  controls.addEventListener('click', function (event) {
    var button = event.target.closest('[data-route-filter]');
    if (!button) return;
    var key = button.getAttribute('data-route-filter');
    show(key);
    try {
      history.replaceState(null, '', location.pathname + location.search + (key === 'all' ? '' : '#' + key));
    } catch (_) {  }
  });
  window.addEventListener('hashchange', function () { show(location.hash.slice(1)); });
})();