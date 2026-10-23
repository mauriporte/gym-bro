"use strict";
/* ---------- state ---------- */
const dateKey = d => d.toLocaleDateString("en-CA");
const today = () => dateKey(new Date());
const DEF_STATE = {lang:(navigator.language||"en").startsWith("es")?"es":"en", mode:"gym",
  profile:{build:"athletic",goal:"muscle",exp:"intermediate",days:4}, body:{sex:"m",age:30,height:178,weight:80},
  trainDays:[1,2,4,5], remind:"18:00", gym:null, log:{}, checkins:{}, skips:{}, notified:"", tab:"today"};
let S = structuredClone(DEF_STATE);
try{ const l=JSON.parse(localStorage.getItem("gymbro")||"null"); if(l) S={...S,...l,profile:{...S.profile,...l.profile},body:{...S.body,...l.body}}; }catch{}
function save(){ try{ localStorage.setItem("gymbro",JSON.stringify(S)); }catch{} }

/* ---------- i18n ---------- */
const tr = v => v[S.lang==="es"?1:0];
const t = (v,vars={}) => tr(v).replace(/\{(\w+)\}/g,(_,k)=>vars[k]??"");
const esc = s => String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const num = (n,d=0) => n.toLocaleString(S.lang,{maximumFractionDigits:d,minimumFractionDigits:d});
const fmtRest = s => s>=60?(s%60?Math.floor(s/60)+" min "+s%60+" s":s/60+" min"):s+" s";
const dowName = (d,len="short") => new Date(2024,0,7+d).toLocaleDateString(S.lang,{weekday:len});

/* ---------- native bridge (Capacitor) ---------- */
const Cap = window.Capacitor, NATIVE = !!Cap?.isNativePlatform?.();
const LN = NATIVE ? Cap.Plugins.LocalNotifications : null, GEO = NATIVE ? Cap.Plugins.Geolocation : null;
async function getPosition(){
  if(GEO){ await GEO.requestPermissions(); const p=await GEO.getCurrentPosition({enableHighAccuracy:true,timeout:15000}); return p.coords; }
  if(!navigator.geolocation) throw new Error("unsupported");
  return new Promise((ok,no)=>navigator.geolocation.getCurrentPosition(p=>ok(p.coords),no,{enableHighAccuracy:true,timeout:15000}));
}
async function notifyPermission(ask){
  if(LN){ const r=ask?await LN.requestPermissions():await LN.checkPermissions(); return r.display; }
  if(!("Notification" in window)) return "unsupported";
  return ask?await Notification.requestPermission():Notification.permission;
}
// Native: one-shot reminders for the next 8 weeks (well under Android's 500-alarm cap), rebuilt whenever check-ins or settings change.
async function scheduleReminders(){
  if(!LN) return;
  try{
    if((await LN.checkPermissions()).display!=="granted") return;
    const pend=await LN.getPending(); if(pend.notifications.length) await LN.cancel({notifications:pend.notifications.map(n=>({id:n.id}))});
    const [h,m]=S.remind.split(":").map(Number), list=[], now=Date.now();
    for(let i=0;i<56;i++){
      const d=new Date(); d.setDate(d.getDate()+i); d.setHours(h,m,0,0);
      const k=dateKey(d);
      if(!S.trainDays.includes(d.getDay())||S.checkins[k]||S.skips[k]||d.getTime()<=now) continue;
      list.push({id:+k.replaceAll("-",""),title:tr(STR.nTitle),body:t(STR.nBody,{s:tr(sessionFor(d).day.title)}),schedule:{at:d,allowWhileIdle:true},smallIcon:"ic_stat_gymbro"});
    }
    if(list.length) await LN.schedule({notifications:list});
  }catch(e){ console.warn("reminders",e); }
}

/* ---------- trainer logic ---------- */
const BYID = Object.fromEntries(EX.map(x=>[x.id,x]));
function rx(ex,pr){
  const g=GOALS[pr.goal], b=BUILDS[pr.build];
  let sets=g.sets+EXPS[pr.exp].sets, reps=g.reps;
  if(pr.goal==="strength"&&!ex.big){ sets=3; reps="8–10"; }
  if(b.cap) sets=Math.min(sets,b.cap);
  sets=Math.max(2,Math.min(6,sets));
  const rest=Math.max(20,(pr.goal==="strength"&&!ex.big?90:g.rest)+b.rest);
  return ex.timed?{sets,reps:g.secs+" s",rest,timed:1}:{sets,reps,rest};
}
function buildPlan(pr,mode){
  const g=GOALS[pr.goal], b=BUILDS[pr.build];
  return SPLITS[pr.days].map((key,i)=>{
    const [title,pats]=TEMPLATES[key], used=new Set(), items=[];
    for(const p of (g.finisher||b.finisher)?[...pats,"cardio"]:pats){
      const c=EX.filter(x=>x.mode.includes(mode)&&x.pat.includes(p)&&!used.has(x.id));
      if(!c.length) continue;
      const ex=c[i%c.length]; used.add(ex.id); items.push({ex,...rx(ex,pr)});
    }
    return {title,items};
  });
}
const minutes = day => Math.round(day.items.reduce((m,it)=>m+it.sets*(45+it.rest),0)/60)+5;
const plan = () => buildPlan(S.profile,S.mode);
function sessionFor(date){
  const ord=d=>(d+6)%7, days=[...S.trainDays].sort((a,b)=>ord(a)-ord(b)), dow=date.getDay(), p=plan(); // Monday-first week
  let idx=days.indexOf(dow); const rest=idx<0;
  if(rest){ idx=days.findIndex(d=>ord(d)>ord(dow)); if(idx<0) idx=0; }
  return {day:p[idx%p.length],idx,rest,next:days[idx]};
}
const rxText = it => `${it.sets} × ${it.reps} · ${tr(STR.rest)} ${fmtRest(it.rest)}`;

