'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {WebSocketServer,WebSocket}=require('ws');
const PORT=Number(process.env.PORT||3000);
const ROOT=path.join(__dirname,'public');
const W=900,H=540, TICK=1/30, MAX_ROOMS=150, MAX_PLAYERS=4;
const rooms=new Map();
const CHAT_LIMIT=160, CHAT_HISTORY=45;
function onlinePlayers(){let n=0;for(const r of rooms.values())for(const p of r.players)if(p?.ws?.readyState===WebSocket.OPEN)n++;return n}
function sendRoom(room,message){for(const p of room.players)if(p?.ws?.readyState===WebSocket.OPEN)send(p.ws,message)}
function cleanChat(value){return typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,CHAT_LIMIT):''}
function roomChat(room,player,value,now=Date.now()){const message=cleanChat(value);if(!message)return false;if(now-(player.lastChatAt||0)<900)return false;player.lastChatAt=now;const entry={id:++room.chatId,playerId:player.id,name:player.name||`P${player.id+1}`,text:message,at:now};room.chat.push(entry);if(room.chat.length>CHAT_HISTORY)room.chat.shift();sendRoom(room,{type:'chat',message:entry});return true}

const CODE_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd=(a,b)=>a+Math.random()*(b-a),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const norm=(dx,dy)=>{const n=Math.hypot(dx,dy)||1;return [dx/n,dy/n]};
function code(){let s;do{s=Array.from({length:5},()=>CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('')}while(rooms.has(s));return s}
function send(ws,obj){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))}
function announce(room,message){room.notice=message;room.noticeTimer=3;}
function player(id,token){return {id,token,profile:null,name:'Guest',profileApplied:false,weapon:'blaster',x:W*(.35+.1*(id%2)),y:H*(.66+.1*Math.floor(id/2)),hp:100,maxHp:100,alive:true,angle:-Math.PI/2,shooting:false,keys:{},fireCd:0,dashCd:0,dashTime:0,dashVx:0,dashVy:0,shieldCd:0,shieldTime:0,invuln:0,boosts:[],upgrades:0,admin:false,adminAim:false,adminCooldown:0,synergyCd:0,ultimate:'guardian',ultCharge:0,ultReadyAt:0,kills:0,score:0,ws:null,lastSeen:Date.now()}}
// This is an optional casual co-op loadout. Players submit minimal derived bonuses,
// not their complete private V18 save file. It is NOT a cheat-proof account system.
function normalizeProfile(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const bounded=(v,lo,hi)=>clamp(Number.isFinite(Number(v))?Math.floor(Number(v)):0,lo,hi);
  const safeName=String(raw.name||'Adventurer').replace(/[\x00-\x1f<>]/g,'').trim().slice(0,22)||'Adventurer';
  const gear=raw.gear||{};const up=raw.upgrades||{};
  return {name:safeName,bestWave:bounded(raw.bestWave,1,999),completed:bounded(raw.completed,0,5),
    health:bounded(up.health,0,5),speed:bounded(up.speed,0,5),damage:bounded(up.damage,0,5),
    weapon:bounded(gear.weapon,0,5),armor:bounded(gear.armor,0,5),charm:bounded(gear.charm,0,5),
    weaponLevels:Object.fromEntries(['pistol','shotgun','blaster','rocket','ion'].map(k=>[k,bounded(raw.weaponLevels?.[k],0,5)])),ionUnlocked:!!raw.ionUnlocked,gearLabel:bounded(gear.weapon,0,5)+bounded(gear.armor,0,5)+bounded(gear.charm,0,5)>0?'Equipped':'None'};
}
function applyProfile(p){
  const t=p.profile||{};
  p.maxHp=100+Math.min(35,(t.health||0)*6);
  p.hp=p.maxHp;
  p.passiveDamage=Math.min(5,(t.damage||0)*.6+(t.weapon||0)*.5);
  p.passiveSpeed=Math.min(24,(t.speed||0)*4);
  p.passiveArmor=Math.min(4,(t.armor||0)*.8);
  p.passiveCoins=Math.min(2,Math.floor((t.charm||0)/2));
  p.weaponMastery=p.profile?.weaponLevels||{};p.profileApplied=true;
}
function newRoom(){const r={code:code(),players:Array(MAX_PLAYERS).fill(null),phase:'lobby',wave:0,stage:0,stageLeft:0,stageTimer:0,enemies:[],bullets:[],fx:[],loot:[],coins:0,score:0,elapsed:0,notice:'',noticeTimer:0,ready:Array(MAX_PLAYERS).fill(false),seq:0,created:Date.now(),lastActive:Date.now(),chat:[],chatId:0,enemyId:0,bossName:'',bossPhase:1, spawnSeq:0,teamEnergy:0,teamEnergyMax:100,synergyCast:null,teamDome:0,teamDomeX:0,teamDomeY:0};rooms.set(r.code,r);return r}
function view(r){return {type:'state',seq:r.seq,onlinePlayers:onlinePlayers(),activeRooms:rooms.size,roomConnected:r.players.filter(p=>p?.ws?.readyState===WebSocket.OPEN).length,room:r.code,phase:r.phase,wave:r.wave,stage:r.stage,stageLeft:r.stageLeft,coins:r.coins,score:r.score,elapsed:Math.round(r.elapsed),notice:r.notice,ready:r.ready,players:r.players.map(p=>p?{id:p.id,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,alive:p.alive,angle:p.angle,shield:p.shieldTime>0,dash:p.dashTime>0,boosts:p.boosts.length,upgrades:p.upgrades,weapon:p.weapon,name:p.name,profile:p.profile?{bestWave:p.profile.bestWave,completed:p.profile.completed,gear:p.profile.gearLabel}:null,admin:p.admin,adminAim:!!p.adminAim,adminCooldown:+Math.max(0,((p.adminReadyAt||0)-Date.now())/1000).toFixed(1),synergyCd:+p.synergyCd.toFixed(1),ultimate:p.ultimate,ultCharge:Math.round(p.ultCharge),ultCooldown:+Math.max(0,((p.ultReadyAt||0)-Date.now())/1000).toFixed(1),kills:p.kills,connected:!!p.ws}:null),enemies:r.enemies.map(e=>({id:e.id,x:e.x,y:e.y,hp:e.hp,maxHp:e.maxHp,type:e.type,r:e.r,charge:e.charge||0,ang:e.ang||0,bossPhase:e.bossPhase||1})),bullets:r.bullets.map(b=>({x:b.x,y:b.y,friendly:b.friendly,owner:b.owner,rocket:b.rocket,ion:!!b.ion})),loot:r.loot.map(l=>({x:l.x,y:l.y,type:l.type})),fx:r.fx.map(f=>({x:f.x,y:f.y,r:f.r,life:f.life})),bossName:r.bossName,teamEnergy:r.teamEnergy,teamEnergyMax:r.teamEnergyMax,synergyCast:r.synergyCast,teamDome:r.teamDome,teamDomeX:r.teamDomeX,teamDomeY:r.teamDomeY};}
function randomSpawn(){let x,y;const side=crypto.randomInt(4);if(side===0){x=rnd(30,W-30);y=25}else if(side===1){x=rnd(30,W-30);y=H-25}else if(side===2){x=25;y=rnd(30,H-30)}else{x=W-25;y=rnd(30,H-30)}return {x,y}}
function makeEnemy(r,type,elite=false){const p=randomSpawn();const scale=(1+(r.wave-1)*.12)*1.5;const base={grunt:[25,90,14],runner:[15,155,11],sniper:[22,92,14],brute:[80,60,23],boss:[660,80,43]}[type];const hp=Math.round(base[0]*scale*(elite?1.55:1));return {...p,id:++r.enemyId,type,hp,maxHp:hp,spd:base[1]*(elite?1.12:1),r:base[2],elite,fireCd:rnd(.8,1.8),charge:0,chargeCd:rnd(2.2,3.8),chargeVx:0,chargeVy:0,ang:0,bossPhase:1, pattern:0, bossPhaseHp:hp,transition:0,stuck:0}}
function participants(r){return r.players.filter(Boolean)}
function connectedPlayers(r){return participants(r).filter(p=>p.ws?.readyState===WebSocket.OPEN)}
function canStart(r){return r.phase==='lobby'&&connectedPlayers(r).length>=2&&connectedPlayers(r).length===participants(r).length}
function beginWave(r){r.wave++;r.phase='combat';r.stage=0;r.stageLeft=0;r.stageTimer=.5;r.ready=Array(MAX_PLAYERS).fill(false);r.enemies=[];r.bullets=r.bullets.filter(b=>b.adminRocket);r.loot=[];r.bossName='';r.teamDome=0;for(const p of participants(r)){p.hp=Math.min(p.maxHp,p.hp+12);p.alive=p.hp>0;p.x=W*(.35+.1*(p.id%2));p.y=H*(.66+.1*Math.floor(p.id/2));p.keys={};p.fireCd=0;p.invuln=1}announce(r,`WAVE ${r.wave} — INCOMING`)}
function spawnSquad(r){r.stage++; const bossWave=r.wave===3||r.wave===6; const last=bossWave&&r.stage===4; const count=last?1:6+Math.min(5,r.wave)+Math.floor(r.stage*.8);
  for(let i=0;i<count;i++){let type='grunt';if(last)type='boss';else {const q=Math.random();type=q<.2?'sniper':q<.45?'runner':q<.56?'brute':'grunt'}r.enemies.push(makeEnemy(r,type,!last&&Math.random()<.16))}
  if(last){r.bossName=r.wave===6?'THE CROWN TYRANT':'THE IRON WARDEN';announce(r,`BOSS: ${r.bossName}`)}else announce(r,`WAVE ${r.wave} — SQUAD ${r.stage}/4`);
}
function damagePlayer(p,n){if(p._room&&p._room.teamDome>0&&Math.hypot(p.x-p._room.teamDomeX,p.y-p._room.teamDomeY)<140)n*=.35;if(!p.alive||p.invuln>0||p.dashTime>0||p.shieldTime>0)return;if(n<=0)return;p.hp=Math.max(0,p.hp-Math.max(1,n-(p.passiveArmor||0)));p.invuln=.65;if(!p.hp)p.alive=false}
function dealEnemy(r,e,d,owner,admin=false){if(e.transition>0)return;const raw=Math.max(1,d);const cap=e.type==='boss'?(admin?Math.max(100,e.maxHp*.34):Math.max(8,e.maxHp*.052)):1e6;const dealt=Math.min(raw,cap);e.hp-=dealt;if(e.hp<=0){if(e.type==='boss'&&e.bossPhase<3){e.bossPhase++;e.transition=1.8;e.hp=e.maxHp;e.fireCd=1.6;announce(r,`${r.bossName} — PHASE ${e.bossPhase}!`);return}r.enemies=r.enemies.filter(q=>q!==e);r.coins+=(e.type==='boss'?35:e.elite?4:1)+(owner.passiveCoins||0);r.score+=e.type==='boss'?1000:e.elite?70:20;r.teamEnergy=Math.min(r.teamEnergyMax,r.teamEnergy+(e.type==='boss'?25:e.elite?12:4));owner.ultCharge=Math.min(100,(owner.ultCharge||0)+(e.type==='boss'?40:e.elite?17:8));owner.kills++;owner.score+=e.type==='boss'?1000:20;if(Math.random()<.12)r.loot.push({x:e.x,y:e.y,type:Math.random()<.55?'boost':'heal'});r.fx.push({x:e.x,y:e.y,r:e.r*2,life:.45});}}
function v35Target(r,x,y){const candidates=r.enemies.filter(e=>e.hp>0&&!(e.transition>0));const bosses=candidates.filter(e=>e.type==='boss');const pool=bosses.length?bosses:candidates;return pool.reduce((best,e)=>!best||dist(e,{x,y})<dist(best,{x,y})?e:best,null)}
function v35Steer(b,target,dt){const old=Math.atan2(b.vy,b.vx),desired=Math.atan2(target.y-b.y,target.x-b.x);const delta=Math.atan2(Math.sin(desired-old),Math.cos(desired-old));const angle=old+clamp(delta,-6*dt,6*dt),speed=Math.hypot(b.vx,b.vy);b.vx=Math.cos(angle)*speed;b.vy=Math.sin(angle)*speed}
function firePlayer(r,p){if(p.admin&&p.adminAim){const target=v35Target(r,p.x,p.y);if(target)p.angle=Math.atan2(target.y-p.y,target.x-p.x)}
const ion=p.weapon==='ion',speed=ion?540:670;const crit=Math.random()<.12;
const mastery=Math.min(5,Math.max(0,Number(p.weaponMastery?.[ion?'ion':'blaster'])||0));
const dmg=((ion?17:8)+(p.passiveDamage||0)+2*p.upgrades+mastery*2+(p.boosts.length*2))*(crit?1.75:1);
const vx=Math.cos(p.angle),vy=Math.sin(p.angle);r.bullets.push({x:p.x+vx*20,y:p.y+vy*20,vx:vx*speed,vy:vy*speed,r:ion?8:5,life:1.6,friendly:true,owner:p.id,damage:dmg,rocket:false,ion});p.fireCd=ion?Math.max(.28,.48-p.upgrades*.012):Math.max(.085,.145-p.upgrades*.007)}
function adminRocketRing(r,p){
  if(!p.alive||!p.admin||(p.adminReadyAt||0)>Date.now()||r.phase!=='combat')return false;
  const count=32, speed=960;
  for(let i=0;i<count;i++){
    const a=(Math.PI*2*i)/count;
    const dx=Math.cos(a),dy=Math.sin(a);
    r.bullets.push({x:p.x+dx*25,y:p.y+dy*25,vx:dx*speed,vy:dy*speed,
      life:1.65,r:12,friendly:true,owner:p.id,damage:650,rocket:true,adminRocket:true});
  }
  p.adminCooldown=1.5;p.adminReadyAt=Date.now()+1500;
  r.fx.push({x:p.x,y:p.y,r:75,life:.55});
  announce(r,`PLAYER ${p.id+1}: ADMIN ROCKET NOVA!`);
  return true;
}
function explodeAdminRocket(r,b){
  const radius=155;
  r.fx.push({x:b.x,y:b.y,r:radius,life:.32});
  const p=r.players[b.owner];
  if(!p)return;
  for(const e of [...r.enemies]){
    const d=Math.hypot(e.x-b.x,e.y-b.y);
    if(d<=radius+e.r){
      // Per-explosion splash damage falls off at the edge.
      const dmg=b.damage*(.45+.55*Math.max(0,1-d/(radius+e.r)));
      if(b.adminRocket){
        // Admin rockets deal high boss damage without the ordinary 5.2% per-hit cap.
        dealEnemy(r,e,e.type==='boss'?Math.max(e.maxHp*.3,dmg):dmg,p,true);
      }else dealEnemy(r,e,dmg,p);
    }
  }
}


