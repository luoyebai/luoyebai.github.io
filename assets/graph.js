(function () {
  'use strict';
  var stage = document.getElementById('graph-stage');
  if (!stage) return;
  if (!(window.CSS && CSS.supports && CSS.supports('transform-style', 'preserve-3d'))) return;
  var world = document.getElementById('graph-world');
  var canvas = document.getElementById('graph-canvas');
  var linkCanvas = document.getElementById('graph-links');
  var labelBox = document.getElementById('graph-labels');
  var statusEl = document.getElementById('graph-status');
  var hintEl = document.getElementById('graph-hint');
  var qEl = document.getElementById('graph-q');
  var autoBtn = document.getElementById('graph-auto');
  var resetBtn = document.getElementById('graph-reset');
  var layoutBox = document.getElementById('graph-layout');
  var legendBox = document.getElementById('graph-legend');
  var ctx = canvas.getContext('2d');
  var lctx = linkCanvas ? linkCanvas.getContext('2d') : ctx;
  var root = document.documentElement;
  var BASE_F = 1500;          
  var R = 900;                
  var CARD_W = 250, CARD_H = 330, CARD_GAP = 34;
  var ROW_GAP = CARD_H + 28;
  var NEB_R = 560, NEB_DIST = -780, NEB_SQUASH = 0.66;
  var FLOOR_Y = 620, FLOOR_HALF = 1700, FLOOR_STEP = 150;
  var PITCH_MAX = 0.72;
  var DUST = 150;
  var TAU = Math.PI * 2;
  var HINT = '拖动书脊把书抽出来 · 松手归位 · 拖空白处转书架';
  var state = { layout: 'shelf' };
  var shelfRows = [];         
  var shelfHeight = 900;      
  var cards = [], links = [], tagList = [], dust = [];
  var hover = null, focusTag = null, query = '';
  var autoPref = true, dragging = false, dragDist = 0, lastX = 0, lastY = 0, idle = 0;
  var dragId = null, captured = false;
  var DRAG_MIN = 6;           
  var PULL_K = 105, PULL_D = 11.2;
  var grabbing = null;        
  var grabVX = 0, grabVY = 0; 
  var grabOriginX = 0, grabOriginY = 0;   
  var grabT = 0;              
  var PULL_VMAX = 6000;       
  var raf = 0, lastT = 0, W = 0, H = 0, DPR = 1, live = false, cachedPersp = '', cachedWorldT = '';
  var worldDY = 0;            
  var CX = 0, CY = 0;         
  var C = null;
  var view = { yaw: 0.0, pitch: -0.04, zoom: 1 };
  var goal = { yaw: 0.0, pitch: -0.04, zoom: 1 };
  var pal = {};
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  function toRgb(c) {
    if (!c) return null;
    c = String(c).trim();
    var m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    var m2 = c.match(/^rgba?\(([^)]+)\)$/i);
    if (m2) {
      var p = m2[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
      if (p.length >= 3) return [p[0], p[1], p[2]];
    }
    return null;
  }
  function rgba(rgb, a) {
    var r = rgb || [140, 160, 200];
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    return 'rgba(' + r[0] + ',' + r[1] + ',' + r[2] + ',' + a.toFixed(3) + ')';
  }
  function readPalette() {
    var cs = getComputedStyle(root);
    function g(n, f) { return (cs.getPropertyValue(n) || '').trim() || f; }
    pal.bg = toRgb(g('--bg', '#0b0d14'));
    pal.accent = toRgb(g('--accent', '#7aa2ff'));
    pal.accent2 = toRgb(g('--accent-2', '#ff9d5c'));
    pal.text = toRgb(g('--text-3', '#8b93a7'));
    pal.surface = toRgb(g('--surface-2', '#1a1f2b'));
    var bright = (pal.bg[0] * 0.299 + pal.bg[1] * 0.587 + pal.bg[2] * 0.114) > 128;
    pal.shadow = bright ? pal.text : pal.bg;
  }
  function rowStep() { return (CARD_W + CARD_GAP) / R; }
  function makeCam() {
    var neb = state.layout === 'nebula';
    var f = BASE_F;
    var dist;
    var cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    if (neb) {
      dist = NEB_DIST / view.zoom;
    } else {
      var target = H * 0.92;
      var lo = -3600, hi = -80;
      for (var it = 0; it < 14; it++) {
        var mid = (lo + hi) / 2;
        var e0 = shelfExtent(mid, f, cp, sp, 0);
        if (e0.bot - e0.top > target) hi = mid; else lo = mid;
      }
      dist = ((lo + hi) / 2) / view.zoom;
      var kRef = scaleAt(0, R, dist, f, cp, sp);
      var dy = 0;
      for (var it2 = 0; it2 < 4; it2++) {
        var e1 = shelfExtent(dist, f, cp, sp, dy);
        var ctr = (e1.top + e1.bot) / 2;
        if (Math.abs(ctr) < 0.4) break;
        dy -= ctr / kRef;
      }
      worldDY = dy;
    }
    var mid = f - dist;                 
    return {
      cy: Math.cos(view.yaw), sy: Math.sin(view.yaw),
      cp: cp, sp: sp,
      f: f, dist: dist, neb: neb,
      near: mid - (neb ? NEB_R * 1.25 : R * 0.55),
      far: mid + (neb ? NEB_R * 1.05 : R * 1.15),
      cx: CX, cyy: CY, dy: neb ? 0 : worldDY,
      right: { x: Math.cos(view.yaw), y: 0, z: Math.sin(view.yaw) },
      up: {
        x: -Math.sin(view.pitch) * Math.sin(view.yaw),
        y: Math.cos(view.pitch),
        z: -Math.sin(view.pitch) * Math.cos(view.yaw)
      },
      fwd: {
        x: Math.cos(view.pitch) * Math.sin(view.yaw),
        y: -Math.sin(view.pitch),
        z: -Math.cos(view.pitch) * Math.cos(view.yaw)
      }
    };
  }
  function shelfExtent(dist, f, cp, sp, dy) {
    var cyw = Math.cos(view.yaw), syw = Math.sin(view.yaw);
    var hw = CARD_W / 2, hh = CARD_H / 2;
    var top = Infinity, bot = -Infinity;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i], q = c.pos;
      var cr = Math.cos(c.rotY), sr = Math.sin(c.rotY);
      for (var k = 0; k < 4; k++) {
        var lx = (k & 1) ? hw : -hw;
        var ly = (k & 2) ? hh : -hh;
        var wx = q.x + lx * cr;
        var wy = q.y + ly;
        var wz = q.z - lx * sr;
        var Z = -wx * syw + wz * cyw;
        var kk = f / (f - (wy * sp + Z * cp + dist));
        var yy = (wy * cp - Z * sp + dy) * kk;
        if (yy < top) top = yy;
        if (yy > bot) bot = yy;
      }
    }
    return { top: top, bot: bot };
  }
  function scaleAt(y, Z, dist, f, cp, sp) {
    return f / (f - (y * sp + Z * cp + dist));
  }
  function project(x, y, z, c, dy) {
    var X = x * c.cy + z * c.sy;
    var Z = -x * c.sy + z * c.cy;
    var Y2 = y * c.cp - Z * c.sp + (dy || 0);
    var Z2 = y * c.sp + Z * c.cp + c.dist;
    var k = c.f / (c.f - Z2);
    return { x: c.cx + X * k, y: c.cyy + Y2 * k, z: Z2, k: k };
  }
  function fog(z, c) {
    var d = c.f - z;                    
    var t = (d - c.near) / (c.far - c.near || 1);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }
  function camLocal(c) {
    var h = c.f - c.dist;
    var cp = Math.cos(view.pitch);
    return {
      x: -Math.sin(view.yaw) * cp * h,
      y: Math.sin(view.pitch) * h,
      z: Math.cos(view.yaw) * cp * h
    };
  }
  function colsMax() {
    var d = (CARD_W + CARD_GAP) / R;
    return Math.max(1, Math.floor(Math.PI / d) + 1);
  }
  function layoutShelf() {
    var flat = [], i;
    var byYear = {};
    for (i = 0; i < cards.length; i++) {
      var y = cards[i].node.year || '—';
      (byYear[y] = byYear[y] || []).push(cards[i]);
    }
    var years = Object.keys(byYear).sort().reverse();
    for (var r = 0; r < years.length; r++) {
      var list = byYear[years[r]];
      list.sort(function (a, b) {
        var ka = a.node.tags[0] || '', kb = b.node.tags[0] || '';
        if (ka !== kb) return ka < kb ? -1 : 1;
        return a.node.date < b.node.date ? 1 : -1;
      });
      flat = flat.concat(list);
    }
    var maxCols = colsMax();
    var step = (CARD_W + CARD_GAP) / R;
    var nRows = Math.max(1, Math.ceil(flat.length / maxCols));
    var per = Math.ceil(flat.length / nRows);
    shelfRows = [];
    for (var s = 0; s < flat.length; s += per) {
      shelfRows.push({ items: flat.slice(s, s + per), y: 0 });
    }
    var cursor = 0;
    for (var q = 0; q < shelfRows.length; q++) {
      if (q > 0) cursor += ROW_GAP;
      shelfRows[q].y = cursor;
    }
    var mid = cursor / 2;
    for (var m = 0; m < shelfRows.length; m++) shelfRows[m].y -= mid;
    shelfHeight = cursor + CARD_H;
    for (var a = 0; a < shelfRows.length; a++) {
      var row = shelfRows[a];
      var n = row.items.length;
      for (var k = 0; k < n; k++) {
        var c = row.items[k];
        var ang = (k - (n - 1) / 2) * step;
        c.pos = { x: R * Math.sin(ang), y: row.y, z: R * Math.cos(ang) };
        c.rotY = ang;
        c.normal = { x: Math.sin(ang), y: 0, z: Math.cos(ang) };
        c.billboard = false;
      }
    }
  }
  function layoutNebula() {
    var clusters = [], map = {}, i;
    for (i = 0; i < cards.length; i++) {
      var key = cards[i].node.tags[0] || '其他';
      if (!map[key]) { map[key] = { key: key, items: [] }; clusters.push(map[key]); }
      map[key].items.push(cards[i]);
    }
    clusters.sort(function (a, b) { return b.items.length - a.items.length; });
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var ci = 0; ci < clusters.length; ci++) {
      var cy0 = 1 - (ci + 0.5) * 2 / clusters.length;
      var rad = Math.sqrt(Math.max(0.0001, 1 - cy0 * cy0));
      var th = golden * ci + 0.6;
      var dir = { x: Math.cos(th) * rad, y: cy0, z: Math.sin(th) * rad };
      var items = clusters[ci].items;
      for (var j = 0; j < items.length; j++) {
        var a = (j / Math.max(1, items.length)) * TAU + ci * 1.7;
        var spread = 0.26 + 0.07 * (j % 3);
        var off = {
          x: dir.x * Math.cos(spread) + Math.sin(spread) * Math.cos(a) * dir.z,
          y: dir.y + Math.sin(spread) * Math.sin(a) * 0.8,
          z: dir.z * Math.cos(spread) - Math.sin(spread) * Math.cos(a) * dir.x
        };
        var L = Math.hypot(off.x, off.y, off.z) || 1;
        items[j].pos = {
          x: off.x / L * NEB_R,
          y: off.y / L * NEB_R * NEB_SQUASH,   
          z: off.z / L * NEB_R
        };
        items[j].rotY = 0;
        items[j].normal = { x: 0, y: 0, z: 1 };
        items[j].billboard = true;
        items[j].hs = 1;          
      }
    }
  }
  function relayout() {
    if (cards.length && cards[0].el.offsetWidth) {
      CARD_W = cards[0].el.offsetWidth;
      CARD_H = cards[0].el.offsetHeight;
    }
    if (state.layout === 'nebula') layoutNebula(); else layoutShelf();
    buildTagAnchors();
  }
  function buildTagAnchors() {
    var acc = {}, i, j;
    for (i = 0; i < cards.length; i++) {
      var c = cards[i];
      for (j = 0; j < c.node.tags.length; j++) {
        var t = c.node.tags[j];
        if (!acc[t]) acc[t] = { name: t, n: 0, x: 0, y: 0, z: 0, minY: Infinity };
        acc[t].n++;
        acc[t].x += c.pos.x; acc[t].y += c.pos.y; acc[t].z += c.pos.z;
        if (c.pos.y < acc[t].minY) acc[t].minY = c.pos.y;
      }
    }
    var out = [];
    for (var k in acc) {
      var a = acc[k];
      a.x /= a.n; a.y /= a.n; a.z /= a.n;
      if (state.layout === 'nebula') {
        var L = Math.hypot(a.x, a.y, a.z) || 1;
        var push = (NEB_R * 1.34) / L;
        a.x *= push; a.y *= push; a.z *= push;
      } else {
        var ang = Math.atan2(a.x, a.z);
        var rr = R * 1.2;
        a.x = rr * Math.sin(ang);
        a.z = rr * Math.cos(ang);
      }
      out.push(a);
    }
    out.sort(function (p, q) { return q.n - p.n; });
    tagList = out;
    syncTagLabels();
  }
  function syncTagLabels() {
    labelBox.textContent = '';
    for (var i = 0; i < tagList.length; i++) {
      if (tagList[i].n < 2) { tagList[i].el = null; continue; }
      var el = document.createElement('span');
      el.className = 'graph-label';
      el.textContent = tagList[i].name;
      var num = document.createElement('i');
      num.textContent = tagList[i].n;
      el.appendChild(num);
      el.style.display = 'none';
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'pointer';
      labelBox.appendChild(el);
      tagList[i].el = el;
    }
  }
  function buildLinks() {
    links = [];
    var i, j, a, b;
    for (i = 0; i < cards.length; i++) {
      cards[i].links = [];
      cards[i].rel = {};
    }
    for (i = 0; i < cards.length; i++) {
      var sa = cards[i].node.tags;
      for (j = i + 1; j < cards.length; j++) {
        var sb = cards[j].node.tags, shared = 0;
        for (a = 0; a < sa.length; a++) {
          for (b = 0; b < sb.length; b++) if (sa[a] === sb[b]) shared++;
        }
        if (shared) {
          var L = { a: cards[i], b: cards[j], w: shared };
          links.push(L);
          L.a.links.push(L);
          L.b.links.push(L);
          L.a.rel[L.b.node.id] = true;
          L.b.rel[L.a.node.id] = true;
        }
      }
    }
  }
  function isHot(c) { return hover === c || c.el === document.activeElement; }
  function isRel(c) { return !!(hover && hover.rel[c.node.id]); }
  function isMatch(c) {
    if (!query) return true;
    var q = query.toLowerCase();
    if (c.node.title.toLowerCase().indexOf(q) >= 0) return true;
    if ((c.node.summary || '').toLowerCase().indexOf(q) >= 0) return true;
    for (var i = 0; i < c.node.tags.length; i++) {
      if (c.node.tags[i].toLowerCase().indexOf(q) >= 0) return true;
    }
    return false;
  }
  function inTag(c) { return !focusTag || c.node.tags.indexOf(focusTag) >= 0; }
  function cruises() {
    return autoPref && !focusTag && !query && !hover && !dragging && !reduce.matches;
  }
  function resize() {
    var r = canvas.getBoundingClientRect();
    var w = Math.max(280, Math.round(r.width));
    var h = Math.max(220, Math.round(r.height));
    CX = r.width / 2;
    CY = r.height / 2;
    if (w === W && h === H) return false;
    W = w; H = h;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (linkCanvas && linkCanvas !== canvas) {
      linkCanvas.width = Math.round(W * DPR);
      linkCanvas.height = Math.round(H * DPR);
      lctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    return true;
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    var dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
    lastT = t;
    if (cruises()) {
      idle += dt;
      if (idle > 1.2) goal.yaw += dt * 0.07;
    }
    var ease = reduce.matches ? 1 : Math.min(1, dt * 7);
    view.yaw += (goal.yaw - view.yaw) * ease;
    view.pitch += (goal.pitch - view.pitch) * ease;
    view.zoom += (goal.zoom - view.zoom) * ease;
    C = makeCam();
    var persp = C.f.toFixed(1) + 'px';
    if (persp !== cachedPersp) { stage.style.perspective = persp; cachedPersp = persp; }
    var wt = 'translateY(' + worldDY.toFixed(2) + 'px) translateZ(' + C.dist.toFixed(1) +
      'px) rotateX(' + view.pitch.toFixed(5) + 'rad) rotateY(' + view.yaw.toFixed(5) + 'rad)';
    if (wt !== cachedWorldT) { world.style.transform = wt; cachedWorldT = wt; }
    drawSky();
    drawFloor();
    drawShelves();
    drawDust(dt);
    drawLinks();
    stepSprings(dt);        
    placeCards(dt);
    placeLabels();
    paintHud();
  }
  function placeCards(dt) {
    var cam = camLocal(C);
    var ease = dt ? Math.min(1, dt * 9) : 1;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i], p = c.pos;
      var fx = p.x, fy = p.y, fz = p.z;
      var pulled = 0;
      if (c.pull) {
        var pl = Math.hypot(c.pull.x, c.pull.y, c.pull.z);
        pulled = Math.min(1, pl / 150);          
        fx += c.pull.x; fy += c.pull.y; fz += c.pull.z;
      }
      var hs = c.hs || 1;
      if (hs !== 1) fy += (hs - 1) * CARD_H / 2;
      var pr = project(fx, fy, fz, C, C.dy);
      var vis;
      if (c.billboard) {
        var L = Math.hypot(p.x, p.y, p.z) || 1;
        var CL = Math.hypot(cam.x, cam.y, cam.z) || 1;
        vis = (p.x * cam.x + p.y * cam.y + p.z * cam.z) / (L * CL);
      } else {
        var X = p.x * C.cy + p.z * C.sy;
        var Z = -p.x * C.sy + p.z * C.cy;
        var Y2 = p.y * C.cp - Z * C.sp;
        var Z2 = p.y * C.sp + Z * C.cp + C.dist;
        var nx = c.normal.x * C.cy + c.normal.z * C.sy;
        var nz = -c.normal.x * C.sy + c.normal.z * C.cy;
        var ny = -nz * C.sp;
        nz = nz * C.cp;
        var vx = -X, vy = -Y2, vz = C.f - Z2;
        var vl = Math.hypot(vx, vy, vz) || 1;
        vis = (nx * vx + ny * vy + nz * vz) / vl;
      }
      var face = (vis - 0.02) / 0.26;
      face = face < 0 ? 0 : face > 1 ? 1 : face;
      var f = fog(pr.z, C);
      if (pulled > 0) { f *= (1 - pulled); face = Math.max(face, pulled); }
      var op = (1 - f * 0.86) * face;
      var hot = isHot(c), rel = isRel(c), match = isMatch(c), inside = inTag(c);
      var deemph = (query && !match) || !inside;
      if (deemph) op *= 0.16;
      else if (query || focusTag) op = Math.min(1, op * 1.45);
      if (hover && !hot && !rel && !pulled) op *= 0.34;
      c.sc += ((hot ? 1.07 : rel ? 1.025 : 1) - c.sc) * ease;
      var sc = c.sc * (1 + 0.07 * pulled);
      var t = 'translate3d(' + fx.toFixed(2) + 'px,' + fy.toFixed(2) + 'px,' + fz.toFixed(2) + 'px)';
      if (c.billboard) {
        t += ' rotateY(' + (-view.yaw).toFixed(5) + 'rad) rotateX(' + (-view.pitch).toFixed(5) + 'rad)';
      } else if (pulled > 0.001) {
        var rot = c.rotY + (-view.yaw - c.rotY) * pulled;
        t += ' rotateY(' + rot.toFixed(5) + 'rad) rotateX(' + (-view.pitch * pulled).toFixed(5) + 'rad)';
      } else {
        t += ' rotateY(' + c.rotY.toFixed(5) + 'rad)';
      }
      if (Math.abs(sc - 1) > 0.001 || hs !== 1) {
        t += ' scale(' + sc.toFixed(4) + ',' + (sc * hs).toFixed(4) + ')';
      }
      if (c.t !== t) { c.el.style.transform = t; c.t = t; }
      var o = op.toFixed(3);
      if (c.o !== o) {
        c.el.style.opacity = o;
        c.el.style.visibility = op < 0.02 ? 'hidden' : '';
        c.o = o;
      }
      var cls = 'gcard' + (c.node.archived ? ' is-archived' : '') +
        (hot ? ' is-hot' : '') + (rel ? ' is-rel' : '') + (deemph ? ' is-dim' : '') +
        (pulled > 0.02 ? ' is-pulled' : '');
      if (c.cls !== cls) { c.el.className = cls; c.cls = cls; }
      c.screen = pr;          
    }
  }
  function applyPull(c, dx, dy) {
    if (!c || !c.screen) return;
    var inv = 1 / Math.max(0.25, c.screen.k);
    var wx = (C.right.x * dx + C.up.x * -dy) * inv;
    var wy = (C.right.y * dx + C.up.y * -dy) * inv;
    var wz = (C.right.z * dx + C.up.z * -dy) * inv;
    var plan = Math.hypot(wx, wy, wz);
    var lift = Math.min(260, plan * 0.55 + 26);   
    c.pull = {
      x: wx + c.normal.x * lift,
      y: wy + c.normal.y * lift,
      z: wz + c.normal.z * lift
    };
  }
  function releasePull(c, vx, vy) {
    if (!c) return;
    var inv = 1 / Math.max(0.25, c.screen ? c.screen.k : 1);
    c.pv = {
      x: (C.right.x * vx + C.up.x * -vy) * inv,
      y: (C.right.y * vx + C.up.y * -vy) * inv,
      z: (C.right.z * vx + C.up.z * -vy) * inv
    };
  }
  function stepSprings(dt) {
    if (dt <= 0) return;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (!c.pull || c === grabbing) continue;
      var p = c.pull, v = c.pv || (c.pv = { x: 0, y: 0, z: 0 });
      v.x += (-PULL_K * p.x - PULL_D * v.x) * dt;
      v.y += (-PULL_K * p.y - PULL_D * v.y) * dt;
      v.z += (-PULL_K * p.z - PULL_D * v.z) * dt;
      p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
      if (Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) < 0.6 &&
          Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) < 0.4) {
        c.pull = null; c.pv = null;
      }
    }
  }
  function placeLabels() {
    for (var i = 0; i < tagList.length; i++) {
      var t = tagList[i];
      if (!t.el) continue;
      var pr = project(t.x, t.y, t.z, C, C.dy);
      var op = (1 - fog(pr.z, C) * 0.9) * (focusTag === t.name ? 1 : 0.8);
      if (pr.z < -60) op *= 0.42;
      if (op < 0.06) {
        if (t.el.style.display !== 'none') t.el.style.display = 'none';
        continue;
      }
      if (t.el.style.display === 'none') t.el.style.display = '';
      var s = Math.max(0.74, Math.min(1.1, pr.k));
      t.el.style.transform = 'translate3d(' + pr.x.toFixed(1) + 'px,' + pr.y.toFixed(1) +
        'px,0) translate(-50%,-50%) scale(' + s.toFixed(3) + ')';
      t.el.style.opacity = op.toFixed(3);
      var on = focusTag === t.name;
      if (on !== t.on) { t.el.classList.toggle('is-on', on); t.on = on; }
    }
  }
  function rowArc(y, rad, angHalf, steps) {
    var pts = [];
    for (var i = 0; i <= steps; i++) {
      var ang = (-0.5 + i / steps) * 2 * angHalf;
      pts.push(project(rad * Math.sin(ang), y, rad * Math.cos(ang), C, C.dy));
    }
    return pts;
  }
  function arcBandPath(top, bot) {
    var i;
    ctx.beginPath();
    for (i = 0; i < top.length; i++) {
      if (i) ctx.lineTo(top[i].x, top[i].y); else ctx.moveTo(top[i].x, top[i].y);
    }
    for (i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y);
    ctx.closePath();
  }
  function fillBand(top, bot, stops) {
    var i, y0 = Infinity, y1 = -Infinity;
    for (i = 0; i < top.length; i++) {
      if (top[i].y < y0) y0 = top[i].y;
      if (bot[i].y > y1) y1 = bot[i].y;
    }
    if (!(y1 > y0)) y1 = y0 + 1;
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    for (i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    arcBandPath(top, bot);
    ctx.fillStyle = g;
    ctx.fill();
  }
  function drawShelves() {
    if (state.layout !== 'shelf' || !shelfRows.length) return;
    var PLANK_T = 20, UNDER = 34, OVER = (CARD_W / 2 + 16) / R;
    for (var r = 0; r < shelfRows.length; r++) {
      var row = shelfRows[r];
      var n = row.items.length;
      var angHalf = ((n - 1) / 2) * rowStep() + OVER;
      var y0 = row.y + CARD_H / 2 + 2;
      var topBack = rowArc(y0, R - 34, angHalf, 46);
      var topFront = rowArc(y0, R + 26, angHalf, 46);
      var frontBot = rowArc(y0 + PLANK_T, R + 26, angHalf, 46);
      var under = rowArc(y0 + PLANK_T + UNDER, R + 26, angHalf, 46);
      fillBand(topBack, topFront, [
        [0, rgba(pal.surface, 0.62)],
        [0.55, rgba(pal.surface, 0.95)],
        [1, rgba(pal.accent, 0.46)]
      ]);
      fillBand(topFront, frontBot, [
        [0, rgba(pal.shadow, 0.72)],
        [0.22, rgba(pal.surface, 0.95)],
        [0.78, rgba(pal.surface, 0.72)],
        [1, rgba(pal.surface, 0.40)]
      ]);
      fillBand(frontBot, under, [
        [0, rgba(pal.shadow, 0.62)],
        [1, rgba(pal.shadow, 0)]
      ]);
      ctx.beginPath();
      for (var i = 0; i < topFront.length; i++) {
        if (i) ctx.lineTo(topFront[i].x, topFront[i].y);
        else ctx.moveTo(topFront[i].x, topFront[i].y);
      }
      ctx.strokeStyle = rgba(pal.accent, 0.34);
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
  }
  function drawSky() {
    ctx.clearRect(0, 0, W, H);
    var g = ctx.createRadialGradient(W / 2, H * 0.64, 0, W / 2, H * 0.64, Math.max(W, H) * 0.74);
    g.addColorStop(0, rgba(pal.accent, 0.11));
    g.addColorStop(0.46, rgba(pal.accent, 0.03));
    g.addColorStop(1, rgba(pal.bg, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    var pool = project(0, FLOOR_Y, 0, C);
    if (pool.z < C.f - 90) {
      var pr = Math.max(120, 1180 * pool.k);
      var pg = ctx.createRadialGradient(pool.x, pool.y, 0, pool.x, pool.y, pr);
      pg.addColorStop(0, rgba(pal.accent, 0.13));
      pg.addColorStop(0.42, rgba(pal.accent, 0.045));
      pg.addColorStop(1, rgba(pal.bg, 0));
      ctx.save();
      ctx.translate(pool.x, pool.y);
      ctx.scale(1, 0.34);                 
      ctx.translate(-pool.x, -pool.y);
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(pool.x, pool.y, pr, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  function drawFloor() {
    ctx.lineWidth = 1;
    var i, a, b, segs = [];
    for (i = -FLOOR_HALF; i <= FLOOR_HALF; i += FLOOR_STEP) {
      segs.push([i, -FLOOR_HALF, i, FLOOR_HALF]);
      segs.push([-FLOOR_HALF, i, FLOOR_HALF, i]);
    }
    for (var k = 0; k < segs.length; k++) {
      var s = segs[k];
      a = project(s[0], FLOOR_Y, s[1], C);
      b = project(s[2], FLOOR_Y, s[3], C);
      if (a.z > C.f - 90 || b.z > C.f - 90) continue;
      var da = Math.hypot(s[0], s[1]) / FLOOR_HALF;
      var db = Math.hypot(s[2], s[3]) / FLOOR_HALF;
      var edge = 1 - Math.max(da, db);
      edge = edge < 0 ? 0 : edge * edge;
      var alpha = 0.52 * edge * (1 - (fog(a.z, C) + fog(b.z, C)) * 0.5);
      if (alpha < 0.012) continue;
      ctx.strokeStyle = rgba(pal.accent, alpha);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  function drawDust(dt) {
    if (reduce.matches) dt = 0;
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i];
      if (dt) {
        d.y -= d.v * dt;
        d.a += dt * 0.16;
        if (d.y < -FLOOR_Y) d.y = FLOOR_Y;
      }
      var pr = project(d.r * Math.cos(d.a), d.y, d.r * Math.sin(d.a), C);
      if (pr.z > C.f - 130) continue;
      var op = (1 - fog(pr.z, C)) * d.s * 0.5;
      if (op < 0.03) continue;
      ctx.fillStyle = rgba(pal.text, op);
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, Math.max(0.6, 1.7 * pr.k * d.s), 0, TAU);
      ctx.fill();
    }
  }
  function drawLinks() {
    var active = hover;
    lctx.clearRect(0, 0, W, H);
    var dashOff = -(performance.now() / 42) % 10;
    for (var i = 0; i < links.length; i++) {
      var L = links[i];
      var on = active && (L.a === active || L.b === active);
      var base = active ? (on ? 0.62 + L.w * 0.14 : 0.018) : 0.055 + L.w * 0.016;
      if (base < 0.012) continue;
      var a = L.a.pos, b = L.b.pos;
      var ax = (a.x + b.x) * 0.5, az = (a.z + b.z) * 0.5;
      var rad = Math.hypot(ax, az);
      var bulge = 1 + 0.42 * Math.min(1, rad / R);
      var mx = ax * bulge, my = (a.y + b.y) * 0.5 + 34, mz = az * bulge;
      var steps = 14, prev = null;
      lctx.beginPath();
      for (var s = 0; s <= steps; s++) {
        var t = s / steps, u = 1 - t;
        var x = u * u * a.x + 2 * u * t * mx + t * t * b.x;
        var y = u * u * a.y + 2 * u * t * my + t * t * b.y;
        var z = u * u * a.z + 2 * u * t * mz + t * t * b.z;
        var pr = project(x, y, z, C, C.dy);
        if (pr.z > C.f - 90) { prev = null; continue; }
        if (prev) { lctx.moveTo(prev.x, prev.y); lctx.lineTo(pr.x, pr.y); }
        prev = pr;
      }
      lctx.strokeStyle = rgba(on ? pal.accent2 : pal.accent, base);
      lctx.lineWidth = on ? 1.4 + L.w * 0.22 : 1;
      if (on) {
        lctx.setLineDash([5, 5]);
        lctx.lineDashOffset = dashOff;
        lctx.shadowColor = rgba(pal.accent2, 0.5);
        lctx.shadowBlur = 8;
      }
      lctx.stroke();
      if (on) { lctx.setLineDash([]); lctx.shadowBlur = 0; }
    }
  }
  function paintHud() {
    if (!statusEl) return;
    var shown = 0;
    for (var i = 0; i < cards.length; i++) if (isMatch(cards[i]) && inTag(cards[i])) shown++;
    var deg = Math.round(((view.yaw * 180 / Math.PI) % 360 + 360) % 360);
    var txt = (state.layout === 'nebula' ? '星云' : '书架') + ' · <b>' + shown + '</b>/' +
      cards.length + ' 个节点 · 关系 ' + links.length + ' 条 · 视角 ' + deg + '°';
    if (focusTag) txt += ' · 标签 <b>' + focusTag + '</b>';
    else if (query) txt += ' · 搜索 “' + query + '”';
    if (statusEl.innerHTML !== txt) statusEl.innerHTML = txt;
  }
  function setHint(s) { if (hintEl && hintEl.textContent !== s) hintEl.textContent = s; }
  function cardOf(el) {
    for (var i = 0; i < cards.length; i++) if (cards[i].el === el) return cards[i];
    return null;
  }
  function findCard(el) {
    while (el && el !== stage) {
      if (el.classList && el.classList.contains('gcard')) return el;
      el = el.parentNode;
    }
    return null;
  }
  stage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    if (dragId !== null) return;
    dragDist = 0; dragId = e.pointerId; captured = false;
    lastX = e.clientX; lastY = e.clientY;
    idle = 0;
    grabVX = 0; grabVY = 0; grabT = 0;
    var el = findCard(e.target);
    var c = el ? cardOf(el) : null;
    if (c && state.layout === 'shelf') {
      grabbing = c;
      grabOriginX = e.clientX; grabOriginY = e.clientY;
      c.pv = { x: 0, y: 0, z: 0 };
      setHint('松手让它归位');
      if (stage.setAttribute) stage.setAttribute('data-cursor-label', '松手归位');
    } else {
      dragging = true;
    }
  });
  window.addEventListener('pointermove', function (e) {
    if (e.pointerId !== dragId) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    dragDist += Math.abs(dx) + Math.abs(dy);
    if (grabbing) {
      if (!captured && dragDist > DRAG_MIN) {
        captured = true;
        stage.classList.add('is-dragging');
        if (stage.setPointerCapture) { try { stage.setPointerCapture(dragId); } catch (err) {} }
        grabT = 0;
      }
      if (captured) {
        var now = performance.now();
        var span = grabT ? (now - grabT) / 1000 : 0;
        if (span > 0.001) {
          var fx = dx / span, fy = dy / span;
          var fm = Math.hypot(fx, fy);
          if (fm > PULL_VMAX) { fx = fx / fm * PULL_VMAX; fy = fy / fm * PULL_VMAX; }
          var k = Math.min(1, span / 0.09);
          grabVX = grabVX * (1 - k) + fx * k;
          grabVY = grabVY * (1 - k) + fy * k;
        }
        grabT = now;
        applyPull(grabbing, e.clientX - grabOriginX, e.clientY - grabOriginY);
      }
      idle = 0;
      return;
    }
    if (!dragging) return;
    if (!captured && dragDist > DRAG_MIN) {
      captured = true;
      stage.classList.add('is-dragging');
      if (stage.setPointerCapture) { try { stage.setPointerCapture(dragId); } catch (err) {} }
    }
    goal.yaw += dx * 0.0042 * view.zoom;
    goal.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, goal.pitch - dy * 0.0031));
    idle = 0;
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (captured) {
      try { stage.releasePointerCapture(dragId); } catch (err) {}
      captured = false;
    }
    dragId = null;
    stage.classList.remove('is-dragging');
  }
  function endGrab() {
    if (!grabbing) return;
    var c = grabbing;
    if (captured) {
      var stale = grabT && (performance.now() - grabT) > 120;
      releasePull(c, stale ? 0 : grabVX, stale ? 0 : grabVY);
      if (!c.pull || Math.hypot(c.pull.x, c.pull.y, c.pull.z) < 0.5) {
        c.pull = null; c.pv = null;
      }
    } else { c.pull = null; c.pv = null; }
    grabbing = null;
    if (stage.setAttribute) stage.setAttribute('data-cursor-label', '按住抽书');
    setHint(HINT);
    if (captured) {
      try { stage.releasePointerCapture(dragId); } catch (err) {}
    }
    captured = false;
    dragId = null;
    stage.classList.remove('is-dragging');
  }
  window.addEventListener('pointerup', function (e) {
    if (e.pointerId !== dragId) return;
    if (grabbing) endGrab(); else endDrag();
  });
  window.addEventListener('pointercancel', function (e) {
    if (e.pointerId !== dragId) return;
    if (grabbing) endGrab(); else endDrag();
  });
  stage.addEventListener('dragstart', function (e) { e.preventDefault(); });
  stage.addEventListener('pointerover', function (e) {
    var el = findCard(e.target);
    var c = el ? cardOf(el) : null;
    if (c !== hover) {
      hover = c;
      if (!grabbing) {
        setHint(c ? (state.layout === 'shelf' ? '按住把书抽出来 · 点击进入' : '点击进入') : HINT);
      }
      idle = 0;
    }
  });
  stage.addEventListener('pointerleave', function () { hover = null; setHint(HINT); });
  stage.addEventListener('click', function (e) {
    if (dragDist > DRAG_MIN) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    goal.zoom = Math.max(0.55, Math.min(1.75, goal.zoom * (e.deltaY > 0 ? 0.93 : 1.075)));
    idle = 0;
  }, { passive: false });
  window.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key, hit = true;
    if (k === 'ArrowLeft') goal.yaw += 0.17;
    else if (k === 'ArrowRight') goal.yaw -= 0.17;
    else if (k === 'ArrowUp') goal.pitch = Math.max(-PITCH_MAX, goal.pitch - 0.09);
    else if (k === 'ArrowDown') goal.pitch = Math.min(PITCH_MAX, goal.pitch + 0.09);
    else if (k === '+' || k === '=') goal.zoom = Math.min(1.75, goal.zoom * 1.1);
    else if (k === '-' || k === '_') goal.zoom = Math.max(0.55, goal.zoom * 0.9);
    else if (k === 'Escape') clearFocus();
    else if (k === 'r' || k === 'R') resetView();
    else hit = false;
    if (hit) { idle = 0; if (k.indexOf('Arrow') === 0) e.preventDefault(); }
  });
  function resetView() {
    goal.yaw = 0.0; goal.pitch = -0.04; goal.zoom = 1;
    clearFocus();
  }
  function clearFocus() {
    focusTag = null;
    query = '';
    if (qEl) qEl.value = '';
    syncLegend();
    syncAuto();
  }
  function syncAuto() {
    if (autoBtn) autoBtn.setAttribute('aria-pressed', autoPref ? 'true' : 'false');
  }
  function syncLegend() {
    if (!legendBox) return;
    var chips = legendBox.querySelectorAll('.graph-tag-chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('is-on', chips[i].getAttribute('data-tag') === focusTag);
    }
  }
  function focusOn(name) {
    focusTag = (focusTag === name) ? null : name;
    syncLegend();
    syncAuto();
    if (!focusTag) return;
    var sx = 0, sy = 0, n = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.node.tags.indexOf(focusTag) < 0) continue;
      sx += c.pos.x; sy += c.pos.y; n++;
    }
    if (!n) return;
    sx /= n; sy /= n;
    goal.yaw = -Math.atan2(sx, Math.sqrt(Math.max(1, NEB_R * NEB_R - sx * sx - sy * sy)));
    goal.pitch = state.layout === 'nebula' ? 0.02
      : Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.atan2(sy, R)));
  }
  if (qEl) {
    qEl.addEventListener('input', function () {
      query = qEl.value.trim();
      idle = 0;
    });
    qEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      for (var i = 0; i < cards.length; i++) {
        if (isMatch(cards[i]) && inTag(cards[i])) { window.location.href = cards[i].el.href; return; }
      }
    });
  }
  if (legendBox) {
    legendBox.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.graph-tag-chip') : null;
      if (chip) focusOn(chip.getAttribute('data-tag'));
    });
  }
  if (labelBox) {
    labelBox.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.graph-label') : null;
      if (!el) return;
      var name = (el.firstChild && el.firstChild.nodeValue ? el.firstChild.nodeValue : '').trim();
      if (name) focusOn(name);
    });
  }
  if (autoBtn) {
    autoBtn.addEventListener('click', function () {
      autoPref = !autoPref;
      idle = autoPref ? 1.2 : 0;
      syncAuto();
    });
  }
  if (resetBtn) resetBtn.addEventListener('click', resetView);
  if (layoutBox) {
    layoutBox.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-val]') : null;
      if (!b) return;
      var v = b.getAttribute('data-val');
      if (v === state.layout) return;
      state.layout = v;
      var kids = layoutBox.querySelectorAll('button');
      for (var i = 0; i < kids.length; i++) {
        var on = kids[i] === b;
        kids[i].classList.toggle('is-on', on);
        kids[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      relayout();
      goal.pitch = v === 'nebula' ? 0.02 : -0.04;
      goal.zoom = 1;
    });
  }
  if (window.MutationObserver) {
    new MutationObserver(readPalette).observe(root, {
      attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-glass']
    });
  }
  if (reduce.addEventListener) {
    reduce.addEventListener('change', function () { syncAuto(); });
  }
  function boot() {
    boot0('正在铺书架');
    bootP(22);
    var els = world.querySelectorAll('.gcard'), i;
    for (i = 0; i < els.length; i++) {
      (function (el, idx) {
        var tags = (el.getAttribute('data-tags') || '').split('|').filter(Boolean);
        var titleEl = el.querySelector('.gcard-title');
        var sumEl = el.querySelector('.gcard-sum');
        var card = {
          el: el,
          node: {
            id: el.getAttribute('data-kind') + ':' + idx,
            kind: el.getAttribute('data-kind'),
            year: el.getAttribute('data-year') || '',
            date: el.getAttribute('data-date') || '',
            title: titleEl ? titleEl.textContent : '',
            summary: sumEl ? sumEl.textContent : '',
            tags: tags,
            archived: el.classList.contains('is-archived')
          },
          hs: 1 + ((parseInt(el.getAttribute('data-cloth'), 10) || 1) - 1) * 0.013,
          pos: { x: 0, y: 0, z: 0 }, rotY: 0,
          normal: { x: 0, y: 0, z: 1 }, billboard: false,
          sc: 1, t: '', o: '', cls: 'gcard', links: [], rel: {}
        };
        cards.push(card);
        el.draggable = false;
        el.setAttribute('draggable', 'false');
        el.addEventListener('focus', function () { hover = card; idle = 0; });
        el.addEventListener('blur', function () { if (hover === card) hover = null; });
      }(els[i], i));
    }
    for (i = 0; i < DUST; i++) {
      dust.push({
        r: 200 + Math.random() * 880,
        y: (Math.random() - 0.5) * 900,
        a: Math.random() * TAU,
        v: 6 + Math.random() * 22,
        s: 0.4 + Math.random() * 0.9
      });
    }
    buildLinks();
    boot0('正在连线');
    bootP(52);
    readPalette();
    resize();
    relayout();
    bootP(78);
    stage.classList.add('is-live');
    live = true;
    syncAuto();
    lastT = 0;
    raf = requestAnimationFrame(function (t) {
      frame(t);
      boot0('书架就绪');
      bootP(100);
      if (window.__boot) window.__boot.done('graph');
    });
  }
  if (reduce.matches) autoPref = false;
  function boot0(text) {
    if (window.__boot) window.__boot.label('graph', text);
  }
  function bootP(p) {
    if (window.__boot) window.__boot.progress('graph', p);
  }
  function safeBoot() {
    try {
      boot();
    } catch (err) {
      window.__graphError = String((err && err.stack) || err);
      if (window.console && console.error) console.error('[graph]', err);
      root.classList.remove('js');
      if (window.__boot) window.__boot.done('graph');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeBoot);
  else safeBoot();
  window.__graph = {
    debug: function () {
      return {
        live: live,
        layout: state.layout,
        yaw: view.yaw, pitch: view.pitch, zoom: view.zoom,
        f: C ? C.f : 0, dist: C ? C.dist : 0,
        w: W, h: H, cx: CX, cy: CY,
        cyy: C ? C.cyy : CY,
        dy: worldDY,
        pullMax: cards.reduce(function(m,c){return c.pull?Math.max(m,Math.hypot(c.pull.x,c.pull.y,c.pull.z)):m;},0),
        pulling: cards.filter(function(c){return !!c.pull;}).length,
        ext: C && !C.neb ? shelfExtent(C.dist, C.f, C.cp, C.sp) : null,
        shelfHeight: shelfHeight,
        cardW: CARD_W, cardH: CARD_H,
        rows: shelfRows.length,
        ox: canvas.getBoundingClientRect().left,
        oy: canvas.getBoundingClientRect().top,
        auto: autoPref, dragging: dragging,
        grabbing: grabbing ? grabbing.node.id : null,
        captured: captured, dragId: dragId, dragDist: dragDist,
        focusTag: focusTag, query: query,
        baseF: BASE_F, R: R,
        cards: cards.map(function (c) {
          return {
            id: c.node.id, title: c.node.title, kind: c.node.kind,
            x: c.pos.x, y: c.pos.y, z: c.pos.z, rotY: c.rotY,
            pull: c.pull ? { x: c.pull.x, y: c.pull.y, z: c.pull.z } : null,
            pv: c.pv ? { x: c.pv.x, y: c.pv.y, z: c.pv.z } : null,
            normal: { x: c.normal.x, y: c.normal.y, z: c.normal.z },
            k: c.screen ? c.screen.k : null,
            billboard: c.billboard, tags: c.node.tags,
            opacity: c.el.style.opacity, cls: c.el.className,
            href: c.el.getAttribute('href')
          };
        }),
        links: links.length,
        labels: tagList.filter(function (t) { return !!t.el; }).length
      };
    },
    set: function (o) {
      if (o.yaw !== undefined) goal.yaw = view.yaw = o.yaw;
      if (o.pitch !== undefined) goal.pitch = view.pitch = o.pitch;
      if (o.zoom !== undefined) goal.zoom = view.zoom = o.zoom;
      C = makeCam();
      stage.style.perspective = C.f.toFixed(1) + 'px';
      world.style.transform = 'translateY(' + worldDY.toFixed(2) + 'px) translateZ(' +
        C.dist.toFixed(1) + 'px) rotateX(' +
        view.pitch.toFixed(5) + 'rad) rotateY(' + view.yaw.toFixed(5) + 'rad)';
      cachedPersp = '';
      cachedWorldT = '';
    }
  };
  function onResize() {
    if (!resize() || !live) return;
    relayout();
    if (!raf) { lastT = 0; raf = requestAnimationFrame(frame); }
  }
  if (window.ResizeObserver) {
    new ResizeObserver(onResize).observe(stage);
  } else {
    window.addEventListener('resize', onResize);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; }
    else if (!raf && live) { lastT = 0; raf = requestAnimationFrame(frame); }
  });
})();