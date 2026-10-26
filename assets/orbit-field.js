(function () {
  'use strict';
  var canvas = document.getElementById('hero-orbit');
  if (!canvas) return;
  var stage = canvas.closest('.orbit-stage'), visual = canvas.closest('.orbit-visual');
  if (!stage || !visual) return;
  var root = document.documentElement, context;
  try { context = canvas.getContext('2d', {alpha: true}); } catch (ignore) {}
  var status = visual.querySelector('[data-orbit-status]');
  if (!context) {
    if (status) status.textContent = '运动轨道 · 当前浏览器显示静态图';
    return;
  }
  var buttons = visual.querySelectorAll('[data-orbit-mode]');
  var pauseButton = visual.querySelector('[data-orbit-pause]');
  var controls = visual.querySelector('[data-orbit-controls]');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var modes = ['signal', 'motion', 'policy'], mode = 'motion', weights = [0, 1, 0];
  var descriptions = ['信号相连 · 沿轨道传递每一次变化', '循迹而动 · 在空间中描绘动作', '探索与收敛 · 从变化中寻找秩序'];
  var colors = {}, glow, W = 0, H = 0, DPR = 1, radius = 1, cx = 0, cy = 0;
  var compact = false, segments = 144, paths = [[], [], []], ground = [];
  var time = 0, last = null, raf = 0, draws = 0, paused = false, visible = true;
  var px = 0, py = 0, tx = 0, ty = 0, pointer = null, pendingPointer = null;
  var interaction = {kind: 'idle', strength: 0, held: false, age: 0, tap: false};
  var spin = 0, targetSpin = 0, deformation = 0, bounds = null;
  var yawShift = 0;
  var camera = null, heroCamera = {turn: 0, scale: 1, dx: 0, dy: 0};
  var neutralCamera = {turn: 0, scale: 1, dx: 0, dy: 0};
  var heroLeave = 0;
  var debug = /[?&]motion-debug=1(?:&|$)/.test(window.location.search || '');
  var metrics = null, costs = [], intervals = [], metricAt = 0;
  var TAU = Math.PI * 2;
  var ignored = 'a,button,input,textarea,select,[contenteditable]';
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  var flowCanvas = document.getElementById('flow-field');
  var flowCtx = null;
  try { flowCtx = flowCanvas && flowCanvas.getContext ? flowCanvas.getContext('2d', {alpha: true}) : null; } catch (ignore) {}
  var flowW = 0, flowH = 0, flowDpr = 1;
  var flowVisible = false, flowChapters = [], flowCards = [], flowRows = [];
  var flowDots = {x: 0, y: 0}, flowBridge = null;
  var leanX = 0, leanY = 0, leanTX = 0, leanTY = 0;
  function readStep(el, name) {
    var v = parseFloat(el.style.getPropertyValue(name));
    return isFinite(v) ? v : 0;
  }
  function measureFlow() {
    if (!flowCtx) return;
    flowChapters = [].slice.call(document.querySelectorAll('.home-flow [data-scroll-chapter]'))
      .filter(function (el) { return !el.hidden && el.offsetParent !== null; });
    flowCards = [].slice.call(document.querySelectorAll(
      '.home-flow .direction-card, .home-flow .lab-invitation, .home-flow .card'));
    flowRows = [].slice.call(document.querySelectorAll('.home-flow .latest-entry'));
    flowBridge = document.querySelector('.page-home .flow-bridge a');
    var pills = [].slice.call(document.querySelectorAll('.home-flow .tag-cloud .tag-pill'));
    pills.forEach(function (pill, index) {
      pill.style.setProperty('--d', (pills.length > 1 ? index / (pills.length - 1) * .38 : 0).toFixed(3));
    });
    var w = Math.max(320, window.innerWidth || 320);
    var h = Math.max(280, window.innerHeight || 280);
    var ratio = Math.min(compact ? 1.25 : 2, window.devicePixelRatio || 1);
    if (w === flowW && h === flowH && ratio === flowDpr) return;
    flowW = w; flowH = h; flowDpr = ratio;
    flowCanvas.width = Math.round(w * ratio);
    flowCanvas.height = Math.round(h * ratio);
  }
  function flowDot(context, x, y, r, color, alpha) {
    context.globalAlpha = alpha; context.fillStyle = color;
    context.beginPath(); context.arc(x, y, r, 0, TAU); context.fill();
  }
  function traceHead(el, rv, out) {
    var r = el.getBoundingClientRect();
    var e1 = clamp((rv - .03) * 5, 0, 1), e2 = clamp((rv - .22) * 5, 0, 1);
    var e3 = clamp((rv - .41) * 5, 0, 1), e4 = clamp((rv - .60) * 5, 0, 1);
    if (e1 < 1) { out.x = r.left + r.width * e1; out.y = r.top; return true; }
    if (e2 < 1) { out.x = r.right; out.y = r.top + r.height * e2; return true; }
    if (e3 < 1) { out.x = r.right - r.width * e3; out.y = r.bottom; return true; }
    if (e4 < 1) { out.x = r.left; out.y = r.bottom - r.height * e4; return true; }
    return false;
  }
  function drawAmbient(alpha) {
    if (alpha <= .012 || !flowCtx) return;
    var saveX = cx, saveY = cy, saveR = radius, saveShift = yawShift, saveCam = camera;
    var savePX = px, savePY = py;
    camera = neutralCamera;
    radius = Math.max(flowW * .58, flowH * .95);
    cx = flowW * .68; cy = flowH * .30;
    yawShift = -(window.pageYOffset || 0) * .00055;
    px = leanX * .55; py = leanY * .55;
    var steps = compact ? 64 : 120;
    for (var i = 0; i < 3; i++) {
      var a0 = time * (.055 + i * .012) + i * 2.1;
      flowCtx.beginPath();
      for (var n = 0; n <= steps; n++) {
        point(i, a0 + n / steps * TAU, temp);
        if (n === 0) flowCtx.moveTo(temp.x, temp.y); else flowCtx.lineTo(temp.x, temp.y);
      }
      flowCtx.strokeStyle = pathColor(i);
      flowCtx.globalAlpha = alpha * (i === 2 ? .5 : .85);
      flowCtx.lineWidth = 1;
      flowCtx.stroke();
      for (var k = 0; k < 5; k++) {
        point(i, a0 + (k + .4) * TAU / 5, temp);
        flowDot(flowCtx, temp.x, temp.y, 1.5, pathColor(i), alpha * (i === 2 ? .5 : .95));
      }
    }
    cx = saveX; cy = saveY; radius = saveR; yawShift = saveShift;
    px = savePX; py = savePY;
    camera = saveCam;
    flowCtx.globalAlpha = 1;
  }
  function drawFlow() {
    if (!flowCtx || !flowW || !flowH) return;
    var context2 = flowCtx;
    context2.setTransform(flowDpr, 0, 0, flowDpr, 0, 0);
    context2.clearRect(0, 0, flowW, flowH);
    if (staticMode() || !flowVisible || document.hidden) return;
    var vh = flowH;
    context2.lineCap = 'round'; context2.lineJoin = 'round';
    var ambient = bounds ? clamp((vh * .60 - bounds.bottom) / (vh * .70), 0, 1) : 0;
    if (ambient > .01) drawAmbient(ambient * (colors.light ? .12 : .19));
    if (flowW <= 700) return;
    var bridgeRect = flowBridge ? flowBridge.getBoundingClientRect() : null;
    var bridgeMid = bridgeRect && bridgeRect.height > 0 ? bridgeRect.top + bridgeRect.height / 2 : null;
    for (var ci = 0; ci < flowChapters.length; ci++) {
      var el = flowChapters[ci];
      var r = el.getBoundingClientRect();
      if (r.bottom < -80 || r.top > vh + 80) continue;
      var enter = readStep(el, '--chapter-enter');
      var progress = readStep(el, '--chapter-progress');
      var railX = Math.round(r.left + 24) + .5;    
      var top = Math.max(r.top, -40);
      var bottom = Math.min(r.bottom, vh + 40);
      var bridgeY = null;
      if (ci === 0 && bridgeMid !== null && bridgeMid > -60 && bridgeMid < vh + 60) {
        bridgeY = bridgeMid;
        if (bridgeY < top) top = Math.max(bridgeY, -40);
      }
      if (bottom - top < 2) continue;
      var headY = r.top + (r.bottom - r.top) * progress;
      var headClamped = clamp(headY, top, bottom);
      if (enter > .2) {
        var bands = el.querySelectorAll('.direction-card, .lab-invitation, .card, .latest-entry, .tag-cloud');
        var bandTops = [];
        for (var bi = 0; bi < bands.length; bi++) {
          var bandRect = bands[bi].getBoundingClientRect();
          if (bandRect.width < 60 || bandRect.bottom < -20 || bandRect.top > vh + 20) continue;
          var dupRow = false;
          for (var bj = 0; bj < bandTops.length; bj++) {
            if (Math.abs(bandTops[bj] - bandRect.top) < 6) { dupRow = true; break; }
          }
          if (dupRow) continue;
          bandTops.push(bandRect.top);
          var bandRv = readStep(bands[bi], '--rv');
          if (bandRv < .1) continue;
          context2.globalAlpha = (.09 + .15 * bandRv) * enter;
          context2.strokeStyle = colors.muted; context2.lineWidth = 1;
          context2.beginPath();
          context2.moveTo(railX + .5, bandRect.top + .5);
          context2.lineTo(railX + 6.5, bandRect.top + .5);
          context2.stroke();
        }
      }
      if (progress > .02 && progress < .995 && enter > .02) {
        var tone = ci % 2 ? colors.warm : colors.accent;
        var tail = 18 + 10 * Math.sin(time * .9 + ci * 1.7);
        context2.globalAlpha = .5 * enter;
        context2.strokeStyle = tone; context2.lineWidth = 1.5;
        context2.beginPath();
        context2.moveTo(railX, Math.max(top, headClamped - tail));
        context2.lineTo(railX, headClamped);
        context2.stroke();
        flowDot(context2, railX, headClamped, 7, tone, .13 * enter);
        flowDot(context2, railX, headClamped, 2.6, tone, .85 * enter);
        flowDot(context2, railX, headClamped, .9, colors.bg, .9 * enter);
      }
      if (ci === 0 && bridgeY !== null && bridgeRect) {
        var brEnter = clamp((vh * .55 - bridgeRect.top) / 200, 0, 1);
        context2.globalAlpha = .22 + .5 * brEnter;
        context2.strokeStyle = colors.accent; context2.lineWidth = 1;
        context2.beginPath(); context2.arc(railX, bridgeY, 4.6, 0, TAU); context2.stroke();
        flowDot(context2, railX, bridgeY, 1.6, colors.accent, .3 + .55 * brEnter);
        context2.globalAlpha = .26 + .34 * brEnter;
        context2.beginPath();
        context2.moveTo(railX + 5, bridgeY); context2.lineTo(bridgeRect.left, bridgeY); context2.stroke();
        var railStart = r.top + 35;
        if (railStart > bridgeY + 6) {
          var seamLine = context2.createLinearGradient(0, bridgeY, 0, railStart);
          seamLine.addColorStop(0, colors.accent);
          seamLine.addColorStop(1, colors.muted);
          context2.globalAlpha = .3 + .35 * brEnter;
          context2.strokeStyle = seamLine;
          context2.beginPath(); context2.moveTo(railX, bridgeY + 5.5); context2.lineTo(railX, railStart); context2.stroke();
        }
      }
      var cap = el.querySelector('.flow-caption');
      if (cap) {
        var cr = cap.getBoundingClientRect();
        var capY = cr.top + cr.height / 2;
        if (capY > -20 && capY < vh + 20) {
          if (enter > .04) {
            context2.globalAlpha = .16 + .3 * enter;
            context2.strokeStyle = colors.accent; context2.lineWidth = 1;
            context2.beginPath();
            context2.moveTo(railX + 5, capY); context2.lineTo(cr.left, capY); context2.stroke();
          }
          flowDot(context2, railX, capY, 4.4, colors.accent, .18 + enter * .5);
          flowDot(context2, railX, capY, 1.7, colors.accent, .35 + enter * .6);
          if (progress > .02 && progress < .985) {
            var wave = (time * .55 + ci * .37) % 1;
            context2.globalAlpha = (1 - wave) * .2 * enter;
            context2.strokeStyle = colors.accent; context2.lineWidth = .9;
            context2.beginPath(); context2.arc(railX, capY, 4.4 + wave * 14, 0, TAU); context2.stroke();
          }
        }
      }
    }
    for (var k = 0; k < flowCards.length; k++) {
      var card = flowCards[k];
      var rv = readStep(card, '--rv');
      if (!(rv > .03 && rv < .999)) continue;
      var rect = card.getBoundingClientRect();
      if (rect.bottom < -40 || rect.top > vh + 40) continue;
      if (rect.width < 40 || rect.height < 40) continue;
      if (!traceHead(card, rv, flowDots)) continue;
      var glowX = flowDots.x, glowY = flowDots.y;
      flowDot(context2, glowX, glowY, 9, colors.warm, .12);
      flowDot(context2, glowX, glowY, 3.4, colors.warm, .42);
      flowDot(context2, glowX, glowY, 1.5, colors.text, .95);
    }
    for (var ri = 0; ri < flowRows.length; ri++) {
      var row = flowRows[ri];
      var rrv = readStep(row, '--rv');
      if (!(rrv > .05 && rrv < .995)) continue;
      var rr = row.getBoundingClientRect();
      if (rr.bottom < -20 || rr.top > vh + 20 || rr.width < 80) continue;
      var hx = rr.left + rr.width * rrv, hy = rr.top;
      context2.globalAlpha = .26 * (1 - rrv * .35);
      context2.strokeStyle = colors.accent; context2.lineWidth = 1.2;
      context2.beginPath();
      context2.moveTo(Math.max(rr.left, hx - Math.min(120, rr.width * .3)), hy);
      context2.lineTo(hx, hy); context2.stroke();
      flowDot(context2, hx, hy, 7, colors.accent, .10);
      flowDot(context2, hx, hy, 2.2, colors.text, .8);
    }
    if (bounds && flowChapters.length) {
      var first = flowChapters[0].getBoundingClientRect();
      var firstRailX = Math.round(first.left + 24) + .5;
      var startX = bounds.left + bounds.width * .70;
      var startY = bounds.bottom - 6;              
      var endX = firstRailX;
      var endY = first.top + 6;                    
      if (flowBridge) {                            
        var bn = flowBridge.getBoundingClientRect();
        if (bn.height > 0) endY = bn.top + bn.height / 2;
      }
      if (startY > -40 && startY < vh + 20 && endY > -20 && endY < vh + 80 && startY < endY) {
        var fade = clamp((vh - Math.max(startY, 0)) / 220, 0, 1);
        var midY = startY + (endY - startY) * .55;
        var c1x = startX - 30, c2x = endX + 70;
        var lanes = [[5, 0], [0, 1], [-5, 2]];
        for (var li = 0; li < lanes.length; li++) {
          var off = lanes[li][0];
          context2.strokeStyle = pathColor(lanes[li][1]); context2.lineWidth = 1;
          context2.globalAlpha = (li === 1 ? .13 : .09) + (li === 1 ? .15 : .09) * fade;
          context2.beginPath();
          context2.moveTo(startX, startY + off);
          context2.bezierCurveTo(c1x, midY + off, c2x, midY, endX, endY);
          context2.stroke();
        }
        var cycle = 3.4;
        for (var d = 0; d < lanes.length; d++) {
          var tt = (time / cycle + d / 3) % 1, u = 1 - tt, laneOff = lanes[d][0];
          var bx = u*u*u*startX + 3*u*u*tt*c1x + 3*u*tt*tt*c2x + tt*tt*tt*endX;
          var by = u*u*u*(startY + laneOff) + 3*u*u*tt*(midY + laneOff) + 3*u*tt*tt*midY + tt*tt*tt*endY;
          var life = Math.min(1, tt * 5) * Math.min(1, (1 - tt) * 5) * fade;
          if (life > .02) {
            flowDot(context2, bx, by, 7, pathColor(d), .13 * life);
            flowDot(context2, bx, by, 2.4, pathColor(d), .9 * life);
            flowDot(context2, bx, by, 1, colors.text, .75 * life);
          }
        }
        var pa = (time / cycle * 3) % 1;
        context2.globalAlpha = (1 - pa) * .26 * fade;
        context2.strokeStyle = pathColor(Math.floor(time / cycle * 3) % 3); context2.lineWidth = 1;
        context2.beginPath(); context2.arc(endX, endY, 4.6 + pa * 15, 0, TAU); context2.stroke();
      }
    }
    context2.globalAlpha = 1;
  }
  function ease(v, target, rate, dt) { return dt ? target + (v - target) * Math.exp(-rate * dt) : v; }
  function staticMode() { return paused || reduce.matches || root.getAttribute('data-motion') === 'off'; }
  function unavailable() { return staticMode() || document.hidden || (!visible && !flowVisible); }
  function palette() {
    var style = getComputedStyle(root);
    function color(name, fallback) { return style.getPropertyValue(name).trim() || fallback; }
    colors = {
      accent: color('--accent', '#67d6d1'), warm: color('--accent-2', '#e8b67c'),
      text: color('--text', '#e4edf5'), muted: color('--text-3', '#8291a5'),
      bg: color('--bg', '#101723'), light: root.getAttribute('data-mode') === 'light'
    };
    glow = document.createElement('canvas'); glow.width = glow.height = 192;
    var paint = glow.getContext('2d');
    if (paint) {
      var gradient = paint.createRadialGradient(96, 96, 0, 96, 96, 96);
      gradient.addColorStop(0, colors.accent); gradient.addColorStop(1, 'transparent');
      paint.fillStyle = gradient; paint.fillRect(0, 0, 192, 192);
    }
  }
  function resize() {
    bounds = stage.getBoundingClientRect();
    compact = root.getAttribute('data-performance') === 'compact';
    var width = Math.max(1, Math.round(bounds.width)), height = Math.max(1, Math.round(bounds.height));
    var ratio = Math.min(compact ? 1.25 : 2, window.devicePixelRatio || 1);
    var nextSegments = compact ? 96 : 144;
    if (width === W && height === H && ratio === DPR && segments === nextSegments) return;
    W = width; H = height; DPR = ratio;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    radius = Math.min(W * .335, H * .35); cx = W * .5; cy = H * .475;
    segments = nextSegments;
    paths.forEach(function (path) {
      path.length = 0;
      for (var i = 0; i <= segments; i++) path.push({x: 0, y: 0, z: 0});
    });
    ground.length = 0;
    for (var n = 0; n <= 80; n++) ground.push({x: 0, y: 0, z: 0});
    measureFlow();
    draw();
  }
  function project(x, y, z, out) {
    var cam = camera || neutralCamera;
    var yaw = -.48 + time * .065 + px * .24 + spin + yawShift + cam.turn;
    var pitch = .42 + py * .16, roll = -.12;
    var ax = x * Math.cos(yaw) + z * Math.sin(yaw);
    var az = -x * Math.sin(yaw) + z * Math.cos(yaw);
    var ay = y * Math.cos(pitch) - az * Math.sin(pitch);
    var depth = y * Math.sin(pitch) + az * Math.cos(pitch);
    var k = 4.8 / (4.8 + depth);
    var scale = (1 + deformation) * cam.scale;
    out.x = cx + cam.dx + (ax * Math.cos(roll) - ay * Math.sin(roll)) * radius * k * scale;
    out.y = cy + cam.dy - (ax * Math.sin(roll) + ay * Math.cos(roll)) * radius * k * scale;
    out.z = depth; return out;
  }
  var temp = {x: 0, y: 0, z: 0};
  function point(index, a, out) {
    var c = Math.cos(a), s = Math.sin(a), angle = [.10, 1.10, -.94][index];
    var mx = c * 1.12, my = s * .90 * Math.cos(angle), mz = s * .90 * Math.sin(angle);
    if (index === 2) { var old = mx; mx = mx * .84 - my * .53; my = old * .53 + my * .84; }
    var sx = c * 1.05, sy = (index - 1) * .49, sz = s * .68;
    var knot = a + index * TAU / 3, spread = 1 + (index - 1) * .09;
    var kx = (Math.sin(knot) + 2 * Math.sin(2 * knot)) / 2.65 * spread;
    var ky = (Math.cos(knot) - 2 * Math.cos(2 * knot)) / 2.65 * spread;
    var kz = -Math.sin(3 * knot) / 2.5;
    return project(sx * weights[0] + mx * weights[1] + kx * weights[2],
      sy * weights[0] + my * weights[1] + ky * weights[2],
      sz * weights[0] + mz * weights[1] + kz * weights[2], out);
  }
  function pathColor(index) { return index === 0 ? colors.warm : index === 1 ? colors.accent : colors.text; }
  function strokePath(points, color, alpha, width, side) {
    context.beginPath(); var started = false;
    for (var i = 0; i < points.length; i++) {
      var p = points[i], show = side === 0 || (side < 0 ? p.z >= 0 : p.z < 0);
      if (show) {
        if (!started) { var prev = points[Math.max(0, i - 1)]; context.moveTo(prev.x, prev.y); }
        context.lineTo(p.x, p.y); started = true;
      } else started = false;
    }
    context.strokeStyle = color; context.globalAlpha = alpha; context.lineWidth = width; context.stroke();
  }
  function dot(x, y, r, color, alpha) {
    context.globalAlpha = alpha; context.fillStyle = color;
    context.beginPath(); context.arc(x, y, r, 0, TAU); context.fill();
  }
  function drawGround() {
    for (var i = 0; i <= 80; i++) {
      var a = i / 80 * TAU;
      project(Math.cos(a) * 1.30, -1.02, Math.sin(a) * .86, ground[i]);
    }
    strokePath(ground, colors.muted, colors.light ? .21 : .24, .7, 0);
    context.globalAlpha = .32; context.strokeStyle = colors.muted; context.lineWidth = .7;
    context.beginPath();
    for (var n = 0; n < 32; n++) {
      var t = n / 32 * TAU, p = project(Math.cos(t) * 1.30, -1.02, Math.sin(t) * .86, temp);
      var x = p.x, y = p.y;
      project(Math.cos(t) * (n % 4 ? 1.33 : 1.37), -1.02, Math.sin(t) * (n % 4 ? .88 : .91), temp);
      context.moveTo(x, y); context.lineTo(temp.x, temp.y);
    }
    context.stroke();
  }
  function drawCore() {
    var vertices = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    var p = vertices.map(function (v) { return project(v[0]*.20, v[1]*.20, v[2]*.20, {}); });
    context.lineWidth = 1; context.strokeStyle = colors.text;
    context.beginPath();
    for (var a = 0; a < 6; a++) for (var b = a + 1; b < 6; b++) {
      if (Math.floor(a / 2) === Math.floor(b / 2)) continue;
      context.moveTo(p[a].x, p[a].y); context.lineTo(p[b].x, p[b].y);
    }
    context.globalAlpha = .46; context.stroke();
    var center = project(0, 0, 0, temp);
    dot(center.x, center.y, 5.4, colors.accent, .13);
    dot(center.x, center.y, 2.2, colors.text, .95);
  }
  function drawTraveller(index, a, front) {
    point(index, a, temp); if ((temp.z < 0) !== front) return;
    var color = pathColor(index), opacity = front ? 1 : .48;
    context.beginPath();
    for (var j = 0; j <= 18; j++) {
      point(index, a - .52 + j / 18 * .52, temp);
      if (j === 0) context.moveTo(temp.x, temp.y); else context.lineTo(temp.x, temp.y);
    }
    context.strokeStyle = color; context.lineWidth = front ? 1.8 : 1.1;
    context.globalAlpha = opacity * .68; context.stroke();
    point(index, a, temp);
    dot(temp.x, temp.y, front ? 8 : 5, color, .09);
    dot(temp.x, temp.y, front ? 3.3 : 2.4, color, opacity);
    dot(temp.x, temp.y, 1, colors.bg, .9);
  }
  function updateExit() {
    var vh = Math.max(320, window.innerHeight || 320);
    heroLeave = bounds ? clamp(-bounds.top / (vh * .42), 0, 1) : 0;
    heroCamera.turn = -heroLeave * .5;
    heroCamera.scale = 1 - heroLeave * .07;
    heroCamera.dx = -heroLeave * 14;
    heroCamera.dy = heroLeave * 10;
  }
  function drawAnnotations() {
    context.font = '10px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.textBaseline = 'middle'; context.fillStyle = colors.muted;
    var labels = ['SIGNAL', 'MOTION', 'POLICY'];
    var positions = [[.09,.23], [.82,.36], [.14,.76]];
    var life = 1 - heroLeave * .85;
    context.globalAlpha = .72 * life;
    for (var i = 0; i < 3; i++) {
      var x = W * positions[i][0], y = H * positions[i][1];
      context.textAlign = i === 1 ? 'right' : 'left'; context.fillStyle = i === modes.indexOf(mode) ? pathColor(i) : colors.muted;
      context.fillText(labels[i], x, y);
      context.strokeStyle = context.fillStyle; context.lineWidth = .65;
      var direction = i === 1 ? -1 : 1;
      context.beginPath(); context.moveTo(x, y + 11); context.lineTo(x + direction * 24, y + 11);
      context.lineTo(x + direction * 34, y + 20); context.stroke();
    }
    context.textAlign = 'center'; context.fillStyle = colors.muted; context.globalAlpha = .55 * life;
    context.fillText('x', W*.80, H*.79); context.fillText('y', W*.23, H*.86);
  }
  function drawStage() {
    if (!W || !H) return; draws++;
    updateExit(); camera = heroCamera;
    context.setTransform(DPR, 0, 0, DPR, 0, 0); context.clearRect(0, 0, W, H);
    context.lineCap = 'round'; context.lineJoin = 'round';
    if (glow) { context.globalAlpha = (colors.light ? .045 : .085) * (1 - heroLeave * .5); context.drawImage(glow, cx-radius*1.5, cy-radius*1.5, radius*3, radius*3); }
    drawGround();
    paths.forEach(function (path, index) {
      for (var i = 0; i <= segments; i++) point(index, i / segments * TAU, path[i]);
      strokePath(path, pathColor(index), colors.light ? .28 : .29, .85, -1);
      drawTraveller(index, time * (.23 + index * .045) + index * 2.0 + .5 + heroLeave * .9, false);
    });
    drawCore();
    paths.forEach(function (path, index) {
      strokePath(path, pathColor(index), index === 2 ? .55 : .78, index === 2 ? .85 : 1.05, 1);
      drawTraveller(index, time * (.23 + index * .045) + index * 2.0 + .5 + heroLeave * .9, true);
      for (var n = 0; n < 4; n++) {
        point(index, n * TAU / 4 + .30, temp); dot(temp.x, temp.y, 1.45, pathColor(index), temp.z < 0 ? .72 : .27);
      }
    });
    if (interaction.kind === 'pulse' && interaction.strength > .001) {
      context.beginPath(); context.ellipse(cx, cy, radius*(.28+interaction.age*.72), radius*(.14+interaction.age*.35), -.18, 0, TAU);
      context.strokeStyle = colors.accent; context.lineWidth = 1; context.globalAlpha = interaction.strength * .45; context.stroke();
    }
    drawAnnotations(); context.globalAlpha = 1;
  }
  function draw() {
    if (visible) drawStage();
    drawFlow();
  }
  function updateControls() {
    buttons.forEach(function (button) { button.setAttribute('aria-pressed', String(button.getAttribute('data-orbit-mode') === mode)); });
    if (pauseButton) {
      pauseButton.setAttribute('aria-pressed', String(paused));
      pauseButton.textContent = paused ? '继续' : '暂停';
      pauseButton.disabled = reduce.matches || root.getAttribute('data-motion') === 'off';
    }
    if (status) status.textContent = reduce.matches || root.getAttribute('data-motion') === 'off'
      ? '静态观览 · 可切换不同轨道形态' : paused ? '时间停驻 · 点击继续恢复运动' : descriptions[modes.indexOf(mode)];
  }
  function release(allowTap) {
    if (allowTap && interaction.held && interaction.strength < .06) {
      interaction.tap = true; interaction.age = 0;
    }
    interaction.held = false;
    if (pointer !== null && stage.releasePointerCapture) {
      try { if (!stage.hasPointerCapture || stage.hasPointerCapture(pointer)) stage.releasePointerCapture(pointer); } catch (ignore) {}
    }
    pointer = null;
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = null; }
  function sync() {
    if (unavailable()) { release(); pendingPointer = null; stop(); }
    else if (!raf) { last = null; raf = requestAnimationFrame(frame); }
    updateControls();
  }
  function frame(now) {
    raf = 0; if (unavailable()) { stop(); return; }
    var raw = last === null ? 0 : (now - last) / 1000, dt = clamp(raw, 0, .05); last = now;
    if (pendingPointer) {
      var e = pendingPointer; pendingPointer = null;
      tx = clamp((e.clientX - bounds.left) / W * 2 - 1, -1, 1);
      ty = clamp((e.clientY - bounds.top) / H * 2 - 1, -1, 1);
      if (pointer !== null && !e.buttons) release(true);
    }
    px = ease(px, tx, 5, dt); py = ease(py, ty, 5, dt); spin = ease(spin, targetSpin, 4, dt);
    leanX = ease(leanX, leanTX, 3, dt); leanY = ease(leanY, leanTY, 3, dt);
    time += dt;
    weights.forEach(function (w, i) { weights[i] = ease(w, modes[i] === mode ? 1 : 0, 4, dt); });
    interaction.age += dt;
    var target = interaction.held ? 1 : 0;
    if (!interaction.held && interaction.tap) target = Math.pow(Math.sin(Math.PI * clamp(interaction.age / .65, 0, 1)), 2);
    if (interaction.kind === 'pulse') target = Math.pow(Math.sin(Math.PI * clamp(interaction.age / 1.5, 0, 1)), 2);
    interaction.strength = ease(interaction.strength, target, interaction.held ? 6 : 4, dt);
    var shapeTarget = interaction.strength * (interaction.kind === 'attract' ? -.19 : interaction.kind === 'spread' ? .12 : interaction.kind === 'pulse' ? .04 : 0);
    deformation = ease(deformation, shapeTarget, 8, dt);
    if (!interaction.held && interaction.strength < .0001 && interaction.age > 1.5) {
      interaction.kind = 'idle'; interaction.strength = 0; interaction.tap = false;
    }
    var start = debug ? performance.now() : 0; draw();
    if (metrics && raw > 0) {
      costs.push(performance.now() - start); intervals.push(raw);
      if (costs.length > 180) { costs.shift(); intervals.shift(); }
      if (now - metricAt > 700) {
        metricAt = now; var sorted = costs.slice().sort(function(a,b){return a-b;});
        metrics.textContent = '轨道绘制 P95 ' + sorted[Math.floor(sorted.length*.95)].toFixed(2) + ' ms · ' + segments*3 + ' 曲线段';
      }
    }
    raf = requestAnimationFrame(frame);
  }
  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      var selected = button.getAttribute('data-orbit-mode'); if (modes.indexOf(selected) < 0) return;
      mode = selected;
      if (unavailable()) weights = modes.map(function (name) { return name === mode ? 1 : 0; });
      updateControls(); if (unavailable()) draw(); else sync();
    });
  });
  if (pauseButton) pauseButton.addEventListener('click', function () { paused = !paused; sync(); });
  function mouse(e) { return !e.pointerType || e.pointerType === 'mouse'; }
  function actionable(e) { return mouse(e) && !unavailable() && !(e.target && e.target.closest && e.target.closest(ignored)); }
  stage.addEventListener('pointerdown', function (e) {
    if (!actionable(e) || e.button < 0 || e.button > 2 || (e.button === 2 && e.shiftKey)) return;
    bounds = stage.getBoundingClientRect();
    release(); interaction.kind = ['attract','pulse','spread'][e.button]; interaction.age = 0; interaction.tap = false;
    interaction.held = e.button !== 1; targetSpin += e.button === 1 ? .30 : 0;
    if (interaction.held) { pointer = e.pointerId; if (stage.setPointerCapture) { try { stage.setPointerCapture(pointer); } catch (ignore) {} } }
    e.preventDefault();
  });
  stage.addEventListener('pointermove', function (e) { if (actionable(e)) pendingPointer = e; }, {passive:true});
  stage.addEventListener('pointerenter', function () { bounds = stage.getBoundingClientRect(); });
  stage.addEventListener('pointerleave', function () { tx = ty = 0; release(); });
  ['pointerup','pointercancel'].forEach(function (name) { window.addEventListener(name, function (e) { if (pointer !== null && e.pointerId === pointer) release(name === 'pointerup'); }); });
  stage.addEventListener('lostpointercapture', function () { interaction.held = false; pointer = null; });
  ['mousedown','auxclick'].forEach(function (name) { stage.addEventListener(name, function(e) { if(e.button === 1 && actionable(e)) e.preventDefault(); }); });
  stage.addEventListener('contextmenu', function(e) { if(!e.shiftKey && actionable(e)) e.preventDefault(); });
  window.addEventListener('blur', function() { release(); tx=ty=0; pendingPointer=null; });
  window.addEventListener('resize', resize, {passive:true});
  window.addEventListener('scroll', function () { bounds = stage.getBoundingClientRect(); }, {passive:true});
  window.addEventListener('resize', measureFlow, {passive:true});
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (!bounds || bounds.bottom > 0 || staticMode()) { leanTX = leanTY = 0; return; }
    leanTX = clamp(e.clientX / flowW * 2 - 1, -1, 1);
    leanTY = clamp(e.clientY / flowH * 2 - 1, -1, 1);
  }, {passive:true});
  document.addEventListener('visibilitychange', sync);
  if (reduce.addEventListener) reduce.addEventListener('change', sync);
  if (window.IntersectionObserver) new IntersectionObserver(function(entries) { visible = entries[0].isIntersecting; sync(); }).observe(stage);
  var flowHost = document.querySelector('.home-flow');
  if (flowHost && window.IntersectionObserver) {
    new IntersectionObserver(function (entries) { flowVisible = entries[0].isIntersecting; sync(); }).observe(flowHost);
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  if (window.MutationObserver) new MutationObserver(function(records) {
    if (records.some(function(r) {return r.attributeName !== 'data-motion';})) { palette(); resize(); draw(); }
    sync();
  }).observe(root, {attributes:true, attributeFilter:['data-theme','data-mode','data-motion','data-performance','style']});
  palette(); resize(); measureFlow(); stage.classList.add('is-ready'); if (controls) controls.hidden = false;
  if (debug) {
    metrics = document.createElement('output'); metrics.className = 'orbit-metrics'; metrics.id = 'orbit-motion-metrics';
    visual.appendChild(metrics);
  }
  window.__orbitField = {info:function() {return {
    running:!!raf, mode:mode, time:time, paused:paused, draws:draws, width:W, height:H,
    interaction:{kind:interaction.kind,strength:interaction.strength,held:interaction.held},
    quality:compact?'compact':'full', segments:segments, weights:weights.slice(), pointer:[px,py], deformation:deformation,
    flow:{visible:flowVisible, chapters:flowChapters.length, cards:flowCards.length,
          size:[flowW, flowH], drawn:!!flowCtx, lean:[leanX, leanY]},
    exit:{leave:heroLeave, turn:heroCamera.turn, scale:heroCamera.scale,
          dx:heroCamera.dx, dy:heroCamera.dy}
  };}};
  sync();
})();