/* ---------- nutrition ---------- */
function nutrition(training){
  const b=S.body, pr=S.profile, g=GOALS[pr.goal], bd=BUILDS[pr.build];
  const bmr=10*b.weight+6.25*b.height-5*b.age+(b.sex==="m"?5:-161);
  const maint=bmr*ACTIVITY[pr.days], adj=g.kcal+(bd.kcal[pr.goal]||0);
  const base=Math.max(bmr,b.sex==="m"?1500:1200,maint*(1+adj));
  const protein=Math.round(g.pkg*b.weight*(bd.lean?.85:1));
  const fat=Math.round(base*(g.fat||.28)/9);
  const carbBase=Math.max(50,(base-protein*4-fat*9)/4);
  const carbs=Math.round(carbBase*(training?1.1:.9));
  const kcal=Math.round((protein*4+fat*9+carbs*4)/10)*10;
  return {maint:Math.round(maint/10)*10, adj, kcal, protein, fat, carbs, water:Math.round((b.weight*.035+(training?.5:0))*10)/10};
}
const food=(ing,per,q)=>({ing,kcal:Math.round(per.kcal*q),p:Math.round(per.p*q),c:Math.round(per.c*q),f:Math.round(per.f*q)});
function mealsFor(date,n){
  const [y,mo,dd]=dateKey(date).split("-").map(Number), day=Date.UTC(y,mo-1,dd)/864e5, q=x=>Math.min(3,Math.max(.5,Math.round(x*4)/4));
  const picks=SLOTS.map(([slot,share],si)=>{ const opts=RECIPES.filter(r=>r.slot.includes(slot)), r=opts[(day+si)%opts.length]; return {slot,r,raw:n.kcal*share/r.kcal}; });
  // recipes are protein-dense: scale them back so protein lands on target, then top up carbs and fat with plain staples
  const K0=picks.reduce((s,m)=>s+m.r.kcal*m.raw,0), P0=picks.reduce((s,m)=>s+m.r.p*m.raw,0);
  // short on protein: solve meal scale k plus lean chicken (1.65 kcal, 0.31 g protein per g) so both kcal and protein land
  const short=P0<n.protein*.95, k=short?Math.max(.4,(n.kcal-5.32*n.protein)/(K0-5.32*P0)):Math.min(1,n.protein*.92/P0);
  const meals=picks.map(({slot,r,raw})=>{ const portion=k<1?Math.max(.5,Math.floor(raw*k*4)/4):q(raw); return {slot,r,portion,kcal:Math.round(r.kcal*portion),p:Math.round(r.p*portion),c:Math.round(r.c*portion),f:Math.round(r.f*portion)}; });
  const sum=key=>meals.reduce((s,m)=>s+m[key],0), extras=[];
  const remP=n.protein-sum("p");
  if(remP>8){ const g=Math.round(remP/.31/10)*10; extras.push(food([g,"g","Chicken breast, cooked (or other lean protein)","Pechuga de pollo cocinada (u otra proteína magra)"],{kcal:1.65,p:.31,c:0,f:.036},g)); }
  let remK=n.kcal-sum("kcal")-extras.reduce((s,x)=>s+x.kcal,0), remF=n.fat-sum("f");
  if(remF>6&&remK>100){ const ml=Math.min(20,Math.round(Math.min(remF,remK*.4/9)/.92/5)*5); if(ml){ const x=food([ml,"ml","Olive oil","Aceite de oliva"],{kcal:8.8,p:0,c:0,f:.92},ml); extras.push(x); remK-=x.kcal; remF-=x.f; } }
  if(remF>8&&remK>150){ const g=Math.round(Math.min(remF/.5,remK*.4/6)/5)*5; const x=food([g,"g","Mixed nuts","Frutos secos variados"],{kcal:6,p:.2,c:.2,f:.5},g); extras.push(x); remK-=x.kcal; }
  if(remK>60){ const g=Math.min(500,Math.round(remK/1.3/10)*10), x=food([g,"g","Cooked rice, pasta or potatoes","Arroz, pasta o patata cocidos"],{kcal:1.3,p:.027,c:.28,f:.003},g); extras.push(x); remK-=x.kcal; }
  if(remK>60){ const g=Math.round(remK/3.7/10)*10; extras.push(food([g,"g","Oats or whole-grain bread","Avena o pan integral"],{kcal:3.7,p:.13,c:.6,f:.07},g)); }
  return {meals,extras};
}
function fmtIng([q,u,en,es],portion){
  const v=q*portion, name=S.lang==="es"?es:en;
  if(u==="pc"){ const r=Math.round(v*2)/2; return `${num(r,r%1?1:0)} × ${name}`; }
  return `${num(u==="ml"?Math.round(v/5)*5:Math.round(v))} ${u} ${name}`;
}

