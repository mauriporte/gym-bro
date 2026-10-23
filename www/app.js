"use strict";
/* ---------- state ---------- */
const dateKey = d => d.toLocaleDateString("en-CA");
const today = () => dateKey(new Date());
const DEF_STATE = {lang:(navigator.language||"en").startsWith("es")?"es":"en", mode:"gym",
  profile:{build:"athletic",goal:"muscle",exp:"intermediate",days:4}, body:{sex:"m",age:30,height:178,weight:80},
  trainDays:[1,2,4,5], remind:"18:00", gym:null, log:{}, checkins:{}, skips:{}, notified:"", tab:"today",
  onboarded:false, planStart:dateKey(new Date()), feedback:{}, kg:{}, coachSnooze:{}, deloadUntil:"", custom:[], adjust:{}};
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
  if(deloading()) sets--;
  sets=Math.max(2,Math.min(6,sets));
  // the user's own +/- tweaks for this exercise, kept across sessions
  const adj=S.adjust?.[ex.id]||{}, dr=adj.reps||0;
  sets=Math.max(1,Math.min(10,sets+(adj.sets||0)));
  const rest=Math.max(20,(pr.goal==="strength"&&!ex.big?90:g.rest)+b.rest);
  return ex.timed?{sets,reps:Math.max(10,g.secs+5*dr)+" s",rest,timed:1,adj:!!(adj.sets||dr)}
    :{sets,reps:reps.split("–").map(n=>Math.max(1,+n+dr)).join("–"),rest,adj:!!(adj.sets||dr)};
}
function adjust(id,key,d){
  const a=(S.adjust||(S.adjust={}))[id]||(S.adjust[id]={});
  a[key]=(a[key]||0)+d;
  if(!a.sets&&!a.reps) delete S.adjust[id];
  save(); renderToday(); renderLib(); renderPlan(); if(modal?.ex.id===id) renderTarget(modal.ex);
}
// "4 sets of 8–12 reps" with − / + steppers on both numbers
function adjLine(it,withRest=true){
  const id=it.ex.id, st=(key,label,lessL,moreL)=>`<span class="step"><button data-adj="${key}" data-ex="${id}" data-d="-1" aria-label="${tr(lessL)}">−</button><b>${tr(label)}</b><button data-adj="${key}" data-ex="${id}" data-d="1" aria-label="${tr(moreL)}">+</button></span>`;
  return `${withRest?`<div class="rx">${esc(rxText(it))}</div>`:""}<div class="adj">${st("sets",STR.sets,STR.fewerSets,STR.moreSets)}${st("reps",it.timed?STR.time:STR.reps,STR.fewerReps,STR.moreRepsBtn)}${it.adj?`<button class="reset" data-adj="reset" data-ex="${id}">${tr(STR.resetAdj)}</button>`:""}</div>`;
}
function buildPlan(pr,mode){
  const g=GOALS[pr.goal], b=BUILDS[pr.build];
  return SPLITS[pr.days].map((key,i)=>{
    const [title,pats]=TEMPLATES[key], used=new Set(), items=[];
    for(const p of (g.finisher||b.finisher)?[...pats,"cardio"]:pats){
      const c=EX.filter(x=>x.mode.includes(mode)&&x.pat.includes(p)&&!used.has(x.id));
      if(!c.length) continue;
      const ex=c.find(x=>x.inPlan)||c[i%c.length]; used.add(ex.id); items.push({ex,...rx(ex,pr)});
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
const rxShort = it => t(it.timed?STR.rxTimed:STR.rxFmt,{s:it.sets,r:it.reps});
const rxText = it => `${rxShort(it)} · ${tr(STR.rest)} ${fmtRest(it.rest)}`;

/* ---------- coach: adapts the plan to logged data ---------- */
const addDays = n => { const d=new Date(); d.setDate(d.getDate()+n); return dateKey(d); };
const deloading = () => !!S.deloadUntil && today()<=S.deloadUntil;
const weighted = ex => ex.eq==="barbell"||ex.eq==="dumbbell"||!!ex.bar;
function coach(){
  let done=0, planned=0, easy=0, hard7=0;
  for(let i=0;i<=14;i++){
    const d=new Date(); d.setDate(d.getDate()-i); const k=dateKey(d), f=S.feedback[k];
    if(f===-1) easy++; if(f===1&&i<=7) hard7++;
    if(i>0&&k>=S.planStart&&S.trainDays.includes(d.getDay())&&!S.skips[k]){ planned++; if(S.checkins[k]) done++; }
  }
  const pr=S.profile, adherence=planned?done/planned:null, weeks=Math.floor((new Date(today())-new Date(S.planStart))/6048e5);
  let s=null;
  if(!deloading()){
    if(hard7>=2) s={type:"deload"};
    else if(planned>=4&&adherence<.5&&pr.days>2) s={type:"fewer",n:pr.days-1};
    else if(planned>=4&&adherence>=.8&&(easy>=2||weeks>=6)){
      if(weeks>=6) s={type:"switch",goal:ROTATE[pr.goal]};
      else if(pr.exp!=="advanced") s={type:"levelup",exp:pr.exp==="beginner"?"intermediate":"advanced"};
      else if(pr.days<6) s={type:"moreDays",n:pr.days+1};
    }
  }
  if(s&&S.coachSnooze[s.type]>today()) s=null;
  return {done,planned,adherence,weeks,s};
}
function sugText(c){
  const s=c.s, pr=S.profile, pct=c.adherence==null?"":Math.round(c.adherence*100)+"%";
  return {title:tr(STR.sug[s.type].t), body:t(STR.sug[s.type].b,{done:c.done,planned:c.planned,n:s.n,pct,exp:s.exp&&tr(EXPS[s.exp].name),w:c.weeks,g:tr(GOALS[pr.goal].name).toLowerCase(),g2:s.goal&&tr(GOALS[s.goal].name).toLowerCase()})};
}
function applySuggestion(s){
  const pr=S.profile;
  if(s.type==="deload") S.deloadUntil=addDays(6);
  else { if(s.n){ pr.days=s.n; S.trainDays=DEFAULT_DAYS[s.n]; } if(s.exp) pr.exp=s.exp; if(s.goal) pr.goal=s.goal; S.planStart=today(); }
  save(); renderAll(); scheduleReminders();
}
const upGame = () => S.profile.exp!=="advanced"?{type:"levelup",exp:S.profile.exp==="beginner"?"intermediate":"advanced"}:{type:"switch",goal:ROTATE[S.profile.goal]};
function coachCard(c){
  if(!c.s) return "";
  const x=sugText(c);
  return `<div class="card"><div class="eyebrow">${tr(STR.coach)}</div><h3>${esc(x.title)}</h3><p class="muted" style="max-width:65ch">${esc(x.body)}</p>
    <div class="row"><button class="btn primary" data-coach="apply">${tr(STR.apply)}</button><button class="btn" data-coach="snooze">${tr(STR.notNow)}</button></div></div>`;
}
// last session's numbers for this exercise and what to do today (double progression)
function progressHint(it){
  const id=it.ex.id, d0=today();
  const last=Object.keys(S.log).filter(k=>k<d0&&S.log[k][id]).sort().pop();
  const finished=last&&S.log[last][id]>=it.sets&&S.feedback[last]!==1;
  if(!weighted(it.ex)) return {hint:finished?tr(it.timed?STR.moreSecs:STR.moreReps):""};
  const lastKg=Object.keys(S.kg).filter(k=>k<d0&&S.kg[k][id]).sort().pop();
  if(!lastKg) return {hint:tr(STR.logKg)};
  const kg=S.kg[lastKg][id], inc=it.ex.eq==="dumbbell"?2:it.ex.pat.some(p=>["squat","hinge","lunge"].includes(p))?5:2.5;
  const done=S.log[lastKg]?.[id]>=it.sets&&S.feedback[lastKg]!==1;
  return done?{hint:t(STR.lastKg,{kg:num(kg,kg%1?1:0),next:num(kg+inc,(kg+inc)%1?1:0)}),next:kg+inc}:{hint:t(STR.repeatKg,{kg:num(kg,kg%1?1:0)}),next:kg};
}

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
  if(ex._K) return; ex._K=ex.motion?true:ex.keys.map(k=>fullPose(ex,k));
  // sample the loop once to frame the camera
  const pts=[], frames=ex.motion?ex.motion.map((_,i)=>motionAt(ex,i*MOTION_DT)):Array.from({length:17},(_,i)=>fk(ex,lerpPose(ex,i/16)));
  for(const J of frames) pts.push(...Object.values(J),...equipPts(ex,J));
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
  if(ex.eq==="lowbar") return [[.6,ex.hands+.05,0],[-.6,0,0]];
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
  const f=ex._f, ph=(time%ex.rep)/ex.rep, J=ex.motion?motionAt(ex,time):fk(ex,lerpPose(ex,(1-Math.cos(2*Math.PI*ph))/2));
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
  if(ex.eq==="lowbar"){ const y=ex.hands; for(const x of [.58,-.58]) line([x,0,0],[x,y+.03,0],lw*.6); line([.58,y,0],[-.58,y,0],lw*.45,C.muted); }
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
   ${coachCard(coach())}
   <div class="row between">
     <div><div class="eyebrow">${esc(dateStr)}</div><h2>${esc(rest?tr(STR.restDay):tr(day.title))}</h2>
       <p class="muted">${rest?`${tr(STR.nextUp)} ${esc(dowName(next,"long"))}: ${esc(tr(day.title))}`:esc(t(STR.dayOf,{a:idx+1,b:S.trainDays.length}))} · ${t(STR.about,{n:minutes(day)})} · ${esc(tr(GOALS[S.profile.goal].name))}</p></div>
     <div class="row">${deloading()?`<span class="chip">${tr(STR.deloadChip)}</span>`:""}${checked?`<span class="chip">${tr(STR.checkedIn)}${checked==="location"?" "+tr(STR.atGym):""}</span>`:`<button class="btn" data-act="checkin">${tr(STR.checkIn)}</button>`}</div>
   </div>
   <div class="card">${day.items.map(it=>{ const h=progressHint(it), kg=S.kg[d]?.[it.ex.id]??h.next??""; return `
     <div class="ex-row">
       <button class="thumb" data-open="${it.ex.id}" aria-label="${esc(t(STR.howTo,{x:tr(it.ex.name)}))}"><canvas></canvas></button>
       <div style="min-width:0">
         <p class="ex-name">${esc(tr(it.ex.name))}</p>
         ${adjLine(it)}
         ${h.hint?`<div class="rx hint">${esc(h.hint)}</div>`:""}
         ${weighted(it.ex)?`<label class="kg"><input type="number" inputmode="decimal" min="0" max="500" step="0.5" data-kg="${it.ex.id}" value="${kg}" aria-label="${esc(t(STR.weightFor,{x:tr(it.ex.name)}))}"> kg</label>`:""}
         <div class="sets" role="group" aria-label="${esc(t(STR.setsFor,{x:tr(it.ex.name)}))}">${Array.from({length:it.sets},(_,i)=>`<button data-ex="${it.ex.id}" data-i="${i}" aria-pressed="${(done[it.ex.id]||0)>i}" aria-label="${t(STR.setN,{n:i+1})}">${i+1}</button>`).join("")}</div>
       </div>
     </div>`; }).join("")}</div>
   ${Object.values(done).some(v=>v>0)?`<div class="row"><span class="eyebrow">${tr(STR.feel)}</span><div class="seg" role="group" aria-label="${tr(STR.feel)}">${[[-1,STR.fbEasy],[0,STR.fbRight],[1,STR.fbHard]].map(([v,l])=>`<button data-fb="${v}" aria-pressed="${S.feedback[d]===v}">${tr(l)}</button>`).join("")}</div></div>`:""}
   <p class="muted" style="max-width:65ch">${esc(tr(GOALS[S.profile.goal].note))} ${esc(tr(BUILDS[S.profile.build].tip))}</p>`;
  el.querySelectorAll(".thumb canvas").forEach(cv=>anim(cv,BYID[cv.parentNode.dataset.open]));
  el.querySelectorAll(".sets button").forEach(b=>b.onclick=()=>{
    const l=S.log[d]||(S.log[d]={}), i=+b.dataset.i, n=l[b.dataset.ex]||0;
    l[b.dataset.ex]=n===i+1?i:i+1;
    // a suggested weight left as-is still counts as the weight used
    const inp=el.querySelector(`[data-kg="${b.dataset.ex}"]`), v=parseFloat(inp?.value);
    if(Number.isFinite(v)&&S.kg[d]?.[b.dataset.ex]==null) (S.kg[d]||(S.kg[d]={}))[b.dataset.ex]=v;
    if(Object.values(l).some(v=>v>0)&&!S.checkins[d]){ S.checkins[d]="workout"; scheduleReminders(); }
    save(); renderToday(); renderProg();
  });
  el.querySelectorAll("[data-kg]").forEach(i=>i.onchange=()=>{
    const v=parseFloat(i.value), l=S.kg[d]||(S.kg[d]={});
    if(Number.isFinite(v)&&v>=0&&v<=500) l[i.dataset.kg]=v; else delete l[i.dataset.kg];
    save();
  });
}
function renderLib(){
  $("#q").placeholder=tr(STR.search); $("#q").setAttribute("aria-label",tr(STR.search)); $("#add-btn").textContent=tr(STR.addExercise);
  const sel=$("#muscle"), cur=sel.value||"all";
  sel.innerHTML=`<option value="all">${tr(STR.allMuscles)}</option>`+Object.keys(MUSCLE_PATS).map(m=>`<option value="${m}">${tr(STR.muscles[m])}</option>`).join("");
  sel.value=cur;
  const q=$("#q").value.toLowerCase(), m=sel.value;
  const list=EX.filter(x=>x.mode.includes(S.mode)&&(!q||(tr(x.name)+tr(x.muscles)).toLowerCase().includes(q))&&(m==="all"||x.pat.some(p=>MUSCLE_PATS[m].includes(p))));
  $("#lib").innerHTML=list.length?list.map(x=>{const r=rx(x,S.profile);return `<button class="tile" data-open="${x.id}"><canvas></canvas><div><span class="ex-name">${esc(tr(x.name))}</span>${x.custom?`<span class="chip" style="align-self:flex-start">${tr(STR.yours)}</span>`:""}<span class="rx">${esc(tr(x.muscles))}</span><span class="rx">${esc(rxShort(r))}</span></div></button>`}).join(""):`<p class="muted">${tr(STR.noMatch)}</p>`;
  $("#lib").querySelectorAll(".tile").forEach(b=>anim(b.querySelector("canvas"),BYID[b.dataset.open]));
}
const opts=(obj,sel)=>Object.entries(obj).map(([k,v])=>`<option value="${k}" ${k===sel?"selected":""}>${esc(tr(v.name))}${v.tag?" · "+esc(tr(v.tag)):""}</option>`).join("");
function renderPlan(){
  const pr=S.profile, p=plan(), g=GOALS[pr.goal], b=BUILDS[pr.build];
  const split=pr.days<=3?t(STR.whySplit.full,{d:pr.days}):pr.days===4?tr(STR.whySplit.ul):t(STR.whySplit.ppl,{d:pr.days});
  const c=coach();
  $("#v-plan").innerHTML=`
   <div class="card"><div class="eyebrow">${tr(STR.coach)}</div>
     <p style="max-width:65ch">${esc(c.adherence==null?t(STR.coachNoData,{w:c.weeks+1}):t(STR.coachStatus,{w:c.weeks+1,pct:Math.round(c.adherence*100)+"%"}))} ${c.s?"":(c.adherence!=null?esc(tr(STR.coachOk)):"")}</p>
     ${c.s?`<p><b>${esc(sugText(c).title)}.</b> <span class="muted">${esc(sugText(c).body)}</span></p>`:""}
     <div class="row">${c.s?`<button class="btn primary" data-coach="apply">${tr(STR.apply)}</button>`:""}<button class="btn" data-coach="up">${tr(STR.upGame)}</button><button class="btn" data-redo>${tr(STR.redo)}</button></div></div>
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
     <li>${esc(t(STR.showing,{a:tr(STR[S.mode+"W"])}))}</li></ul></div>
   <div class="days">${p.map((d,i)=>`<div class="card day"><div class="eyebrow">${tr(STR.session)} ${String.fromCharCode(65+i)}</div><h3>${esc(tr(d.title))} <span class="muted" style="font:400 14px var(--body)">· ${t(STR.about,{n:minutes(d)})}</span></h3>
     <ol>${d.items.map(it=>`<li><a href="#" data-open="${it.ex.id}">${esc(tr(it.ex.name))}</a><br><span>${esc(rxText(it))}</span></li>`).join("")}</ol></div>`).join("")}</div>
   <p class="muted" style="max-width:65ch">${tr(STR.rotate)}</p>`;
  const v=$("#v-plan");
  for(const k of ["build","goal","exp","days"]) v.querySelector("#f-"+k).onchange=e=>{
    S.profile[k]=k==="days"?+e.target.value:e.target.value;
    if(k==="days") S.trainDays=DEFAULT_DAYS[S.profile.days];
    if(k==="goal") S.planStart=today(); // a new goal starts a new block for the coach
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

/* ---------- custom exercises ---------- */
const PAT_GROUP={pushH:"Chest",pullH:"Back",pullV:"Back",pushV:"Shoulders",shoulders:"Shoulders",bi:"Arms",tri:"Arms",squat:"Legs",hinge:"Legs",lunge:"Legs",core:"Core",cardio:"Cardio"};
const PAT_NAME={squat:["Squat","Sentadilla"],hinge:["Hip hinge","Bisagra de cadera"],lunge:["Lunge / single leg","Zancada / unilateral"],pushH:["Chest press","Empuje horizontal"],pushV:["Overhead press","Empuje vertical"],pullH:["Row","Remo"],pullV:["Vertical pull","Tirón vertical"],bi:["Biceps","Bíceps"],tri:["Triceps","Tríceps"],shoulders:["Shoulders","Hombros"],core:["Core","Core"],cardio:["Cardio","Cardio"]};
// ordered specific → general: on a tie the more specific movement wins ("jalón al pecho" is a pull, not a chest press)
const KEYWORDS={bi:"curl bicep biceps hammer martillo",tri:"tricep triceps extension pushdown dip fondo skull frances",shoulders:"lateral raise elevacion deltoid deltoides shrug encogimiento",pullV:"pullup dominada chin pulldown jalon",pullH:"row remo face pull seated",lunge:"lunge zancada split bulgarian bulgara step subida pistol",hinge:"deadlift muerto hinge bisagra thrust glute gluteo puente bridge morning swing",squat:"squat sentadilla goblet hack prensa legpress",pushV:"overhead militar shoulderpress arnold handstand pino",pushH:"bench banca chest pecho pushup flexion fly apertura",core:"plank plancha crunch abs abdominal core situp twist rueda hollow",cardio:"run correr jump salto burpee rope cuerda cardio sprint bike bici skipping jacks"};
const MODE_WORDS={gym:"barbell cable polea machine maquina smith rack prensa",home:"dumbbell mancuerna kettlebell rusa casa home floor suelo chair silla towel toalla band banda mat esterilla",cali:"calisthenics calistenia bodyweight corporal rings anillas park parque muscleup planche lever front back paralelas"};
const norm=s=>s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9 ]/g," ");
function matchText(text){
  const words=new Set(norm(text).split(/\s+/).filter(w=>w.length>2)), has=w=>[...words].some(x=>x.startsWith(w)||w.startsWith(x)&&x.length>3);
  const pats=Object.entries(KEYWORDS).map(([p,ws])=>[p,ws.split(" ").filter(has).length]).sort((a,b)=>b[1]-a[1]);
  const pat=pats[0][1]?pats[0][0]:null;
  const modes=MODES.map(m=>[m,MODE_WORDS[m].split(" ").filter(has).length]).sort((a,b)=>b[1]-a[1]), mode=modes[0][1]>modes[1][1]?modes[0][0]:null;
  const ranked=EX.filter(x=>!x.custom).map(x=>{
    let s=norm(x.name[0]+" "+x.name[1]).split(/\s+/).filter(w=>w.length>3&&has(w)).length*2;
    if(pat&&x.pat.includes(pat)) s+=3; if(mode&&x.mode.includes(mode)) s+=.5;
    return {x,s};
  }).filter(m=>pat?m.s>=3:m.s>0).sort((a,b)=>b.s-a.s);
  return {pat, mode, matches:ranked.slice(0,3).map(m=>m.x)};
}
// Pose comparison: joint-angle ranges from video landmarks vs. the same ranges sampled from each known exercise's animation.
const angBetween=(a,b)=>Math.acos(Math.max(-1,Math.min(1,dot(a,b)/(Math.hypot(...a)*Math.hypot(...b)||1))))/D;
function poseFeatures(frames){
  const rows=frames.map(J=>{
    const mid=(a,b)=>mul(add(J[a],J[b]),.5), sh=mid("shL","shR"), hp=mid("hpL","hpR"), up=sub(sh,hp);
    const avg=f=>(f("L")+f("R"))/2;
    return [angBetween(up,[0,1,0]),
      avg(s=>180-angBetween(up,sub(J["kn"+s],J["hp"+s]))),
      avg(s=>180-angBetween(sub(J["hp"+s],J["kn"+s]),sub(J["ft"+s],J["kn"+s]))),
      avg(s=>angBetween(mul(up,-1),sub(J["el"+s],J["sh"+s]))),
      avg(s=>180-angBetween(sub(J["sh"+s],J["el"+s]),sub(J["hd"+s],J["el"+s])))];
  });
  return [0,1,2,3,4].flatMap(i=>{ const v=rows.map(r=>r[i]).sort((a,b)=>a-b); return [v[Math.floor(v.length*.1)],v[Math.floor(v.length*.9)]]; });
}
function knownFeatures(ex){ prep(ex); return ex._feat||(ex._feat=poseFeatures([0,.125,.25,.375,.5,.625,.75,.875,1].map(f=>fk(ex,lerpPose(ex,f))))); }
const W8=[2,2,1,1,1,1,1,1,1,1];
const featDist=(a,b)=>Math.sqrt(a.reduce((s,v,i)=>s+W8[i]*(v-b[i])**2,0));
const MP="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";
let poseLM=null;
async function poseModel(){
  if(poseLM) return poseLM;
  const v=await import(MP+"/vision_bundle.mjs"), fs=await v.FilesetResolver.forVisionTasks(MP+"/wasm");
  return poseLM=await v.PoseLandmarker.createFromOptions(fs,{baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"},runningMode:"VIDEO",numPoses:1});
}
async function matchVideo(blob,onProgress){
  const lm=await poseModel(), vid=document.createElement("video"), url=URL.createObjectURL(blob);
  vid.muted=true; vid.playsInline=true; vid.src=url;
  try{
    await new Promise((ok,no)=>{ vid.onloadeddata=ok; vid.onerror=()=>no(new Error("video")); });
    const end=Math.min(vid.duration||0,15), frames=[];
    for(let tm=.05,n=0;tm<end;tm+=MOTION_DT,n++){
      vid.currentTime=tm; await new Promise(ok=>vid.onseeked=ok);
      const w=lm.detectForVideo(vid,Math.round(n*MOTION_DT*1000)+1).worldLandmarks?.[0]; onProgress?.(tm/end);
      if(w) frames.push(rigFromLandmarks(w));
    }
    if(frames.length<5) throw new Error("nopose");
    const f=poseFeatures(frames);
    return {matches:EX.filter(x=>!x.custom).map(x=>({x,d:featDist(f,knownFeatures(x))})).sort((a,b)=>a.d-b.d).slice(0,3).map(m=>m.x), motion:toMotion(frames)};
  } finally { URL.revokeObjectURL(url); }
}
/* video → stick-figure motion: landmarks mapped onto the demo rig, smoothed, turned to face +z and stood on the floor */
const MOTION_DT=.2, RIG=["head","neck","hip","shL","shR","elL","elR","hdL","hdR","hpL","hpR","knL","knR","ftL","ftR","toeL","toeR"];
function rigFromLandmarks(w){
  const p=i=>[w[i].x,-w[i].y,w[i].z], mid=(a,b)=>mul(add(p(a),p(b)),.5); // MediaPipe y points down
  return {head:mid(7,8),nose:p(0),neck:mid(11,12),hip:mid(23,24),shL:p(11),shR:p(12),elL:p(13),elR:p(14),hdL:p(15),hdR:p(16),
    hpL:p(23),hpR:p(24),knL:p(25),knR:p(26),ftL:p(27),ftR:p(28),toeL:p(31),toeR:p(32)};
}
function toMotion(raw){
  // facing = nose ahead of the head and toes ahead of the ankles, averaged over the clip
  let fx=0,fz=0; for(const J of raw){ for(const v of [sub(J.nose,J.head),sub(J.toeL,J.ftL),sub(J.toeR,J.ftR)]){ fx+=v[0]; fz+=v[2]; } }
  const rot=Math.PI/2-Math.atan2(fz,fx), c=Math.cos(rot), s=Math.sin(rot);
  const turned=raw.map(J=>Object.fromEntries(RIG.map(k=>{ const [x,y,z]=J[k]; return [k,[x*c-z*s,y,x*s+z*c]]; })));
  const sm=turned.map((_,i)=>Object.fromEntries(RIG.map(k=>{ const n=[turned[i-1],turned[i],turned[i+1]].filter(Boolean); return [k,[0,1,2].map(a=>n.reduce((t,J)=>t+J[k][a],0)/n.length)]; })));
  const floor=Math.min(...sm.flatMap(J=>[J.ftL[1],J.ftR[1],J.toeL[1],J.toeR[1]])), cx=sm.reduce((t,J)=>t+J.hip[0],0)/sm.length, cz=sm.reduce((t,J)=>t+J.hip[2],0)/sm.length;
  return sm.map(J=>RIG.flatMap(k=>[J[k][0]-cx,J[k][1]-floor,J[k][2]-cz].map(v=>Math.round(v*1000)/1000)));
}
// plays the recorded frames back and forth so the loop never jumps
function motionAt(ex,time){
  const F=ex.motion, n=F.length, span=2*(n-1), p=(time/MOTION_DT)%span, q=p<n-1?p:span-p, i=Math.min(n-2,Math.floor(q)), f=q-i, J={};
  RIG.forEach((k,j)=>{ J[k]=[0,1,2].map(a=>F[i][j*3+a]+(F[i+1][j*3+a]-F[i][j*3+a])*f); });
  return J;
}
function addCustomToEX(c){
  const like=BYID[c.like]||BYID["plank"], {_K,_f,_feat,...base}=like, g=PAT_GROUP[c.pat];
  const desc=(c.desc||"").split(/(?<=[.!?])\s+|\n+/).map(s=>s.trim()).filter(Boolean);
  const ex={...base,id:c.id,custom:1,inPlan:c.inPlan,like:like.id,name:[c.name,c.name],muscles:STR.muscles[g],mode:c.mode,pat:[c.pat],timed:c.timed?1:0,big:0,cues:desc.length?[desc,desc]:like.cues};
  if(c.motion?.length>=2) Object.assign(ex,{motion:c.motion,eq:undefined,bar:undefined});
  const i=EX.findIndex(x=>x.id===c.id); if(i>=0) EX[i]=ex; else EX.push(ex);
  BYID[c.id]=ex;
}
function removeCustom(id){
  S.custom=S.custom.filter(c=>c.id!==id); const i=EX.findIndex(x=>x.id===id); if(i>=0) EX.splice(i,1); delete BYID[id];
  save(); renderAll();
}
let addState=null;
function openAdd(){
  addState={blob:null,motion:null,tried:false};
  const dlg=$("#add");
  dlg.innerHTML=`<form class="dlg" id="a-form" novalidate>
    <button class="x" type="button" data-close aria-label="${tr(STR.close)}">×</button>
    <div><div class="eyebrow">${tr(STR.tabs.lib)}</div><h2>${tr(STR.addTitle)}</h2></div>
    <p class="muted">${tr(STR.addIntro)}</p>
    <label class="field">${tr(STR.addName)}<input id="a-name" maxlength="60" autocomplete="off"></label>
    <label class="field">${tr(STR.addDesc)}<textarea id="a-desc" rows="4" maxlength="800" placeholder="${esc(tr(STR.addDescPh))}"></textarea></label>
    <div class="row"><label class="btn">${tr(STR.addRecord)}<input type="file" accept="video/*" capture="environment" id="a-rec" hidden></label><label class="btn">${tr(STR.addPick)}<input type="file" accept="video/*" id="a-pick" hidden></label></div>
    <video id="a-video" hidden muted playsinline loop controls class="vid"></video>
    <button type="button" class="btn primary" id="a-compare">${tr(STR.addCompare)}</button>
    <div class="status" id="a-status" role="status"></div>
    <div class="form">
      <label class="field">${tr(STR.addGroup)}<select id="a-pat">${Object.keys(PAT_NAME).map(p=>`<option value="${p}">${esc(tr(PAT_NAME[p]))}</option>`).join("")}</select></label>
      <label class="field">${tr(STR.addLike)}<select id="a-like">${EX.filter(x=>!x.custom).map(x=>`<option value="${x.id}">${esc(tr(x.name))}</option>`).join("")}</select></label>
      <label class="field">${tr(STR.addWhere)}<select id="a-mode">${MODES.map(m=>`<option value="${m}">${tr(STR[m])}</option>`).join("")}<option value="all">${tr(STR.addAll)}</option></select></label>
      <label class="field">${tr(STR.addType)}<select id="a-type"><option value="reps">${tr(STR.reps)}</option><option value="time">${tr(STR.time)}</option></select></label>
    </div>
    <label class="check"><input type="checkbox" id="a-inplan"> ${tr(STR.addInPlan)}</label>
    <button type="submit" class="btn primary">${tr(STR.addSave)}</button>
  </form>`;
  const st=m=>$("#a-status").textContent=m;
  $("#a-pat").value="core"; $("#a-like").value="plank"; $("#a-mode").value=S.mode;
  const onVideo=e=>{ const f=e.target.files?.[0]; if(!f) return; if(f.size>200e6) return st(tr(STR.addTooBig)); Object.assign(addState,{blob:f,motion:null,tried:false}); const v=$("#a-video"); v.src=URL.createObjectURL(f); v.hidden=false; v.play().catch(()=>{}); st(tr(STR.addVideoReady)); };
  $("#a-rec").onchange=onVideo; $("#a-pick").onchange=onVideo;
  const compare=async()=>{
    const txt=$("#a-name").value+" "+$("#a-desc").value, m=matchText(txt);
    let matches=m.matches, via="text", warn="";
    if(addState.blob){
      st(tr(STR.addAnalyzing)); addState.tried=true;
      try{ const r=await matchVideo(addState.blob,p=>st(tr(STR.addAnalyzing)+" "+Math.round(p*100)+"%")); matches=r.matches; addState.motion=r.motion; via="video"; }
      catch(e){ warn=tr(e.message==="nopose"?STR.addNoPose:STR.addOffline)+" "; console.warn("pose",e); }
    }
    if(!matches.length&&!m.pat) return st(warn+tr(STR.addNoMatch));
    const pat=m.pat||matches[0].pat[0];
    $("#a-pat").value=pat; if(matches[0]) $("#a-like").value=matches[0].id; if(m.mode) $("#a-mode").value=m.mode;
    if(matches[0]?.timed) $("#a-type").value="time";
    st(warn+t(via==="video"?STR.addResultVideo:STR.addResult,{x:matches.map(x=>tr(x.name)).join(", ")||"—",g:tr(PAT_NAME[pat])}));
  };
  $("#a-compare").onclick=compare;
  $("#a-form").onsubmit=async e=>{
    e.preventDefault();
    const name=$("#a-name").value.trim(); if(!name) return st(tr(STR.addNeedName));
    if(addState.blob&&!addState.tried) await compare(); // a video is only kept as the stick-figure motion it converts to
    const mode=$("#a-mode").value, c={id:"c-"+Date.now().toString(36),name,desc:$("#a-desc").value.trim(),pat:$("#a-pat").value,like:$("#a-like").value,mode:mode==="all"?[...MODES]:[mode],timed:$("#a-type").value==="time",inPlan:$("#a-inplan").checked,motion:addState.motion};
    if(c.inPlan) for(const o of S.custom) if(o.pat===c.pat) o.inPlan=false, addCustomToEX(o); // one custom per movement slot
    S.custom.push(c); addCustomToEX(c); save(); dlg.close(); renderAll(); scheduleReminders();
  };
  dlg.showModal(); history.pushState({dlg:1},"");
}

/* ---------- first-run setup ---------- */
const OB_STEPS=["welcome","goal","build","exp","days","body","ready"];
let obStep=0;
function showApp(){ $("#onboard").hidden=!!S.onboarded; $(".wrap").hidden=!S.onboarded; if(!S.onboarded) renderOnboard(); }
function renderOnboard(){
  const pr=S.profile, step=OB_STEPS[obStep], last=obStep===OB_STEPS.length-1;
  const cards=(key,obj,cur,sub)=>`<div class="choices">${Object.entries(obj).map(([k,v])=>`<button class="preset" data-ob="${key}" data-v="${k}" aria-pressed="${cur===k}"><b>${esc(tr(v.name))}</b>${sub?`<span class="muted">${esc(sub(k,v))}</span>`:""}</button>`).join("")}</div>`;
  const b=S.body, p=plan(), n=nutrition(true);
  const body={
    welcome:`<div class="logo ob-logo"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 9v14M23 9v14M5 12v8M27 12v8M9 16h14"/></svg>GymBro</div>
      <p class="lead">${tr(STR.obWelcome)}</p>
      <div class="seg" role="group" aria-label="Language / Idioma" style="align-self:flex-start"><button data-lang="en" aria-pressed="${S.lang==="en"}">English</button><button data-lang="es" aria-pressed="${S.lang==="es"}">Español</button></div>`,
    goal:`<h2>${tr(STR.obGoal)}</h2>${cards("goal",GOALS,pr.goal,k=>tr(GOAL_DESC[k]))}`,
    build:`<h2>${tr(STR.obBuild)}</h2>${cards("build",BUILDS,pr.build,(k,v)=>tr(v.tag))}`,
    exp:`<h2>${tr(STR.obExp)}</h2>${cards("exp",EXPS,pr.exp)}
      <h3>${tr(STR.obWhere)}</h3><div class="choices">${MODES.map(m=>`<button class="preset" data-ob="mode" data-v="${m}" aria-pressed="${S.mode===m}"><span class="mode-ico">${$("#m-"+m).innerHTML}</span><b>${tr(STR[m])}</b></button>`).join("")}</div>`,
    days:`<h2>${tr(STR.obDays)}</h2><div class="dow">${[2,3,4,5,6].map(d=>`<button data-ob="days" data-v="${d}" aria-pressed="${pr.days===d}">${d}</button>`).join("")}</div>
      <h3>${tr(STR.obWhich)}</h3><div class="dow">${[1,2,3,4,5,6,0].map(d=>`<button data-obday="${d}" aria-pressed="${S.trainDays.includes(d)}">${esc(dowName(d))}</button>`).join("")}</div>
      <div class="status" id="ob-status" role="status"></div>
      <label class="field" style="max-width:260px">${tr(STR.remindBy)}<input type="time" id="ob-remind" value="${esc(S.remind)}"></label>`,
    body:`<h2>${tr(STR.obBody)}</h2><p class="muted">${tr(STR.obBodyNote)}</p><div class="form">
      <label class="field">${tr(STR.sex)}<select id="ob-sex"><option value="m" ${b.sex==="m"?"selected":""}>${tr(STR.male)}</option><option value="f" ${b.sex==="f"?"selected":""}>${tr(STR.female)}</option></select></label>
      <label class="field">${tr(STR.age)}<input id="ob-age" type="number" inputmode="numeric" min="14" max="90" value="${b.age}"></label>
      <label class="field">${tr(STR.height)}<input id="ob-height" type="number" inputmode="numeric" min="130" max="220" value="${b.height}"></label>
      <label class="field">${tr(STR.weight)}<input id="ob-weight" type="number" inputmode="decimal" min="35" max="250" step="0.5" value="${b.weight}"></label></div>`,
    ready:`<h2>${tr(STR.obReady)}</h2>
      <p class="muted">${esc(tr(GOALS[pr.goal].name))} · ${esc(tr(BUILDS[pr.build].name))} · ${esc(tr(EXPS[pr.exp].name))} · ${pr.days} × ${esc(tr(STR[S.mode]).toLowerCase())}</p>
      <div class="days">${p.map((d,i)=>`<div class="card day"><div class="eyebrow">${tr(STR.session)} ${String.fromCharCode(65+i)}</div><h3>${esc(tr(d.title))}</h3><ol>${d.items.map(it=>`<li>${esc(tr(it.ex.name))}<br><span>${esc(rxText(it))}</span></li>`).join("")}</ol></div>`).join("")}</div>
      <p class="muted">${tr(STR.target)}: ${num(n.kcal)} kcal · ${tr(STR.protein)} ${n.protein} g</p>
      <p class="muted">${tr(STR.obReadyNote)}</p>`,
  }[step];
  $("#onboard").innerHTML=`<div class="ob">
    <div class="ob-top"><span class="eyebrow">${obStep?t(STR.obStep,{a:obStep,b:OB_STEPS.length-1}):""}</span><div class="ob-dots">${OB_STEPS.map((_,i)=>`<i class="${i<=obStep?"on":""}"></i>`).join("")}</div></div>
    <div class="ob-body">${body}</div>
    <div class="ob-nav">${obStep?`<button class="btn" data-obnav="-1">${tr(STR.obBack)}</button>`:"<span></span>"}<button class="btn primary" data-obnav="1">${tr(last?STR.obStart:obStep?STR.obNext:STR.obNext)}</button></div></div>`;
  scrollTo(0,0);
}
function readObForm(){
  const step=OB_STEPS[obStep], lim={age:[14,90],height:[130,220],weight:[35,250]};
  if(step==="days") S.remind=$("#ob-remind").value||"18:00";
  if(step==="body"){ S.body.sex=$("#ob-sex").value; for(const k in lim){ const v=parseFloat($("#ob-"+k).value); S.body[k]=Number.isFinite(v)?Math.min(lim[k][1],Math.max(lim[k][0],v)):DEF_STATE.body[k]; } }
}
async function obNav(dir){
  readObForm(); save();
  if(dir>0&&obStep===OB_STEPS.length-1){
    Object.assign(S,{onboarded:true,planStart:today(),tab:"today"}); save(); showApp(); renderAll();
    try{ if((await notifyPermission(true))==="granted") scheduleReminders(); }catch{}
    return;
  }
  obStep=Math.max(0,Math.min(OB_STEPS.length-1,obStep+dir)); renderOnboard();
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
  $("#lang-seg").setAttribute("aria-label","Language / Idioma"); $("#mode-seg").setAttribute("aria-label",MODES.map(m=>tr(STR[m])).join(" / "));
  $("#views").setAttribute("aria-label",tr(STR.angle)); $("#d-close").setAttribute("aria-label",tr(STR.close));
  const vb=document.querySelectorAll("#views button"); vb[0].textContent=tr(STR.auto); vb[1].textContent=tr(STR.side); vb[3].textContent=tr(STR.front);
  renderToday(); renderLib(); renderPlan(); renderFood(); renderProg(); setTab(S.tab);
}
function openEx(id){
  const ex=BYID[id]; if(!ex) return; const r=rx(ex,S.profile);
  $("#d-name").textContent=tr(ex.name); $("#d-muscles").textContent=tr(ex.muscles);
  $("#d-cues").innerHTML=tr(ex.cues).map(c=>`<li>${esc(c)}</li>`).join("");
  renderTarget(ex);
  $("#d-note").textContent=!ex.custom?"":ex.motion?tr(STR.motionNote):t(STR.likeNote,{x:tr(BYID[ex.like].name)});
  $("#d-remove").hidden=!ex.custom; $("#d-remove").textContent=tr(STR.removeEx); $("#d-remove").dataset.id=ex.id;
  modal={ex,cv:$("#d-canvas"),view:"auto",t0:performance.now()}; setView("auto");
  $("#dlg").showModal();
  history.pushState({dlg:1},""); // Android back button pops this entry instead of exiting the app
}
function renderTarget(ex){
  const r=rx(ex,S.profile);
  $("#d-target").innerHTML=`<div style="flex-basis:100%"><span class="eyebrow">${tr(STR.yourTarget)} · ${esc(tr(GOALS[S.profile.goal].name))}</span><b style="font-size:24px">${esc(rxShort(r))}</b>${adjLine({ex,...r},false)}</div><div><span class="eyebrow">${tr(STR.restCap)}</span><b>${fmtRest(r.rest)}</b></div>`;
}
function setView(v){ if(modal){ modal.view=v; modal.t0=performance.now(); } document.querySelectorAll("#views button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.view===v)); }
document.addEventListener("click",e=>{
  const el=e.target.closest("[data-adj],[data-open],[data-preset],[data-act],[data-lang],#mode-seg button,nav button,#views button,[data-ob],[data-obday],[data-obnav],[data-coach],[data-fb],[data-redo],[data-add]"); if(!el) return;
  if(el.dataset.adj){ const id=el.dataset.ex; if(el.dataset.adj==="reset"){ delete S.adjust[id]; save(); renderToday(); renderLib(); renderPlan(); if(modal?.ex.id===id) renderTarget(modal.ex); } else adjust(id,el.dataset.adj,+el.dataset.d); }
  else if(el.dataset.open){ e.preventDefault(); openEx(el.dataset.open); }
  else if(el.dataset.add!=null) openAdd();
  else if(el.dataset.obnav) obNav(+el.dataset.obnav);
  else if(el.dataset.ob){ const k=el.dataset.ob, v=el.dataset.v; if(k==="mode") S.mode=v; else S.profile[k]=k==="days"?+v:v; if(k==="days") S.trainDays=DEFAULT_DAYS[+v]; save(); renderOnboard(); }
  else if(el.dataset.obday){ const d=+el.dataset.obday, set=new Set(S.trainDays); set.has(d)?set.delete(d):set.add(d);
    if(set.size<2||set.size>6){ $("#ob-status").textContent=tr(STR.dayRange); return; } S.remind=$("#ob-remind").value||S.remind; S.trainDays=[...set]; S.profile.days=set.size; save(); renderOnboard(); }
  else if(el.dataset.coach){ const c=coach(); if(el.dataset.coach==="apply"&&c.s) applySuggestion(c.s); else if(el.dataset.coach==="up") applySuggestion(upGame()); else if(c.s){ S.coachSnooze[c.s.type]=addDays(7); save(); renderAll(); } }
  else if(el.dataset.fb){ const d=today(), v=+el.dataset.fb; S.feedback[d]=S.feedback[d]===v?undefined:v; save(); renderToday(); }
  else if(el.dataset.redo!=null){ S.onboarded=false; obStep=1; save(); showApp(); }
  else if(el.dataset.preset){ const x=PRESETS[el.dataset.preset]; Object.assign(S.profile,{build:x.build,goal:x.goal}); save(); renderAll(); scheduleReminders(); }
  else if(el.dataset.act==="checkin") checkIn("manual");
  else if(el.dataset.act==="skip"){ S.skips[today()]=1; save(); renderToday(); scheduleReminders(); }
  else if(el.dataset.lang){ S.lang=el.dataset.lang; save(); renderAll(); if(!S.onboarded) renderOnboard(); scheduleReminders(); }
  else if(el.dataset.mode){ S.mode=el.dataset.mode; save(); renderAll(); }
  else if(el.dataset.view) setView(el.dataset.view);
  else setTab(el.id.slice(2));
});
$("#d-close").onclick=()=>$("#dlg").close();
for(const id of ["#dlg","#add"]) $(id).addEventListener("close",()=>{
  if(id==="#dlg") modal=null;
  if(history.state?.dlg) history.back();
});
addEventListener("popstate",()=>{ for(const id of ["#dlg","#add"]) if($(id).open) $(id).close(); });
$("#add").addEventListener("click",e=>{ if(e.target.id==="add"||e.target.closest("[data-close]")) $("#add").close(); });
$("#d-remove").onclick=()=>{ const id=$("#d-remove").dataset.id; $("#dlg").close(); removeCustom(id); };
$("#dlg").addEventListener("click",e=>{ if(e.target.id==="dlg") $("#dlg").close(); });
$("#q").oninput=renderLib; $("#muscle").onchange=renderLib;
document.addEventListener("visibilitychange",()=>{ if(!document.hidden){ renderAll(); tick(); } });

// self-checks (browser dev only): every profile yields a usable plan, recipe macros add up, calorie targets stay sane
if(!NATIVE){
for(const mode of MODES) for(const days of [2,3,4,5,6]) for(const goal in GOALS)
  buildPlan({build:"athletic",goal,exp:"beginner",days},mode).forEach(d=>console.assert(d.items.length>=3,"thin plan",mode,days,goal,tr(d.title)));
for(const r of RECIPES) console.assert(Math.abs(r.p*4+r.c*4+r.f*9-r.kcal)/r.kcal<.1,"recipe macros off",r.id);
console.assert((()=>{ const n=nutrition(true); return n.kcal>1200&&n.kcal<5000&&n.protein>50; })(),"nutrition out of range");
for(const goal in GOALS){ const n={...nutrition(true),kcal:goal==="fatloss"?1600:3200,protein:goal==="fatloss"?150:110}, {meals,extras}=mealsFor(new Date(),n), all=[...meals,...extras];
  const k=all.reduce((s,m)=>s+m.kcal,0), p=all.reduce((s,m)=>s+m.p,0);
  console.assert(Math.abs(k-n.kcal)/n.kcal<.08&&p>=n.protein*.9,"meal plan misses target",goal,k,p); }
}

S.custom.forEach(addCustomToEX);
readColors(); renderAll(); showApp(); requestAnimationFrame(loop); setInterval(tick,60e3); tick(); scheduleReminders();
