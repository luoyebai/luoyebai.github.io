(function () {
  'use strict';
  var scene = document.getElementById('lost');
  if (!scene) return;
  var space = document.getElementById('lost-space');
  var status = document.getElementById('lost-status');
  var speech = document.getElementById('lost-speech');
  var routes = [].slice.call(document.querySelectorAll('#lost-routes a'));
  var departure = null;
  var beacons = [].slice.call(scene.querySelectorAll('[data-beacon]'));
  var indicators = scene.querySelectorAll('.lost-progress i');
  var found = new Set();
  var messages = ['收到一点信号了！还差两枚。', '星图亮起来了，再找最后一枚。', '坐标已锁定。谢谢你，领航员！'];
  document.getElementById('lost-mission').hidden = false;
  beacons.forEach(function (button) {
    button.hidden = false;
    button.addEventListener('click', function () {
      var id = button.getAttribute('data-beacon');
      if (found.has(id)) return;
      found.add(id);
      button.classList.add('is-found');
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-label', button.getAttribute('aria-label').replace('收集', '已收集'));
      indicators[found.size - 1].classList.add('is-found');
      speech.textContent = messages[found.size - 1];
      status.textContent = '已找到 ' + found.size + ' / 3 枚信标，继续寻找发光的星标。';
      if (found.size === 3) {
        scene.classList.add('is-rescued');
        var destination = routes[Math.floor(Math.random() * routes.length)] || scene.querySelector('.lost-actions a');
        status.textContent = '3 / 3 信标就位，正在跃迁至「' + destination.textContent.trim() + '」…';
        speech.textContent = '下一站，交给好奇心！';
        departure = window.setTimeout(function () { window.location.assign(destination.href); }, 700);
      }
    });
  });
  window.addEventListener('pagehide', function () { window.clearTimeout(departure); });
  function syncVisibility(visible) { space.classList.toggle('is-paused', !visible || document.hidden); }
  var visible = true;
  if (window.IntersectionObserver) new IntersectionObserver(function (entries) {
    visible = entries[0].isIntersecting; syncVisibility(visible);
  }).observe(space);
  document.addEventListener('visibilitychange', function () { syncVisibility(visible); });
})();