/* ---------- 3D figure ---------- */
const D=Math.PI/180;
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k], sub=(a,b)=>add(a,mul(b,-1));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2], nrm=a=>{const l=Math.hypot(...a);return l<1e-4?null:mul(a,1/l)};
const rotX=(v,a)=>{const c=Math.cos(a),s=Math.sin(a);return [v[0],v[1]*c-v[2]*s,v[1]*s+v[2]*c]};
const POSE0={p:0,hf:0,k:0,ha:6,s:0,a:8,e:8,lift:0};
function fullPose(ex,key){
  const P={...POSE0,...ex.base,...key}, o={p:P.p,lift:P.lift};
  for(const n of ["hf","k","ha","s","a","e"]) for(const side of ["L","R"]) o[n+side]=P[n+side]??P[n];
  return o;
}
function lerpPose(ex,f){ const [A,B]=ex._K, o={}; for(const k in A) o[k]=A[k]+(B[k]-A[k])*f; return o; }
function prep(ex){
  if(ex._K) return; ex._K=ex.keys.map(k=>fullPose(ex,k));
  // sample the loop once to frame the camera
  const pts=[]; for(let i=0;i<=16;i++){ const J=fk(ex,lerpPose(ex,i/16)); pts.push(...Object.values(J),...equipPts(ex,J)); }
  const cx=pts.reduce((s,p)=>s+p[0],0)/pts.length, cz=pts.reduce((s,p)=>s+p[2],0)/pts.length;
  ex._f={cx,cz,R:Math.max(...pts.map(p=>Math.hypot(p[0]-cx,p[2]-cz)))+.12,ymin:Math.min(0,...pts.map(p=>p[1])),ymax:Math.max(...pts.map(p=>p[1]))+.14};
}
function fk(ex,P){
  const W=v=>rotX(v,P.p*D), J={hip:[0,0,0],neck:W([0,.5,0]),head:W([0,.64,0])};
  for(const [sd,side] of [[1,"L"],[-1,"R"]]){
    const hf=P["hf"+side]*D,k=P["k"+side]*D,ha=P["ha"+side]*D,sa=hf-k;
    const hp=[sd*.1,0,0], kn=add(hp,mul([sd*Math.sin(ha),-Math.cos(ha)*Math.cos(hf),Math.cos(ha)*Math.sin(hf)],.45));
    const ft=add(kn,mul([sd*Math.sin(ha),-Math.cos(ha)*Math.cos(sa),Math.cos(ha)*Math.sin(sa)],.45));
    const toe=add(ft,[0,Math.sin(sa)*.13,Math.cos(sa)*.13]);
    const s=P["s"+side]*D,a=P["a"+side]*D,e=P["e"+side]*D, sh=[sd*.19,.47,0];
    const u=[sd*Math.sin(a),-Math.cos(a)*Math.cos(s),Math.cos(a)*Math.sin(s)];
    const r=[0,Math.sin(a)+Math.max(0,Math.sin(s)),Math.cos(a)*Math.cos(s)];
    const w=nrm(sub(r,mul(u,dot(r,u))))||[0,0,1];
    const el=add(sh,mul(u,.3)), hd=add(el,mul(add(mul(u,Math.cos(e)),mul(w,Math.sin(e))),.28));
    Object.assign(J,{["hp"+side]:W(hp),["kn"+side]:W(kn),["ft"+side]:W(ft),["toe"+side]:W(toe),["sh"+side]:W(sh),["el"+side]:W(el),["hd"+side]:W(hd)});
  }
  let dy=0,dz=0;
  const lowest=()=>Math.min(...Object.entries(J).map(([n,p])=>p[1]-(n==="head"?.1:.02)));
  if(ex.anchor==="hands"){ dy=ex.hands-(J.hdL[1]+J.hdR[1])/2; dz=-(J.hdL[2]+J.hdR[2])/2; }
  else if(ex.anchor==="none"){ [,dy,dz]=ex.root; }
  else { dy=-lowest(); dz=ex.anchor==="floorHands"?-(J.hdL[2]+J.hdR[2])/2:-(J.ftL[2]+J.ftR[2])/2; }
  for(const n in J) J[n]=add(J[n],[0,dy+P.lift,dz]);
  return J;
}
function equipPts(ex,J){
  const c=mul(add(J.hdL,J.hdR),.5);
  if(ex.eq==="barbell"||ex.bar) return [add(c,[.85,.23,0]),add(c,[-.85,-.23,0])];
  if(ex.eq==="pullbar") return [[.65,ex.hands+.12,0],[-.65,0,0]];
  if(ex.eq==="bench") return [[0,0,-.95],[0,0,.25]];
  if(ex.eq==="dipbars") return [[.3,0,-.35],[-.3,ex.hands,.35]];
  if(ex.eq==="chair") return [[.25,0,-.45],[-.25,.9,.05]];
  if(ex.eq==="door") return [[.45,2.1,c[2]],[-.45,0,c[2]]];
  return [];
}
function autoYaw(time){ // 10 s clip: side → 45° → front, eased turns
  const seq=[90,40,0], seg=10/3, i=Math.floor((time%10)/seg), into=(time%10)-i*seg;
  const from=seq[(i+2)%3], to=seq[i], f=Math.min(1,into/.7), sm=f*f*(3-2*f);
  return {yaw:from+(to-from)*sm, view:to};
}
const C={};
function readColors(){ const cs=getComputedStyle(document.documentElement); for(const k of ["ink","muted","faint","line","plate","raised"]) C[k]=cs.getPropertyValue("--"+k).trim(); }
function draw(cv,ex,time,yaw){
  prep(ex);
  const dpr=Math.min(2,devicePixelRatio||1), Wd=cv.clientWidth, H=cv.clientHeight; if(!Wd) return;
  if(cv.width!==Math.round(Wd*dpr)){ cv.width=Math.round(Wd*dpr); cv.height=Math.round(H*dpr); }
  const g=cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,Wd,H);
  const f=ex._f, ph=(time%ex.rep)/ex.rep, J=fk(ex,lerpPose(ex,(1-Math.cos(2*Math.PI*ph))/2));
  const sc=Math.min(Wd*.9/(2*f.R),H*.86/(f.ymax-f.ymin)), sy=Math.sin(yaw*D), cy=Math.cos(yaw*D), base=H*.93;
  const pr=p=>[Wd/2+((p[0]-f.cx)*cy-(p[2]-f.cz)*sy)*sc, base-(p[1]-f.ymin)*sc, (p[0]-f.cx)*sy+(p[2]-f.cz)*cy];
  const floorY=base+f.ymin*sc;
  g.strokeStyle=C.line; g.lineWidth=1; g.beginPath(); g.moveTo(0,floorY); g.lineTo(Wd,floorY); g.stroke();
  const hp=pr([J.hip[0],0,J.hip[2]]); g.fillStyle=C.raised; g.beginPath(); g.ellipse(hp[0],floorY,f.R*sc*.5,4,0,0,7); g.fill();
  const lw=Math.max(2.2,sc*.058), L=[];
  g.lineCap="round"; g.lineJoin="round";
  const seg=(a,b,col,w=lw)=>{const A=pr(a),B=pr(b); L.push({d:(A[2]+B[2])/2,f(){g.strokeStyle=col;g.lineWidth=w;g.beginPath();g.moveTo(A[0],A[1]);g.lineTo(B[0],B[1]);g.stroke();}})};
  const disc=(c,R,th)=>{const A=pr(c); L.push({d:A[2],f(){g.fillStyle=C.plate;g.strokeStyle=C.muted;g.lineWidth=1;g.beginPath();g.ellipse(A[0],A[1],Math.max(th*sc,R*Math.abs(sy)*sc+th*Math.abs(cy)*sc*.5),R*sc,0,0,7);g.fill();g.stroke();}})};
  const flat=pts=>{g.fillStyle=C.raised;g.strokeStyle=C.faint;g.lineWidth=1;g.beginPath();pts.map(pr).forEach((p,i)=>i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]));g.closePath();g.fill();g.stroke();};
  const line=(a,b,w,col=C.faint)=>{const A=pr(a),B=pr(b);g.strokeStyle=col;g.lineWidth=w;g.beginPath();g.moveTo(A[0],A[1]);g.lineTo(B[0],B[1]);g.stroke();};
  // static equipment sits behind the athlete
  if(ex.eq==="bench"){ const y=.42,z0=-.95,z1=.25; for(const z of [z0+.1,z1-.1]) line([0,0,z],[0,y,z],lw*.7); flat([[.15,y,z0],[-.15,y,z0],[-.15,y,z1],[.15,y,z1]]); }
  if(ex.eq==="pullbar"){ const y=ex.hands; line([.62,0,0],[.62,y+.06,0],lw*.6); line([-.62,0,0],[-.62,y+.06,0],lw*.6); line([.62,y,0],[-.62,y,0],lw*.45,C.muted); }
  if(ex.eq==="dipbars"){ const y=ex.hands; for(const x of [.28,-.28]){ line([x,y,-.35],[x,y,.35],lw*.5,C.muted); line([x,0,-.3],[x,y,-.3],lw*.4); line([x,0,.3],[x,y,.3],lw*.4);} }
  if(ex.eq==="chair"){ const y=ex.hands-.03, hz=(J.hdL[2]+J.hdR[2])/2; flat([[.24,y,hz+.04],[-.24,y,hz+.04],[-.24,y,hz-.42],[.24,y,hz-.42]]); for(const x of [.22,-.22]){ for(const z of [hz+.02,hz-.4]) line([x,0,z],[x,y,z],lw*.4); line([x,y,hz-.42],[x,y+.45,hz-.42],lw*.4);} line([.22,y+.45,hz-.42],[-.22,y+.45,hz-.42],lw*.4); }
  if(ex.eq==="door"){ const hz=(J.hdL[2]+J.hdR[2])/2+.05; for(const x of [.42,-.42]) line([x,0,hz],[x,2.05,hz],lw*.8); line([.42,2.05,hz],[-.42,2.05,hz],lw*.8); }
  // athlete: left side muted so the limbs read apart from any angle
  for(const [side,col] of [["L",C.muted],["R",C.ink]]){
    seg(J["hp"+side],J["kn"+side],col); seg(J["kn"+side],J["ft"+side],col); seg(J["ft"+side],J["toe"+side],col,lw*.8);
    seg(J["sh"+side],J["el"+side],col,lw*.9); seg(J["el"+side],J["hd"+side],col,lw*.85);
  }
  seg(J.hip,J.neck,C.ink,lw*1.8); seg(J.hpL,J.hpR,C.ink,lw*1.3); seg(J.shL,J.shR,C.ink,lw*1.1);
  { const A=pr(J.head); L.push({d:A[2],f(){g.fillStyle=C.ink;g.beginPath();g.arc(A[0],A[1],.1*sc,0,7);g.fill();}}); }
  const c=mul(add(J.hdL,J.hdR),.5);
  if(ex.eq==="barbell"||ex.bar){ seg(add(c,[.85,0,0]),add(c,[-.85,0,0]),C.muted,Math.max(2,lw*.32)); for(const s of [1,-1]){ disc(add(c,[s*.62,0,0]),.225,.035); disc(add(c,[s*.7,0,0]),.2,.03);} }
  if(ex.eq==="dumbbell") for(const side of ["L","R"]){ const h=J["hd"+side]; seg(add(h,[.08,0,0]),add(h,[-.08,0,0]),C.muted,Math.max(2,lw*.4)); for(const s of [1,-1]) disc(add(h,[s*.09,0,0]),.065,.025); }
  L.sort((a,b)=>a.d-b.d).forEach(x=>x.f());
}

