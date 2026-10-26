/* =========================================================================
   demo.js —— 文章里的「可运行示例」
   Markdown 写 ```js run（或 ```html run）即可，见 tools/mdparse.py。

   安全模型
   --------
   代码来自站点作者，不是访客输入，但仍在**沙箱 iframe** 里执行：
   sandbox="allow-scripts" 且**不给** allow-same-origin，
   于是 iframe 拿到的是一个唯一不透明源 —— 读不到站点 DOM / cookie / localStorage，
   也不能导航顶层窗口。父子之间只靠 postMessage 通信，并用随机 token +
   event.source 双重校验，防止别的 frame 伪造输出。

   为什么日志画在父页面
   --------------------
   console 输出由沙箱 postMessage 回来，在**父页面**渲染。好处：
   用站点自己的样式、可选中可复制、iframe 高度只服务于「渲染结果」，
   而且即使代码卡死，卡死之前产生的日志仍然留在页面上。

   死循环怎么办
   ------------
   同步死循环没法从外部打断（塞进 Worker 就会丢掉 DOM 能力）。
   iframe 不保证独立进程；定时器可运行时给出超时提示，
   父页面仍能响应时可点「重置」重建 iframe；否则可能需要关闭该标签页。
   ========================================================================= */
(function () {
  'use strict';

  var MAX_HEIGHT = 720;
  var MAX_LOG_LINES = 500;
  var BLOCKED_HINT_MS = 8000;
  var sessions = {};          // token -> { panel, frame }
  var panels = [];
  var activityObserver = null;
  var activityFrame = 0;

  function inViewport(panel) {
    var rect = panel.getBoundingClientRect();
    return rect.height > 0 && rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight &&
      rect.right > 0 && rect.left < window.innerWidth;
  }

  function sendActivity(state, force) {
    if (!state || !state.frame || !state.frame.contentWindow) return;
    var active = !document.hidden && state.visible;
    if (!force && state.lastActive === active) return;
    state.lastActive = active;
    state.frame.contentWindow.postMessage({ __demoToken: state.token, type: 'activity', payload: { active: active } }, '*');
  }

  function refreshActivity() {
    activityFrame = 0;
    panels.forEach(function (panel) {
      var state = panel.__demoState;
      if (!state) return;
      if (!activityObserver) state.visible = inViewport(panel);
      sendActivity(state);
    });
  }

  /* Serialized into the opaque child. It deliberately has no outer dependencies. */
  function animationRuntime(demo, token, send) {
    var loops = [];
    var parentActive = false;
    var disposed = false;

    function active() { return !disposed && parentActive && !document.hidden; }
    function stopFrame(loop) {
      if (loop.frame) cancelAnimationFrame(loop.frame);
      loop.frame = 0;
      loop.previous = null;
    }
    function schedule(loop) {
      if (!loop.frame && loop.playing && active()) loop.frame = requestAnimationFrame(loop.tick);
    }
    function sync() {
      loops.forEach(function (loop) {
        if (active()) schedule(loop);
        else stopFrame(loop);
      });
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      loops.forEach(function (loop) { loop.playing = false; stopFrame(loop); });
      loops.length = 0;
    }
    demo.animate = function (callback) {
      if (typeof callback !== 'function') throw new TypeError('demo.animate 需要一个回调函数');
      var loop = { playing: false, frame: 0, previous: null, elapsed: 0 };
      var api = {
        start: function () {
          if (disposed) return api;
          if (!loop.playing) loop.previous = null;
          loop.playing = true;
          schedule(loop);
          return api;
        },
        pause: function () { loop.playing = false; stopFrame(loop); return api; },
        reset: function () { api.pause(); loop.elapsed = 0; return api; },
        // A hidden panel retains the user's choice and resumes when visible.
        isRunning: function () { return loop.playing && !disposed; }
      };
      loop.tick = function (timestamp) {
        loop.frame = 0;
        if (!loop.playing || !active()) { loop.previous = null; return; }
        var delta = loop.previous === null ? 0 : Math.min(0.05, Math.max(0, (timestamp - loop.previous) / 1000));
        loop.previous = timestamp;
        loop.elapsed += delta;
        try {
          if (callback({ time: loop.elapsed, delta: delta }) === false) api.pause();
        } catch (error) {
          api.pause();
          send('error', { text: (error && (error.stack || error.message)) || String(error) });
        }
        schedule(loop);
      };
      loops.push(loop);
      return api;
    };
    window.addEventListener('message', function (event) {
      var message = event.data;
      if (event.source !== parent || !message || message.__demoToken !== token) return;
      if (message.type === 'dispose') { dispose(); return; }
      if (message.type !== 'activity') return;
      parentActive = !!(message.payload && message.payload.active === true);
      sync();
    });
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', dispose, { once: true });
  }

  /* ---------- 把站点的主题变量带进沙箱，让 demo 和站点同色 ---------- */
  function resolveColor(expr, fallback) {
    // 用一个探针元素把 color-mix() 之类解析成具体颜色值，
    // 因为要写进 iframe 的 <style>，必须是能直接用的字面量。
    var d = document.createElement('div');
    d.style.color = expr;
    d.style.display = 'none';
    document.body.appendChild(d);
    var v = getComputedStyle(d).color;
    d.remove();
    return v && v !== 'rgba(0, 0, 0, 0)' ? v : fallback;
  }

  function themeVars() {
    var cs = getComputedStyle(document.documentElement);
    var names = ['--accent', '--accent-2', '--accent-softer', '--text', '--text-2', '--text-3',
                 '--surface', '--surface-2', '--surface-3', '--border', '--border-2',
                 '--radius', '--radius-sm', '--font-mono', '--font-body',
                 '--ok', '--warn', '--danger'];
    var out = [];
    names.forEach(function (n) {
      var v = cs.getPropertyValue(n).trim();
      if (v) out.push(n + ':' + v);
    });
    // iframe 的透明背景各浏览器表现不一致（实测会画成白色，深色主题下很突兀），
    // 所以显式把面板底色算成具体颜色传进去。
    out.push('--demo-bg:' + resolveColor(
      'color-mix(in oklab, var(--surface) 82%, var(--bg))', '#14161d'));
    return ':root{' + out.join(';') + '}';
  }

  /* ---------- 沙箱文档 ----------
     payload 走 <script type="application/json">，并把 `<` 转义成 \u003c，
     这样源码里出现 </script> 也不会提前闭合标签。 */
  function sandboxDoc(payload, token, themeCss) {
    var json = JSON.stringify(payload).replace(/</g, '\\u003c');
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>' + themeCss +
      '*,*::before,*::after{box-sizing:border-box}' +
      'html,body{margin:0;background:var(--demo-bg,#14161d)}' +
      'body{font-family:var(--font-body,system-ui,sans-serif);font-size:14px;line-height:1.65;' +
      'color:var(--text,#e8e8ef);padding:14px 16px;word-break:break-word}' +
      '#demo-root:empty{display:none}' +
      'canvas,svg,video{max-width:100%;height:auto}' +
      'img{max-width:100%;height:auto}' +
      'button{font:inherit;color:inherit;cursor:pointer;min-height:36px;padding:.38em .9em;border-radius:8px;' +
      'background:var(--surface-2,rgba(255,255,255,.06));border:1px solid var(--border-2,rgba(255,255,255,.2))}' +
      'button:hover{border-color:var(--accent,#7aa2ff)}' +
      'button:disabled{cursor:default;opacity:.5}' +
      ':is(button,input,select,textarea,a):focus-visible{outline:2px solid var(--accent,#7aa2ff);outline-offset:3px}' +
      'input,select,textarea{font:inherit;color:inherit;padding:.28em .55em;border-radius:6px;' +
      'background:var(--surface-2,rgba(255,255,255,.06));border:1px solid var(--border-2,rgba(255,255,255,.2))}' +
      'input,select,textarea{max-width:100%}input[type="range"]{accent-color:var(--accent,#7aa2ff);min-height:28px;padding:0;cursor:pointer}' +
      'input[type="checkbox"],input[type="radio"]{accent-color:var(--accent,#7aa2ff)}' +
      'label{display:inline-flex;align-items:center;gap:.55em;flex-wrap:wrap}' +
      'fieldset{min-width:0;border:1px solid var(--border,rgba(255,255,255,.15));border-radius:10px}' +
      'output,.demo-readout{font-variant-numeric:tabular-nums;color:var(--accent-2,#7aa2ff)}' +
      '.demo-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0}' +
      'canvas{display:block;border-radius:10px;touch-action:pan-y}' +
      'a{color:var(--accent-2,#7aa2ff)}' +
      'h1,h2,h3,h4{margin:.8em 0 .4em;line-height:1.3}' +
      'table{border-collapse:collapse}td,th{border:1px solid var(--border,rgba(255,255,255,.15));padding:.3em .6em}' +
      '::-webkit-scrollbar{width:10px;height:10px}' +
      '::-webkit-scrollbar-thumb{background:var(--surface-3,rgba(255,255,255,.15));border-radius:99px}' +
      '</style></head><body>' +
      '<div id="demo-root"></div>' +
      '<script type="application/json" id="demo-payload">' + json + '<\/script>' +
      '<script>(function(){' +
      'var P=JSON.parse(document.getElementById("demo-payload").textContent);' +
      'var TOKEN=' + JSON.stringify(token) + ';' +
      'var root=document.getElementById("demo-root");' +
      'function send(t,p){try{parent.postMessage({__demoToken:TOKEN,type:t,payload:p||{}},"*");}catch(e){}}' +
      'function fmt(v,d){d=d||0;' +
      'if(typeof v==="string")return v;' +
      'if(v===null)return "null";if(v===undefined)return "undefined";' +
      'if(typeof v==="number"||typeof v==="boolean")return String(v);' +
      'if(typeof v==="function")return "ƒ "+(v.name||"anonymous")+"()";' +
      'if(v instanceof Error)return v.stack||(v.name+": "+v.message);' +
      'if(v&&v.nodeType)return "<"+(v.tagName||"node").toLowerCase()+">";' +
      'if(v&&typeof v.then==="function")return "Promise";' +
      'if(d>2)return Array.isArray(v)?"[…]":"{…}";' +
      'try{if(Array.isArray(v))return "["+v.slice(0,40).map(function(x){return fmt(x,d+1);}).join(", ")+' +
      '(v.length>40?", …":"")+"]";' +
      'if(typeof v==="object"){var k=Object.keys(v);' +
      'var b=k.slice(0,24).map(function(x){return x+": "+fmt(v[x],d+1);}).join(", ");' +
      'if(k.length>24)b+=", …";var c=v.constructor&&v.constructor.name;' +
      'return (c&&c!=="Object"?c+" ":"")+"{"+b+"}";}}catch(e){}' +
      'return String(v);}' +
      'function write(lv,args){send("log",{level:lv,text:Array.prototype.map.call(args,function(a){return fmt(a);}).join(" ")});}' +
      '["log","info","warn","error","debug"].forEach(function(k){' +
      'console[k]=function(){write(k==="debug"?"log":k,arguments);};});' +
      'var demo={root:root,log:function(){write("log",arguments);},warn:function(){write("warn",arguments);},' +
      'error:function(){write("error",arguments);},clear:function(){root.innerHTML="";send("clear");}};' +
      '(' + animationRuntime.toString() + ')(demo,TOKEN,send);' +
      'try{window.demo=demo;}catch(e){}' +
      'window.addEventListener("error",function(ev){' +
      'send("error",{text:(ev.message||"Script error")+(ev.lineno?"  (第 "+ev.lineno+" 行)":"")});});' +
      'window.addEventListener("unhandledrejection",function(ev){' +
      'send("error",{text:"未处理的 Promise 拒绝: "+fmt(ev.reason)});});' +
      'var lastH=-1;function measure(){' +
      // 只量内容容器的高度：它与 iframe 视口高度无关。
      // 千万不能用 documentElement.scrollHeight —— 那个值 >= 当前视口高度，
      // 再拿它去设 iframe 高度就成了正反馈，页面会每 400ms 长一点、无限被撑长。
      'var r=document.getElementById("demo-root");' +
      'var b=r.getBoundingClientRect();' +
      'var hasDom=r.children.length>0;' +
      'return {h:hasDom?Math.ceil(b.height+28):0,hasDom:hasDom};}' +
      'function report(){var m=measure();' +
      'if(m.h!==lastH){lastH=m.h;send("height",{h:m.h,hasDom:m.hasDom});}}' +
      'var resizeWatcher=null,resizeTimer=0;' +
      'if(window.ResizeObserver){try{resizeWatcher=new ResizeObserver(report);resizeWatcher.observe(root);}catch(e){if(resizeWatcher)resizeWatcher.disconnect();resizeWatcher=null;}}' +
      'if(!resizeWatcher)resizeTimer=setInterval(report,400);' +
      'function cleanupMeasure(){if(resizeWatcher)resizeWatcher.disconnect();if(resizeTimer)clearInterval(resizeTimer);resizeWatcher=null;resizeTimer=0;}' +
      'window.addEventListener("pagehide",cleanupMeasure,{once:true});' +
      'window.addEventListener("message",function(e){var d=e.data;if(e.source===parent&&d&&d.__demoToken===TOKEN&&d.type==="dispose")cleanupMeasure();});' +
      'send("start");' +
      'try{' +
      'if(P.lang==="html"){root.innerHTML=P.code;}' +
      'else{var s=document.createElement("script");s.textContent=P.code;document.body.appendChild(s);}' +
      'send("done",{ok:true});' +
      '}catch(err){send("error",{text:(err&&(err.stack||err.message))||String(err)});send("done",{ok:false});}' +
      'report();' +
      '})();<\/script></body></html>';
  }

  /* ---------- 单个面板 ---------- */
  function setupPanel(panel) {
    var srcEl = panel.querySelector('[data-demo-src]');
    var stage = panel.querySelector('[data-demo-stage]');
    var mountEl = panel.querySelector('[data-demo-mount]');
    var logEl = panel.querySelector('[data-demo-log]');
    var runBtn = panel.querySelector('[data-demo-run]');
    var runLabel = panel.querySelector('[data-demo-run-label]');
    var resetBtn = panel.querySelector('[data-demo-reset]');
    var statusEl = panel.querySelector('[data-demo-status]');
    var codeEl = panel.querySelector('[data-demo-code]');
    var toggleBtn = panel.querySelector('[data-demo-toggle]');
    var toggleLabel = panel.querySelector('[data-demo-toggle-label]');
    if (!srcEl || !mountEl || !runBtn) return;

    // 代码默认折叠：面板要突出的是「能跑」，源码按需展开
    if (toggleBtn && codeEl) {
      toggleBtn.addEventListener('click', function () {
        var open = codeEl.hidden;      // 当前是折叠状态 -> 这次要展开
        codeEl.hidden = !open;
        toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggleBtn.classList.toggle('is-open', open);
        if (toggleLabel) toggleLabel.textContent = open ? '收起代码' : '查看代码';
      });
    }

    var code = '';
    try { code = JSON.parse(srcEl.textContent || '""'); } catch (e) { code = ''; }
    if (typeof code !== 'string') code = '';
    var lang = panel.getAttribute('data-demo') || 'js';
    var lineCount = 0;

    var state = { frame: null, token: '', timer: null, done: false, visible: inViewport(panel), lastActive: null };

    function setStatus(text, cls) {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      statusEl.className = 'demo-status' + (cls ? ' is-' + cls : '');
    }

    function clearLog() {
      lineCount = 0;
      if (logEl) { logEl.innerHTML = ''; logEl.hidden = true; }
      panel.removeAttribute('data-demo-lines');
    }

    function teardown() {
      if (state.frame) {
        if (state.frame.contentWindow) state.frame.contentWindow.postMessage({ __demoToken: state.token, type: 'dispose' }, '*');
        if (sessions[state.token]) delete sessions[state.token];
        state.frame.remove();
        state.frame = null;
      }
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      state.token = '';
      state.done = false;
      state.lastActive = null;
    }

    function reset() {
      teardown();
      clearLog();
      stage.hidden = true;
      panel.classList.remove('is-running', 'is-done', 'is-error', 'is-blocked');
      runLabel.textContent = '运行';
      resetBtn.hidden = true;
      setStatus('');
    }

    function run() {
      teardown();
      clearLog();
      var token = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      state.token = token;

      var frame = document.createElement('iframe');
      frame.className = 'demo-frame';
      // 关键：只给 allow-scripts，**不给** allow-same-origin
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('title', '可运行示例的运行结果');
      frame.srcdoc = sandboxDoc({ lang: lang, code: code }, token, themeVars());
      state.frame = frame;
      sessions[token] = { panel: panel, frame: frame, state: state };
      frame.addEventListener('load', function () { if (state.frame === frame) sendActivity(state, true); });

      mountEl.innerHTML = '';
      mountEl.appendChild(frame);
      stage.hidden = false;
      state.visible = inViewport(panel);
      sendActivity(state, true);
      panel.classList.remove('is-done', 'is-error', 'is-blocked');
      panel.classList.add('is-running');
      runLabel.textContent = '重新运行';
      resetBtn.hidden = false;
      setStatus('运行中…');

      state.timer = setTimeout(function () {
        if (!state.done) {
          panel.classList.add('is-blocked');
          setStatus('代码可能陷入死循环，点「重置」可恢复', 'error');
        }
      }, BLOCKED_HINT_MS);
    }

    runBtn.addEventListener('click', run);
    resetBtn.addEventListener('click', reset);

    panel.__demoReset = reset;
    panel.__demoState = state;
    panels.push(panel);
    if (activityObserver) activityObserver.observe(panel);
    panel.__demoAppendLog = function (level, text) {
      if (!logEl || lineCount >= MAX_LOG_LINES) return;
      if (lineCount === 0) logEl.hidden = false;
      lineCount++;
      var d = document.createElement('div');
      d.className = 'demo-line is-' + level;
      d.textContent = text;
      logEl.appendChild(d);
      panel.setAttribute('data-demo-lines', String(lineCount));
      if (lineCount === MAX_LOG_LINES) {
        var more = document.createElement('div');
        more.className = 'demo-line is-muted';
        more.textContent = '…输出过多，已截断';
        logEl.appendChild(more);
      }
    };
  }

  /* ---------- 统一的消息接收（按 token 路由）---------- */
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d.__demoToken !== 'string') return;
    var s = sessions[d.__demoToken];
    if (!s) return;
    // 双重校验：token 之外，再确认来源就是那个 iframe 的 window
    if (!s.frame || ev.source !== s.frame.contentWindow) return;

    var panel = s.panel;
    var stage = panel.querySelector('[data-demo-stage]');
    var statusEl = panel.querySelector('[data-demo-status]');
    var frame = s.frame;

    if (d.type === 'start') {
      sendActivity(s.state, true);
      return;
    }

    if (d.type === 'height') {
      var p = d.payload || {};
      var h = Math.min(Math.max(0, p.h || 0), MAX_HEIGHT);
      // 没有 DOM 输出就把高度压到 0，别在结果区留一块空白。
      // 不加任何余量：加了就会和沙箱上报的高度形成正反馈（页面被越撑越长）。
      var target = p.hasDom ? h : 0;
      if (Math.abs((parseInt(frame.style.height, 10) || 0) - target) > 1) {
        frame.style.height = target + 'px';
      }
      if (stage) stage.hidden = false;
      return;
    }
    if (d.type === 'log') {
      if (panel.__demoAppendLog) {
        panel.__demoAppendLog((d.payload && d.payload.level) || 'log',
                              String((d.payload && d.payload.text) || ''));
      }
      return;
    }
    if (d.type === 'clear') {
      var logEl = panel.querySelector('[data-demo-log]');
      if (logEl) { logEl.innerHTML = ''; logEl.hidden = true; }
      return;
    }
    if (d.type === 'error') {
      panel.classList.add('is-error');
      if (statusEl) {
        statusEl.textContent = String((d.payload && d.payload.text) || '运行出错');
        statusEl.className = 'demo-status is-error';
      }
      return;
    }
    if (d.type === 'done') {
      var st = panel.__demoState;
      if (st) { st.done = true; if (st.timer) { clearTimeout(st.timer); st.timer = null; } }
      panel.classList.remove('is-running');
      panel.classList.add(d.payload && d.payload.ok ? 'is-done' : 'is-error');
      // 出错时不要用「运行完成」盖掉上面的错误信息
      if (!panel.classList.contains('is-error') && statusEl) {
        statusEl.textContent = '运行完成';
        statusEl.className = 'demo-status is-done';
      }
    }
  });

  function boot() {
    if (window.IntersectionObserver) {
      activityObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var state = entry.target.__demoState;
          if (!state) return;
          state.visible = entry.isIntersecting && entry.intersectionRatio > 0;
          sendActivity(state);
        });
      }, { threshold: [0, 0.01] });
    } else {
      var scheduleActivity = function () {
        if (!activityFrame) activityFrame = requestAnimationFrame(refreshActivity);
      };
      document.addEventListener('scroll', scheduleActivity, { passive: true, capture: true });
      window.addEventListener('resize', scheduleActivity, { passive: true });
    }
    document.querySelectorAll('.demo[data-demo]').forEach(setupPanel);
    document.addEventListener('visibilitychange', refreshActivity);
    window.addEventListener('pagehide', function () {
      panels.forEach(function (panel) { if (panel.__demoReset) panel.__demoReset(); });
      if (activityObserver) activityObserver.disconnect();
      if (activityFrame) cancelAnimationFrame(activityFrame);
    });
    window.addEventListener('pageshow', function (event) {
      if (!event.persisted) return;
      if (activityObserver) panels.forEach(function (panel) { activityObserver.observe(panel); });
      refreshActivity();
    });
    // 换主题后沙箱里内联的配色就过期了，直接复位，避免颜色对不上
    if (window.Theme && Theme.onChange) {
      Theme.onChange(function () {
        document.querySelectorAll('.demo[data-demo]').forEach(function (p) {
          if (p.__demoReset) p.__demoReset();
        });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
