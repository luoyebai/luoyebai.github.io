/* 启动引导：主题元数据、页面级小增强 */
(function () {
  'use strict';

  /* 主题元数据（由生成器注入的 JSON） */
  var metaEl = document.getElementById('theme-meta');
  if (metaEl) {
    try {
      window.__THEMES__ = JSON.parse(metaEl.textContent || '{}');
    } catch (e) { window.__THEMES__ = {}; }
  } else {
    window.__THEMES__ = window.__THEMES__ || {};
  }

  /* 目录/搜索用的站点根路径 */
  var root = document.documentElement.getAttribute('data-root') || '';
  if (!document.documentElement.getAttribute('data-search-url')) {
    document.documentElement.setAttribute('data-search-url', root + '/search-index.json');
  }

  /* 外链标记 + 安全属性 */
  document.querySelectorAll('.prose a[href^="http"]').forEach(function (a) {
    if (a.hostname && a.hostname !== window.location.hostname) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });

  document.querySelectorAll('.mobile-toc a').forEach(function (a) {
    a.addEventListener('click', function () {
      a.closest('details').open = false;
    });
  });

  /* 代码块：滚动到横向溢出时加提示 */
  document.querySelectorAll('.code-pre').forEach(function (pre) {
    if (pre.scrollWidth > pre.clientWidth + 4) pre.classList.add('is-scrollable');
  });

  /* ---- 代码块折叠 ----------------------------------------------------
     默认策略：超过 24 行先收起来。长文里塞两屏代码，读者要滚很久才能
     翻过去，而多数时候他想先知道「这段在讲什么」再决定要不要看。 */
  var AUTO_FOLD = 24;
  document.querySelectorAll('.code-block[data-lines]').forEach(function (box) {
    var lines = parseInt(box.getAttribute('data-lines'), 10) || 0;
    var more = box.querySelector('.code-more');
    var foldBtn = box.querySelector('.code-fold');
    var pre = box.querySelector('.code-pre');

    /* 折叠要能动起来，就得知道「没折的时候有多高」：`max-height` 从 `auto`
       过渡到 `16.5em` 是不成立的（auto 不可插值），只能先把实际高度量下来写进
       `--code-h`。量的时候必须处于展开态 —— 折叠态量到的是被裁过的高度。 */
    function measure() {
      if (!pre || !pre.style) return;
      var was = box.classList.contains('is-folded');
      if (was) box.classList.remove('is-folded');
      var h = pre.scrollHeight;              /* scrollHeight 是内容高度，被裁过也准 */
      if (was) box.classList.add('is-folded');
      if (h > 0) pre.style.setProperty('--code-h', h + 'px');
    }
    measure();
    if (window.ResizeObserver) new ResizeObserver(measure).observe(pre);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    window.addEventListener('resize', measure, { passive: true });

    function apply(folded) {
      box.classList.toggle('is-folded', folded);
      if (more) {
        more.hidden = !folded;
        var lab = more.querySelector('[data-fold-more]');
        if (lab) lab.textContent = '展开全部 ' + lines + ' 行';
      }
      if (foldBtn) {
        foldBtn.setAttribute('aria-expanded', String(!folded));
        var t = foldBtn.querySelector('[data-fold-label]');
        if (t) t.textContent = folded ? '展开' : '收起';
      }
    }
    apply(lines > AUTO_FOLD);

    function toggle() {
      var folded = box.classList.contains('is-folded');
      if (!folded) measure();      // 收起前重量一次：这一量决定了收起动画从哪开始
      apply(!folded);
      if (folded) setTimeout(measure, 320);   // 展开之后补量一次（折叠期间内容可能被改过）
    }
    if (foldBtn) foldBtn.addEventListener('click', toggle);
    if (more) more.addEventListener('click', toggle);
  });

  /* ---- 目录折叠 ------------------------------------------------------
     两层折叠：
     1. **整块收起**（标题上的按钮）—— 长文读到一半想腾出侧栏；
     2. **分层收起**（每一节前面的小箭头）—— 只收起某一节的子树。
     收起整块之后要还能看到自己在哪一节，所以标题上留了当前小节的名字。 */
  var toc = document.querySelector('[data-toc]');
  if (toc) {
    var tocBtn = toc.querySelector('[data-toc-toggle]');
    var cur = toc.querySelector('[data-toc-current]');
    var TOC_KEY = 'luoyebai.toc.folded';
    var stored = null;
    try { stored = window.localStorage.getItem(TOC_KEY); } catch (e) { /* 隐私模式 */ }

    function setToc(folded, remember) {
      toc.classList.toggle('is-folded', folded);
      if (tocBtn) tocBtn.setAttribute('aria-expanded', String(!folded));
      if (remember) {
        try { window.localStorage.setItem(TOC_KEY, folded ? '1' : '0'); } catch (e) { /* 忽略 */ }
      }
    }
    setToc(stored === '1', false);
    if (tocBtn) {
      tocBtn.addEventListener('click', function () {
        setToc(!toc.classList.contains('is-folded'), true);
      });
    }

    /* 分层：每个带子节点的 <li> 前面有一个 .toc-node 按钮。
       事件委托挂在两个容器上 —— 侧栏一份、移动端 <details> 里还有一份，
       两边是同一份 HTML，各自独立折叠。 */
    document.querySelectorAll('.toc, .mobile-toc').forEach(function (box) {
      box.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-toc-node]');
        if (!btn) return;
        ev.preventDefault();
        var li = btn.closest('.toc-item');
        if (!li) return;
        var collapsed = li.classList.toggle('is-collapsed');
        btn.setAttribute('aria-expanded', String(!collapsed));
        btn.setAttribute('aria-label', collapsed ? '展开这一节' : '折叠这一节');
        // 刚刚收起的可能正是「你正在读的那一节」，立刻重算一次提示亮点，
        // 否则要等下一次滚动才亮
        markCurrent(toc.querySelector('a.is-active'));
      });
    });

    // 收起整块时标题上显示当前小节；展开时它被 CSS 隐藏，更新也无所谓
    var litNode = null;          // 当前点亮的那个箭头
    var markCurrent = function (a) {
      if (!a) return;
      var t = a.textContent.trim();
      if (cur && cur.textContent !== t) cur.textContent = t;
      // 当前小节落在收起的分支里时，给那个分支的箭头点个亮，
      // 否则读者会以为这一节的内容不见了。
      // 要连**它自己那一层**一起看：多数时候当前小节就是一个带子节点的 h2，
      // 收起的正是它自己（只往上找父级会漏掉这种最常见的情况）。
      var hit = null, li = a.closest('.toc-item');
      while (li && !hit) {
        if (li.classList.contains('has-kids') && li.classList.contains('is-collapsed')) {
          hit = li.querySelector(':scope > .toc-row > .toc-node');
        }
        li = li.parentElement ? li.parentElement.closest('.toc-item') : null;
      }
      /* 只在**确实变了**的时候动 DOM。
         这个函数是被监视 `.toc-item` class 的 MutationObserver 调起来的，
         原来无条件先 remove 再 add：remove 本身就产生一次 mutation，
         于是「观察者 -> markCurrent -> remove -> 观察者 -> …」无限循环，
         整个渲染进程卡死（探针那边表现为 CDP evaluate 一直超时）。 */
      if (litNode === hit) return;
      if (litNode) litNode.classList.remove('is-active-branch');
      litNode = hit;
      if (litNode) litNode.classList.add('is-active-branch');
    };
    markCurrent(toc.querySelector('a.is-active'));
    if (window.MutationObserver) {
      new MutationObserver(function () {
        markCurrent(toc.querySelector('a.is-active'));
      }).observe(toc, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  }

  /* ---- 正文图片：悬停放大 + 点击看原图 --------------------------------
     这批文章里全是界面截图和示意图，缩在正文宽度里小字根本看不清。
     悬停时放大一点，点击则开一层遮罩看原图。 */
  (function () {
    var list = [].slice.call(document.querySelectorAll('.prose img'));
    if (!list.length) return;
    list.forEach(function (img) {
      img.classList.add('is-zoomable');
      if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
    });

    var box = null, pic = null, cap = null, prevBtn = null, nextBtn = null;
    var count = null, opener = null, index = 0;
    var layers = null, top = 0, seq = 0;

    function build() {
      box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', '查看大图');
      box.innerHTML =
        '<button class="lightbox-close" type="button" aria-label="关闭（Esc）">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" ' +
        'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
        '<button class="lightbox-nav is-prev" type="button" data-lb-prev aria-label="上一张（←）">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<figure class="lightbox-figure"><span class="lightbox-stage">' +
        '<img alt=""><img alt="" aria-hidden="true"></span>' +
        '<figcaption></figcaption></figure>' +
        '<button class="lightbox-nav is-next" type="button" data-lb-next aria-label="下一张（→）">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<span class="lightbox-count" aria-live="polite"></span>';
      layers = [].slice.call(box.querySelectorAll('.lightbox-stage img'));
      pic = layers[0];
      cap = box.querySelector('figcaption');
      prevBtn = box.querySelector('[data-lb-prev]');
      nextBtn = box.querySelector('[data-lb-next]');
      count = box.querySelector('.lightbox-count');
      if (list.length < 2) {                       // 只有一张图就不摆上一张/下一张
        prevBtn.hidden = true;
        nextBtn.hidden = true;
        count.hidden = true;
      }
      box.addEventListener('click', function (e) {
        // 点图片本身不关（想细看时会点上去）；点控件也不关，只有点背景才关
        if (e.target === cap) return;
        if (e.target.tagName === 'IMG' && e.target.closest('.lightbox-stage')) return;
        if (e.target.closest && e.target.closest('.lightbox-close, .lightbox-nav, .lightbox-count')) return;
        close();
      });
      box.querySelector('.lightbox-close').addEventListener('click', close);
      prevBtn.addEventListener('click', function () { step(-1); });
      nextBtn.addEventListener('click', function () { step(1); });
      document.body.appendChild(box);
    }

    /* 换图走**两层轮流淡入淡出**。第一版是在同一个 <img> 上改 `src`：
       新图没解码完之前那一层是空的（旧图已经被替换掉了），连点「下一张」就是
       一下一下地闪；现在旧图留在下面撑住画面，新图 decode 完了再翻上来。 */
    function show(i, instant) {
      index = i;
      var img = list[i];
      opener = img;                                 // 关掉时焦点回到**当前**这张
      var text = (img.alt || '').trim();
      // alt 是「图片.png」这种文件名时，当说明文字反而添乱
      var useful = text && !/\.(png|jpe?g|webp|gif|svg)$/i.test(text);
      cap.textContent = useful ? text : '';
      cap.hidden = !useful;
      if (count) count.textContent = (i + 1) + ' / ' + list.length;
      // 到头就禁用，而不是绕回另一头：位置感更明确，也不会「跳」到别处
      prevBtn.disabled = (i === 0);
      nextBtn.disabled = (i === list.length - 1);

      var under = layers[top], over = layers[1 - top];
      var mine = ++seq;
      var reveal = function () {
        if (mine !== seq) return;                   // 连点的时候，旧的这一轮作废
        over.classList.add('is-in');
        under.classList.remove('is-in');
        over.setAttribute('aria-hidden', 'false');
        under.setAttribute('aria-hidden', 'true');
        top = 1 - top;
      };
      over.classList.remove('is-in');
      over.alt = useful ? text : '';
      if (instant) over.style.transition = 'none';
      over.src = img.currentSrc || img.src;
      if (over.decode) over.decode().then(reveal, reveal);
      else over.onload = reveal;
      if (instant) {
        window.requestAnimationFrame(function () { over.style.transition = ''; });
      }

      // 顺手预热相邻两张：连点「下一张」时不用每张都等一次下载
      [i - 1, i + 1].forEach(function (n) {
        if (n < 0 || n >= list.length) return;
        var pre = new Image();
        pre.src = list[n].currentSrc || list[n].src;
      });
    }

    function step(delta) {
      var next = index + delta;
      if (next < 0 || next >= list.length) return;
      show(next);
    }

    function open(img) {
      if (!box) build();
      var i = list.indexOf(img);
      show(i < 0 ? 0 : i, true);   // 打开时直接到位，别从空白淡进来
      box.classList.add('is-open');
      document.documentElement.classList.add('has-lightbox');
      var btn = box.querySelector('.lightbox-close');
      if (btn) btn.focus();
    }

    function close() {
      if (!box || !box.classList.contains('is-open')) return;
      box.classList.remove('is-open');
      document.documentElement.classList.remove('has-lightbox');
      seq++;
      layers.forEach(function (l) {
        l.removeAttribute('src');
        l.classList.remove('is-in');
      });
      top = 0;
      if (opener && opener.focus) opener.focus();
      opener = null;
    }

    document.addEventListener('click', function (e) {
      var img = e.target.closest && e.target.closest('.prose img.is-zoomable');
      if (!img) return;
      // 图片被包在链接里时，让链接先走（比如点击跳转的示意图）
      if (img.closest('a')) return;
      e.preventDefault();
      open(img);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); return; }
      if (!box || !box.classList.contains('is-open')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    });
    window.__lightbox = {
      open: open, close: close, next: function () { step(1); },
      prev: function () { step(-1); },
      index: function () { return index; }, total: list.length,
      isOpen: function () { return !!box && box.classList.contains('is-open'); }
    };
  })();

  /* 标题锚点平滑跳转（尊重动效开关） */
  document.querySelectorAll('.heading-anchor').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var id = decodeURIComponent(a.getAttribute('href').slice(1));
      var t = document.getElementById(id);
      if (!t) return;
      ev.preventDefault();
      var smooth = document.documentElement.getAttribute('data-motion') !== 'off';
      t.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
      history.replaceState(null, '', '#' + id);
    });
  });
})();