/* ---------- animation loop ---------- */
const live=new Map();
const io=new IntersectionObserver(es=>es.forEach(e=>{const v=live.get(e.target); if(v) v.on=e.isIntersecting;}));
function anim(cv,ex){ live.set(cv,{ex,on:false}); io.observe(cv); }
const reduce=matchMedia("(prefers-reduced-motion: reduce)");
let modal=null, frame=0;
function loop(ts){
  if(frame++%60===0) readColors();
  const time=reduce.matches?0:ts/1000;
  for(const [cv,v] of live){ if(!cv.isConnected){ live.delete(cv); io.unobserve(cv); continue; } if(v.on) draw(cv,v.ex,time,40); }
  if(modal){
    const mt=(ts-modal.t0)/1000, a=modal.view==="auto"?autoYaw(mt):{yaw:+modal.view,view:+modal.view};
    draw(modal.cv,modal.ex,mt,a.yaw);
    $("#d-hud").textContent=tr(STR.views[a.view])+" · 0:"+String(Math.floor(mt%10)).padStart(2,"0")+" / 0:10";
    $("#d-prog").style.width=((mt%10)/10*100)+"%";
  }
  requestAnimationFrame(loop);
}

/* ---------- views ---------- */
const $=s=>document.querySelector(s);
function renderToday(){
  const el=$("#v-today"), {day,rest,next,idx}=sessionFor(new Date()), d=today(), done=S.log[d]||{}, checked=S.checkins[d];
  const dateStr=new Date().toLocaleDateString(S.lang,{weekday:"long",month:"long",day:"numeric"});
  el.innerHTML=`
   ${due()?`<div class="card banner" role="status"><p><b>${tr(STR.noCheck)}</b> <span class="muted">${esc(t(STR.plannedFor,{s:tr(day.title),t:S.remind}))}</span></p>
     <div class="row"><button class="btn primary" data-act="checkin">${tr(STR.trainingNow)}</button><button class="btn" data-act="skip">${tr(STR.restToday)}</button></div></div>`:""}
   <div class="row between">
     <div><div class="eyebrow">${esc(dateStr)}</div><h2>${esc(rest?tr(STR.restDay):tr(day.title))}</h2>
       <p class="muted">${rest?`${tr(STR.nextUp)} ${esc(dowName(next,"long"))}: ${esc(tr(day.title))}`:esc(t(STR.dayOf,{a:idx+1,b:S.trainDays.length}))} · ${t(STR.about,{n:minutes(day)})} · ${esc(tr(GOALS[S.profile.goal].name))}</p></div>
     ${checked?`<span class="chip">${tr(STR.checkedIn)}${checked==="location"?" "+tr(STR.atGym):""}</span>`:`<button class="btn" data-act="checkin">${tr(STR.checkIn)}</button>`}
   </div>
   <div class="card">${day.items.map(it=>`
     <div class="ex-row">
       <button class="thumb" data-open="${it.ex.id}" aria-label="${esc(t(STR.howTo,{x:tr(it.ex.name)}))}"><canvas></canvas></button>
       <div style="min-width:0">
         <p class="ex-name">${esc(tr(it.ex.name))}</p>
         <div class="rx">${esc(rxText(it))}</div>
         <div class="sets" role="group" aria-label="${esc(t(STR.setsFor,{x:tr(it.ex.name)}))}">${Array.from({length:it.sets},(_,i)=>`<button data-ex="${it.ex.id}" data-i="${i}" aria-pressed="${(done[it.ex.id]||0)>i}" aria-label="${t(STR.setN,{n:i+1})}">${i+1}</button>`).join("")}</div>
       </div>
     </div>`).join("")}</div>
   <p class="muted" style="max-width:65ch">${esc(tr(GOALS[S.profile.goal].note))} ${esc(tr(BUILDS[S.profile.build].tip))}</p>`;
  el.querySelectorAll(".thumb canvas").forEach(cv=>anim(cv,BYID[cv.parentNode.dataset.open]));
  el.querySelectorAll(".sets button").forEach(b=>b.onclick=()=>{
    const l=S.log[d]||(S.log[d]={}), i=+b.dataset.i, n=l[b.dataset.ex]||0;
    l[b.dataset.ex]=n===i+1?i:i+1;
    if(Object.values(l).some(v=>v>0)&&!S.checkins[d]){ S.checkins[d]="workout"; scheduleReminders(); }
    save(); renderToday(); renderProg();
  });
}
function renderLib(){
  $("#q").placeholder=tr(STR.search); $("#q").setAttribute("aria-label",tr(STR.search));
  const sel=$("#muscle"), cur=sel.value||"all";
  sel.innerHTML=`<option value="all">${tr(STR.allMuscles)}</option>`+Object.keys(MUSCLE_PATS).map(m=>`<option value="${m}">${tr(STR.muscles[m])}</option>`).join("");
  sel.value=cur;
  const q=$("#q").value.toLowerCase(), m=sel.value;
  const list=EX.filter(x=>x.mode.includes(S.mode)&&(!q||(tr(x.name)+tr(x.muscles)).toLowerCase().includes(q))&&(m==="all"||x.pat.some(p=>MUSCLE_PATS[m].includes(p))));
  $("#lib").innerHTML=list.length?list.map(x=>{const r=rx(x,S.profile);return `<button class="tile" data-open="${x.id}"><canvas></canvas><div><span class="ex-name">${esc(tr(x.name))}</span><span class="rx">${esc(tr(x.muscles))}</span><span class="rx">${r.sets} × ${esc(r.reps)}</span></div></button>`}).join(""):`<p class="muted">${tr(STR.noMatch)}</p>`;
  $("#lib").querySelectorAll(".tile").forEach(b=>anim(b.querySelector("canvas"),BYID[b.dataset.open]));
}
const opts=(obj,sel)=>Object.entries(obj).map(([k,v])=>`<option value="${k}" ${k===sel?"selected":""}>${esc(tr(v.name))}${v.tag?" · "+esc(tr(v.tag)):""}</option>`).join("");
function renderPlan(){
  const pr=S.profile, p=plan(), g=GOALS[pr.goal], b=BUILDS[pr.build];
  const split=pr.days<=3?t(STR.whySplit.full,{d:pr.days}):pr.days===4?tr(STR.whySplit.ul):t(STR.whySplit.ppl,{d:pr.days});
  $("#v-plan").innerHTML=`
   <div><div class="eyebrow">${tr(STR.profiles)}</div><h2>${tr(STR.pickStart)}</h2></div>
   <div class="presets">${PRESETS.map((x,i)=>`<button class="preset" data-preset="${i}" aria-pressed="${x.build===pr.build&&x.goal===pr.goal}"><b>${esc(tr(x.name))}</b><span class="muted">${esc(tr(x.sub))}</span></button>`).join("")}</div>
   <div class="card"><h3>${tr(STR.tune)}</h3>
     <div class="form">
       <label class="field">${tr(STR.build)}<select id="f-build">${opts(BUILDS,pr.build)}</select></label>
       <label class="field">${tr(STR.goal)}<select id="f-goal">${opts(GOALS,pr.goal)}</select></label>
       <label class="field">${tr(STR.exp)}<select id="f-exp">${opts(EXPS,pr.exp)}</select></label>
       <label class="field">${tr(STR.daysWk)}<select id="f-days">${[2,3,4,5,6].map(n=>`<option ${n==pr.days?"selected":""}>${n}</option>`).join("")}</select></label>
     </div></div>
   <div class="card"><h3>${tr(STR.why)}</h3><ul class="why">
     <li>${esc(t(STR.whyReps,{g:tr(g.name),r:g.reps,t:fmtRest(Math.max(20,g.rest+b.rest)),n:tr(g.note)}))}</li>
     <li>${esc(split)}</li>
     <li>${esc(tr(b.name))} (${esc(tr(b.tag))}): ${esc(tr(b.tip))}</li>
     <li>${esc(tr(EXPS[pr.exp].name))}: ${esc(tr(STR.whyExp[pr.exp]))}</li>
     ${(g.finisher||b.finisher)?`<li>${tr(STR.finisher)}</li>`:""}
     <li>${esc(t(STR.showing,{a:tr(S.mode==="gym"?STR.gymW:STR.homeW),b:tr(S.mode==="gym"?STR.homeW:STR.gymW)}))}</li></ul></div>
   <div class="days">${p.map((d,i)=>`<div class="card day"><div class="eyebrow">${tr(STR.session)} ${String.fromCharCode(65+i)}</div><h3>${esc(tr(d.title))} <span class="muted" style="font:400 14px var(--body)">· ${t(STR.about,{n:minutes(d)})}</span></h3>
     <ol>${d.items.map(it=>`<li><a href="#" data-open="${it.ex.id}">${esc(tr(it.ex.name))}</a><br><span>${esc(rxText(it))}</span></li>`).join("")}</ol></div>`).join("")}</div>
   <p class="muted" style="max-width:65ch">${tr(STR.rotate)}</p>`;
  const v=$("#v-plan");
  for(const k of ["build","goal","exp","days"]) v.querySelector("#f-"+k).onchange=e=>{
    S.profile[k]=k==="days"?+e.target.value:e.target.value;
    if(k==="days") S.trainDays=DEFAULT_DAYS[S.profile.days];
    save(); renderAll(); scheduleReminders();
  };
}
function renderFood(){
  const b=S.body, {rest}=sessionFor(new Date()), n=nutrition(!rest), other=nutrition(rest), pct=Math.round(n.adj*100);
  const {meals,extras}=mealsFor(new Date(),n), tot=[...meals,...extras].reduce((a,m)=>({kcal:a.kcal+m.kcal,p:a.p+m.p,c:a.c+m.c,f:a.f+m.f}),{kcal:0,p:0,c:0,f:0});
  const adjTxt=pct>0?t(STR.surplus,{n:pct}):pct<0?t(STR.deficit,{n:-pct}):tr(STR.atMaint);
  // grocery list: next 7 days of meals
  const groc=new Map();
  for(let i=0;i<7;i++){ const d=new Date(); d.setDate(d.getDate()+i); const s=sessionFor(d); const plan7=mealsFor(d,nutrition(!s.rest)); for(const [ing,portion] of [...plan7.meals.flatMap(m=>m.r.ing.map(i=>[i,m.portion])),...plan7.extras.map(x=>[x.ing,1])]){ const cur=groc.get(ing[2])||{ing,q:0}; cur.q+=ing[0]*portion; groc.set(ing[2],cur);} }
  const grocList=[...groc.values()].sort((a,b)=>tr([a.ing[2],a.ing[3]]).localeCompare(tr([b.ing[2],b.ing[3]]),S.lang));
  $("#v-food").innerHTML=`
   <div><div class="eyebrow">${esc(t(STR.todayIs,{d:tr(rest?STR.restDayN:STR.trainDay).toLowerCase()}))}</div><h2>${tr(STR.target)}</h2></div>
   <div class="macros">
     <div><span class="eyebrow">${tr(STR.kcal)}</span><b>${num(n.kcal)}</b><small>${tr(rest?STR.trainDay:STR.restDayN)}: ${num(other.kcal)}</small></div>
     <div><span class="eyebrow">${tr(STR.protein)}</span><b>${n.protein} g</b><small>${num(n.protein/b.weight,1)} g/kg</small></div>
     <div><span class="eyebrow">${tr(STR.carbs)}</span><b>${n.carbs} g</b><small>${tr(rest?STR.trainDay:STR.restDayN)}: ${other.carbs} g</small></div>
     <div><span class="eyebrow">${tr(STR.fat)}</span><b>${n.fat} g</b><small>${tr(STR.water)}: ${t(STR.litres,{n:num(n.water,1)})}</small></div>
   </div>
   <p class="muted" style="max-width:65ch">${esc(t(STR.maint,{m:num(n.maint),p:adjTxt,g:tr(GOALS[S.profile.goal].name).toLowerCase()}))}</p>
   <div class="card"><h3>${tr(STR.yourBody)}</h3><div class="form">
     <label class="field">${tr(STR.sex)}<select id="b-sex"><option value="m" ${b.sex==="m"?"selected":""}>${tr(STR.male)}</option><option value="f" ${b.sex==="f"?"selected":""}>${tr(STR.female)}</option></select></label>
     <label class="field">${tr(STR.age)}<input id="b-age" type="number" inputmode="numeric" min="14" max="90" value="${b.age}"></label>
     <label class="field">${tr(STR.height)}<input id="b-height" type="number" inputmode="numeric" min="130" max="220" value="${b.height}"></label>
     <label class="field">${tr(STR.weight)}<input id="b-weight" type="number" inputmode="decimal" min="35" max="250" step="0.5" value="${b.weight}"></label>
   </div></div>
   <div class="card"><div class="row between"><h3>${tr(STR.todaysMeals)}</h3><span class="rx">${tr(STR.dayTotal)} ${num(tot.kcal)} kcal · P ${tot.p} · C ${tot.c} · ${tr(["F","G"])} ${tot.f} — ${t(STR.vsTarget,{n:num(n.kcal)})}</span></div>
     ${meals.map(m=>`<div class="meal">
       <div class="eyebrow">${tr(STR.slots[m.slot])}</div>
       <p class="ex-name">${esc(tr(m.r.name))}</p>
       <div class="rx">${m.portion===1?tr(STR.serving1):t(STR.servings,{n:num(m.portion,m.portion%1?2:0)})} · ${num(m.kcal)} kcal · P ${m.p} g · C ${m.c} g · ${tr(["F","G"])} ${m.f} g · ${t(STR.mins,{n:m.r.min})}</div>
       <details><summary>${tr(STR.recipe)}</summary><div class="recipe">
         <div><div class="eyebrow" style="margin-bottom:8px">${tr(STR.ingredients)}</div><ul>${m.r.ing.map(i=>`<li>${esc(fmtIng(i,m.portion))}</li>`).join("")}</ul></div>
         <div><div class="eyebrow" style="margin-bottom:8px">${tr(STR.method)}</div><ol>${tr(m.r.steps).map(s=>`<li>${esc(s)}</li>`).join("")}</ol></div>
       </div></details></div>`).join("")}
     ${extras.length?`<div class="meal"><div class="eyebrow">${tr(STR.extras)}</div>
       <ul class="why">${extras.map(x=>`<li>${esc(fmtIng(x.ing,1))} <span class="rx">· ${num(x.kcal)} kcal</span></li>`).join("")}</ul>
       <p class="rx">${tr(STR.extrasHint)}</p></div>`:""}
   </div>
   <div class="card"><h3>${tr(STR.tips)}</h3><ul class="why">
     ${NUTRI_TIPS[S.profile.goal].map(x=>`<li>${esc(tr(x))}</li>`).join("")}
     <li>${tr(STR.preWorkout)}</li><li>${tr(STR.supps)}</li></ul></div>
   <div class="card"><h3>${tr(STR.grocery)}</h3><ul class="grocery">${grocList.map(({ing,q})=>`<li><span>${esc(tr([ing[2],ing[3]]))}</span><span>${esc(fmtIng([q,ing[1],"",""],1).trim())}</span></li>`).join("")}</ul></div>
   <p class="fine">${tr(STR.disclaimer)}</p>`;
  const lim={age:[14,90],height:[130,220],weight:[35,250]};
  $("#b-sex").onchange=e=>{ S.body.sex=e.target.value; save(); renderFood(); };
  for(const k in lim) $("#b-"+k).onchange=e=>{
    const v=parseFloat(e.target.value);
    S.body[k]=Number.isFinite(v)?Math.min(lim[k][1],Math.max(lim[k][0],v)):DEF_STATE.body[k];
    save(); renderFood();
  };
}

