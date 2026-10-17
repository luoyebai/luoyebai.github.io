(function () {
  'use strict';
  var controls = document.querySelector('[data-route-controls]');
  if (!controls) return;
  var paths = Array.prototype.slice.call(document.querySelectorAll('[data-learning-path]'));
  var keys = paths.map(function (p) { return p.getAttribute('data-learning-path'); });
  function motionOk() {
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      && document.documentElement.getAttribute('data-motion') !== 'off';
  }
  function hideLater(path) {
    clearTimeout(path.__leave);
    if (!motionOk()) {
      path.classList.remove('is-leaving');
      path.hidden = true;
      return;
    }
    path.classList.add('is-leaving');
    path.__leave = setTimeout(function () {
      path.hidden = true;
      path.classList.remove('is-leaving');
    }, 220);
  }
  function show(key) {
    if (key !== 'all' && keys.indexOf(key) < 0) key = 'all';
    var anim = motionOk();
    paths.forEach(function (path, i) {
      var on = key === 'all' || path.getAttribute('data-learning-path') === key;
      if (on) {
        clearTimeout(path.__leave);
        path.classList.remove('is-leaving');
        path.style.animationDelay = anim ? (i * 45) + 'ms' : '';
        path.hidden = false;
      } else if (!path.hidden) {
        hideLater(path);
      }
    });
    controls.querySelectorAll('[data-route-filter]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-route-filter') === key));
    });
    var first = null;
    for (var i = 0; i < paths.length; i++) {
      var on = key === 'all' || paths[i].getAttribute('data-learning-path') === key;
      if (on) { first = paths[i]; break; }
    }
    if (first && first.getBoundingClientRect().top < 0) {
      first.scrollIntoView({ behavior: anim ? 'smooth' : 'auto', block: 'start' });
    }
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