(function () {
  'use strict';
  var prose = document.querySelector('.page-links .prose');
  if (!prose) return;
  var headings = Array.from(prose.querySelectorAll('h2'));
  var groups = headings.map(function (h, i) {
    var list = h.nextElementSibling;
    var section = document.createElement('section'); section.className = 'resource-group';
    h.before(section); section.append(h);
    if (list && list.tagName === 'UL') section.append(list);
    section.dataset.group = String(i);
    section.style.setProperty('--resource-index', i);
    var descriptions = ['从学习方法到算法与系统设计，找到可靠的起点。', '写代码时随手查阅的工具、问答与调试参考。', '语言规范、核心准则与标准库参考。', '从日常命令到内核，逐步理解你的系统。', '学习、计算与创作中常用的在线工具。', '代码之外，也留一点好奇心。'];
    var description = document.createElement('p'); description.className = 'resource-description'; description.textContent = descriptions[i] || '';
    h.after(description);
    section.querySelectorAll('li a').forEach(function (a) {
      var title = a.textContent; var url;
      try { url = new URL(a.href); } catch (e) { return; }
      a.textContent = '';
      var icon = document.createElement('span'); icon.className = 'resource-icon'; icon.textContent = url.hostname.replace(/^www\./, '').slice(0,2).toUpperCase(); icon.setAttribute('aria-hidden', 'true');
      var name = document.createElement('strong'); name.textContent = title;
      var domain = document.createElement('small'); domain.textContent = url.hostname.replace(/^www\./, '');
      var arrow = document.createElement('span'); arrow.className = 'resource-arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
      a.append(icon, name, domain, arrow); a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', title + '（新标签页打开）');
    });
    return section;
  });
  var bar = document.createElement('div'); bar.className = 'resource-toolbar';
  var label = document.createElement('label'); label.textContent = '查找资源';
  var input = document.createElement('input'); input.type = 'search'; input.placeholder = '搜索名称或域名…'; label.append(input);
  var filters = document.createElement('div'); filters.className = 'resource-filters'; filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', '资源分类');
  var status = document.createElement('p'); status.className = 'resource-count'; status.setAttribute('role', 'status');
  var clear = document.createElement('button'); clear.type = 'button'; clear.className = 'resource-clear'; clear.textContent = '重置筛选';
  clear.addEventListener('click', function () { input.value = ''; selected = 'all'; update(); input.focus(); });
  var empty = document.createElement('p'); empty.className = 'resource-empty'; empty.textContent = '没有找到匹配的资源，试试其他关键词或分类。'; empty.hidden = true;
  var selected = 'all';
  ['全部'].concat(headings.map(function (h) { return h.textContent.replace(/#$/, '').trim(); })).forEach(function (name, i) {
    var btn = document.createElement('button'); btn.type = 'button'; btn.textContent = name; btn.dataset.filter = i ? String(i - 1) : 'all'; btn.setAttribute('aria-pressed', i ? 'false' : 'true');
    btn.addEventListener('click', function () { selected = btn.dataset.filter; update(); }); filters.append(btn);
  });
  function update() {
    var query = input.value.trim().toLocaleLowerCase(), count = 0;
    groups.forEach(function (group) {
      var found = 0;
      group.querySelectorAll('li').forEach(function (li) {
        var match = (selected === 'all' || selected === group.dataset.group) && li.textContent.toLocaleLowerCase().includes(query);
        li.hidden = !match; if (match) found++;
      });
      group.hidden = !found; count += found;
      var heading = group.querySelector('h2'); heading.dataset.count = String(found);
    });
    filters.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.filter === selected)); });
    status.textContent = count + ' 个资源 · 在新标签页打开'; empty.hidden = count !== 0;
  }
  input.addEventListener('input', update); bar.append(label, filters, status, clear); prose.before(bar); prose.append(empty); update();
})();