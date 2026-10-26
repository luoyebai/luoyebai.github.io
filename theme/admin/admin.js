/* =========================================================================
   写作后台前端
   ========================================================================= */
(function () {
  'use strict';

  var S = {
    state: null,
    filter: 'all',
    q: '',
    cur: null,        // { kind, slug, originalSlug, front, body }
    dirty: false,
    imgTarget: null,  // { key, cb }
    previewTimer: null
  };

  var FIELDS = {
    common: [
      { k: 'title', label: '标题', type: 'text', wide: true },
      { k: 'slug', label: 'URL 别名 slug', type: 'text', hint: '留空自动从标题生成' },
      { k: 'date', label: '发布日期', type: 'date' },
      { k: 'updated', label: '更新日期', type: 'date' },
      { k: 'tags', label: '标签（逗号分隔）', type: 'text', wide: true },
      { k: 'summary', label: '摘要', type: 'textarea', wide: true, hint: '留空自动截取正文' },
      { k: 'cover', label: '封面图', type: 'cover', wide: true }
    ],
    post: [],
    project: [
      { k: 'tagline', label: '一句话副标题', type: 'text', wide: true },
      { k: 'status', label: '状态', type: 'text', hint: '如：维护中 / 归档 / 开发中' },
      { k: 'order', label: '排序（越小越靠前）', type: 'number' },
      { k: 'stack', label: '技术栈（逗号分隔）', type: 'text', wide: true },
      { k: 'links', label: '外部链接', type: 'links', wide: true }
    ],
    page: [
      { k: 'subtitle', label: '副标题', type: 'text', wide: true }
    ],
    // 文档是幻灯片。collection 决定它进哪门课（下拉，取值来自 site.config.json），
    // order 决定课内顺序；两者都由构建期读的 front-matter 决定，没有别的登记表。
    doc: [
      { k: 'collection', label: '所属课程', type: 'select', options: 'docCollections' },
      { k: 'order', label: '课内排序（越小越靠前）', type: 'number' }
    ]
  };

  var FLAGS = {
    post: [['featured', '精选'], ['draft', '草稿'], ['archived', '归档']],
    project: [['featured', '精选'], ['draft', '草稿']],
    page: [['draft', '草稿']],
    doc: [['draft', '草稿']]
  };

  var LIST_ORDER = [['post', '文章'], ['project', '项目'], ['doc', '文档'], ['page', '页面']];

  // 这些 kind 会参与左侧的按类型筛选
  var FILTERABLE = ['post', 'project', 'page', 'doc'];
  var KIND_DIR = { post: 'posts', project: 'projects', page: 'pages', doc: 'docs' };

  // ---------------------------------------------------------------- 后台主题
  var THEME_KEY = 'blog.admin.theme';
  var ADMIN_THEMES = ['midnight', 'violet', 'ocean', 'forest', 'rose', 'paper'];

  function applyAdminTheme(id) {
    if (ADMIN_THEMES.indexOf(id) < 0) id = 'midnight';
    document.documentElement.setAttribute('data-admin-theme', id);
    try { localStorage.setItem(THEME_KEY, id); } catch (e) { /* 隐私模式忽略 */ }
    document.querySelectorAll('#themeMenu [data-admin-theme]').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-admin-theme') === id);
    });
  }

  function initAdminTheme() {
    var saved = 'midnight';
    try { saved = localStorage.getItem(THEME_KEY) || 'midnight'; } catch (e) { /* ignore */ }
    var m = /[?&]atheme=([a-z]+)/.exec(location.search);
    if (m && ADMIN_THEMES.indexOf(m[1]) >= 0) saved = m[1];
    applyAdminTheme(saved);
  }

  // ---------------------------------------------------------------- 主题管理
  function openThemes() {
    if (!S.state) { toast('正在加载主题，请稍后重试'); return; }
    S.themeDraft = JSON.parse(JSON.stringify(S.state.themes || []));
    S.themeRevision = S.state.configRevision;
    renderThemes();
    S.themeOriginal = JSON.stringify(collectThemes());
    $('themeSaveStatus').textContent = '保存后，构建站点即可预览。';
    $('themeModal').hidden = false;
  }

  function seedField(key, label, val) {
    return '<label class="seed">' + esc(label) +
      '<input type="color" data-seed="' + key + '" value="' + esc(val || '#888888') + '"></label>';
  }

  function renderThemes() {
    var list = S.themeDraft || [];
    $('themeCount').textContent = list.length;
    $('themeList').innerHTML = list.map(function (t, i) {
      var s = t.seeds || {};
      return '<div class="theme-card" data-idx="' + i + '">' +
        '<div class="theme-thumb" data-act="pick-theme-bg" data-idx="' + i + '"' +
          (t.bg ? ' style="background-image:url(/' + esc(t.bg) + ')"' : '') +
          ' title="' + esc(t.bg || '点击选择背景图') + '"></div>' +
        '<div class="theme-fields">' +
          '<label class="field"><span>名称</span><input type="text" data-tf="name" value="' + esc(t.name || '') + '"></label>' +
          '<label class="field"><span>英文名</span><input type="text" data-tf="nameEn" value="' + esc(t.nameEn || '') + '"></label>' +
          '<div class="theme-id"><span>id</span>' +
            '<input type="text" data-tf="id" value="' + esc(t.id || '') + '" style="width:132px">' +
            '<span class="grow"></span><span>' + esc(t.bg || '(未设置背景图)') + '</span></div>' +
          '<div class="theme-seeds">' +
            seedField('accent', '强调色', s.accent) +
            seedField('accent2', '辅助色', s.accent2) +
            seedField('darkBg', '深色底', s.darkBg) +
            seedField('lightBg', '浅色底', s.lightBg) +
            '<label class="seed">色相 <input type="number" data-tf="tintHue" min="0" max="359" value="' +
              (s.tintHue == null ? 220 : s.tintHue) + '"></label>' +
          '</div>' +
        '</div>' +
        '<div class="theme-side">' +
          '<div class="theme-swatch">' +
            '<i style="background:' + esc(s.accent || '#888') + '"></i>' +
            '<i style="background:' + esc(s.accent2 || '#888') + '"></i>' +
            '<i style="background:' + esc(s.darkBg || '#888') + '"></i></div>' +
          '<button class="btn ghost" data-act="suggest-seeds" data-idx="' + i + '">按图取色</button>' +
          '<button class="btn ghost danger" data-act="del-theme" data-idx="' + i + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join('') || '<p class="hint">还没有主题。</p>';
  }

  // 从表单读回当前编辑值（每次改动前先收一遍，避免重绘丢改动）
  function collectThemes() {
    var out = [];
    $('themeList').querySelectorAll('.theme-card').forEach(function (card) {
      var t = JSON.parse(JSON.stringify(S.themeDraft[+card.getAttribute('data-idx')] || {}));
      if (!t.seeds) t.seeds = {};
      card.querySelectorAll('[data-tf]').forEach(function (n) {
        var k = n.getAttribute('data-tf');
        if (k === 'tintHue') t.seeds.tintHue = parseInt(n.value, 10) || 0;
        else t[k] = n.value.trim();
      });
      card.querySelectorAll('[data-seed]').forEach(function (n) {
        t.seeds[n.getAttribute('data-seed')] = n.value;
      });
      t.swatch = [t.seeds.accent, t.seeds.accent2, t.seeds.darkBg];
      out.push(t);
    });
    return out.length ? out : JSON.parse(JSON.stringify(S.themeDraft || []));
  }

  function saveThemes() {
    if (S.configSaving) return;
    var themes = collectThemes();
    if (!themes.length) { toast('至少要保留一套主题', 'err'); return; }
    S.configSaving = true;
    setConfigSaving(true);
    $('themeSaveStatus').textContent = '正在保存主题…';
    busy(true);
    return api('/api/site', { body: { themes: themes, revision: S.themeRevision } })
      .then(function (r) {
        S.themeRevision = r.revision;
        S.themeOriginal = JSON.stringify(themes);
        $('themeSaveStatus').textContent = '主题已保存，构建站点即可预览。';
        toast('主题已保存', 'ok');
        if (!modalDirty($('themeModal'))) $('themeModal').hidden = true;
        return refresh();
      })
      .catch(function (e) {
        $('themeSaveStatus').textContent = e.message;
        return configSaveFailed(e);
      })
      .then(function () { S.configSaving = false; setConfigSaving(false); busy(false); });
  }

  function addTheme() {
    var themes = collectThemes();
    var n = 1;
    while (themes.some(function (t) { return t.id === 'theme-' + n; })) n++;
    var firstImg = (S.state.images || [])[0] || {};
    themes.push({
      id: 'theme-' + n, name: '新主题', nameEn: 'Theme ' + n,
      bg: firstImg.path || '',
      swatch: [],
      seeds: { accent: '#7aa2ff', accent2: '#ff9d5c', darkBg: '#0a0f1e',
               lightBg: '#f6f4f0', tintHue: 220 }
    });
    S.themeDraft = themes;
    renderThemes();
    var body = $('themeModal').querySelector('.modal-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  function suggestSeeds(i) {
    var cur = collectThemes();
    S.themeDraft = cur;
    if (!cur[i] || !cur[i].bg) { toast('先给这个主题选一张背景图', 'err'); return; }
    busy(true);
    api('/api/theme-suggest', { body: { bg: cur[i].bg } })
      .then(function (r) {
        S.themeDraft[i].seeds = r.seeds;
        renderThemes();
        toast('已按画面重新取色', 'ok');
      })
      .catch(function (e) { toast(e.message, 'err'); })
      .then(function () { busy(false); });
  }

  // ---------------------------------------------------------------- 基础
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, kind) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, kind === 'err' ? 5000 : 2200);
  }
  var busyCount = 0;
  function busy(on) {
    busyCount = Math.max(0, busyCount + (on ? 1 : -1));
    $('loading').hidden = !busyCount;
  }

  function setConfigSaving(on) {
    document.querySelectorAll('[data-act="save-site"], [data-act="save-themes"]').forEach(function (b) {
      b.disabled = on;
      b.setAttribute('aria-busy', String(on));
    });
  }

  function setSaving(on) {
    S.saving = on;
    document.querySelectorAll('[data-act="save"], [data-act="save-build"], [data-act="delete"], [data-act="reload"]').forEach(function (b) {
      b.disabled = on;
      b.setAttribute('aria-busy', String(on));
    });
  }

  function api(path, opts) {
    opts = opts || {};
    if (opts.body !== undefined) {
      opts.method = opts.method || 'POST';
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, opts).then(function (r) {
      // 先取文本再解析：服务端出错时可能返回非 JSON（例如 413 或连接被重置），
      // 直接 r.json() 会抛出难懂的 SyntaxError。
      return r.text().then(function (text) {
        var data = {};
        if (text) {
          try { data = JSON.parse(text); }
          catch (e) {
            var reason = r.status === 413
              ? '请求体过大（图片超过限制，请压到 12MB 以内）'
              : r.status === 0
                ? '无法连接到后台服务'
                : 'HTTP ' + r.status + (r.statusText ? ' ' + r.statusText : '');
            throw new Error(reason);
          }
        }
        if (!r.ok || data.ok === false) {
          var error = new Error(data.error || ('HTTP ' + r.status));
          error.status = r.status;
          throw error;
        }
        return data;
      });
    }, function () {
      throw new Error('无法连接到后台服务，请确认 tools/admin.py 还在运行');
    });
  }

  function setDirty(v) {
    S.dirty = v;
    $('dirty').hidden = !v;
    clearTimeout(S.draftTimer);
    if (v) { $('dirty').textContent = '未保存 · 正在暂存…'; S.draftTimer = setTimeout(persistDraft, 500); }
  }

  // Per-workspace, document and browser-tab keys prevent unrelated drafts from
  // replacing one another. Storage failures never prevent a normal disk save.
  var draftSession = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var draftPrefix = 'blog.admin.draft.v1.';
  function draftScope() { return draftPrefix + encodeURIComponent(S.state.root || '') + '.'; }
  function draftKey(owner) {
    if (!owner.draftKey) owner.draftKey = draftScope() + encodeURIComponent(owner.kind + ':' +
      (owner.originalSlug || 'new-' + Math.random().toString(36).slice(2))) + '.' + draftSession;
    return owner.draftKey;
  }
  function drafts() {
    var items = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(draftScope()) !== 0) continue;
        try {
          var raw = localStorage.getItem(key), item = JSON.parse(raw);
          if (item && item.kind in KIND_DIR && typeof item.body === 'string' && item.front && typeof item.front === 'object') {
            item.key = key; item.raw = raw; items.push(item);
          }
        } catch (e) { /* Leave malformed records intact; skip only the listing. */ }
      }
    } catch (e) { /* Private mode / denied storage. */ }
    return items.sort(function (a, b) { return b.at - a.at; });
  }
  function draftBadge() {
    if (!S.state) return;
    var count = drafts().length;
    $('draftCount').textContent = count ? ' · ' + count : '';
  }
  function persistDraft() {
    clearTimeout(S.draftTimer);
    if (!S.cur || !S.state || !S.dirty) return true;
    try {
      localStorage.setItem(draftKey(S.cur), JSON.stringify({ kind: S.cur.kind,
        originalSlug: S.cur.originalSlug, revision: S.cur.revision || '',
        front: collectFront(), body: $('body').value, at: Date.now() }));
      $('dirty').textContent = '未保存 · 已暂存本机';
      S.draftStorageFailed = false;
      draftBadge();
      return true;
    } catch (e) {
      $('dirty').textContent = '未保存 · 暂存不可用';
      if (!S.draftStorageFailed) toast('本机暂存空间不足或不可用，请及时保存；正文保存功能不受影响', 'err');
      S.draftStorageFailed = true;
      return false;
    }
  }
  function protectDraftBeforeSwitch() {
    if (persistDraft()) return true;
    toast('暂存失败，当前输入已保留。请先保存或复制改动，再切换 / 恢复内容。', 'err');
    return false;
  }
  function forgetDraft(owner) {
    if (!owner) return;
    try {
      if (owner.draftKey) localStorage.removeItem(owner.draftKey);
      var recovered = owner.recoveredDraft;
      if (recovered && localStorage.getItem(recovered.key) === recovered.raw) localStorage.removeItem(recovered.key);
    } catch (e) { /* Saving must remain successful if local storage is denied. */ }
    delete owner.draftKey; delete owner.recoveredDraft;
    draftBadge();
  }
  function offerDraft(owner) {
    var found = drafts().find(function (item) { return item.kind === owner.kind && item.originalSlug === owner.originalSlug; });
    if (!found) return;
    askConfirm({ title: '发现未保存的暂存', message: '「' + (found.front.title || owner.slug) + '」在 ' +
      new Date(found.at).toLocaleString() + ' 有本机暂存。载入后可以继续编辑；暂存仍可在恢复中心找到。', okLabel: '载入暂存' })
      .then(function (ok) { if (ok && S.cur === owner) applyDraft(found, owner); });
  }
  function applyDraft(item, owner) {
    var changedOnDisk = item.originalSlug && item.revision !== owner.revision;
    owner.front = item.front; owner.body = item.body;
    // Preserve the actual base revision. A stale recovered draft cannot silently
    // overwrite a version another editor saved while this window was closed.
    if (item.originalSlug) owner.revision = item.revision;
    owner.recoveredDraft = { key: item.key, raw: item.raw };
    renderMeta(); $('body').value = item.body; setDirty(true); doPreview();
    $('statusText').textContent = changedOnDisk ? '已载入暂存；磁盘版本已变化，保存前请复制改动并重新载入合并' : '已载入本机暂存，确认内容后保存';
    if (changedOnDisk) toast('磁盘内容已更新。暂存已载入，但不会覆盖新版本；请先复制改动，再重新载入比较。', 'err');
  }

  function recoveryTime(value) { return new Date(value).toLocaleString(); }
  function recoveryList(mode, offset) {
    offset = offset || 0;
    S.recoveryMode = mode; S.recoveryOffset = offset;
    var request = S.recoveryRequest = (S.recoveryRequest || 0) + 1;
    $('recoveryDetail').hidden = true;
    $('recoveryList').textContent = '正在载入…';
    document.querySelectorAll('[data-recovery-tab]').forEach(function (button) {
      button.classList.toggle('primary', button.dataset.recoveryTab === mode);
    });
    var promise;
    if (mode === 'drafts') { var local = drafts(); promise = Promise.resolve({items: local.slice(offset, offset + 40), total: local.length}); }
    else if (mode === 'history') {
      var owner = S.recoveryOwner;
      if (!owner || !owner.originalSlug) { $('recoveryList').textContent = '先打开一篇已保存的内容，即可查看版本历史。'; return; }
      promise = api('/api/history?kind=' + encodeURIComponent(owner.kind) + '&slug=' + encodeURIComponent(owner.originalSlug) + '&offset=' + offset);
    } else promise = api('/api/trash?offset=' + offset);
    promise.then(function (r) {
      if (request !== S.recoveryRequest) return;
      S.recoveryItems = r.items;
      $('recoveryList').innerHTML = r.items.map(function (item, index) {
        var title = mode === 'drafts' ? item.front.title : mode === 'trash' ? item.title : item.reason + ' · ' + item.slug;
        var hint = mode === 'history' ? (Math.ceil(item.bytes / 1024) + ' KB · ' + item.id.slice(0, 8)) : (S.state.labels[item.kind] + ' · ' + (item.originalSlug || item.slug || '尚未保存的新内容'));
        return '<article class="recovery-item"><div><strong>' + esc(title || '未命名') + '</strong><span>' + esc(recoveryTime(item.at)) + ' · ' + esc(hint) + '</span></div>' +
          (mode !== 'trash' ? '<button class="btn ghost tiny" data-recovery-view="' + index + '">查看' + (mode === 'history' ? ' / 差异' : '暂存') + '</button>' : '') +
          (mode === 'drafts' ? '<button class="btn ghost tiny" data-recovery-discard="' + index + '">清理暂存</button>' : '') +
          '<button class="btn tiny" data-recovery-restore="' + index + '">' + (mode === 'drafts' ? '载入' : '恢复') + '</button></article>';
      }).join('') || '<p class="hint">' + (mode === 'history' ? '保存后会自动留下版本。已有内容的第一次保存也会保留修改前的正文。' : mode === 'trash' ? '回收站是空的。删除的内容会保留在本机，可随时恢复。' : '暂无未保存的暂存。编辑后会自动暂存到当前浏览器。') + '</p>';
      $('recoveryPaging').hidden = r.total <= 40;
      $('recoveryPage').textContent = (offset + 1) + '–' + Math.min(offset + 40, r.total) + ' / ' + r.total;
      $('recoveryPrev').disabled = offset === 0;
      $('recoveryNext').disabled = offset + 40 >= r.total;
    }).catch(function (e) { if (request === S.recoveryRequest) $('recoveryList').textContent = e.message; });
  }
  function openRecovery(mode) {
    if (S.saving || S.opening) return;
    persistDraft(); S.recoveryOwner = S.cur;
    if ($('recoveryModal').hidden) S.recoveryOpener = document.activeElement;
    $('recoveryModal').hidden = false;
    $('recoveryContext').textContent = S.cur ? '当前内容：' + (collectFront().title || S.cur.slug) : '本机内容恢复';
    recoveryList(mode || 'drafts');
    $('recoveryModal').querySelector('[data-recovery-tab="' + (mode || 'drafts') + '"]').focus();
  }
  function closeRecovery() {
    $('recoveryModal').hidden = true;
    var opener = S.recoveryOpener;
    S.recoveryOpener = null;
    if (opener && opener.isConnected && !opener.disabled) opener.focus();
  }
  function recoveryKey(event) {
    var modal = $('recoveryModal');
    // A confirmation above the recovery dialog owns its own keyboard handling.
    if (modal.hidden || askState) return false;
    if (event.key === 'Escape') {
      event.preventDefault(); closeRecovery(); return true;
    }
    if (event.key !== 'Tab') return false;
    var focusable = Array.prototype.filter.call(modal.querySelectorAll(
      'button, input, select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])'),
      function (node) { return !node.disabled && !node.closest('[hidden]') && node.getClientRects().length; });
    if (!focusable.length) return false;
    var index = focusable.indexOf(document.activeElement);
    if (index < 0 || (event.shiftKey ? index === 0 : index === focusable.length - 1)) {
      event.preventDefault(); focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
    }
    return true;
  }
  function recoveryView(index) {
    var item = (S.recoveryItems || [])[index], mode = S.recoveryMode;
    if (!item) return;
    var request = S.recoveryRequest;
    var show = function (text, diff) {
      if (request !== S.recoveryRequest || mode !== S.recoveryMode) return;
      $('recoveryDetail').hidden = false;
      $('recoverySource').textContent = text;
      $('recoveryDiff').textContent = diff || '';
      $('recoveryDiffWrap').hidden = !diff;
    };
    if (mode === 'drafts') return show(JSON.stringify(item.front, null, 2) + '\n\n' + item.body);
    var owner = S.recoveryOwner;
    api('/api/history/version?kind=' + encodeURIComponent(owner.kind) + '&slug=' + encodeURIComponent(owner.originalSlug) + '&id=' + item.id)
      .then(function (r) { show(r.text, r.diff); }).catch(function (e) { toast(e.message, 'err'); });
  }
  function recoveryRestore(index) {
    var item = (S.recoveryItems || [])[index], mode = S.recoveryMode, owner = S.recoveryOwner;
    if (!item || S.saving || S.opening) return;
    askConfirm({ title: mode === 'drafts' ? '载入本机暂存' : '恢复内容',
      message: mode === 'history' ? '把选中的历史版本恢复为当前内容？当前已保存版本会保留，未保存输入会先暂存在本机；URL 保持不变。' :
        mode === 'trash' ? '恢复「' + item.title + '」到原位置？若同名内容存在，将停止恢复。恢复后需重新构建站点。' : '载入「' + (item.front.title || '未命名') + '」？当前输入会先暂存，载入后需手动保存。',
      okLabel: mode === 'drafts' ? '载入暂存' : '确认恢复' }).then(function (ok) {
        if (!ok || S.saving || S.opening) return;
        if (!protectDraftBeforeSwitch()) return;
        if (mode === 'drafts') {
          closeRecovery();
          if (item.originalSlug) {
            return openDoc(item.kind, item.originalSlug, true, true).then(function (loaded) {
              if (loaded && S.cur.kind === item.kind && S.cur.originalSlug === item.originalSlug) applyDraft(item, S.cur);
            });
          }
          createDoc(item.kind, item.front.title || '未命名'); applyDraft(item, S.cur); return;
        }
        if (mode === 'history' && S.cur !== owner) { toast('当前文档已切换，请重新打开版本历史'); return; }
        setSaving(true);
        var payload = mode === 'history' ? {kind:owner.kind, slug:owner.originalSlug, revision:owner.revision, id:item.id} : {id:item.id};
        api(mode === 'history' ? '/api/history/restore' : '/api/trash/restore', {body:payload})
          .then(function (r) {
            setSaving(false); closeRecovery(); setDirty(false);
            toast('已恢复内容；重新构建后会更新博客', 'ok');
            return refresh(true).then(function () { return openDoc(r.kind || owner.kind, r.slug, true, true); });
          }).catch(function (e) { toast('恢复失败：' + e.message, 'err'); })
          .then(function () { setSaving(false); });
      });
  }

  function discardLocalDraft(index) {
    var item = (S.recoveryItems || [])[index];
    if (!item || S.recoveryMode !== 'drafts') return;
    askConfirm({title:'清理本机暂存', message:'只移除这份浏览器暂存，不会修改已保存正文或历史版本。确认已不再需要「' + (item.front.title || '未命名') + '」的这份改动？', okLabel:'清理暂存', danger:true})
      .then(function (ok) {
        if (!ok) return;
        try {
          if (localStorage.getItem(item.key) !== item.raw) { toast('这份暂存刚被其他窗口更新，请重新检查后再清理。', 'err'); return; }
          localStorage.removeItem(item.key); draftBadge(); recoveryList('drafts');
          toast('已清理这份本机暂存；当前编辑器中的输入仍保留', 'ok');
        } catch (e) { toast('浏览器拒绝清理暂存，已保存内容未受影响', 'err'); }
      });
  }

  // ---------------------------------------------------------------- 列表
  function renderTabs() {
    var docs = S.state.docs;
    var all = 0, draft = 0, arch = 0;
    LIST_ORDER.forEach(function (p) { all += docs[p[0]].length; });
    Object.keys(docs).forEach(function (k) {
      docs[k].forEach(function (d) {
        if (d.draft) draft++;
        if (d.archived) arch++;
      });
    });
    var tabs = [['all', '全部', all], ['post', '文章', docs.post.length],
                ['project', '项目', docs.project.length],
                ['doc', '文档', (docs.doc || []).length],
                ['page', '页面', docs.page.length],
                ['draft', '草稿', draft], ['archived', '归档', arch]];
    $('tabs').innerHTML = tabs.map(function (t) {
      return '<button data-filter="' + t[0] + '"' + (S.filter === t[0] ? ' class="is-on"' : '') +
        '>' + t[1] + '<b>' + t[2] + '</b></button>';
    }).join('');
  }

  function match(d) {
    if (S.filter === 'draft' && !d.draft) return false;
    if (S.filter === 'archived' && !d.archived) return false;
    if (!S.q) return true;
    var hay = (d.title + ' ' + d.tags.join(' ') + ' ' + d.slug + ' ' + d.summary).toLowerCase();
    return hay.indexOf(S.q) >= 0;
  }

  function docNode(kind, d) {
    var cur = S.cur && S.cur.kind === kind && S.cur.slug === d.slug;
    var badges = '';
    if (d.draft) badges += '<span class="badge draft">草稿</span>';
    if (d.archived) badges += '<span class="badge arch">归档</span>';
    if (d.featured) badges += '<span class="badge feat">精选</span>';
    // 文档没有日期，副标题改成「课程名 · 第 n 篇 · m 页」，比一排「—」有用
    var sub = kind === 'doc'
      ? '<span class="mono">' + esc(collectionTitle(d.collection)) + '</span>' +
        '<span class="badge">' + (d.order == null ? '—' : d.order) + '</span>' +
        '<span class="badge">' + (d.slides || 0) + ' 页</span>'
      : '<span class="mono">' + esc(d.date || '—') + '</span>';
    if (kind === 'doc' && d.figures && d.figures.length) {
      badges += '<span class="badge">图 ' + d.figures.length + '</span>';
    }
    return '<button class="doc' + (cur ? ' is-on' : '') + '" data-kind="' + kind +
      '" data-slug="' + esc(d.slug) + '">' +
      '<span class="doc-title">' + esc(d.title) + '</span>' +
      '<span class="doc-sub">' + sub + badges + '</span></button>';
  }

  function collectionTitle(id) {
    var list = (S.state && S.state.docCollections) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].title;
    return id || '未归类';
  }

  function renderList() {
    renderTabs();
    var docs = S.state.docs, html = '';
    LIST_ORDER.forEach(function (p) {
      var kind = p[0];
      if (FILTERABLE.indexOf(S.filter) >= 0 && S.filter !== kind) return;
      var items = (docs[kind] || []).filter(match);
      if (!items.length) return;
      html += '<div class="group-title">' + p[1] + ' · ' + items.length + '</div>';
      html += items.map(function (d) { return docNode(kind, d); }).join('');
    });
    $('list').innerHTML = html || '<div class="group-title">没有匹配的内容</div>';

    var st = S.state.stats;
    $('sideFoot').textContent = '文章 ' + st.post + ' · 项目 ' + st.project +
      ' · 文档 ' + (st.doc || 0) + ' · 页面 ' + st.page + '　|　' + S.state.root;
  }

  // ---------------------------------------------------------------- 元信息表单
  function fieldHtml(f, front) {
    var v = front[f.k];
    if (f.type === 'cover') {
      var has = v ? 'background-image:url(/' + esc(v) + ')' : '';
      return '<div class="field wide"><span>' + esc(f.label) + '</span>' +
        '<div class="cover-row">' +
        '<span class="cover-thumb" id="coverThumb" style="' + has + '"></span>' +
        '<span class="cover-path" id="coverPath">' + (v ? esc(v) : '（未设置）') + '</span>' +
        '<button class="btn ghost" data-act="pick-cover">选择</button>' +
        '<button class="btn ghost" data-act="clear-cover">清除</button>' +
        '</div></div>';
    }
    if (f.type === 'links') {
      var rows = (v && v.length ? v : []).map(linkRow).join('');
      return '<div class="field wide"><span>' + esc(f.label) + '</span>' +
        '<div id="linkRows">' + rows + '</div>' +
        '<button class="btn ghost" data-act="add-link" style="align-self:flex-start">＋ 添加链接</button></div>';
    }
    if (f.type === 'textarea') {
      return '<label class="field wide"><span>' + esc(f.label) + '</span>' +
        '<textarea data-key="' + f.k + '" rows="2">' + esc(v || '') + '</textarea></label>';
    }
    if (f.type === 'select') {
      // options 是 state 里一份列表的名字（目前只有 docCollections）
      var opts = (S.state[f.options] || []).map(function (o) {
        var val = o.id == null ? o : o.id;
        var label = o.title == null ? val : o.title;
        return '<option value="' + esc(val) + '"' +
          (String(v || '') === String(val) ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
      return '<label class="field"><span>' + esc(f.label) + '</span>' +
        '<select aria-label="' + esc(f.label) + '" data-key="' + f.k + '">' +
        (v ? '' : '<option value="">（未选择）</option>') + opts + '</select></label>';
    }
    var val = v == null ? '' : String(v);
    if (f.type === 'number') val = v == null ? '' : String(v);
    return '<label class="field' + (f.wide ? ' wide' : '') + '"><span>' + esc(f.label) +
      (f.hint ? ' <i style="opacity:.6">· ' + esc(f.hint) + '</i>' : '') + '</span>' +
      '<input type="' + f.type + '" data-key="' + f.k + '" value="' + esc(val) + '"></label>';
  }

  function linkRow(l) {
    l = l || {};
    return '<div class="link-row">' +
      '<input type="text" data-link="label" placeholder="显示文字" value="' + esc(l.label || '') + '">' +
      '<input type="text" data-link="href" placeholder="https://… 或 /posts/x/" value="' + esc(l.href || '') + '">' +
      '<button class="icon" data-act="del-link" title="删除">✕</button></div>';
  }

  // 文档没有日期和封面：front-matter 里不写，表单也不必摆出来
  var OMIT = { doc: ['date', 'updated', 'cover'] };

  function renderMeta() {
    var kind = S.cur.kind, front = S.cur.front;
    $('editingTitle').textContent = front.title || '未命名内容';
    $('meta').hidden = kind === 'doc';
    var metaToggle = document.querySelector('[data-act="toggle-meta"]');
    metaToggle.setAttribute('aria-expanded', String(kind !== 'doc'));
    metaToggle.textContent = kind === 'doc' ? '展开文档信息' : '收起文档信息';
    S.deck = null; S.slideIndex = 0; S.slideUndo = []; S.slideSource = false;
    S.previewSession = (S.previewSession || 0) + 1;
    S.previewData = null;
    S.previewBody = null;
    $('slideWorkbench').hidden = kind !== 'doc';
    document.querySelector('.split').classList.toggle('is-document', kind === 'doc');
    $('slideBody').hidden = kind !== 'doc';
    $('body').hidden = kind === 'doc';
    var omit = OMIT[kind] || [];
    // 文档摆「发布日期 / 更新日期 / 封面」只会误导 —— 它压根不读这三个字段
    var fields = FIELDS.common.concat(FIELDS[kind] || []).filter(function (f) {
      return omit.indexOf(f.k) < 0;
    });
    var flags = (FLAGS[kind] || []).map(function (f) {
      return '<label class="check"><input type="checkbox" data-key="' + f[0] + '"' +
        (front[f[0]] ? ' checked' : '') + '>' + f[1] + '</label>';
    }).join('');
    $('meta').innerHTML =
      '<div class="grid">' + fields.map(function (f) { return fieldHtml(f, front); }).join('') + '</div>' +
      '<div class="checks">' + flags + '</div>';
  }

  function collectFront() {
    var meta = $('meta');
    var front = {};
    // 保留原 front 里的未知字段
    Object.keys(S.cur.front || {}).forEach(function (k) { front[k] = S.cur.front[k]; });

    ['title', 'slug', 'date', 'updated', 'tags', 'summary', 'cover',
     'tagline', 'status', 'order', 'stack', 'subtitle', 'collection', 'origin'].forEach(function (k) {
      var node = meta.querySelector('[data-key="' + k + '"]');
      if (!node) return;
      if (k === 'tags' || k === 'stack') {
        var parts = String(node.value || '').split(/[,，]/)
          .map(function (s) { return s.trim(); }).filter(Boolean);
        if (parts.length) front[k] = parts; else delete front[k];
      } else if (k === 'order') {
        if (node.value === '') delete front[k];
        else front[k] = parseInt(node.value, 10) || 0;
      } else {
        if (node.value === '') delete front[k];
        else front[k] = node.value;
      }
    });

    ['featured', 'draft', 'archived'].forEach(function (k) {
      var node = meta.querySelector('[data-key="' + k + '"]');
      if (node) front[k] = node.checked;
    });

    var linkRows = meta.querySelectorAll('#linkRows .link-row');
    if (linkRows.length) {
      var links = [];
      Array.prototype.forEach.call(linkRows, function (row) {
        var label = row.querySelector('[data-link="label"]').value.trim();
        var href = row.querySelector('[data-link="href"]').value.trim();
        if (href) links.push({ label: label || href, href: href });
      });
      if (links.length) front.links = links; else delete front.links;
    }
    return front;
  }

  // ---------------------------------------------------------------- 预览
  function schedulePreview() {
    clearTimeout(S.previewTimer);
    S.previewRequest = (S.previewRequest || 0) + 1;
    S.previewTimer = setTimeout(doPreview, 300);
  }

  function followPreview(position) {
    if (!$('previewSync').checked || !S.cur || S.previewBody !== $('body').value) return;
    var line = position.line;
    if (S.deck && S.deck.all && Number.isInteger(Number(position.blockIndex))) {
      var current = S.deck.slides.findIndex(function (s) { return s.blockIndex === Number(position.blockIndex); });
      if (current >= 0 && current !== S.deck.cur) { S.deck.cur = current; paintDeckPreview(); }
    }
    if (S.cur.kind === 'doc' && !S.slideSource) {
      var blocks = splitSlides();
      var index = Number(position.blockIndex);
      if (Number.isInteger(index) && blocks[index] && index !== S.slideIndex) {
        S.slideIndex = index;
        // Wheel scrolling need not move focus away from the source editor.
        $('slideBody').value = blocks[index].text;
        renderSlideEditor();
      }
      line -= (blocks[S.slideIndex || 0].startLine - 1);
    }
    window.BlogPreview.syncSource(S.cur.kind === 'doc' && !S.slideSource ? $('slideBody') : $('body'), Math.max(1, line));
  }

  function showPreviewFrame() {
    if (!S.previewData) return;
    var d = S.deck;
    window.BlogPreview.render($('preview'), S.previewData, {
      key: String(S.previewSession), index: d ? d.cur : 0,
      all: d ? d.all : false, step: d ? d.step || 0 : 0,
      onScroll: followPreview,
      onReady: function () { $('preview').setAttribute('aria-busy', 'false'); }
    });
  }

  function doPreview() {
    clearTimeout(S.previewTimer);
    var body = $('body').value;
    var kind = (S.cur && S.cur.kind) || 'post';
    var owner = S.cur;
    var request = S.previewRequest = (S.previewRequest || 0) + 1;
    if (kind === 'doc') renderSlideEditor();
    $('counter').textContent = body.length + ' 字符';
    $('preview').setAttribute('aria-busy', 'true');
    api('/api/preview', { body: { body: body, kind: kind, front: S.cur ? collectFront() : {} } }).then(function (r) {
      if (request !== S.previewRequest || owner !== S.cur || body !== $('body').value) return;
      S.previewBody = body;
      S.previewData = r;
      $('previewError').hidden = true;
      if (r.deck) { renderDeckPreview(r); return; }
      $('deckTools').hidden = true;
      S.deck = null;
      showPreviewFrame();
      $('previewInfo').textContent = r.minutes + ' 分钟 · ' + r.chars + ' 字';
    }).catch(function (e) {
      if (request !== S.previewRequest || owner !== S.cur) return;
      $('preview').setAttribute('aria-busy', 'false');
      $('previewError').textContent = '预览更新失败：' + e.message + '。修改内容后将自动重试。';
      $('previewError').hidden = false;
    });
  }

  /* 文档复用博客的幻灯片排版，控制条留在编辑器内。 */
  function renderDeckPreview(r) {
    var previous = S.deck;
    var slides = r.slides || [];
    var pageIndex = slides.findIndex(function (s) { return s.blockIndex === (S.slideIndex || 0); });
    var nextIndex = S.slideSource && previous && previous.cur >= 0 ? Math.min(previous.cur, Math.max(0, slides.length - 1)) : pageIndex;
    S.deck = { slides: slides, cur: nextIndex, all: previous ? previous.all : false, count: r.count || 0, step: previous && previous.cur === nextIndex ? previous.step : 0 };
    $('deckTools').hidden = false;
    var missing = (r.missingFigures || []);
    if (missing.length) {
      $('previewError').textContent = '找不到插图：' + missing.join('、') + '（可用清单见「＋ 插图…」）';
      $('previewError').hidden = false;
    }
    paintDeckPreview(true);
    $('previewInfo').textContent = r.count + ' 页 · ' + r.minutes + ' 分钟';
  }

  function paintDeckPreview(refresh) {
    if (!S.deck) return;
    var d = S.deck, slide = d.slides[d.cur];
    var fragments = slide ? (slide.html.match(/class="deck-fragment"/g) || []).length : 0;
    d.step = Math.min(d.step || 0, fragments);
    $('deckNo').textContent = d.all ? '通读 · ' + d.count + ' 页' : slide ? (d.cur + 1) + ' / ' + d.count : '空白页';
    if (!d.all && fragments) $('deckNo').textContent += ' · 展开 ' + d.step + '/' + fragments;
    document.querySelector('[data-act="deck-prev"]').disabled = d.cur < 0 ? !d.slides.some(function (s) { return s.blockIndex < S.slideIndex; }) : d.cur <= 0 && !d.step;
    document.querySelector('[data-act="deck-next"]').disabled = d.cur < 0 ? !d.slides.some(function (s) { return s.blockIndex > S.slideIndex; }) : d.cur >= d.slides.length - 1 && d.step >= fragments;
    document.querySelector('[data-act="deck-all"]').classList.toggle('primary', d.all);
    if (refresh) showPreviewFrame();
    else window.BlogPreview.update({step:d.step, all:d.all});
  }

  function deckStep(n) {
    if (!S.deck || !S.deck.slides.length) return;
    if (S.previewBody !== $('body').value) return;
    var slide = S.deck.slides[S.deck.cur];
    var count = slide ? (slide.html.match(/class="deck-fragment"/g) || []).length : 0;
    var step = S.deck.step || 0;
    if (!S.deck.all && ((n > 0 && step < count) || (n < 0 && step > 0))) {
      S.deck.step = step + n; paintDeckPreview(); return;
    }
    S.deck.all = false;
    if (S.deck.cur < 0) {
      var neighbours = S.deck.slides.map(function (s, i) { return {block:s.blockIndex, index:i}; }).filter(function (s) { return n > 0 ? s.block > S.slideIndex : s.block < S.slideIndex; });
      if (!neighbours.length) return;
      S.deck.cur = (n > 0 ? neighbours[0] : neighbours[neighbours.length - 1]).index;
    } else S.deck.cur += n;
    if (S.deck.cur < 0) S.deck.cur = 0;
    if (S.deck.cur > S.deck.slides.length - 1) S.deck.cur = S.deck.slides.length - 1;
    S.deck.step = n < 0 ? (S.deck.slides[S.deck.cur].html.match(/class="deck-fragment"/g) || []).length : 0;
    S.slideIndex = S.deck.slides[S.deck.cur].blockIndex;
    $('slideBody').value = splitSlides()[S.slideIndex].text;
    renderSlideEditor();
    paintDeckPreview(true);
  }

  /* 在光标处插入一段文本（插图标记、分隔线都走它） */
  /* 当前真正在写的那个编辑框：文档的「分页编辑」模式下写的是当前页，
     其余情况都是整篇正文。插入工具条和快捷键都走它。 */
  function activeEditor() {
    return (S.cur && S.cur.kind === 'doc' && !S.slideSource) ? $('slideBody') : $('body');
  }

  function afterEdit(ta) {
    ta.focus();
    if (ta === $('slideBody')) syncSlideBody();
    setDirty(true);
    schedulePreview();
  }

  /* 行内插入：**不补空行**，有选区就把选区包起来、光标留在标记里。
     粗体 / 行内代码 / 链接是这种用法，跟「整行插入」（分隔线、插图）不是一回事。 */
  function wrapSelection(before, after, placeholder) {
    var ta = activeEditor();
    var start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    var end = ta.selectionEnd == null ? start : ta.selectionEnd;
    var sel = ta.value.slice(start, end) || placeholder || '';
    ta.value = ta.value.slice(0, start) + before + sel + after + ta.value.slice(end);
    ta.selectionStart = start + before.length;
    ta.selectionEnd = start + before.length + sel.length;
    afterEdit(ta);
  }

  /* 正文图片的相对地址：中文要转成百分号编码，括号要转义 —— 括号不转义会把
     Markdown 的 `](...)` 提前闭合，落进正文就是一个坏链接。 */
  function mdImagePath(path) {
    return '/' + path.split('/').map(function (segment) {
      return encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29');
    }).join('/');
  }

  /* 工具条：每个按钮就是一小段文本，作者完全可以手写同样的东西。 */
  var SNIPPETS = {
    bold: function () { wrapSelection('**', '**', '粗体'); },
    italic: function () { wrapSelection('*', '*', '斜体'); },
    code: function () { wrapSelection('`', '`', 'code'); },
    link: function () { wrapSelection('[', '](https://)', '链接文字'); },
    list: function () { insertAtCursor('- 第一项\n- 第二项'); },
    quote: function () { insertAtCursor('> 引用'); },
    codeblock: function () { insertAtCursor('```cpp\n\n```'); },
    table: function () { insertAtCursor('| 列 A | 列 B |\n| --- | --- |\n|  |  |'); },
    callout: function () { insertAtCursor('::: note 提示\n写点什么\n:::'); },
    gallery: function () { insertAtCursor('::: gallery 2\n![](assets/uploads/a.webp) ![](assets/uploads/b.webp)\n::: 并排图'); },
    math: function () { insertAtCursor('$$\nE = mc^2\n$$'); },
    hr: function () { insertAtCursor('---'); },
    image: function () {
      S.imgTarget = { key: 'bodyImage' };
      $('imgTitle').textContent = '插入正文图片';
      openImages();
    }
  };

  function insertSnippet(kind) {
    var fn = SNIPPETS[kind];
    if (!fn) return;
    if (!S.cur) { toast('先打开一篇内容再插入', 'err'); return; }
    fn();
  }

  function insertAtCursor(text) {
    var ta = activeEditor();
    var start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    var end = ta.selectionEnd == null ? start : ta.selectionEnd;
    var before = ta.value.slice(0, start);
    var after = ta.value.slice(end);
    // 前后各补一行，保证标记独占一行 —— 分隔线和插图标记都必须是整行才有意义
    var pad = (before && !/\n$/.test(before) ? '\n' : '') ;
    var tail = (/^\n/.test(after) ? '' : '\n');
    ta.value = before + pad + text + tail + after;
    var caret = (before + pad + text).length;
    ta.selectionStart = ta.selectionEnd = caret;
    afterEdit(ta);
  }

  // ---------------------------------------------------------------- 打开 / 新建
  function splitSlides() {
    return window.BlogPreview.splitSlides($('body').value);
  }
  function joinSlides(blocks) {
    return blocks.map(function (s, i) { return (i ? (s.sep || '----\n') : '') + s.text; }).join('');
  }
  function slideTitle(text) {
    var heading = text.match(/^#{1,6}\s+(.+)$/m);
    return (heading ? heading[1] : text.trim().split('\n')[0] || '空白页（发布时忽略）').replace(/[<*>`_]/g, '').slice(0, 48);
  }
  function renderSlideEditor() {
    if (!S.cur || S.cur.kind !== 'doc') return;
    var blocks = splitSlides();
    S.slideIndex = Math.max(0, Math.min(S.slideIndex || 0, blocks.length - 1));
    var scroll = $('slideRail').scrollLeft;
    $('slideRail').innerHTML = blocks.map(function (s, i) {
      return '<button type="button" class="slide-thumb' + (i === S.slideIndex ? ' is-current' : '') + '" data-slide-select="' + i + '" aria-pressed="' + (i === S.slideIndex) + '"><span>' + String(i + 1).padStart(2, '0') + '<span class="slide-grip" title="拖动调整顺序" aria-hidden="true">⠿</span></span><b>' + esc(slideTitle(s.text)) + '</b><small>' + (s.text.trim().length + ' 字符') + '</small></button>';
    }).join('');
    $('slideRail').scrollLeft = scroll;
    if (document.activeElement !== $('slideBody')) $('slideBody').value = blocks[S.slideIndex].text;
    $('slideBody').hidden = !!S.slideSource; $('body').hidden = !S.slideSource;
    document.querySelector('[data-act="slide-source"]').setAttribute('aria-pressed', String(!!S.slideSource));
    ['up','down','remove','undo'].forEach(function (act) {
      document.querySelector('[data-act="slide-' + act + '"]').disabled = act === 'up' ? S.slideIndex === 0 : act === 'down' ? S.slideIndex === blocks.length - 1 : act === 'remove' ? blocks.length <= 1 : !(S.slideUndo || []).length;
    });
  }
  function syncSlideBody() {
    var blocks = splitSlides(); blocks[S.slideIndex || 0].text = $('slideBody').value;
    // Keep page boundaries on separate lines when a page is followed by another.
    if ((S.slideIndex || 0) < blocks.length - 1 && !blocks[S.slideIndex || 0].text.endsWith('\n')) blocks[S.slideIndex || 0].text += '\n';
    $('body').value = joinSlides(blocks);
  }
  function rememberSlideEdit() {
    if (!S.cur || S.cur.kind !== 'doc') return;
    S.slideUndo = S.slideUndo || [];
    S.slideUndo.push({body:$('body').value,index:S.slideIndex || 0});
    if (S.slideUndo.length > 20) S.slideUndo.shift();
  }
  function bindSlideDrag() {
    var rail = $('slideRail'), drag = null, frame = 0, suppressClick = false;
    function paint() {
      if (!drag) return;
      var bounds = rail.getBoundingClientRect();
      var speed = drag.x < bounds.left + 40 ? -12 : drag.x > bounds.right - 40 ? 12 : 0;
      rail.scrollLeft += speed;
      var items = Array.from(rail.querySelectorAll('.slide-thumb'));
      var slot = items.length;
      items.forEach(function (item, index) {
        item.classList.remove('drop-before', 'drop-after');
        var rect = item.getBoundingClientRect();
        if (slot === items.length && drag.x < rect.left + rect.width / 2) slot = index;
      });
      drag.to = slot > drag.from ? slot - 1 : slot;
      if (drag.to !== drag.from) {
        if (slot < items.length) items[slot].classList.add('drop-before');
        else items[items.length - 1].classList.add('drop-after');
      }
      frame = requestAnimationFrame(paint);
    }
    rail.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || !event.target.closest('.slide-grip') || drag) return;
      var item = event.target.closest('[data-slide-select]');
      drag = {from:Number(item.dataset.slideSelect), to:Number(item.dataset.slideSelect), x:event.clientX, start:event.clientX, id:event.pointerId, item:item, moved:false};
      rail.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    rail.addEventListener('pointermove', function (event) {
      if (!drag || drag.id !== event.pointerId) return;
      drag.x = event.clientX;
      if (!drag.moved && Math.abs(drag.x - drag.start) > 5) {
        drag.moved = true; drag.item.classList.add('is-dragging'); rail.classList.add('is-sorting'); paint();
      }
    });
    function finish(cancelled) {
      if (!drag) return;
      var current = drag; drag = null;
      cancelAnimationFrame(frame); frame = 0;
      if (rail.hasPointerCapture(current.id)) rail.releasePointerCapture(current.id);
      rail.classList.remove('is-sorting');
      rail.querySelectorAll('.slide-thumb').forEach(function (item) { item.classList.remove('is-dragging', 'drop-before', 'drop-after'); });
      suppressClick = current.moved;
      setTimeout(function () { suppressClick = false; }, 0);
      if (cancelled || !current.moved || current.from === current.to) return;
      rememberSlideEdit();
      var blocks = splitSlides(), item = blocks.splice(current.from, 1)[0];
      blocks.splice(current.to, 0, item);
      blocks.forEach(function (block, index) { if (index < blocks.length - 1 && !block.text.endsWith('\n')) block.text += '\n'; });
      $('body').value = joinSlides(blocks); S.slideIndex = current.to;
      $('slideBody').blur(); setDirty(true); renderSlideEditor(); doPreview();
      var selected = rail.querySelector('.is-current');
      if (selected) { selected.focus({preventScroll:true}); selected.scrollIntoView({block:'nearest',inline:'nearest'}); }
      toast('已移至第 ' + (current.to + 1) + ' 页，保存后生效');
    }
    rail.addEventListener('pointerup', function () { finish(false); });
    rail.addEventListener('pointercancel', function () { finish(true); });
    rail.addEventListener('lostpointercapture', function () { finish(true); });
    window.addEventListener('blur', function () { finish(true); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && drag) { event.preventDefault(); finish(true); } });
    rail.addEventListener('click', function (event) { if (suppressClick) { event.preventDefault(); event.stopPropagation(); } }, true);
  }
  function slideOperation(action) {
    if (!S.cur || S.cur.kind !== 'doc') return;
    if (action === 'source') { S.slideSource = !S.slideSource; renderSlideEditor(); return; }
    if (action === 'undo') {
      var old = (S.slideUndo || []).pop(); if (!old) return;
      $('body').value = old.body; S.slideIndex = old.index;
    } else {
      var blocks = splitSlides(), index = S.slideIndex || 0;
      if ((action === 'up' && !index) || (action === 'down' && index === blocks.length - 1) || (action === 'remove' && blocks.length < 2)) return;
      S.slideUndo = S.slideUndo || []; S.slideUndo.push({body:$('body').value, index:index}); if (S.slideUndo.length > 20) S.slideUndo.shift();
      if (action === 'add' || action === 'copy') {
        var templates = {content:'\n## 新的一页\n\n- 第一个要点\n- 第二个要点\n\n', cover:'\n# 新的章节\n\n用一句话介绍这一节。\n\n', code:'\n## 代码示例\n\n```python\nprint("Hello, world!")\n```\n\n', image:'\n## 图文说明\n\n在这里写说明，可使用右侧「＋ 插图」插入示意图。\n\n'};
        if (!blocks[index].text.endsWith('\n')) blocks[index].text += '\n';
        blocks.splice(index + 1, 0, {sep:$('slideTemplate').value === 'cover' && action === 'add' ? '---\n' : '----\n', text:action === 'copy' ? blocks[index].text : templates[$('slideTemplate').value]});
        S.slideIndex = index + 1;
      } else if (action === 'remove') { blocks.splice(index, 1); S.slideIndex = Math.max(0, index - 1); }
      else if (action === 'up' || action === 'down') { var dest = index + (action === 'up' ? -1 : 1); var item = blocks.splice(index, 1)[0]; blocks.splice(dest, 0, item); S.slideIndex = dest; }
      blocks.forEach(function (s, i) { if (i < blocks.length - 1 && !s.text.endsWith('\n')) s.text += '\n'; });
      $('body').value = joinSlides(blocks);
    }
    setDirty(true); $('slideBody').blur(); renderSlideEditor(); doPreview();
  }

  function openDoc(kind, slug, discardConfirmed, skipDraftPrompt) {
    if (S.saving) { toast('正在保存，请稍后切换内容'); return; }
    if (S.dirty && !discardConfirmed) {
      askConfirm({
        title: '有未保存的改动',
        message: '当前改动还没保存。切换后会保留本机暂存，可在恢复中心继续编辑。',
        okLabel: '暂存并切换',
      }).then(function (ok) {
        if (ok) openDoc(kind, slug, true);
      });
      return;
    }
    if (!protectDraftBeforeSwitch()) return Promise.resolve(false);
    var request = S.docRequest = (S.docRequest || 0) + 1;
    S.opening = true;
    $('editorBody').inert = true;
    busy(true);
    return api('/api/doc?kind=' + encodeURIComponent(kind) + '&slug=' + encodeURIComponent(slug))
      .then(function (r) {
        if (request !== S.docRequest) return;
        S.cur = { kind: kind, slug: r.slug, originalSlug: r.slug, revision: r.revision, front: r.front || {}, body: r.body || '' };
        $('empty').hidden = true;
        $('editorBody').hidden = false;
        renderMeta();
        $('body').value = S.cur.body;
        setDirty(false);
        // 状态栏里显示源文件路径。以前是三元表达式，除 post/project 外全落到 pages，
        // 于是文档会显示成 content/pages/xxx.md —— 看着像存错了地方。
        $('statusText').textContent = S.state.labels[kind] + ' · content/' +
          (KIND_DIR[kind] || 'posts') + '/' + r.slug + '.md';
        renderList();
        doPreview();
        if (!skipDraftPrompt) offerDraft(S.cur);
        return true;
      })
      .catch(function (e) { if (request === S.docRequest) toast(e.message, 'err'); })
      .then(function (loaded) {
        if (request === S.docRequest) { S.opening = false; $('editorBody').inert = false; }
        busy(false);
        return loaded;
      });
  }

  // ---------------------------------------------------------------- 站内弹窗
  // 不用原生 prompt/confirm：Chrome 在多次弹窗后会提供「阻止此页面创建更多对话框」，
  // 用户一旦勾选，之后 prompt() 直接返回 null —— 表现就是「点新建完全没反应」，
  // 而且没有任何提示。站内弹窗还能自己控制样式、焦点与键盘行为。
  var askState = null;

  function askOpen(opts) {
    return new Promise(function (resolve) {
      if (askState) askState.resolve(null);      // 上一个还没关就先当取消
      askState = { resolve: resolve, withInput: !!opts.withInput };
      $('askTitle').textContent = opts.title || '请确认';
      $('askMessage').textContent = opts.message || '';
      $('askField').hidden = !opts.withInput;
      $('askLabel').textContent = opts.label || '名称';
      $('askHint').textContent = opts.hint || '';
      var ok = $('askOk');
      ok.textContent = opts.okLabel || '确定';
      ok.classList.toggle('danger', !!opts.danger);
      ok.classList.toggle('primary', !opts.danger);
      var inp = $('askInput');
      inp.value = opts.value || '';
      inp.placeholder = opts.placeholder || '';
      $('askModal').hidden = false;
      setTimeout(function () {
        if (opts.withInput) { inp.focus(); inp.select(); }
        else { ok.focus(); }
      }, 30);
    });
  }

  function askClose(value) {
    if (!askState) return;
    var resolve = askState.resolve, withInput = askState.withInput;
    askState = null;
    $('askModal').hidden = true;
    if (withInput) resolve(value == null ? null : (String(value).trim() || null));
    else resolve(!!value);
  }

  function askAccept() {
    askClose(askState && askState.withInput ? $('askInput').value : true);
  }

  function askText(opts) {
    return askOpen(Object.assign({ withInput: true }, opts || {}));
  }

  function askConfirm(opts) {
    return askOpen(Object.assign({ withInput: false }, opts || {}));
  }

  function newDoc(kind) {
    if (!S.state) { toast('正在加载内容，请稍后再试'); return; }
    if (S.saving || S.opening) { toast('正在载入或保存，请稍后新建内容'); return; }
    var label = kind === 'project' ? '项目名称'
      : kind === 'page' ? '页面标题'
      : kind === 'doc' ? '文档标题' : '文章标题';
    var go = function () {
      askText({
        title: '新建' + (S.state.labels[kind] || ''),
        label: label,
        placeholder: '例如：DDS 选型与调参',
        hint: '会据此生成文件名与 URL，之后都能改',
        okLabel: '创建',
      }).then(function (title) {
        if (!title) return;
        createDoc(kind, title);
      });
    };
    if (S.dirty) {
      askConfirm({
        title: '有未保存的改动',
        message: '当前改动还没保存。会先保留本机暂存，然后新建内容。',
        okLabel: '暂存并新建',
      }).then(function (ok) { if (ok) go(); });
      return;
    }
    go();
  }

  function createDoc(kind, title) {
    if (!protectDraftBeforeSwitch()) return false;
    S.docRequest = (S.docRequest || 0) + 1;
    var tpl = (S.state.templates || {})[kind] || '---\ntitle: {title}\n---\n\n';
    var localNow = new Date();
    var today = localNow.getFullYear() + '-' + String(localNow.getMonth() + 1).padStart(2, '0') + '-' + String(localNow.getDate()).padStart(2, '0');
    var slug = title.toLowerCase().replace(/[^\w\u4e00-\u9fff\s-]/g, '')
      .replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
    var cols = S.state.docCollections || [];
    var firstCol = cols.length ? cols[0].id : '';
    var text = tpl.replace(/\{title\}/g, title).replace(/\{slug\}/g, slug)
                  .replace(/\{date\}/g, today).replace(/\{collection\}/g, firstCol);
    var parts = text.split(/^---\s*$/m);
    // 文档的 front-matter 和文章不一样：没有 date，多了 collection / order
    var front = kind === 'doc'
      ? { title: title, slug: slug, collection: firstCol, order: 99, draft: true, tags: [] }
      : { title: title, slug: slug, date: today, draft: true, tags: [] };
    S.cur = {
      kind: kind, slug: slug, originalSlug: '', front: front,
      body: (parts.length >= 3 ? parts.slice(2).join('---') : text).replace(/^\n+/, '')
    };
    if (kind === 'doc') S.cur.body = '# ' + title + '\n\n用一句话介绍这份文档。\n\n---\n\n## 本次内容\n\n- 第一个要点\n- 第二个要点\n- 第三个要点\n\n----\n\n## 小结\n\n写下这一节最重要的结论。\n';
    $('empty').hidden = true;
    $('editorBody').hidden = false;
    renderMeta();
    $('body').value = S.cur.body;
    setDirty(true);
    $('statusText').textContent = '新' + S.state.labels[kind] + '（未保存）';
    renderList();
    doPreview();
    $('meta').querySelector('[data-key="title"]').focus();
  }

  // ---------------------------------------------------------------- 保存 / 删除
  function save(thenBuild) {
    if (!S.cur || S.saving || S.opening) return;
    var owner = S.cur;
    setSaving(true);
    busy(true);
    $('statusText').textContent = '正在保存…';
    var payload = {
      kind: S.cur.kind,
      originalSlug: S.cur.originalSlug,
      revision: S.cur.revision,
      front: collectFront(),
      body: $('body').value
    };
    var snapshot = JSON.stringify({ front: payload.front, body: payload.body });
    return api('/api/save', { body: payload })
      .then(function (r) {
        if (S.cur !== owner) return;
        var changed = snapshot !== JSON.stringify({ front: collectFront(), body: $('body').value });
        owner.slug = r.slug;
        owner.originalSlug = r.slug;
        owner.revision = r.revision;
        owner.front = r.front || payload.front;
        var slugInput = $('meta').querySelector('[data-key="slug"]');
        if (slugInput && slugInput.value.trim() === String(payload.front.slug || '')) slugInput.value = r.slug;
        forgetDraft(owner);
        setDirty(changed);
        if (changed) persistDraft();
        $('statusText').textContent = (changed ? '已保存上一版，仍有新改动未保存 · ' : '已保存 · ') + r.path + (r.renamed ? '（已重命名，旧链接将在构建后保留）' : '');
        toast(changed ? '已保存提交时的内容；继续输入的部分请再次保存' : '已保存 ' + r.slug, 'ok');
        return refresh(true).catch(function () { toast('文件已保存，列表刷新失败，可稍后重试', 'err'); });
      })
      .then(function () {
        if (thenBuild && !S.dirty) return build();
      })
      .catch(function (e) {
        $('statusText').textContent = '保存失败 · ' + e.message;
        setDirty(true);
        toast('保存失败：' + e.message, 'err');
      })
      .then(function () { setSaving(false); busy(false); });
  }

  function del() {
    if (S.saving || S.opening) return;
    if (!S.cur || !S.cur.originalSlug) { toast('还没保存过，直接关掉即可'); return; }
    var owner = S.cur, name = owner.front.title || owner.slug;
    return askConfirm({
      title: '移入回收站',
      message: '把「' + name + '」移入回收站？已保存内容可以恢复；未保存输入会单独暂存在本机。',
      okLabel: '移入回收站',
      danger: true,
    }).then(function (ok) {
      if (!ok || S.cur !== owner) return;
      if (!protectDraftBeforeSwitch()) return;
      setSaving(true);
      busy(true);
      return api('/api/delete', { body: { kind: owner.kind, slug: owner.originalSlug, revision: owner.revision } })
        .then(function () {
          toast('已移入回收站，可在恢复中心找回', 'ok');
          S.cur = null;
          $('editorBody').hidden = true;
          $('empty').hidden = false;
          setDirty(false);
          return refresh();
        })
        .catch(function (e) { toast(e.message, 'err'); })
        .then(function () { setSaving(false); busy(false); });
    });
  }

  function build() {
    busy(true);
    return api('/api/build', { body: {} })
      .then(function (r) {
        var line = (r.output || '').trim().split('\n').pop() || '构建完成';
        toast('构建完成 · ' + line, 'ok');
        $('statusText').textContent = '构建于 ' + r.at + ' · ' + line;
      })
      .catch(function (e) { toast('构建失败：' + e.message, 'err'); })
      .then(function () { busy(false); });
  }

  /* 一键发布：构建 → 自检 → 提交 → 推送到 GitHub Pages（tools/deploy.py）。
     不做「点一下直接推」：先弹一个框确认提交说明（默认带上当前这篇的标题），
     取消就不发。推送是**不可逆的对外动作**，多一次确认是值得的。 */
  function deploy() {
    if (S.saving || S.opening) { toast('正在保存/载入，请稍后再发布', 'err'); return; }
    if (S.dirty) { toast('有未保存的改动：先按 Ctrl+S 保存，再发布', 'err'); return; }
    var title = (S.cur && S.cur.front && S.cur.front.title) || '站点';
    askText({
      title: '发布到线上',
      message: '会依次执行：构建 → 自检 → 提交 → 推送到 GitHub Pages。',
      label: '提交说明',
      value: '更新：' + title,
      okLabel: '开始发布',
      hint: '推送目标写在 site.config.json 的 deploy.remote 里'
    }).then(function (message) {
      if (!message) return;
      busy(true);
      $('statusText').textContent = '正在发布…';
      api('/api/deploy', { body: { message: message } })
        .then(function (r) {
          var line = (r.output || '').trim().split('\n').slice(-2).join(' · ');
          toast('已发布 · ' + line, 'ok');
          $('statusText').textContent = '发布于 ' + r.at + ' · ' + line;
        })
        .catch(function (e) {
          toast('发布失败：' + e.message, 'err');
          $('statusText').textContent = '发布失败：' + e.message;
        })
        .then(function () { busy(false); });
    });
  }

  /* 本篇体检：发布前最容易漏的几件事，都是**能在写的时候就查出来**的。
     只读不写，什么都不改；外链域名单独列出来，方便贴进 `tools/siteicons.py --missing`。 */
  function checkup() {
    if (!S.cur) { toast('先打开一篇内容', 'err'); return; }
    var front = S.cur.front || {};
    var body = $('body').value || '';
    var issues = [];
    var title = String(front.title || '').trim();
    if (!title) issues.push('标题是空的');
    else if (title.length > 34) issues.push('标题 ' + title.length + ' 字，列表里会折行（建议 ≤ 30）');
    if (!String(front.summary || '').trim()) issues.push('没有写摘要（列表和搜索里会截正文前 120 字）');
    if (S.cur.kind !== 'doc' && !front.cover) issues.push('没有封面（列表卡片上是纯文字）');
    var noAlt = (body.match(/!\[\s*\]\(/g) || []).length;
    if (noAlt) issues.push(noAlt + ' 张图没有说明文字（`![](…)`）');
    var fenced = body.replace(/```[\s\S]*?```/g, '');
    var hosts = {};
    (fenced.match(/\]\(https?:\/\/[^)\s]+/g) || []).forEach(function (m) {
      var host = m.replace(/^\]\(https?:\/\//, '').split('/')[0].replace(/^www\./, '');
      if (host) hosts[host] = 1;
    });
    var list = Object.keys(hosts).sort();
    var lines = issues.length ? issues.map(function (s, i) { return (i + 1) + '. ' + s; })
      : ['没有发现问题：标题、摘要、封面、图片说明都齐了。'];
    if (list.length) {
      lines.push('');
      lines.push('外链域名 ' + list.length + ' 个（没登记站点图标的会显示成首字母标记）：');
    }
    askText({
      title: '本篇体检',
      message: lines.join('\n'),
      label: '外链域名',
      value: list.join(', '),
      okLabel: '知道了',
      hint: '在项目根目录跑 python tools/siteicons.py --missing 可以对比登记表'
    });
  }

  // ---- 预览 + 选中：点一张先看大图，确认了才「使用这张」 ----
  //    以前是点一下直接生效，想反悔得重新翻一遍。
  function clearPreview() {
    S.pick = null;
    $('imgPreview').hidden = true;
    $('imgPreviewShot').style.backgroundImage = '';
    $('imgPreviewShot').innerHTML =
      '<span class="img-preview-empty" id="imgPreviewEmpty">正在取预览…</span>';
    $('imgPreviewName').textContent = '';
    $('imgPreviewMeta').textContent = '';
    Array.prototype.forEach.call(
      document.querySelectorAll('.img-item.is-on, .online-item.is-on'),
      function (el) { el.classList.remove('is-on'); });
  }

  function showPreview(pick) {
    S.pick = pick;
    $('imgPreview').hidden = false;
    $('imgPreviewName').textContent = pick.name || '';
    $('imgPreviewMeta').textContent = pick.meta || '';
    var shot = $('imgPreviewShot');
    shot.style.backgroundImage = '';
    shot.innerHTML = '<span class="img-preview-empty">正在取预览…</span>';

    function load(url) {
      if (S.pick !== pick) return;
      var img = new Image();
      img.alt = '';
      img.onload = function () {
        if (S.pick !== pick) return;
        shot.innerHTML = '';
        shot.appendChild(img);
      };
      img.onerror = function () {
        if (S.pick !== pick) return;
        shot.innerHTML = '<span class="img-preview-empty">这张图加载不出来，换一张试试</span>';
      };
      img.src = url;
    }

    // 本地图片直接就是站内路径
    if (!pick.online) { load(pick.local); return; }

    // 在线图**一律**让后台去取（返回的是 /api/online/proxy?… 同源地址）：
    // 浏览器直连图源在无头环境里会停在 0×0 —— 4kwallpapers 挂着不返回，
    // wallhaven 的 CDN 也一样，只有走后台用它的 UA 取才稳。
    api('/api/online/preview', {
      body: { provider: online.provider, item: pick.onlineItem }
    }).then(function (r) {
      if (S.pick !== pick) return;
      pick.resolved = r.url;
      load(r.url);
    }).catch(function (e) {
      if (S.pick !== pick) return;
      shot.innerHTML = '<span class="img-preview-empty">取预览失败：' + esc(e.message) + '</span>';
    });
  }

  // ---------------------------------------------------------------- 图片
  function openImages() {
    var groups = {};
    (S.state.images || []).forEach(function (im) {
      (groups[im.group] = groups[im.group] || []).push(im);
    });
    var html = '';
    Object.keys(groups).forEach(function (g) {
      html += '<div class="img-group">' + esc(g) + '</div>';
      html += groups[g].map(function (im) {
        return '<button class="img-item" data-path="' + esc(im.path) + '">' +
          '<img src="/' + esc(im.path) + '" alt="" loading="lazy">' +
          '<span>' + esc(im.name) + '</span></button>';
      }).join('');
    });
    $('imgGrid').innerHTML = html || '<p class="hint">还没有图片，上传一张吧。</p>';
    clearPreview();
    setImgTab('local');
    $('imgModal').hidden = false;
  }

  // ---- 在线图源：搜索 → 选一张 → 后台下载并压成 WebP ----
  // 默认给个关键词：空查询在 wallhaven 上会返回一堆跟文章毫无关系的图，
  // 第一屏就没法用
  var online = { provider: 'wallhaven', q: 'robot', page: 1, pages: 1, busy: false,
                 mode: 'search', loaded: false };

  function setImgTab(tab) {
    S.imgTab = tab;
    var onlineOn = tab === 'online';
    $('onlineBar').hidden = !onlineOn;
    $('onlineGrid').hidden = !onlineOn;
    $('imgGrid').hidden = onlineOn;
    $('onlineCats').hidden = true;
    clearPreview();
    Array.prototype.forEach.call($('imgTabs').querySelectorAll('[data-img-tab]'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-img-tab') === tab);
    });
    // 本地那一排工具（上传按钮 + 格式说明）切到在线时收起来
    var tools = document.querySelector('#imgModal .modal-tools .file');
    var hint = document.getElementById('imgHint');
    if (tools) tools.hidden = onlineOn;
    if (hint) hint.hidden = onlineOn;
    if (onlineOn && !online.loaded) onlineSearch();
  }

  function updatePager() {
    $('onlinePage').textContent = online.page + ' / ' + online.pages;
    $('onlinePrev').disabled = online.page <= 1;
    $('onlineNext').disabled = online.page >= online.pages;
  }

  function onlineSearch(mode) {
    // 上一次还没回来就把这次请求**排上队**，而不是直接丢掉：
    // 连点两下「下一页」时丢掉第二次，界面看着就像点了没反应。
    // 排队时用「最新一次意图」的参数（页码/关键词都是当下的值）。
    if (online.busy) { online.queued = mode || 'search'; return; }
    online.busy = true;
    online.mode = mode || 'search';
    online.q = $('onlineQ').value.trim();
    var grid = $('onlineGrid');
    // 每次请求给个序号：一是让「还在路上」的状态可观察，
    // 二是探针能靠它等结果，而不是靠固定 sleep（图源要现抓，长短不一）
    online.req = (online.req || 0) + 1;
    grid.setAttribute('data-req', String(online.req));
    grid.setAttribute('data-busy', '1');
    grid.innerHTML = '<p class="hint">正在取图源…</p>';
    $('onlineHint').textContent = '';
    clearPreview();
    api('/api/online/search?provider=' + encodeURIComponent(online.provider) +
        '&q=' + encodeURIComponent(online.q) +
        '&page=' + online.page +
        '&mode=' + encodeURIComponent(online.mode))
      .then(function (r) {
        online.pages = Math.max(1, r.pages || 1);
        online.page = Math.max(1, r.page || 1);
        online.loaded = true;
        grid.dataset.loaded = '1';
        updatePager();
        $('onlineHint').textContent = r.note ||
          ('共 ' + (r.total || r.items.length) + ' 张，只搜 SFW 的 16:9' +
           (r.mode === 'random' ? '（随机一批，再点一次换一批）' : ''));
        if (online.provider === '4kwallpapers' && r.cats && r.cats.length) {
          $('onlineCats').hidden = false;
          $('onlineCats').innerHTML = r.cats.map(function (c) {
            return '<button type="button" class="chip" data-cat="' + esc(c.slug) + '">' +
              esc(c.label) + '</button>';
          }).join('');
        } else {
          $('onlineCats').hidden = true;
        }
        if (!r.items.length) {
          grid.innerHTML = '<p class="hint">没搜到，换个词试试。</p>';
          return;
        }        grid.innerHTML = r.items.map(function (it, idx) {
          // wallhaven 有缩略图；4kwallpapers 按 robots.txt 不能取缩略图目录，
          // 只能先显示标题，点了再由后台解析原图地址来预览 —— 慢一点，但合规
          var thumb = it.thumb
            ? '<img src="' + esc(it.thumb) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
            : '<span class="img-placeholder">' + (it.w ? (it.w + '×' + it.h) : '点一下看大图') + '</span>';
          // data-id 是给「翻页/随机之后内容有没有变」这类检查用的稳定标识：
          // 光看标题不行，4kwallpapers 的卡片第一个 <span> 是占位块，标题在第二个
          return '<button class="img-item online-item" data-idx="' + idx + '"' +
            ' data-id="' + esc(it.provider + ':' + (it.id || '')) + '">' +
            thumb + '<span class="img-title">' + esc(it.title || it.id) + '</span></button>';
        }).join('');
        grid.__items = r.items;
      })
      .catch(function (e) {
        grid.innerHTML = '';
        $('onlineHint').textContent = '取图源失败：' + e.message;
        updatePager();
      })
      .then(function () {
        grid.removeAttribute('data-busy');
        online.busy = false;
        if (online.queued) {
          var next = online.queued;
          online.queued = null;
          onlineSearch(next);
        }
      });
  }

  function onlineFetch(item) {
    if (S.onlineBusy) return;
    S.onlineBusy = true;
    toast('正在下载并压缩…', 'ok');
    api('/api/online/fetch', { body: { provider: online.provider, item: item } })
      .then(function (r) {
        toast('已存入 ' + r.path + '（' + Math.round(r.bytes / 1024) + ' KB）', 'ok');
        return refresh().then(function () {
          applyImage(r.path);
          $('imgModal').hidden = true;
        });
      })
      .catch(function (e) { toast('下载失败：' + e.message, 'err'); })
      .then(function () { S.onlineBusy = false; });
  }

  /* opts.insert：粘贴/拖进来的图直接落到光标处，不弹图片选择器、也不设封面。 */
  function uploadImage(file, opts) {
    opts = opts || {};
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      toast('图片 ' + (file.size / 1048576).toFixed(1) + 'MB，超过 12MB 上限，请先压缩', 'err');
      return;
    }
    busy(true);
    // 用文件 MIME 兜底扩展名（有些系统导出的文件没有后缀）
    var name = file.name && /\.[A-Za-z0-9]+$/.test(file.name)
      ? file.name
      : (file.name || 'image') + (file.type === 'image/png' ? '.png'
        : file.type === 'image/webp' ? '.webp'
          : file.type === 'image/gif' ? '.gif' : '.jpg');
    var reader = new FileReader();
    reader.onerror = function () {
      busy(false);
      toast('读取文件失败，可以试试换一张或先压缩', 'err');
    };
    reader.onload = function () {
      api('/api/upload', {
        body: { filename: name, data: String(reader.result),
                target: S.imgTarget && S.imgTarget.key === 'siteAvatar' ? 'avatar' : 'image' }
      }).then(function (r) {
        toast('已上传 ' + r.path, 'ok');
        if (opts.insert) {
          var alt = (opts.alt || file.name || '图片').replace(/^.*[\\/]/, '');
          insertAtCursor('![' + alt.replace(/[[\]]/g, '') + '](' + mdImagePath(r.path) + ')');
          return null;                       // 走这条路不刷新列表，免得打断正在写的那一段
        }
        return refresh().then(function () {
          if (S.imgTarget && S.imgTarget.key === 'siteAvatar') {
            var f = $('siteForm').querySelector('[data-site="avatar"]');
            if (f) f.value = r.path;
            var th = $('siteAvatarThumb');
            if (th) th.style.backgroundImage = 'url(/' + r.path + ')';
            $('imgModal').hidden = true;
            // 头像上传后直接落盘，避免「传了但没保存」导致前台死链
            return saveSite(true);
          }
          applyImage(r.path);
          openImages();
        });
      }).catch(function (e) { toast('上传失败：' + e.message, 'err'); })
        .then(function () { busy(false); });
    };
    reader.readAsDataURL(file);
  }

  function applyImage(path) {
    if (!S.imgTarget) return;
    if (S.imgTarget.key === 'slideImage' || S.imgTarget.key === 'bodyImage') {
      if (S.imgTarget.key === 'slideImage') rememberSlideEdit();
      var imagePath = mdImagePath(path);
      insertAtCursor('![' + (S.imgTarget.key === 'bodyImage' ? '图片说明' : '图片说明') + '](' + imagePath + ')');
    } else if (S.imgTarget.key === 'siteAvatar') {
      var f = $('siteForm').querySelector('[data-site="avatar"]');
      if (f) f.value = path;
      var th = $('siteAvatarThumb');
      if (th) th.style.backgroundImage = 'url(/' + path + ')';
    } else if (S.imgTarget.key === 'themeBg') {
      var i = S.imgTarget.index;
      S.themeDraft = collectThemes();
      if (!S.themeDraft[i]) return;
      S.themeDraft[i].bg = path;
      renderThemes();
      $('imgModal').hidden = true;
      // 换图后顺手按新画面取一次色，省得手动调
      api('/api/theme-suggest', { body: { bg: path } })
        .then(function (r) {
          if (S.themeDraft[i]) {
            S.themeDraft[i].seeds = r.seeds;
            renderThemes();
            toast('已按新背景图重新取色', 'ok');
          }
        })
        .catch(function () { /* 取色失败不影响换图 */ });
      return;
    } else {
      S.cur.front.cover = path;
      var t = $('coverThumb'), p = $('coverPath');
      if (t) t.style.backgroundImage = 'url(/' + path + ')';
      if (p) p.textContent = path;
      setDirty(true);
      schedulePreview();
    }
    $('imgModal').hidden = true;
  }

  // ---------------------------------------------------------------- 站点设置
  function siteField(key, label, value, type, wide) {
    if (type === 'textarea') {
      return '<label class="field wide"><span>' + esc(label) + '</span>' +
        '<textarea data-site="' + key + '" rows="2">' + esc(value || '') + '</textarea></label>';
    }
    return '<label class="field' + (wide ? ' wide' : '') + '"><span>' + esc(label) + '</span>' +
      '<input type="text" data-site="' + key + '" value="' + esc(value == null ? '' : value) + '"></label>';
  }

  function openSite() {
    if (!S.state) { toast('正在加载站点设置，请稍后重试'); return; }
    S.siteBase = JSON.parse(JSON.stringify(S.state));
    S.siteRevision = S.state.configRevision;
    var s = S.state.site || {}, h = S.state.hero || {};
    var stats = (h.stats || []).map(function (st) {
      return '<div class="link-row">' +
        '<input type="text" data-stat="value" placeholder="数值（可用 {posts} {projects}）" value="' + esc(st.value || '') + '">' +
        '<input type="text" data-stat="label" placeholder="说明" value="' + esc(st.label || '') + '">' +
        '<textarea data-stat="hint" aria-label="统计悬浮提示" placeholder="悬浮提示（留空则不显示）">' + esc(st.hint || '') + '</textarea>' +
        '<button class="icon" data-act="del-stat">✕</button></div>';
    }).join('');

    var curFont = (S.state.appearance || {}).defaultFont || 'sans';
    var fontOptions = [['sans', '黑体（无衬线）'], ['serif', '宋体（衬线）'], ['mono', '等宽']]
      .map(function (pair) {
        return '<option value="' + pair[0] + '"' +
          (curFont === pair[0] ? ' selected' : '') + '>' + pair[1] + '</option>';
      }).join('');
    var appearance = S.state.appearance || {};
    var curCursor = appearance.defaultCursor || (appearance.customCursor === false ? 'off' : 'glow');
    var cursorOptions = [['glow', '微光（适合阅读）'], ['on', '圆环'], ['off', '系统指针']]
      .map(function (pair) {
        return '<option value="' + pair[0] + '"' +
          (curCursor === pair[0] ? ' selected' : '') + '>' + pair[1] + '</option>';
      }).join('');

    $('siteForm').innerHTML =
      '<div class="grid">' +
      siteField('title', '站点名 / 网名', s.title) +
      siteField('titleEn', '英文名 / 账号', s.titleEn) +
      siteField('role', '身份（显示在头像旁）', s.role) +
      siteField('tagline', '副标题', s.tagline) +
      siteField('description', '站点描述', s.description, 'textarea', true) +
      siteField('email', '邮箱', s.email) +
      siteField('emailAlt', '备用邮箱', s.emailAlt) +
      siteField('phone', '电话', s.phone) +
      siteField('org', '所在单位', s.org) +
      siteField('url', '站点网址', s.url) +
      siteField('startYear', '起始年份', s.startYear) +
      '<label class="field"><span>默认字体（浏览者首次访问）</span>' +
      '<select data-appearance="defaultFont">' + fontOptions + '</select></label>' +
      '<label class="field"><span>默认鼠标指针（浏览者首次访问）</span>' +
      '<select data-appearance="defaultCursor">' + cursorOptions + '</select></label>' +
      '<div class="field wide"><span>头像</span><div class="cover-row">' +
      '<span class="cover-thumb" id="siteAvatarThumb" style="' +
      (s.avatar ? 'background-image:url(/' + esc(s.avatar) + ')' : '') + '"></span>' +
      '<input type="text" data-site="avatar" value="' + esc(s.avatar || '') + '" style="flex:1">' +
      '<button class="btn ghost" data-act="pick-avatar">选择 / 上传</button></div></div>' +
      '</div>' +

      '<div class="group-title">首页 Hero</div>' +
      '<div class="grid">' +
      siteField('heroEyebrow', '小标签', h.eyebrow) +
      siteField('heroTitleLines', '大标题（每行一个，用 | 分隔）',
                (h.titleLines || []).join(' | '), 'text', true) +
      siteField('heroSubtitle', '副标题文案', h.subtitle, 'textarea', true) +
      '</div>' +

      '<div class="group-title">首页统计数字</div>' +
      '<div id="statRows">' + stats + '</div>' +
      '<button class="btn ghost" data-act="add-stat">＋ 添加一项</button>' +

      '<div class="group-title">社交链接</div>' +
      '<div id="socialRows">' + (S.state.social || []).map(function (l) {
        return '<div class="link-row">' +
          '<input type="text" data-social="label" value="' + esc(l.label || '') + '">' +
          '<input type="text" data-social="href" value="' + esc(l.href || '') + '">' +
          '<button class="icon" data-act="del-social">✕</button></div>';
      }).join('') + '</div>' +
      '<button class="btn ghost" data-act="add-social">＋ 添加链接</button>';

    S.siteOriginal = JSON.stringify(collectSite());
    $('siteSaveStatus').textContent = '保存后，构建站点即可预览。';
    $('siteModal').hidden = false;
  }

  function collectSite() {
    var f = $('siteForm');
    var base = S.siteBase || S.state;
    var site = Object.assign({}, base.site);
    f.querySelectorAll('[data-site]').forEach(function (n) {
      var key = n.getAttribute('data-site');
      if (key.indexOf('hero') !== 0) site[key] = n.value.trim();
    });
    if (site.startYear) site.startYear = parseInt(site.startYear, 10) || site.startYear;

    // 外观默认值；访问者已保存的偏好继续优先。
    var appearance = Object.assign({}, base.appearance);
    f.querySelectorAll('[data-appearance]').forEach(function (n) {
      appearance[n.getAttribute('data-appearance')] = n.value;
    });

    var hero = Object.assign({}, base.hero);
    hero.eyebrow = f.querySelector('[data-site="heroEyebrow"]').value.trim();
    hero.subtitle = f.querySelector('[data-site="heroSubtitle"]').value.trim();
    hero.titleLines = f.querySelector('[data-site="heroTitleLines"]').value
      .split('|').map(function (s) { return s.trim(); }).filter(Boolean);
    hero.stats = [];
    f.querySelectorAll('#statRows .link-row').forEach(function (row) {
      var v = row.querySelector('[data-stat="value"]').value.trim();
      var l = row.querySelector('[data-stat="label"]').value.trim();
      var hint = row.querySelector('[data-stat="hint"]').value.trim();
      if (l) hero.stats.push({ value: v, label: l, hint: hint });
    });

    var social = [];
    f.querySelectorAll('#socialRows .link-row').forEach(function (row) {
      var l = row.querySelector('[data-social="label"]').value.trim();
      var h = row.querySelector('[data-social="href"]').value.trim();
      if (h) social.push({ label: l || h, href: h });
    });
    return { site: site, hero: hero, social: social, appearance: appearance };
  }

  function saveSite(keepOpen) {
    if (S.configSaving) return;
    S.configSaving = true;
    setConfigSaving(true);
    var payload = collectSite();
    var snapshot = JSON.stringify(payload);
    $('siteSaveStatus').textContent = '正在保存设置…';
    busy(true);
    return api('/api/site', { body: Object.assign({ revision: S.siteRevision }, payload) })
      .then(function (r) {
        S.siteRevision = r.revision;
        S.siteOriginal = snapshot;
        var changed = modalDirty($('siteModal'));
        $('siteSaveStatus').textContent = changed ? '上一版已保存；新改动尚未保存。' : '设置已保存，构建站点即可预览。';
        toast(changed ? '已保存提交时的设置；新改动请再次保存' : '设置已保存', 'ok');
        if (!keepOpen && !changed) $('siteModal').hidden = true;
        return refresh();
      })
      .catch(function (e) {
        $('siteSaveStatus').textContent = e.message;
        return configSaveFailed(e);
      })
      .then(function () { S.configSaving = false; setConfigSaving(false); busy(false); });
  }

  function configSaveFailed(error) {
    toast(error.message, 'err');
    // Keep the current form intact. Reopening it after copying changes loads the latest settings.
    if (error.status === 409) return refresh(true).catch(function () {});
  }

  function modalDirty(modal) {
    if (!modal || modal.hidden) return false;
    if (modal.id === 'siteModal') return S.siteOriginal !== JSON.stringify(collectSite());
    if (modal.id === 'themeModal') return S.themeOriginal !== JSON.stringify(collectThemes());
    return false;
  }

  function closeModal(modal) {
    if (modal.id === 'recoveryModal') { closeRecovery(); return; }
    if (S.configSaving && /^(site|theme)Modal$/.test(modal.id)) {
      toast('正在保存设置，请稍后关闭'); return;
    }
    if (!modalDirty(modal)) { modal.hidden = true; return; }
    askConfirm({ title: '设置还未保存', message: '关闭后会放弃本次改动。', okLabel: '放弃改动', danger: true })
      .then(function (ok) { if (ok) modal.hidden = true; });
  }

  // ---------------------------------------------------------------- 事件
  /* 往编辑框里粘图 / 拖图：直接上传到 assets/uploads/ 并把 Markdown 插到光标处。
     写作时最常用的一步就是「截图 → 粘进来」，以前得先存文件、再走图片选择器。
     一次粘多张就排成一行（渲染器会把一行多张图并排）。 */
  function bindEditorUpload() {
    var ta = $('body');
    if (!ta) return;

    function pick(files) {
      var imgs = [].slice.call(files || []).filter(function (f) {
        return f && /^image\//.test(f.type || '');
      });
      if (!imgs.length) return false;
      imgs.forEach(function (f) {
        uploadImage(f, { insert: true, alt: imgs.length > 1 ? '并排图' : '图片说明' });
      });
      return true;
    }

    ta.addEventListener('paste', function (ev) {
      var items = (ev.clipboardData && ev.clipboardData.items) || [];
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          var f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (pick(files)) ev.preventDefault();
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      ta.addEventListener(type, function (ev) {
        if (!ev.dataTransfer) return;
        ev.preventDefault();
        ta.classList.add('is-drop');
      });
    });
    ta.addEventListener('dragleave', function () { ta.classList.remove('is-drop'); });
    ta.addEventListener('drop', function (ev) {
      ta.classList.remove('is-drop');
      if (!ev.dataTransfer) return;
      if (pick(ev.dataTransfer.files)) ev.preventDefault();
    });
  }

  function bind() {
    bindSlideDrag();
    bindEditorUpload();
    document.addEventListener('click', function (ev) {
      var t = ev.target;

      // 站内输入 / 确认弹窗
      if (t.closest('[data-ask-ok]')) { askAccept(); return; }
      if (t.closest('[data-ask-cancel]')) { askClose(null); return; }

      // 后台主题菜单
      var themeBtn = t.closest('#themeMenu button[data-admin-theme]');
      if (themeBtn) {
        applyAdminTheme(themeBtn.getAttribute('data-admin-theme'));
        $('themeMenu').hidden = true;
        return;
      }
      var menu = $('themeMenu');
      if (menu && !menu.hidden && !t.closest('.theme-pick')) menu.hidden = true;

      var tab = t.closest('[data-filter]');
      if (tab) { S.filter = tab.getAttribute('data-filter'); renderList(); return; }
      var recoveryTab = t.closest('[data-recovery-tab]');
      if (recoveryTab) { recoveryList(recoveryTab.dataset.recoveryTab); return; }
      var recoveryViewButton = t.closest('[data-recovery-view]');
      if (recoveryViewButton) return recoveryView(Number(recoveryViewButton.dataset.recoveryView));
      var recoveryRestoreButton = t.closest('[data-recovery-restore]');
      if (recoveryRestoreButton) return recoveryRestore(Number(recoveryRestoreButton.dataset.recoveryRestore));
      var recoveryDiscardButton = t.closest('[data-recovery-discard]');
      if (recoveryDiscardButton) return discardLocalDraft(Number(recoveryDiscardButton.dataset.recoveryDiscard));

      var doc = t.closest('.doc');
      var slideChoice = t.closest('[data-slide-select]');
      if (slideChoice) { S.slideIndex = Number(slideChoice.getAttribute('data-slide-select')); $('slideBody').value = splitSlides()[S.slideIndex].text; renderSlideEditor(); doPreview(); $('slideBody').focus(); return; }
      if (doc) { openDoc(doc.getAttribute('data-kind'), doc.getAttribute('data-slug')); return; }

      var md = t.closest('[data-md]');
      if (md) { insertSnippet(md.getAttribute('data-md')); return; }

      var act = t.closest('[data-act]');
      if (act) {
        var a = act.getAttribute('data-act');
        if (a === 'theme-menu') {
          var tm = $('themeMenu');
          tm.hidden = !tm.hidden;
          return;
        }
        if (a === 'new-post') return newDoc('post');
        if (a === 'new-project') return newDoc('project');
        if (a === 'new-page') return newDoc('page');
        if (a === 'new-doc') return newDoc('doc');
        if (a === 'doc-image') { S.imgTarget = {key:'slideImage'}; $('imgTitle').textContent = '插入文档图片'; return openImages(); }
        if (a.indexOf('slide-') === 0) return slideOperation(a.slice(6));
        if (a === 'toggle-meta') { $('meta').hidden = !$('meta').hidden; act.setAttribute('aria-expanded', String(!$('meta').hidden)); act.textContent = $('meta').hidden ? '展开文档信息' : '收起文档信息'; return; }
        if (a === 'insert-step') { rememberSlideEdit(); insertAtCursor('\n--\n'); return; }
        if (a === 'deck-prev') return deckStep(-1);
        if (a === 'deck-next') return deckStep(1);
        if (a === 'deck-all') {
          if (!S.deck) return;
          S.deck.all = !S.deck.all;
          act.classList.toggle('primary', S.deck.all);
          paintDeckPreview(true);
          return;
        }
        if (a === 'insert-sep-h' || a === 'insert-sep-v') {
          $('slideTemplate').value = a === 'insert-sep-h' ? 'cover' : 'content';
          return slideOperation('add');
        }
        if (a === 'save') return save(false);
        if (a === 'save-build') return save(true);
        if (a === 'delete') return del();
        if (a === 'history') return openRecovery('history');
        if (a === 'recovery') return openRecovery('drafts');
        if (a === 'recovery-prev') return recoveryList(S.recoveryMode, Math.max(0, S.recoveryOffset - 40));
        if (a === 'recovery-next') return recoveryList(S.recoveryMode, S.recoveryOffset + 40);
        if (a === 'reload') {
          if (!S.dirty) { openDoc(S.cur.kind, S.cur.originalSlug || S.cur.slug); return; }
          askConfirm({
            title: '有未保存的改动',
            message: '放弃未保存的改动，重新载入这篇内容？',
            okLabel: '放弃改动',
            danger: true,
          }).then(function (ok) {
            if (ok) { forgetDraft(S.cur); setDirty(false); openDoc(S.cur.kind, S.cur.originalSlug || S.cur.slug, true, true); }
          });
          return;
        }
        if (a === 'build') return build();
        if (a === 'deploy') return deploy();
        if (a === 'checkup') return checkup();
        if (a === 'site') return openSite();
        if (a === 'save-site') return saveSite();
        if (a === 'themes') return openThemes();
        if (a === 'close-themes') { closeModal($('themeModal')); return; }
        if (a === 'save-themes') return saveThemes();
        if (a === 'add-theme') return addTheme();
        if (a === 'del-theme') {
          var di = +t.getAttribute('data-idx');
          var dcur = collectThemes();
          if (dcur.length <= 1) { toast('至少要保留一套主题', 'err'); return; }
          askConfirm({
            title: '删除主题',
            message: '删除主题「' + (dcur[di].name || dcur[di].id) + '」？\n保存后会从站点移除（背景图文件不会删）。',
            okLabel: '删除',
            danger: true,
          }).then(function (ok) {
            if (!ok) return;
            dcur.splice(di, 1);
            S.themeDraft = dcur;
            renderThemes();
          });
          return;
        }
        if (a === 'suggest-seeds') return suggestSeeds(+t.getAttribute('data-idx'));
        if (a === 'pick-theme-bg') {
          var pi = +t.getAttribute('data-idx');
          S.themeDraft = collectThemes();
          S.imgTarget = { key: 'themeBg', index: pi };
          $('imgTitle').textContent = '选择背景图';
          return openImages();
        }
        if (a === 'pick-cover') { S.imgTarget = { key: 'cover' }; $('imgTitle').textContent = '选择封面图'; return openImages(); }
        if (a === 'clear-cover') {
          S.cur.front.cover = '';
          $('coverThumb').style.backgroundImage = '';
          $('coverPath').textContent = '（未设置）';
          setDirty(true);
          schedulePreview();
          return;
        }
        if (a === 'pick-avatar') { S.imgTarget = { key: 'siteAvatar' }; $('imgTitle').textContent = '选择头像'; return openImages(); }
        if (a === 'add-link') { $('linkRows').insertAdjacentHTML('beforeend', linkRow({})); setDirty(true); return; }
        if (a === 'del-link') { act.closest('.link-row').remove(); setDirty(true); return; }
        if (a === 'add-stat') { $('statRows').insertAdjacentHTML('beforeend',
          '<div class="link-row"><input type="text" data-stat="value" placeholder="数值"><input type="text" data-stat="label" placeholder="说明"><textarea data-stat="hint" aria-label="统计悬浮提示" placeholder="悬浮提示（留空则不显示）"></textarea><button class="icon" data-act="del-stat">✕</button></div>'); return; }
        if (a === 'del-stat') { act.closest('.link-row').remove(); return; }
        if (a === 'add-social') { $('socialRows').insertAdjacentHTML('beforeend',
          '<div class="link-row"><input type="text" data-social="label" placeholder="名称"><input type="text" data-social="href" placeholder="链接"><button class="icon" data-act="del-social">✕</button></div>'); return; }
        if (a === 'del-social') { act.closest('.link-row').remove(); return; }
      }

      // 注意：**不要**在这里处理 `.img-item`。
      // 这是挂在 body 上的总委托，而在线图源的卡片类名是
      // `img-item online-item`，所以它会连在线卡片一起吃掉 ——
      // 调 `applyImage(undefined)` 直接把弹窗关掉、封面也清空，
      // 表现就是「点了图片，预览没出来，弹窗还没了」。
      // 现在两个网格各有自己的委托（#imgGrid / #onlineGrid），先选中、看大图、再确认。

      if (t.closest('[data-close]')) {
        closeModal(t.closest('.modal'));
        return;
      }
    });

    $('body').addEventListener('input', function () { setDirty(true); schedulePreview(); });
    $('body').addEventListener('beforeinput', rememberSlideEdit);
    $('slideBody').addEventListener('beforeinput', rememberSlideEdit);
    $('slideBody').addEventListener('input', function () { syncSlideBody(); setDirty(true); schedulePreview(); });
    $('meta').addEventListener('input', function () { setDirty(true); schedulePreview(); var title = $('meta').querySelector('[data-key="title"]'); if (title) $('editingTitle').textContent = title.value || '未命名内容'; });
    $('siteForm').addEventListener('input', function () {
      var av = $('siteForm').querySelector('[data-site="avatar"]');
      var th = $('siteAvatarThumb');
      if (av && th) th.style.backgroundImage = av.value ? 'url(/' + av.value + ')' : '';
    });

    $('q').addEventListener('input', function () { S.q = this.value.trim().toLowerCase(); renderList(); });

    $('imgFile').addEventListener('change', function () { uploadImage(this.files[0]); this.value = ''; });

    // 图片弹窗：本地 / 在线两个页签
    $('imgTabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-img-tab]');
      if (b) setImgTab(b.getAttribute('data-img-tab'));
    });
    $('onlineProv').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-prov]');
      if (!b) return;
      online.provider = b.getAttribute('data-prov');
      online.page = 1;
      Array.prototype.forEach.call(this.querySelectorAll('[data-prov]'), function (x) {
        x.classList.toggle('is-active', x === b);
      });
      // 4kwallpapers 只认分类 slug，给个能直接用的默认值
      $('onlineQ').value = online.provider === '4kwallpapers' ? 'nature' : 'robot';
      $('onlineQ').placeholder = online.provider === '4kwallpapers'
        ? '分类名（英文 slug，如 nature / cars / space）'
        : '搜索关键词（英文更准）';
      $('onlineGrid').dataset.loaded = '';
      onlineSearch();
    });
    $('onlineGo').addEventListener('click', function () {
      online.page = 1;
      onlineSearch('search');
    });
    $('onlineRandom').addEventListener('click', function () {
      online.page = 1;
      onlineSearch('random');
    });
    $('onlinePrev').addEventListener('click', function () {
      if (online.page > 1) { online.page -= 1; onlineSearch('search'); }
    });
    $('onlineNext').addEventListener('click', function () {
      if (online.page < online.pages) { online.page += 1; onlineSearch('search'); }
    });
    $('onlineQ').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); online.page = 1; onlineSearch('search'); }
    });
    $('onlineCats').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-cat]');
      if (!b) return;
      $('onlineQ').value = b.getAttribute('data-cat');
      online.page = 1;
      onlineSearch('search');
    });

    // 本地图片：点一张先看大图
    $('imgGrid').addEventListener('click', function (ev) {
      var b = ev.target.closest('.img-item');
      if (!b) return;
      var path = b.getAttribute('data-path');
      Array.prototype.forEach.call(this.querySelectorAll('.img-item'), function (el) {
        el.classList.toggle('is-on', el === b);
      });
      showPreview({ local: true, path: path, name: path.split('/').pop(),
                    meta: path, local: '/' + path });
    });

    // 在线图片：同样先看大图；4kwallpapers 的预览地址要后台解析
    $('onlineGrid').addEventListener('click', function (ev) {
      var b = ev.target.closest('.online-item');
      if (!b) return;
      var items = this.__items || [];
      var it = items[parseInt(b.getAttribute('data-idx'), 10)];
      if (!it) return;
      Array.prototype.forEach.call(this.querySelectorAll('.online-item'), function (el) {
        el.classList.toggle('is-on', el === b);
      });
      showPreview({
        online: true, onlineItem: it, name: it.title || it.id,
        meta: [online.provider, it.w ? (it.w + '×' + it.h) : ''].filter(Boolean).join(' · ')
      });
    });

    $('imgPreviewCancel').addEventListener('click', clearPreview);
    $('imgPreviewUse').addEventListener('click', function () {
      var p = S.pick;
      if (!p) return;
      if (p.online) { onlineFetch(p.onlineItem); return; }
      applyImage(p.path);
      $('imgModal').hidden = true;
    });

    // 插图下拉：选完立刻插到光标处，然后复位成占位项
    var figSel = $('figPick');
    if (figSel) {
      figSel.addEventListener('change', function () {
        var name = this.value;
        this.value = '';
        if (!name) return;
        insertAtCursor('<!--fig:' + name + '-->');
        toast('已插入插图 ' + name);
      });
    }

    document.addEventListener('keydown', function (ev) {
      // 站内弹窗优先响应键盘
      if (askState) {
        if (ev.key === 'Escape') { ev.preventDefault(); askClose(null); return; }
        if (ev.key === 'Enter' && (askState.withInput || ev.target === $('askOk'))) {
          ev.preventDefault();
          askAccept();
          return;
        }
      }
      if (recoveryKey(ev)) return;
      if (ev.key === 'Escape') {
        var menu = $('themeMenu');
        if (menu && !menu.hidden) { menu.hidden = true; return; }
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        if (!$('siteModal').hidden) saveSite(true);
        else if (!$('themeModal').hidden) saveThemes();
        else if (S.cur) save(false);
        return;
      }
      /* 插入快捷键只在编辑框里生效：焦点在搜标题、字段里的时候不该被劫持。 */
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.target === activeEditor()) {
        var keys = { b: 'bold', i: 'italic', e: 'code', k: 'link' };
        var kind = keys[(ev.key || '').toLowerCase()];
        if (kind) { ev.preventDefault(); insertSnippet(kind); }
      }
    });

    window.addEventListener('beforeunload', function (ev) {
      persistDraft();
      if (S.dirty || S.saving || S.configSaving || modalDirty($('siteModal')) || modalDirty($('themeModal'))) {
        ev.preventDefault(); ev.returnValue = '';
      }
    });
    window.addEventListener('pagehide', persistDraft);
    document.addEventListener('visibilitychange', function () { if (document.hidden) persistDraft(); });
    window.addEventListener('storage', function (ev) {
      if (ev.key && ev.key.indexOf(draftPrefix) === 0) draftBadge();
    });
  }

  // ---------------------------------------------------------------- 启动

  /* 插图下拉：选项来自服务端的 tools/docfigs.py。
     插进去的是 `<!--fig:名字-->` 这一行标记 —— 构建时才展开成内联 SVG，
     所以正文里永远不会出现一大坨 SVG 源码。 */
  function fillFigurePicker(figs) {
    var sel = $('figPick');
    if (!sel) return;
    sel.innerHTML = '<option value="">＋ 插图…</option>' + figs.map(function (f) {
      return '<option value="' + esc(f.name) + '">' + esc(f.name) + ' · ' +
        esc((f.caption || '').slice(0, 18)) + '</option>';
    }).join('');
  }

  function refresh(keepStatus) {
    return api('/api/state').then(function (r) {
      S.state = r;
      draftBadge();
      $('siteName').textContent = (r.site.title || '') + ' · ' + (r.site.tagline || '');
      document.title = '写作后台 · ' + (r.site.title || '');
      // 「打开站点」指向独立端口的站点预览（站点用根绝对路径，不能挂在后台子路径下）
      var link = $('viewSite');
      if (link && r.sitePort) {
        link.href = location.protocol + '//' + location.hostname + ':' + r.sitePort + '/';
      }
      renderList();
      fillFigurePicker(r.figures || []);
      if (!keepStatus && r.last_build && r.last_build.at) {
        $('statusText').textContent = '上次构建 ' + r.last_build.at +
          (r.last_build.ok ? ' · 成功' : ' · 失败');
      }
      return r;
    });
  }

  function boot() {
    initAdminTheme();
    bind();
    refresh().then(function () {
      // 深链：?open=post:dds-qos-tuning 打开某篇；?open=site / ?open=themes 打开对应弹窗
      var m = /[?&]open=([a-z]+):([^&]+)/.exec(location.search);
      if (m) {
        var kind = m[1], slug = decodeURIComponent(m[2]);
        if (S.state.docs[kind] && S.state.docs[kind].some(function (d) { return d.slug === slug; })) {
          openDoc(kind, slug);
        }
        return;
      }
      var s = /[?&]open=([a-z]+)(?:&|$)/.exec(location.search);
      if (s) {
        if (s[1] === 'site') openSite();
        else if (s[1] === 'themes') openThemes();
        else if (s[1] === 'images') openImages();
      }
    }).catch(function (e) {
      document.body.innerHTML = '<p style="padding:40px;color:#e06464">后台加载失败：' +
        esc(e.message) + '</p>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
