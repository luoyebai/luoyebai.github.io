(function () {
  'use strict';
  var scene = document.getElementById('lost');
  if (!scene) return;
  var status = document.getElementById('lost-status');
  var count = document.getElementById('lost-count');
  var signal = document.getElementById('lost-signal');
  var routes = [].slice.call(scene.querySelectorAll('#lost-routes a')).filter(function (a) {
    return a.origin === window.location.origin && a.pathname !== window.location.pathname;
  });
  var beacons = [].slice.call(scene.querySelectorAll('[data-beacon]'));
  var indicators = scene.querySelectorAll('.lost-progress i');
  var found = new Set();
  var departure = null;
  var destination = null;
  document.getElementById('lost-mission').hidden = false;
  document.getElementById('lost-search').hidden = false;
  beacons.forEach(function (button) {
    button.hidden = false;
    button.addEventListener('click', function () {
      var id = button.getAttribute('data-beacon');
      if (found.has(id)) return;
      found.add(id);
      button.classList.add('is-found');
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-label', button.getAttribute('aria-label').replace('点亮', '已点亮'));
      button.querySelector('small').textContent = '已连接';
      scene.querySelector('[data-link="' + id + '"]').classList.add('is-linked');
      indicators[found.size - 1].classList.add('is-found');
      count.textContent = '0' + found.size + ' / 03';
      signal.textContent = '已连接 ' + found.size + ' 个坐标';
      status.textContent = '已点亮 ' + found.size + ' / 3 颗星，再点亮 ' + (3 - found.size) + ' 颗就出发。';
      if (found.size === beacons.length) {
        scene.classList.add('is-rescued');
        destination = routes[Math.floor(Math.random() * routes.length)] || scene.querySelector('.lost-actions a');
        status.textContent = '连接完成，正在前往「' + destination.textContent.trim() + '」…';
        signal.textContent = '坐标已连接 · 即将出发';
        departure = window.setTimeout(function () { window.location.assign(destination.href); }, 700);
      }
    });
  });
  window.addEventListener('pagehide', function () { window.clearTimeout(departure); departure = null; });
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted || !destination) return;
    destination = null;
    scene.classList.remove('is-rescued');
    found.clear();
    count.textContent = '00 / 03';
    signal.textContent = '等待坐标连接';
    status.textContent = '点亮星图里的 3 颗星，自动前往一个随机页面。';
    beacons.forEach(function (button, i) {
      button.classList.remove('is-found');
      button.removeAttribute('aria-disabled');
      button.setAttribute('aria-label', button.getAttribute('aria-label').replace('已点亮', '点亮'));
      button.querySelector('small').textContent = '0' + (i + 1);
      indicators[i].classList.remove('is-found');
      scene.querySelector('[data-link="' + button.getAttribute('data-beacon') + '"]').classList.remove('is-linked');
    });
  });
})();