/* ---------- attendance + reminders ---------- */
function due(){
  const d=today(), now=new Date(), [h,m]=S.remind.split(":").map(Number);
  return S.trainDays.includes(now.getDay())&&!S.checkins[d]&&!S.skips[d]&&now.getHours()*60+now.getMinutes()>=h*60+m;
}
function checkIn(how){ const d=today(); if(!S.checkins[d]||how==="location") S.checkins[d]=how; save(); renderToday(); renderProg(); scheduleReminders(); }
function streak(){
  let n=0; const d=new Date(); if(!S.checkins[today()]) d.setDate(d.getDate()-1);
  for(let i=0;i<400;i++,d.setDate(d.getDate()-1)){
    const k=dateKey(d);
    if(S.checkins[k]) n++; else if(S.trainDays.includes(d.getDay())&&!S.skips[k]) break;
  }
  return n;
}
async function renderProg(){
  const now=new Date(), mon=new Date(now); mon.setDate(now.getDate()-((now.getDay()+6)%7));
  const wk=Object.keys(S.checkins).filter(k=>k>=dateKey(mon)).length;
  const mPrefix=today().slice(0,7), setsM=Object.entries(S.log).filter(([k])=>k.startsWith(mPrefix)).reduce((s,[,l])=>s+Object.values(l).reduce((a,b)=>a+b,0),0);
  const start=new Date(mon); start.setDate(mon.getDate()-7*15); const end=new Date(mon); end.setDate(mon.getDate()+6); const cells=[];
  for(const d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    const k=dateKey(d), sets=Object.values(S.log[k]||{}).reduce((a,b)=>a+b,0);
    cells.push(`<i class="${S.checkins[k]?(sets>=10?"l2":"l1"):""} ${k===today()?"today":""}" title="${k}${sets?" · "+sets:""}"></i>`);
  }
  const perm=await notifyPermission(false);
  $("#v-prog").innerHTML=`
   <div class="stats">
     <div class="card stat"><span class="eyebrow">${tr(STR.streak)}</span><b>${streak()}</b><span class="muted">${tr(STR.inRow)}</span></div>
     <div class="card stat"><span class="eyebrow">${tr(STR.thisWeek)}</span><b>${wk}/${S.trainDays.length}</b><span class="muted">${tr(STR.done)}</span></div>
     <div class="card stat"><span class="eyebrow">${tr(STR.thisMonth)}</span><b>${setsM}</b><span class="muted">${tr(STR.setsLogged)}</span></div>
   </div>
   <div class="card"><h3>${tr(STR.attendance)}</h3><div class="heat-wrap"><div class="heat">${cells.join("")}</div></div>
     <div class="row muted" style="font-size:12px;gap:16px"><span>${tr(STR.heatKey)}</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--faint)"></i> ${tr(STR.ckd)}</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--ink)"></i> ${tr(STR.tenSets)}</span></div></div>
   <div class="card"><h3>${tr(STR.reminders)}</h3>
     <p class="muted" style="max-width:65ch">${tr(STR.remindInfo)}</p>
     <div class="field">${tr(STR.trainDays)}<div class="dow" role="group">${[1,2,3,4,5,6,0].map(d=>`<button data-d="${d}" aria-pressed="${S.trainDays.includes(d)}">${esc(dowName(d))}</button>`).join("")}</div></div>
     <label class="field" style="max-width:240px">${tr(STR.remindBy)}<input type="time" id="remind" value="${esc(S.remind)}"></label>
     <div class="row"><button class="btn${perm==="granted"?"":" primary"}" id="notif">${tr(perm==="granted"?STR.notifOn:STR.notifTurnOn)}</button><button class="btn" id="setgym">${tr(S.gym?STR.gymUpdate:STR.gymSave)}</button><button class="btn" id="testn">${tr(STR.testN)}</button></div>
     <div class="status" id="pstatus" role="status"></div></div>`;
  const v=$("#v-prog"), st=m=>v.querySelector("#pstatus").textContent=m;
  v.querySelectorAll(".dow button").forEach(b=>b.onclick=()=>{
    const d=+b.dataset.d, set=new Set(S.trainDays); set.has(d)?set.delete(d):set.add(d);
    if(set.size<2||set.size>6) return st(tr(STR.dayRange));
    S.trainDays=[...set]; S.profile.days=set.size; save(); renderAll(); scheduleReminders();
  });
  v.querySelector("#remind").onchange=e=>{ S.remind=e.target.value||"18:00"; save(); renderToday(); scheduleReminders(); };
  v.querySelector("#notif").onclick=async()=>{
    try{ const p=await notifyPermission(true); if(p==="unsupported") return st(tr(STR.nUnsupported)); st(tr(p==="granted"?STR.nGranted:STR.nBlocked)); if(p==="granted"){ await scheduleReminders(); renderProg(); } }
    catch{ st(tr(STR.nBlocked)); }
  };
  v.querySelector("#setgym").onclick=async()=>{
    st(tr(STR.locFinding));
    try{ const c=await getPosition(); S.gym={lat:c.latitude,lon:c.longitude}; save(); await renderProg(); $("#pstatus").textContent=tr(STR.locSaved); }
    catch(e){ st(tr(e?.message==="unsupported"?STR.locNone:STR.locBlocked)); }
  };
  v.querySelector("#testn").onclick=async()=>st(tr(await notify(true)?STR.testSent:STR.nBlocked));
}
async function notify(test){
  const body=test?tr(STR.nTest):t(STR.nBody,{s:tr(sessionFor(new Date()).day.title)});
  try{
    if(LN){ if((await LN.checkPermissions()).display!=="granted") return false; await LN.schedule({notifications:[{id:1,title:tr(STR.nTitle),body,schedule:{at:new Date(Date.now()+1500)},smallIcon:"ic_stat_gymbro"}]}); return true; }
    if("Notification" in window&&Notification.permission==="granted"){ new Notification(tr(STR.nTitle),{body,tag:"gymbro"}); return true; }
  }catch(e){ console.warn("notify",e); }
  return false;
}
function dist(a,b){ const R=6371e3,r=x=>x*D, dl=r(b.lat-a.lat), dn=r(b.lon-a.lon), h=Math.sin(dl/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dn/2)**2; return 2*R*Math.asin(Math.sqrt(h)); }
let lastGeo=0;
function tick(){
  const d=today(), now=Date.now();
  if(S.gym&&!S.checkins[d]&&now-lastGeo>5*60e3){ lastGeo=now;
    getPosition().then(c=>{ if(dist(S.gym,{lat:c.latitude,lon:c.longitude})<150) checkIn("location"); }).catch(()=>{}); }
  // native reminders are pre-scheduled; this covers the web build
  if(!LN&&due()&&S.notified!==d) notify(false).then(ok=>{ if(ok){ S.notified=d; save(); } });
  if(S.tab==="today"&&!!document.querySelector("#v-today .banner")!==due()) renderToday();
}

