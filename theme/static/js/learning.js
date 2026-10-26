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

  /* 切换路线：入场交给 CSS 动画（元素从 display:none 变回来时动画会自己重播，
     不需要 JS 去掂时间），同一条路线里再按顺序错开一点。原来直接挂 `hidden`，
     换路线就是「啪」地一下整块换掉。 */
  /* 收起来的那条先淡出再 `hidden`：直接挂 `hidden` 是硬切，
     出场和入场对不上就会觉得整块内容闪了一下。 */
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
    /* 换完之后如果列表已经被滚到视口上方，就把它拉回来：不然筛选一换，
       屏幕上就是「内容凭空少了一半」的空白。 */
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
    } catch (_) { /* 沙箱预览不允许改写地址，方向筛选仍可使用。 */ }
  });
  window.addEventListener('hashchange', function () { show(location.hash.slice(1)); });
})();
