/* Stable galaxy particles, display-synchronous motion and shared projections.
   Soft sprites use a small offscreen buffer; morph.js takes over these same stars. */
(function () {
  'use strict';
  var cv = document.getElementById('hero-galaxy');
  if (!cv || !cv.getContext) return;
  var hero = cv.parentNode, ctx = cv.getContext('2d'), root = document.documentElement;
  if (!ctx) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var compact = root.getAttribute('data-performance') === 'compact';
  var MAXP = compact ? 650 : 1250, MINP = compact ? 280 : 460, Q = compact ? .55 : .7;
  var TAU = Math.PI * 2, LEVELS = [.26, .46, .66, .92];
  var parts = [], samples = [], sprites = [], fields = [], interaction = null;
  var warm = [255,180,120], cool = [120,160,255], core, glows, strokeCols;
  var buf = document.createElement('canvas'), bctx = buf.getContext('2d');
  var W=0,H=0,BW=0,BH=0,DPR=1,cx=0,cy=0,RAD=240,PSPR=3.4;
  var heroRect,raf=0,last=null,visible=true,paused=false,yaw=.6,draws=0;
  var px=0,py=0,tpx=0,tpy=0,scrollT=0,tScrollT=0,lastVar=-1;
  var activePointer=null,pendingPointer=null;
  var actionNames=['attract','burst','repel'];
  var ignoredTargets='a,button,input,textarea,select,[contenteditable],.hero-title,.hero-sub,.hero-eyebrow,.hero-id,.hero-stats,[data-galaxy-controls]';
  var actionButtons=hero.querySelectorAll('[data-galaxy-action]');
  var pauseBtn=hero.querySelector('[data-galaxy-pause]'),status=hero.querySelector('[data-galaxy-status]');
  var lastState='',lastStatus='',lastDisabled=null;
  var trails=[[],[],[],[],[],[]],pt={x:0,y:0,k:0,depth:0};
  var metrics=null,costs=[],intervals=[],metricTime=0;
  var debug=window.location && /[?&]motion-debug=1(?:&|$)/.test(window.location.search);
  function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
  function smooth(v){v=clamp(v,0,1);return v*v*(3-2*v);}
  function approach(v,target,rate,dt){return dt>0?target+(v-target)*Math.exp(-rate*dt):v;}

  function toRgb(c){
    var m=String(c||'').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if(m){var h=m[1];if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
    m=String(c||'').match(/^rgba?\(([^)]+)\)/i);
    return m?m[1].split(/[,\s/]+/).filter(Boolean).slice(0,3).map(parseFloat):null;
  }
  function makeSprite(rgb,alpha,size){
    var canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    var c=canvas.getContext('2d'),r=size/2,color=(rgb||[255,255,255]).join(',');
    var gradient=c.createRadialGradient(r,r,0,r,r,r);
    gradient.addColorStop(0,'rgba('+color+','+alpha+')');
    gradient.addColorStop(.22,'rgba('+color+','+(alpha*.72)+')');
    gradient.addColorStop(.55,'rgba('+color+','+(alpha*.16)+')');
    gradient.addColorStop(1,'rgba('+color+',0)');
    c.fillStyle=gradient;c.fillRect(0,0,size,size);return canvas;
  }
  function readPalette(){
    var cs=getComputedStyle(root);
    warm=toRgb(cs.getPropertyValue('--accent-2'))||warm;cool=toRgb(cs.getPropertyValue('--accent'))||cool;
    strokeCols=['255,255,255',warm.join(','),cool.join(',')];
    sprites=[null,warm,cool].map(function(color){return LEVELS.map(function(level){return makeSprite(color,level,64);});});
    glows=[makeSprite(warm,.22,128),makeSprite(cool,.22,128)];
    core=document.createElement('canvas');core.width=core.height=256;
    var c=core.getContext('2d'),g=c.createRadialGradient(128,128,0,128,128,128);
    g.addColorStop(0,'rgba('+warm.join(',')+',.19)');g.addColorStop(.28,'rgba('+warm.join(',')+',.07)');
    g.addColorStop(.62,'rgba('+cool.join(',')+',.032)');g.addColorStop(1,'rgba('+cool.join(',')+',0)');
    c.fillStyle=g;c.fillRect(0,0,256,256);
  }
  function build(count){
    var n=count||clamp(Math.round(RAD*RAD/78),MINP,MAXP);
    while(parts.length<n){
      var id=parts.length,nucleus=Math.random()<.12;
      var t=nucleus?Math.pow(Math.random(),2.2):Math.sqrt(Math.random());
      var r=nucleus?t*.24:.12+t*.88+(Math.random()-.5)*.07;
      var sample={id:id,x:0,y:0,size:0,tier:r<.1?0:r<.3?1:2,level:(Math.random()*4)|0,alpha:0};
      parts.push({r:r,a:id%3*TAU/3+t*2.05*Math.PI+(.34+.30*(1-t))*(Math.random()-.5)*2,
        y:(Math.random()+Math.random()+Math.random()-1.5)/1.5*(.035+.16*r),
        s:(nucleus?.85:.4)+Math.random()*(nucleus?.8:.7),dx:0,dy:0,sample:sample,
        x:0,y2:0,size:0,k:1,alpha:1,onScreen:true});samples.push(sample);
    }
    parts.length=samples.length=n;
  }
  function project(p){
    var a=p.a+yaw*.55/(.34+p.r),x=Math.cos(a)*p.r,z=Math.sin(a)*p.r;
    var y=p.y*Math.cos(.64)-z*Math.sin(.64),depth=p.y*Math.sin(.64)+z*Math.cos(.64);
    var k=2.35/(2.35+depth),cr=Math.cos(-.28),sr=Math.sin(-.28),zoom=1+scrollT*.62;
    pt.x=cx+(x*cr-y*sr)*RAD*k*zoom+px*(.16+.5*p.r)*RAD*.34;
    pt.y=cy+(x*sr+y*cr)*RAD*k*zoom+py*(.10+.3*p.r)*RAD*.26;pt.k=k;pt.depth=depth;
  }
  function frozen(){return paused||reduce.matches||root.getAttribute('data-motion')==='off';}
  function unavailable(){return frozen()||!visible||document.hidden;}
  function updateControls(){
    var disabled=unavailable(),state=disabled?'paused':interaction?interaction.mode:'idle';
    var message='移动鼠标或点击按钮探索星系';
    if(reduce.matches||root.getAttribute('data-motion')==='off')message='请先开启动效，再探索星系';
    else if(paused)message='请先继续星系动效';else if(!visible||document.hidden)message='星系回到视野后继续';
    else if(state==='attract')message='引力汇聚 · 星尘正在靠近';else if(state==='repel')message='斥力涟漪 · 星尘向外散开';
    else if(state==='burst')message='星爆展开 · 旋臂即将归位';
    if(state!==lastState){hero.setAttribute('data-galaxy-state',state);lastState=state;}
    if(status&&message!==lastStatus){status.textContent=message;lastStatus=message;}
    if(disabled!==lastDisabled){for(var i=0;i<actionButtons.length;i++)actionButtons[i].disabled=disabled;lastDisabled=disabled;}
  }
  function releasePointer(){
    var id=activePointer;activePointer=null;
    if(id!==null&&hero.releasePointerCapture){try{if(!hero.hasPointerCapture||hero.hasPointerCapture(id))hero.releasePointerCapture(id);}catch(ignore){}}
  }
  function retire(field,allowPulse){
    if(!field||field.released)return;field.held=false;
    if(allowPulse&&field.strength<.01){field.pulse=true;field.age=0;return;}
    field.released=true;field.releaseAge=0;field.releaseStart=field.strength;
  }
  function releaseInteraction(allowPulse){releasePointer();if(interaction&&interaction.held)retire(interaction,allowPulse===true);}
  function beginInteraction(mode,x,y,held){
    if(unavailable())return false;
    // Fade the old field without resetting any star's displacement.
    retire(interaction,false);
    interaction={mode:mode,x:x,y:y,tx:x,ty:y,age:0,held:held,pulse:!held,strength:0,released:false,releaseAge:0};
    fields.push(interaction);if(fields.length>3)fields.shift();updateControls();return true;
  }
  function advanceFields(dt){
    for(var i=fields.length-1;i>=0;i--){
      var f=fields[i],done=false;f.age+=dt;f.x=approach(f.x,f.tx,18,dt);f.y=approach(f.y,f.ty,18,dt);
      if(f.released){f.releaseAge+=dt;f.strength=f.releaseStart*(1-smooth(f.releaseAge/.8));done=f.releaseAge>=.8;}
      else if(f.mode==='burst'||f.pulse){var duration=f.mode==='burst'?1.8:1.35;
        f.strength=Math.pow(Math.sin(Math.PI*clamp(f.age/duration,0,1)),2);done=f.age>=duration;}
      else{f.strength=1-Math.exp(-f.age/.08);if(1-f.strength<.00001)f.strength=1;}
      if(done){fields.splice(i,1);if(f===interaction){interaction=null;updateControls();}}
    }
  }
  function displace(p,dt){
    var ox=0,oy=0;
    for(var i=0;i<fields.length;i++){
      var f=fields[i],dx=pt.x-f.x,dy=pt.y-f.y,distance=Math.hypot(dx,dy);if(distance<.01)continue;
      var falloff=Math.max(0,1-distance/(RAD*(f.mode==='burst'?1.9:1.1)));
      var amount=f.mode==='burst'?RAD*.72*f.strength*Math.sqrt(falloff)/distance:(f.mode==='attract'?-.88:1.05)*falloff*f.strength;
      amount+=(f.mode==='attract'?-1:1)*RAD*.045*f.strength/distance;ox+=dx*amount;oy+=dy*amount;
    }
    var length=Math.hypot(ox,oy),limit=RAD*.9;if(length>limit){ox*=limit/length;oy*=limit/length;}
    if(dt>0){p.dx=approach(p.dx,ox,12,dt);p.dy=approach(p.dy,oy,12,dt);}pt.x+=p.dx;pt.y+=p.dy;
  }
  function maskAlpha(x,y){
    var u=x/BW,v=y/BH;
    var horizontal=u<.42?clamp((u-.08)/.34,0,1)*.2:.2+.8*clamp((u-.42)/.24,0,1);
    return horizontal*clamp((.99-v)/.47,0,1)*(1-scrollT*.5)*(W<=600?.55:1);
  }
  function draw(dt){
    dt=dt||0;draws++;bctx.setTransform(1,0,0,1,0,0);bctx.clearRect(0,0,BW,BH);
    bctx.globalCompositeOperation='lighter';bctx.globalAlpha=1;
    var radius=RAD*1.15;bctx.drawImage(core,cx-radius,cy-radius,radius*2,radius*2);
    for(var bucket=0;bucket<6;bucket++)trails[bucket].length=0;
    for(var i=0;i<parts.length;i++){
      var p=parts[i];project(p);displace(p,dt);p.x=pt.x;p.y2=pt.y;p.k=pt.k;
      p.size=Math.max(1.3,p.s*PSPR*pt.k*(p.r<.18?1.3:1));
      // Keep the sprite level fixed: continuous depth opacity never wraps to dark.
      p.alpha=.55+.45*(1-clamp((pt.depth+1)/2,0,1));
      var s=p.sample;s.x=pt.x*W/BW;s.y=pt.y*H/BH;s.size=p.size*W/BW;s.alpha=p.alpha*maskAlpha(pt.x,pt.y);
      p.onScreen=pt.x>=-40&&pt.x<=BW+40&&pt.y>=-40&&pt.y<=BH+40;
      if(p.onScreen)trails[s.tier*2+(p.size>2.2?1:0)].push(p);
    }
    if(scrollT>.0001)for(var b=0;b<6;b++){
      bctx.strokeStyle='rgba('+strokeCols[(b/2)|0]+','+((.10+.20*scrollT)*smooth(scrollT/.12))+')';
      bctx.lineWidth=b%2?1.5:.8;bctx.beginPath();
      for(var j=0;j<trails[b].length;j++){
        var star=trails[b][j],dx=star.x-cx,dy=star.y2-cy,distance=Math.hypot(dx,dy)||1;
        var len=scrollT*(18+96*star.r)*star.k;
        bctx.moveTo(star.x-dx/distance*len,star.y2-dy/distance*len);bctx.lineTo(star.x,star.y2);
      }bctx.stroke();
    }
    for(var k=0;k<parts.length;k++){
      var p2=parts[k];if(!p2.onScreen)continue;bctx.globalAlpha=p2.alpha;
      bctx.drawImage(sprites[p2.sample.tier][p2.sample.level],p2.x-p2.size,p2.y2-p2.size,p2.size*2,p2.size*2);
    }
    for(var f=0;f<fields.length;f++){
      var field=fields[f],burst=field.mode==='burst',ri=RAD*(burst?.12+clamp(field.age/1.8,0,1)*1.75:.44);
      bctx.globalAlpha=field.strength;bctx.drawImage(glows[field.mode==='attract'?0:1],field.x-ri,field.y-ri,ri*2,ri*2);
      bctx.strokeStyle='rgba('+strokeCols[field.mode==='attract'?1:2]+',.38)';bctx.lineWidth=Math.max(.9,Q*1.4);
      bctx.beginPath();bctx.arc(field.x,field.y,ri*(burst?.88:.76),0,TAU);bctx.stroke();
    }
    bctx.globalAlpha=1;bctx.globalCompositeOperation='source-over';
    ctx.setTransform(DPR,0,0,DPR,0,0);ctx.clearRect(0,0,W,H);ctx.drawImage(buf,0,0,BW,BH,0,0,W,H);
  }
  function resize(){
    heroRect=hero.getBoundingClientRect();var w=Math.max(320,Math.round(heroRect.width)),h=Math.max(280,Math.round(heroRect.height));
    var dpr=Math.min(compact?1:1.5,window.devicePixelRatio||1);if(w===W&&h===H&&dpr===DPR)return false;
    var oldBW=BW,oldBH=BH;W=w;H=h;DPR=dpr;cv.width=Math.round(W*DPR);cv.height=Math.round(H*DPR);
    BW=Math.max(200,Math.round(W*Q));BH=Math.max(180,Math.round(H*Q));buf.width=BW;buf.height=BH;
    cx=BW*.76;cy=BH*.48;RAD=Math.min(BW*.35,BH*.66);PSPR=Math.max(1.7,RAD/100);
    if(oldBW){parts.forEach(function(p){p.dx*=BW/oldBW;p.dy*=BH/oldBH;});
      fields.forEach(function(f){f.x*=BW/oldBW;f.tx*=BW/oldBW;f.y*=BH/oldBH;f.ty*=BH/oldBH;});}return true;
  }
  function applyScrollVars(){if(Math.abs(scrollT-lastVar)<.00001)return;lastVar=scrollT;hero.style.setProperty('--hero-scroll',scrollT);}
  function readScroll(){heroRect=hero.getBoundingClientRect();var y=window.pageYOffset||root.scrollTop||0;tScrollT=clamp(y/Math.max(1,H*.92),0,1);}
  function isMouse(e){return !e.pointerType||e.pointerType==='mouse';}
  function interactionPoint(e,refresh){
    if(!isMouse(e)||(e.target&&e.target.closest&&e.target.closest(ignoredTargets)))return null;
    if(refresh||!heroRect)heroRect=hero.getBoundingClientRect();var r=heroRect,x=e.clientX-r.left,y=e.clientY-r.top;
    if(x<r.width*.46||x>r.width||y<0||y>r.height)return null;return{x:x*BW/r.width,y:y*BH/r.height};
  }
  function consumePointer(){
    var e=pendingPointer;pendingPointer=null;if(!e)return;
    if(activePointer!==null&&e.pointerId===activePointer){
      if(e.buttons===0)releaseInteraction(true);else{var point=interactionPoint(e,false);
        if(!point)releaseInteraction(true);else if(interaction){interaction.tx=point.x;interaction.ty=point.y;}}
    }
    if(!compact&&heroRect){tpx=clamp(((e.clientX-heroRect.left)/heroRect.width-.5)*2,-1,1);tpy=clamp(((e.clientY-heroRect.top)/heroRect.height-.5)*2,-1,1);}
  }
  function frame(time){
    if(unavailable()){stop();return;}raf=requestAnimationFrame(frame);
    var interval=last===null?0:Math.max(0,time-last),dt=Math.min(.05,interval/1000);last=time;consumePointer();
    scrollT=approach(scrollT,tScrollT,7,dt);if(Math.abs(scrollT-tScrollT)<.00001)scrollT=tScrollT;
    applyScrollVars();yaw+=dt*(.055+scrollT*.46);px=approach(px,tpx,7,dt);py=approach(py,tpy,7,dt);advanceFields(dt);
    var begin=debug?performance.now():0;draw(dt);
    if(debug){costs.push(performance.now()-begin);if(interval)intervals.push(interval);if(costs.length>240)costs.shift();if(intervals.length>240)intervals.shift();
      if(time-metricTime>500&&metrics){var sorted=costs.slice().sort(function(a,b){return a-b;}),sum=intervals.reduce(function(a,b){return a+b;},0);
        metrics.textContent='星系 '+(sum?1000*intervals.length/sum:0).toFixed(1)+' fps · 绘制 P95 '+sorted[Math.floor((sorted.length-1)*.95)].toFixed(2)+' ms · '+parts.length+' 粒子';metricTime=time;}}
  }
  function start(){if(!raf&&parts.length&&!unavailable()){last=null;raf=requestAnimationFrame(frame);}}
  function stop(){if(raf)cancelAnimationFrame(raf);raf=0;last=null;}
  function changed(){if(window.dispatchEvent&&typeof Event!=='undefined')window.dispatchEvent(new Event('galaxy:change'));}
  function sync(){if(unavailable()){releaseInteraction(false);pendingPointer=null;stop();}else start();updateControls();changed();}
  if(pauseBtn)pauseBtn.addEventListener('click',function(){paused=!paused;pauseBtn.setAttribute('aria-pressed',String(paused));pauseBtn.textContent=paused?'继续星系动效':'暂停星系动效';sync();});
  if(window.MutationObserver)new MutationObserver(function(records){
    if(!records||records.some(function(r){return r.attributeName!=='data-motion';})){readPalette();draw();}sync();
  }).observe(root,{attributes:true,attributeFilter:['data-theme','data-mode','data-motion']});
  if(reduce.addEventListener)reduce.addEventListener('change',sync);
  document.addEventListener('visibilitychange',sync);window.addEventListener('scroll',readScroll,{passive:true});
  function resized(){if(resize()){draw();changed();}readScroll();sync();}
  window.addEventListener('resize',resized,{passive:true});if(window.ResizeObserver)new ResizeObserver(resized).observe(hero);
  hero.addEventListener('pointerdown',function(e){
    if(e.button<0||e.button>2||(e.button===2&&e.shiftKey))return;var point=interactionPoint(e,true);if(!point||unavailable())return;
    releasePointer();beginInteraction(actionNames[e.button],point.x,point.y,e.button!==1);e.preventDefault();
    if(e.button!==1){activePointer=e.pointerId;if(hero.setPointerCapture){try{hero.setPointerCapture(e.pointerId);}catch(ignore){}}}
  });
  hero.addEventListener('mousedown',function(e){if(e.button===1&&!unavailable()&&interactionPoint(e,true))e.preventDefault();});
  hero.addEventListener('auxclick',function(e){if(e.button===1&&!unavailable()&&interactionPoint(e,true))e.preventDefault();});
  hero.addEventListener('contextmenu',function(e){if(!e.shiftKey&&!unavailable()&&interactionPoint(e,true))e.preventDefault();});
  window.addEventListener('pointerup',function(e){if(activePointer!==null&&e.pointerId===activePointer)releaseInteraction(true);});
  window.addEventListener('pointercancel',function(e){if(isMouse(e)&&(activePointer===null||e.pointerId===activePointer))releaseInteraction(false);});
  hero.addEventListener('lostpointercapture',function(e){if(activePointer!==null&&e.pointerId===activePointer)releaseInteraction(true);});
  hero.addEventListener('pointerleave',function(){releaseInteraction(true);tpx=tpy=0;});
  window.addEventListener('blur',function(){releaseInteraction(false);tpx=tpy=0;pendingPointer=null;});
  for(var a=0;a<actionButtons.length;a++)actionButtons[a].addEventListener('click',function(e){var mode=e.currentTarget.getAttribute('data-galaxy-action');if(actionNames.indexOf(mode)<0)return;releasePointer();beginInteraction(mode,cx,cy,false);});
  window.addEventListener('pointermove',function(e){if(isMouse(e)&&!unavailable())pendingPointer=e;},{passive:true});
  if(window.IntersectionObserver)new IntersectionObserver(function(es){visible=es[0].isIntersecting;sync();},{threshold:0}).observe(hero);

  readPalette();resize();build();readScroll();scrollT=tScrollT;applyScrollVars();draw();
  var controls=hero.querySelector('[data-galaxy-controls]');if(controls)controls.hidden=false;
  var snapshot={particles:samples,width:W,height:H,paused:false,scroll:scrollT,yaw:yaw};
  window.__galaxy={
    snapshot:function(){snapshot.width=W;snapshot.height=H;snapshot.paused=unavailable();snapshot.scroll=scrollT;snapshot.yaw=yaw;return snapshot;},
    info:function(){return{parts:parts.length,w:W,h:H,bw:BW,bh:BH,q:Q,state:lastState,held:!!(interaction&&interaction.held),strength:interaction?interaction.strength:0,
      point:interaction?[interaction.x,interaction.y]:null,px:px,py:py,scroll:scrollT,yaw:yaw,running:!!raf,fieldCount:fields.length,draws:draws};},
    bench:function(n){var begin=performance.now();for(var i=0;i<(n||60);i++)draw();return(performance.now()-begin)/(n||60);},
    setParts:function(n){if(!Number.isInteger(n)||n<1||n>4000)return;build(n);draw();sync();}
  };
  if(debug){metrics=document.createElement('output');metrics.id='galaxy-motion-metrics';metrics.style.cssText='position:fixed;bottom:12px;left:12px;padding:8px 12px;background:#10151ee8;color:#f2f5ff;z-index:999;font:12px monospace;pointer-events:none;border-radius:8px';document.body.appendChild(metrics);}
  sync();if(window.__boot){window.__boot.label('hero','正在点亮星系');window.__boot.progress('hero',100);window.__boot.done('hero');}
})();