/* ---------- shell ---------- */
const TABS=["today","lib","plan","food","prog"];
function setTab(id){
  S.tab=TABS.includes(id)?id:"today"; save();
  for(const k of TABS){ $("#t-"+k).setAttribute("aria-selected",k===S.tab); $("#v-"+k).hidden=k!==S.tab; }
}
function renderAll(){
  document.documentElement.lang=S.lang;
  for(const k of TABS) $("#t-"+k).textContent=tr(STR.tabs[k]);
  document.querySelectorAll("#lang-seg button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.lang===S.lang));
  document.querySelectorAll("#mode-seg button").forEach(b=>{ b.setAttribute("aria-pressed",b.dataset.mode===S.mode); b.title=tr(STR[b.dataset.mode]); b.setAttribute("aria-label",tr(STR[b.dataset.mode])); });
  $("#lang-seg").setAttribute("aria-label","Language / Idioma"); $("#mode-seg").setAttribute("aria-label",tr(STR.gym)+" / "+tr(STR.home));
  $("#views").setAttribute("aria-label",tr(STR.angle)); $("#d-close").setAttribute("aria-label",tr(STR.close));
  const vb=document.querySelectorAll("#views button"); vb[0].textContent=tr(STR.auto); vb[1].textContent=tr(STR.side); vb[3].textContent=tr(STR.front);
  renderToday(); renderLib(); renderPlan(); renderFood(); renderProg(); setTab(S.tab);
}
function openEx(id){
  const ex=BYID[id]; if(!ex) return; const r=rx(ex,S.profile);
  $("#d-name").textContent=tr(ex.name); $("#d-muscles").textContent=tr(ex.muscles);
  $("#d-cues").innerHTML=tr(ex.cues).map(c=>`<li>${esc(c)}</li>`).join("");
  $("#d-target").innerHTML=`<div><span class="eyebrow">${tr(STR.sets)}</span><b>${r.sets}</b></div><div><span class="eyebrow">${tr(r.timed?STR.time:STR.reps)}</span><b>${esc(r.reps)}</b></div><div><span class="eyebrow">${tr(STR.restCap)}</span><b>${fmtRest(r.rest)}</b></div><div><span class="eyebrow">${tr(STR.forGoal)}</span><b style="font-size:19px;padding-top:5px">${esc(tr(GOALS[S.profile.goal].name))}</b></div>`;
  modal={ex,cv:$("#d-canvas"),view:"auto",t0:performance.now()}; setView("auto");
  $("#dlg").showModal();
  history.pushState({dlg:1},""); // Android back button pops this entry instead of exiting the app
}
function setView(v){ if(modal){ modal.view=v; modal.t0=performance.now(); } document.querySelectorAll("#views button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.view===v)); }
document.addEventListener("click",e=>{
  const el=e.target.closest("[data-open],[data-preset],[data-act],#lang-seg button,#mode-seg button,nav button,#views button"); if(!el) return;
  if(el.dataset.open){ e.preventDefault(); openEx(el.dataset.open); }
  else if(el.dataset.preset){ const x=PRESETS[el.dataset.preset]; Object.assign(S.profile,{build:x.build,goal:x.goal}); save(); renderAll(); scheduleReminders(); }
  else if(el.dataset.act==="checkin") checkIn("manual");
  else if(el.dataset.act==="skip"){ S.skips[today()]=1; save(); renderToday(); scheduleReminders(); }
  else if(el.dataset.lang){ S.lang=el.dataset.lang; save(); renderAll(); scheduleReminders(); }
  else if(el.dataset.mode){ S.mode=el.dataset.mode; save(); renderAll(); }
  else if(el.dataset.view) setView(el.dataset.view);
  else setTab(el.id.slice(2));
});
$("#d-close").onclick=()=>$("#dlg").close();
$("#dlg").addEventListener("close",()=>{ modal=null; if(history.state?.dlg) history.back(); });
addEventListener("popstate",()=>{ if($("#dlg").open) $("#dlg").close(); });
$("#dlg").addEventListener("click",e=>{ if(e.target.id==="dlg") $("#dlg").close(); });
$("#q").oninput=renderLib; $("#muscle").onchange=renderLib;
document.addEventListener("visibilitychange",()=>{ if(!document.hidden){ renderAll(); tick(); } });

// self-checks (browser dev only): every profile yields a usable plan, recipe macros add up, calorie targets stay sane
if(!NATIVE){
for(const mode of ["gym","home"]) for(const days of [2,3,4,5,6]) for(const goal in GOALS)
  buildPlan({build:"athletic",goal,exp:"beginner",days},mode).forEach(d=>console.assert(d.items.length>=3,"thin plan",mode,days,goal,tr(d.title)));
for(const r of RECIPES) console.assert(Math.abs(r.p*4+r.c*4+r.f*9-r.kcal)/r.kcal<.1,"recipe macros off",r.id);
console.assert((()=>{ const n=nutrition(true); return n.kcal>1200&&n.kcal<5000&&n.protein>50; })(),"nutrition out of range");
for(const goal in GOALS){ const n={...nutrition(true),kcal:goal==="fatloss"?1600:3200,protein:goal==="fatloss"?150:110}, {meals,extras}=mealsFor(new Date(),n), all=[...meals,...extras];
  const k=all.reduce((s,m)=>s+m.kcal,0), p=all.reduce((s,m)=>s+m.p,0);
  console.assert(Math.abs(k-n.kcal)/n.kcal<.08&&p>=n.protein*.9,"meal plan misses target",goal,k,p); }
}

readColors(); renderAll(); requestAnimationFrame(loop); setInterval(tick,60e3); tick(); scheduleReminders();
