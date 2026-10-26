/* Shared blog rendering in an isolated, reusable preview frame. */
(function (root) {
  'use strict';

  var active = null;
  var frames = new WeakMap();
  var sourceMeasurements = new WeakMap();
  var tokenSerial = 0;

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function safeJSON(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  function finite(value, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? value : fallback;
  }

  function safeURL(value, base) {
    if (!value || typeof value !== 'string') return '';
    try {
      var result = new URL(value, base);
      return /^https?:$/.test(result.protocol) ? result.href : '';
    } catch (_) { return ''; }
  }

  function originBase() {
    return root.location.origin + '/';
  }

  function assetList(values, base) {
    return (Array.isArray(values) ? values : []).map(function (value) {
      return safeURL(value, base);
    }).filter(function (value, index, items) { return value && items.indexOf(value) === index; });
  }

  function newToken() {
    var random = '';
    if (root.crypto && root.crypto.getRandomValues) {
      var numbers = new Uint32Array(4);
      root.crypto.getRandomValues(numbers);
      random = Array.from(numbers, function (n) { return n.toString(16); }).join('-');
    }
    return 'preview-' + (++tokenSerial) + '-' + (random || Date.now().toString(36));
  }

  function slideMarkup(slide, index, current) {
    var first = Math.max(1, finite(slide.source_line, 1));
    var last = Math.max(first, finite(slide.source_end, first));
    var block = Math.max(0, Math.floor(finite(slide.blockIndex, finite(slide.block_index, index))));
    return '<section class="slide' + (slide.kind === 'h' ? ' slide--section' : '') + (current ? ' is-current' : '') + '" data-slide-index="' + index +
      '" data-block-index="' + block + '" data-source-line="' + first + '" data-source-end="' + last +
      '"><div class="slide-inner">' + (slide.html || '<p class="muted">这一页还没有内容。</p>') + '</div></section>';
  }

  function articleMarkup(response, base) {
    var front = response.front || {};
    var cover = safeURL(front.cover, base);
    var tags = Array.isArray(front.tags) ? front.tags : [];
    var title = escapeHTML(front.title || '未命名文章');
    var hero = '<header class="phero ' + (cover ? 'has-media' : 'is-plain') + '">';
    if (cover) hero += '<div class="phero-media media-shim"><img src="' + escapeHTML(cover) + '" alt="" decoding="async"></div>';
    hero += '<span class="phero-scrim" aria-hidden="true"></span><div class="phero-inner">';
    if (tags.length) hero += '<div class="post-tags">' + tags.map(function (tag) {
      return '<span class="pill">' + escapeHTML(tag) + '</span>';
    }).join('') + '</div>';
    hero += '<h1 class="phero-title">' + title + '</h1>';
    if (front.summary) hero += '<p class="phero-lede">' + escapeHTML(front.summary) + '</p>';
    var meta = [];
    if (front.date) meta.push('<time>' + escapeHTML(front.date) + '</time>');
    if (response.minutes != null) meta.push(escapeHTML(response.minutes) + ' 分钟');
    if (front.updated) meta.push('更新于 ' + escapeHTML(front.updated));
    if (meta.length) hero += '<div class="phero-meta">' + meta.map(function (text) {
      return '<span class="meta-item">' + text + '</span>';
    }).join('') + '</div>';
    hero += '</div></header>';
    return '<article class="post">' + hero + '<div class="post-layout"><main class="post-main">' +
      '<div class="prose">' + (response.html || '<p class="muted">开始写作后，正文会显示在这里。</p>') +
      '</div></main></div></article>';
  }

  function documentMarkup(response, options, token, restoreLine) {
    var assets = response.previewAssets || response;
    var base = originBase();
    var styles = assetList(assets.styles, base);
    var mathStyle = safeURL(assets.mathStyle, base);
    if (mathStyle && styles.indexOf(mathStyle) === -1) styles.push(mathStyle);
    // KaTeX must execute before the shared math runtime. All scripts are defer,
    // so their declared order is kept without blocking document parsing.
    var scripts = assetList((assets.mathScripts || []).concat(assets.scripts || []), base);
    var helper = safeURL('/admin/preview-frame.js?v=source-map-1', base);
    if (helper) scripts.push(helper);
    var theme = response.previewTheme || {};
    var attributes = '';
    ['theme', 'mode', 'font', 'width', 'bg', 'motion', 'cursor'].forEach(function (name) {
      var defaults = { theme: 'dusk', mode: 'dark', font: 'serif', width: 'normal', bg: 'off', motion: 'off', cursor: 'off' };
      attributes += ' data-' + name + '="' + escapeHTML(theme[name] || defaults[name]) + '"';
    });
    var config = {
      token: token,
      restoreLine: restoreLine,
      step: Math.max(0, Math.floor(finite(options.step, 0))),
      all: !!options.all,
      siteBase: safeURL(assets.siteBase, base) || base,
      assetBase: safeURL(assets.assetBase || '/', base) || base
    };
    var body;
    if (response.deck) {
      var slides = Array.isArray(response.slides) ? response.slides : [];
      var requested = Math.floor(finite(options.index, 0));
      var index = requested < 0 ? -1 : Math.max(0, Math.min(slides.length - 1, requested));
      var empty = { html: '<p class="muted">这一页没有可预览的内容。</p>' };
      var rendered = options.all ? slides.map(function (slide, i) { return slideMarkup(slide, i, true); }).join('') :
        slideMarkup(slides[index] || empty, index, true);
      body = (response.sprite || '') + '<main class="deck ' + (options.all ? 'is-scroll' : 'is-paged') +
        '"><div class="deck-stage" tabindex="0">' + rendered + '</div></main>';
    } else {
      body = articleMarkup(response, base);
    }
    var pageClasses = String(response.previewBodyClass || '').split(/\s+/).filter(function (name) {
      return ['page-single', 'page-learning', 'page-links'].indexOf(name) !== -1;
    }).join(' ');
    return '<!doctype html><html lang="zh-CN"' + attributes + ' data-glass="med" data-root="' + escapeHTML(base.replace(/\/$/, '')) + '">' +
      '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="color-scheme" content="dark light"><base href="' + escapeHTML(base) + '">' +
      '<title>' + escapeHTML((response.front || {}).title || '实时预览') + '</title>' +
      styles.map(function (url) { return '<link rel="stylesheet" href="' + escapeHTML(url) + '">'; }).join('') +
      '<style>html{scroll-behavior:auto}body.preview-page{margin:0;padding:16px 16px 48px;min-width:0}' +
      '.preview-page [hidden]{display:none!important}.preview-page .post-main{width:100%}' +
      '.preview-page .deck{max-width:100%}.preview-page .slide{scroll-behavior:auto}' +
      // Let the editor pane own vertical scrolling instead of nesting a second
      // scrollbar inside each slide. Typography still comes from docs.css.
      '.preview-page .deck.is-paged .slide{height:auto;overflow:visible}</style>' +
      '<script>window.PREVIEW_CONFIG=' + safeJSON(config) + ';</script>' +
      scripts.map(function (url) { return '<script defer src="' + escapeHTML(url) + '"></script>'; }).join('') +
      '</head><body class="preview-page ' + pageClasses + '">' + body + '</body></html>';
  }

  function render(container, response, options) {
    if (!container || !response) return;
    options = options || {};
    var state = frames.get(container);
    if (!state) {
      var frame = root.document.createElement('iframe');
      frame.className = 'blog-preview-frame';
      frame.title = '博客实时预览';
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.style.cssText = 'display:block;width:100%;height:100%;border:0;min-height:0;background:transparent;';
      state = { frame: frame, line: 0, options: {} };
      frames.set(container, state);
    }
    var samePage = state.options.key === options.key && !!state.options.all === !!options.all &&
      (!!options.all || finite(state.options.index, 0) === finite(options.index, 0));
    var restoreLine = samePage ? state.line : 0;
    state.line = restoreLine;
    state.options = Object.assign({}, options);
    state.token = newToken();
    state.siteBase = safeURL((response.previewAssets || response).siteBase, originBase()) || originBase();
    state.ready = false;
    active = state;
    if (state.frame.parentNode !== container) {
      container.textContent = '';
      container.appendChild(state.frame);
    }
    state.frame.srcdoc = documentMarkup(response, options, state.token, restoreLine);
    return state.frame;
  }

  function update(options) {
    if (!active) return;
    active.options = Object.assign({}, active.options, options || {});
    active.frame.contentWindow.postMessage({
      type: 'blog-preview-control', token: active.token,
      step: Math.max(0, Math.floor(finite(active.options.step, 0))), all: !!active.options.all
    }, '*');
  }

  function receive(event) {
    var state = active, message = event.data;
    if (!state || event.source !== state.frame.contentWindow || !message || typeof message !== 'object' ||
        message.token !== state.token) return;
    if (message.type === 'blog-preview-scroll') {
      var line = finite(message.line, 0);
      if (line < 1) return;
      state.line = line;
      var block = Number.isInteger(message.blockIndex) && message.blockIndex >= 0 ? message.blockIndex : null;
      if (typeof state.options.onScroll === 'function') state.options.onScroll({ line: line, blockIndex: block });
    } else if (message.type === 'blog-preview-ready') {
      state.ready = true;
      // A step change while the frame was loading should still take effect.
      update();
      if (typeof state.options.onReady === 'function') state.options.onReady(message);
    } else if (message.type === 'blog-preview-link') {
      var href = safeURL(message.href, state.siteBase);
      if (href) root.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  function splitSlides(text) {
    text = String(text == null ? '' : text);
    var blocks = [], fence = null, start = 0, sep = '', startLine = 1, lineNumber = 1;
    var lines = /[^\n]*(?:\n|$)/g, match;
    while ((match = lines.exec(text)) && match[0]) {
      var raw = match[0];
      var line = raw.replace(/\n$/, '').replace(/\r$/, '');
      var marker = /^\s*(`{3,}|~{3,})/.exec(line);
      var inside = fence !== null;
      if (marker) {
        var token = marker[1];
        if (fence === null) fence = token;
        else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      }
      if (!inside && !marker && /^\s*(?:-{3,}|\+{4,})\s*$/.test(line)) {
        blocks.push({ sep: sep, text: text.slice(start, match.index), startLine: startLine });
        sep = raw;
        start = lines.lastIndex;
        startLine = lineNumber + 1;
      }
      lineNumber += 1;
    }
    blocks.push({ sep: sep, text: text.slice(start), startLine: startLine });
    return blocks;
  }

  var measureProperties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'fontStretch', 'fontFeatureSettings', 'fontVariationSettings', 'lineHeight', 'letterSpacing',
    'wordSpacing', 'textTransform', 'textIndent', 'textAlign', 'direction', 'tabSize',
    'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'wordBreak', 'overflowWrap'];

  function measureSource(textarea) {
    var style = root.getComputedStyle(textarea);
    var values = measureProperties.map(function (name) { return style[name]; });
    var width = textarea.clientWidth;
    var text = textarea.value;
    var signature = values.join('|') + '|' + width + '|' + textarea.wrap;
    var cached = sourceMeasurements.get(textarea);
    if (cached && cached.text === text && cached.signature === signature) return cached.offsets;
    if (!width) return null;
    var mirror = root.document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.style.cssText = 'position:fixed;top:0;left:-100000px;visibility:hidden;pointer-events:none;' +
      'margin:0;border:0;box-sizing:border-box;height:auto;min-height:0;max-height:none;overflow:visible;';
    measureProperties.forEach(function (name, index) { mirror.style[name] = values[index]; });
    mirror.style.width = width + 'px';
    mirror.style.whiteSpace = textarea.wrap === 'off' ? 'pre' : 'pre-wrap';
    if (textarea.wrap !== 'off') mirror.style.overflowWrap = style.overflowWrap === 'normal' ? 'break-word' : style.overflowWrap;
    var nodes = text.replace(/\r\n?/g, '\n').split('\n').map(function (line, index, lines) {
      var marker = root.document.createElement('span');
      marker.textContent = line || '\u200b';
      mirror.appendChild(marker);
      if (index < lines.length - 1) mirror.appendChild(root.document.createTextNode('\n'));
      return marker;
    });
    root.document.body.appendChild(mirror);
    var top = mirror.getBoundingClientRect().top;
    var offsets = nodes.map(function (node) { return node.getBoundingClientRect().top - top; });
    mirror.remove();
    sourceMeasurements.set(textarea, { text: text, signature: signature, offsets: offsets });
    return offsets;
  }

  function syncSource(textarea, line) {
    if (!textarea) return;
    var offsets = measureSource(textarea);
    if (!offsets || !offsets.length) return;
    var position = Math.max(0, Math.min(offsets.length - 1, finite(line, 1) - 1));
    var index = Math.floor(position), fraction = position - index;
    var top = offsets[index] + fraction * ((offsets[index + 1] || offsets[index]) - offsets[index]);
    textarea.scrollTop = Math.max(0, Math.min(textarea.scrollHeight - textarea.clientHeight, top - 24));
  }

  if (root.addEventListener) root.addEventListener('message', receive);
  if (root.document && root.document.fonts && root.document.fonts.addEventListener) {
    root.document.fonts.addEventListener('loadingdone', function () { sourceMeasurements = new WeakMap(); });
  }
  var api = { render: render, update: update, syncSource: syncSource, splitSlides: splitSlides };
  root.BlogPreview = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
