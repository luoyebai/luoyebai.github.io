/* 数学公式渲染：把 .math-inline / .math-block 的 data-tex 交给 KaTeX。
   生成器已把 $..$ 预处理成带 data-tex 的占位元素，所以不能用 KaTeX 的
   auto-render（它靠扫描 $ 分隔符）。KaTeX 缺失时保留原始 TeX 文本作为降级。 */
(function () {
  'use strict';

  function renderAll() {
    var katex = window.katex;
    if (!katex) return;

    document.querySelectorAll('.math-inline, .math-block').forEach(function (el) {
      if (el.getAttribute('data-rendered')) return;
      var tex = el.getAttribute('data-tex');
      if (tex === null || tex === '') return;
      var display = el.classList.contains('math-block');
      try {
        katex.render(tex, el, {
          displayMode: display,
          throwOnError: false,
          strict: false,
          trust: false,
          output: 'html'
        });
        el.setAttribute('data-rendered', '1');
        el.classList.add('is-rendered');
      } catch (err) {
        /* 渲染失败则保留原始文本，便于阅读排查 */
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAll);
  } else {
    renderAll();
  }
  window.__renderMath = renderAll;
})();