// V36 — three server-authoritative hero ultimates. Each player's meter fills from kills.
function castUltimate(r,p){
 if(r.phase!=='combat'||!p.alive)return false;
 if((p.ultCharge||0)<100){send(p.ws,{type:'toast',text:'Ultimate not charged: '+Math.floor(p.ultCharge||0)+'/100'});return false}
 if((p.ultReadyAt||0)>Date.now()){send(p.ws,{type:'toast',text:'Ultimate cooldown active'});return false}
 p.ultCharge=0;p.ultReadyAt=Date.now()+24000;
 if(p.ultimate==='guardian'){
   p.shieldTime=Math.max(p.shieldTime,6);p.invuln=Math.max(p.invuln,2);
   for(const q of participants(r))if(q.alive&&dist(p,q)<190)q.shieldTime=Math.max(q.shieldTime,4);
   for(const e of [...r.enemies])if(dist(p,e)<240)dealEnemy(r,e,Math.max(210,e.maxHp*.2),p);
   r.fx.push({x:p.x,y:p.y,r:210,life:1});announce(r,`P${p.id+1}: FORTRESS SLAM!`);
 }else if(p.ultimate==='scout'){
   p.dashTime=Math.max(p.dashTime,.75);p.invuln=Math.max(p.invuln,1);
   const enemies=[...r.enemies].filter(e=>e.transition<=0).sort((a,b)=>dist(a,p)-dist(b,p)).slice(0,12);
   for(const e of enemies){dealEnemy(r,e,240,p);r.fx.push({x:e.x,y:e.y,r:55,life:.7})}
   announce(r,`P${p.id+1}: LIGHTNING RUSH!`);
 }else{
   const enemies=[...r.enemies].filter(e=>e.transition<=0).sort((a,b)=>(a.type==='boss'?-1:1)-(b.type==='boss'?-1:1)||dist(a,p)-dist(b,p)).slice(0,9);
   for(const e of enemies){const x=e.x,y=e.y;for(const target of [...r.enemies])if(dist(target,{x,y})<92)dealEnemy(r,target,Math.max(200,target.maxHp*.22),p);r.fx.push({x,y,r:95,life:1});}
   announce(r,`P${p.id+1}: ORBITAL STRIKE!`);
 }
 return true;
}
function castSynergy(r,p,kind){
  if(r.phase!=='combat'||!p.alive||p.synergyCd>0)return false;
  const prices={heal:50,dome:65,volley:100};
  const cost=prices[kind];if(!cost||r.teamEnergy<cost)return false;
  // Coordinated abilities require at least two teammates alive and reasonably close.
  const nearby=r.players.filter(q=>q&&q.alive&&q.id!==p.id&&dist(q,p)<260);
  if(!nearby.length){send(p.ws,{type:'toast',text:'Synergy requires a teammate within 260 px'});return false}
  r.teamEnergy-=cost;p.synergyCd=12;
  if(kind==='heal'){
    for(const q of r.players)if(q&&q.alive&&dist(p,q)<300)q.hp=Math.min(q.maxHp,q.hp+38);
    r.fx.push({x:p.x,y:p.y,r:140,life:.8});announce(r,`P${p.id+1} + TEAM: HEALING PULSE!`);
  }else if(kind==='dome'){
    r.teamDome=5;r.teamDomeX=p.x;r.teamDomeY=p.y;announce(r,`P${p.id+1} + TEAM: GUARDIAN DOME!`);
  }else{
    const targetOrder=[...r.enemies].sort((a,b)=>dist(a,p)-dist(b,p));
    for(let i=0;i<16;i++){
      const a=i*Math.PI*2/16;
      r.bullets.push({x:p.x+Math.cos(a)*22,y:p.y+Math.sin(a)*22,vx:Math.cos(a)*780,vy:Math.sin(a)*780,life:1.2,r:8,friendly:true,owner:p.id,damage:95,rocket:true});
    }
    announce(r,`P${p.id+1} + TEAM: SYNERGY ROCKET STORM!`);
  }
  return true;
}
function enemyFire(r,e,target,spread=0){const a=Math.atan2(target.y-e.y,target.x-e.x)+spread;r.bullets.push({x:e.x,y:e.y,vx:Math.cos(a)*265,vy:Math.sin(a)*265,life:3.4,r:6,friendly:false,damage:e.type==='boss'?13:10,owner:-1})}
function handleShop(r,p,item){if(r.phase!=='shop'||r.ready[p.id])return; if(item==='damage'&&r.coins>=30+p.upgrades*18&&p.upgrades<5){r.coins-=30+p.upgrades*18;p.upgrades++;send(p.ws,{type:'toast',text:'Blaster upgraded!'})}else if(item==='heal'&&r.coins>=25&&p.hp<p.maxHp){r.coins-=25;p.hp=Math.min(p.maxHp,p.hp+40);p.alive=p.hp>0}else if(item==='boost'&&r.coins>=24){r.coins-=24;p.boosts.push(8)}else send(p.ws,{type:'toast',text:'Not enough coins, full HP, or max upgrades.'})}
function update(r,dt){if(r.phase!=='combat')return;if(participants(r).some(p=>!p.ws||p.ws.readyState!==WebSocket.OPEN))return;r.elapsed+=dt;r.teamDome=Math.max(0,r.teamDome-dt);r.noticeTimer=Math.max(0,r.noticeTimer-dt);if(r.noticeTimer===0)r.notice='';
  for(const p of participants(r)){p._room=r;p.synergyCd=Math.max(0,p.synergyCd-dt);p.adminCooldown=Math.max(0,p.adminCooldown-dt);p.fireCd=Math.max(0,p.fireCd-dt);p.dashCd=Math.max(0,p.dashCd-dt);p.shieldCd=Math.max(0,p.shieldCd-dt);p.shieldTime=Math.max(0,p.shieldTime-dt);p.invuln=Math.max(0,p.invuln-dt);p.dashTime=Math.max(0,p.dashTime-dt);p.boosts=p.boosts.map(v=>v-dt).filter(v=>v>0);if(!p.alive)continue;
    const k=p.keys;let dx=(k.right?1:0)-(k.left?1:0),dy=(k.down?1:0)-(k.up?1:0);[dx,dy]=norm(dx,dy);if(!k.left&&!k.right&&!k.up&&!k.down){dx=0;dy=0}const sp=p.dashTime>0?720:265+(p.passiveSpeed||0);p.x=clamp(p.x+(p.dashTime>0?p.dashVx:dx)*sp*dt,18,W-18);p.y=clamp(p.y+(p.dashTime>0?p.dashVy:dy)*sp*dt,18,H-18);
    if(p.shooting&&p.fireCd<=0)firePlayer(r,p);
  }
  r.stageTimer-=dt;if(r.stageTimer<=0&&r.stage<4){spawnSquad(r);r.stageTimer=10.5;} 
  for(const e of [...r.enemies]){if(e.transition>0){e.transition-=dt;continue}const live=participants(r).filter(p=>p.alive);if(!live.length)break;const target=live.reduce((a,b)=>dist(e,a)<dist(e,b)?a:b);let dx=target.x-e.x,dy=target.y-e.y;const d=Math.hypot(dx,dy)||1;let vx=dx/d,vy=dy/d;
    if(e.type==='sniper'){if(d<230){vx=-vx;vy=-vy}else if(d<330){vx=-vy*.85;vy=(dx/d)*.85}if(e.x<55)vx=Math.abs(vx);if(e.x>W-55)vx=-Math.abs(vx);if(e.y<55)vy=Math.abs(vy);if(e.y>H-55)vy=-Math.abs(vy)}
    if(e.type==='runner'){e.chargeCd-=dt;if(e.charge>0){e.charge-=dt;vx=e.chargeVx;vy=e.chargeVy}else if(e.chargeCd<=0){e.charge=.45;e.chargeCd=rnd(3,4);e.chargeVx=dx/d;e.chargeVy=dy/d}}
    if(e.type==='boss'){e.ang=Math.atan2(dy,dx);e.pattern+=dt;if(e.bossPhase>=2&&e.pattern>2.8){e.pattern=0; e.charge=1.15; e.chargeVx=dx/d;e.chargeVy=dy/d}if(e.charge>0){e.charge-=dt;vx=0;vy=0}}
    const movement=e.spd*(e.type==='runner'&&e.charge>0?2.4:1);e.x=clamp(e.x+vx*movement*dt,e.r,W-e.r);e.y=clamp(e.y+vy*movement*dt,e.r,H-e.r);
    e.fireCd-=dt;if(e.fireCd<=0&&(e.type==='sniper'||e.type==='boss')){if(e.type==='boss'){const n=5+e.bossPhase*2;for(let i=0;i<n;i++)enemyFire(r,e,target,(i-(n-1)/2)*.15);e.fireCd=Math.max(.95,2.0-e.bossPhase*.3)}else{enemyFire(r,e,target);e.fireCd=1.5}}if(d<e.r+17)damagePlayer(target,e.type==='boss'?20:12);
  }
  for(const b of [...r.bullets]){if(b.adminRocket){const owner=r.players[b.owner];if(owner?.admin&&owner.adminAim){const target=v35Target(r,b.x,b.y);if(target)v35Steer(b,target,dt)}}b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.life<=0||b.x<-20||b.x>W+20||b.y<-20||b.y>H+20){if(b.rocket)explodeAdminRocket(r,b);r.bullets.splice(r.bullets.indexOf(b),1);continue}if(b.friendly){const p=r.players[b.owner];for(const e of [...r.enemies]){if(dist(b,e)<e.r+b.r){if(b.rocket)explodeAdminRocket(r,b);else dealEnemy(r,e,b.damage,p);r.bullets.splice(r.bullets.indexOf(b),1);break}}}else{for(const p of participants(r)){if(p.alive&&dist(p,b)<17+b.r){damagePlayer(p,b.damage);r.bullets.splice(r.bullets.indexOf(b),1);break}}}}
  for(const l of [...r.loot]){for(const p of participants(r)){if(p.alive&&dist(l,p)<27){if(l.type==='boost')p.boosts.push(8);else p.hp=Math.min(p.maxHp,p.hp+25);r.loot.splice(r.loot.indexOf(l),1);break}}}
  for(const f of [...r.fx]){f.life-=dt;if(f.life<=0)r.fx.splice(r.fx.indexOf(f),1)}
  if(participants(r).every(p=>!p.alive)){r.phase='lost';announce(r,'ALL FOUR PLAYERS DOWN — GAUNTLET FAILED');return}
  if(r.stage===4&&r.enemies.length===0){for(const l of r.loot){const p=participants(r).find(p=>p.alive);if(p){if(l.type==='heal')p.hp=Math.min(p.maxHp,p.hp+25);else p.boosts.push(8)}}r.loot=[];
    if(r.wave===6){r.phase='won';announce(r,'VICTORY! CROWN TYRANT DEFEATED');return}
    r.phase='shop';r.ready=Array(MAX_PLAYERS).fill(false);announce(r,'WAVE CLEARED — SHOP & READY UP');}
}
function leave(r,p){if(!r||!p)return;p.ws=null;p.lastSeen=Date.now();r.lastActive=Date.now();announce(r,`PLAYER ${p.id+1} DISCONNECTED — WAITING FOR REJOIN`)}
function attach(ws,r,p){if(p.ws&&p.ws!==ws)try{p.ws.close()}catch{}p.ws=ws;ws.room=r;ws.pid=p.id;p.lastSeen=Date.now();r.lastActive=Date.now();send(ws,{type:'joined',room:r.code,id:p.id,token:p.token});send(ws,{type:'chat_history',messages:r.chat});announce(r,`PLAYER ${p.id+1} CONNECTED`)}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost'); if(u.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,rooms:rooms.size}));return}if(/^\/assets\/(?:hero[0-3]|enemy[0-3]|boss[0-1]|hero_sheet_[0-3]|enemy_sheet_[0-3]|boss_sheet_[0-1])\.png$/.test(u.pathname)||/^\/assets\/arena[0-3]\.jpg$/.test(u.pathname)){const file=path.join(ROOT,u.pathname.slice(1));fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('Missing asset');return;}res.writeHead(200,{'Content-Type':u.pathname.endsWith('.png')?'image/png':'image/jpeg','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(data)});return;}const allowed={'/':'index.html','/index.html':'index.html','/online.html':'online.html','/menu.html':'menu.html','/classic.html':'classic.html','/legacy.html':'legacy.html','/soundtracks.html':'soundtracks.html','/saves.html':'saves.html','/site-check.html':'site-check.html','/404.html':'404.html'};const name=allowed[u.pathname];if(!name){res.writeHead(404);res.end('Not found');return}const file=path.join(ROOT,name);fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('Missing');return}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self' 'unsafe-inline' 'unsafe-eval' ws: wss: data:; object-src 'none'; frame-ancestors 'none'"});res.end(data)})});
const wss=new WebSocketServer({server,maxPayload:2048});
wss.on('connection',ws=>{ws.isAlive=true;ws.msgTimes=[];ws.on('pong',()=>{ws.isAlive=true});ws.on('message',data=>{if(data.length>2048)return;const now=Date.now();ws.msgTimes=ws.msgTimes.filter(t=>now-t<1000);if(ws.msgTimes.length>=80)return;ws.msgTimes.push(now);let m;try{m=JSON.parse(data.toString())}catch{return}if(typeof m!=='object'||m===null)return;
  if(m.type==='create'&&!ws.room){if(rooms.size>=MAX_ROOMS){send(ws,{type:'error',message:'Server at room capacity'});return}const r=newRoom();const p=player(0,crypto.randomBytes(20).toString('hex'));r.players[0]=p;attach(ws,r,p);return}
  if(m.type==='join'&&!ws.room){const key=String(m.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);const r=rooms.get(key);if(!r){send(ws,{type:'error',message:'Room not found'});return}let p=r.players.find(q=>q&&q.token===m.token&&m.token);if(!p){if(r.phase!=='lobby'){send(ws,{type:'error',message:'Room already started; reconnect with your original browser'});return}const free=r.players.findIndex(q=>!q);if(free<0){send(ws,{type:'error',message:'Room is full (4 players)'});return}p=player(free,crypto.randomBytes(20).toString('hex'));r.players[free]=p}attach(ws,r,p);return}
  const r=ws.room;if(!r)return;const p=r.players[ws.pid];if(!p||p.ws!==ws)return;r.lastActive=now;
  if(m.type==='chat'){roomChat(r,p,m.text,now);return}
  if(m.type==='profile'&&r.phase==='lobby'){
    const parsed=normalizeProfile(m.profile);
    if(parsed){p.profile=parsed;p.name=parsed.name;send(ws,{type:'toast',text:`V18 profile ready: ${p.name}`})}
    return;
  }
  if(m.type==='weapon_select'&&r.phase==='lobby'){if(m.weapon==='blaster'||m.weapon==='ion'){p.weapon=m.weapon;send(p.ws,{type:'toast',text:'Equipped '+(p.weapon==='ion'?'ION CANNON':'BLASTER')})}return;}
  if(m.type==='start'&&p.id===0&&canStart(r)){r.wave=0;r.coins=0;r.score=0;r.elapsed=0;r.teamEnergy=0;r.teamDome=0;for(const q of participants(r)){applyProfile(q);q.alive=true;q.upgrades=0;q.boosts=[];q.kills=0;q.score=0;q.adminCooldown=0;q.synergyCd=0;q.ultCharge=0;q.ultReadyAt=0}beginWave(r);return}
  if(m.type==='start'){send(ws,{type:'error',message:p.id!==0?'Only room creator can start':r.phase!=='lobby'?'Battle has already started':'Need at least 2 connected players; every joined player must be connected.'});return}
  if(m.type==='input'&&r.phase==='combat'){const k=m.keys||{};p.keys={up:k.up===true,down:k.down===true,left:k.left===true,right:k.right===true};p.shooting=m.fire===true;const angle=Number(m.angle);if(Number.isFinite(angle))p.angle=clamp(angle,-1e4,1e4);if(m.dash===true&&p.dashCd<=0&&p.alive){let dx=(p.keys.right?1:0)-(p.keys.left?1:0),dy=(p.keys.down?1:0)-(p.keys.up?1:0);if(dx===0&&dy===0){dx=Math.cos(p.angle);dy=Math.sin(p.angle)}[p.dashVx,p.dashVy]=norm(dx,dy);p.dashTime=.22;p.dashCd=3.3}if(m.shield===true&&p.shieldCd<=0&&p.alive){p.shieldTime=.85;p.shieldCd=9}return}
  if(m.type==='admin_unlock'){
    if(String(m.passcode||'')===(process.env.ADMIN_PASSCODE||'ADEP')){
      p.admin=true;send(ws,{type:'admin',enabled:true});
      send(ws,{type:'toast',text:'ADMIN MODE UNLOCKED — PRESS F FOR ROCKET NOVA'});
    }else send(ws,{type:'toast',text:'Wrong admin passcode'});
    return;
  }
  if(m.type==='admin_aim_toggle'){if(!p.admin){send(ws,{type:'toast',text:'Unlock admin with ADEP first'});return}p.adminAim=!p.adminAim;send(ws,{type:'toast',text:'ADMIN AIMBOT '+(p.adminAim?'ON':'OFF')});return}
  if(m.type==='ultimate_select'&&r.phase==='lobby'){const kind=String(m.kind||'');if(['guardian','scout','engineer'].includes(kind)){p.ultimate=kind;send(p.ws,{type:'toast',text:'Ultimate selected: '+kind.toUpperCase()})}return}
  if(m.type==='ultimate'){castUltimate(r,p);return}
  if(m.type==='admin_fire'){adminRocketRing(r,p);return}
  if(m.type==='synergy'){castSynergy(r,p,String(m.kind||''));return}
  if(m.type==='buy'){handleShop(r,p,String(m.item||''));return}
  if(m.type==='ready'&&r.phase==='shop'){r.ready[p.id]=true;if(participants(r).every(q=>r.ready[q.id]))beginWave(r);return}
  if(m.type==='restart'&&r.phase!=='combat'&&p.id===0){r.phase='lobby';r.wave=0;r.enemies=[];r.bullets=[];r.ready=Array(MAX_PLAYERS).fill(false);announce(r,'READY FOR ANOTHER RUN')}
 });ws.on('close',()=>{if(ws.room&&ws.room.players[ws.pid]?.ws===ws)leave(ws.room,ws.room.players[ws.pid])})});
const clock=setInterval(()=>{for(const r of rooms.values()){update(r,TICK);r.seq++;const v=JSON.stringify(view(r));for(const p of r.players){if(p&&p.ws&&p.ws.readyState===WebSocket.OPEN)p.ws.send(v)}if(Date.now()-r.lastActive>10*60*1000)rooms.delete(r.code)}},1000/30);
const presence=setInterval(()=>{const message={type:'presence',onlinePlayers:onlinePlayers(),activeRooms:rooms.size};for(const ws of wss.clients)send(ws,message)},2000);
const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue}ws.isAlive=false;ws.ping()}},30000);
server.listen(PORT,'0.0.0.0',()=>console.log(`Battle Arena online server listening on ${PORT}`));
function stop(){clearInterval(clock);clearInterval(presence);clearInterval(heartbeat);wss.close();server.close()}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
module.exports={participants,connectedPlayers,canStart,cleanChat,roomChat,onlinePlayers,server,rooms,newRoom,player,normalizeProfile,applyProfile,update,beginWave,spawnSquad,dealEnemy,adminRocketRing,explodeAdminRocket,castSynergy,castUltimate,view,v35Target,v35Steer,firePlayer,stop};
