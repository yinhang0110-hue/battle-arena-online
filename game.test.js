'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');const EventEmitter=require('node:events');
class MockWSS extends EventEmitter{constructor(){super();this.clients=new Set()}close(){}}
const original=Module._load;Module._load=function(id,...args){if(id==='ws')return {WebSocketServer:MockWSS,WebSocket:{OPEN:1}};return original.call(this,id,...args)};
const game=require('../server.js');Module._load=original;
test('four-player run launches, waves spawn, boss cannot be one-shot',()=>{
 const r=game.newRoom();r.players=Array.from({length:4},(_,i)=>game.player(i,String(i)));r.players[0].ws={readyState:1,send:()=>{}};r.players[1].ws={readyState:1,send:()=>{}};game.beginWave(r);assert.equal(r.wave,1);assert.equal(r.phase,'combat');game.spawnSquad(r);assert.ok(r.enemies.length>=4);r.wave=3;r.stage=3;game.spawnSquad(r);const boss=r.enemies.find(e=>e.type==='boss');assert.ok(boss);const hp=boss.hp;game.dealEnemy(r,boss,999999,r.players[0]);assert.ok(boss.hp>hp*.9,'single shot should be capped');
});
test('end wave offers shop and rewards',()=>{
 const r=game.newRoom();r.players=Array.from({length:4},(_,i)=>game.player(i,String(i)));for(const p of r.players)p.ws={readyState:1,send:()=>{}};game.beginWave(r);r.stage=4;r.stageTimer=100;r.enemies=[];game.update(r,1/30);assert.equal(r.phase,'shop');
});
test('players cannot move beyond arena',()=>{
 const r=game.newRoom();r.players=Array.from({length:4},(_,i)=>game.player(i,String(i)));for(const p of r.players)p.ws={readyState:1,send:()=>{}};game.beginWave(r);r.stage=4;r.stageTimer=100;r.enemies=[game.makeEnemy?game.makeEnemy(r,'grunt'): {x:25,y:25,type:'grunt',r:12,hp:20,maxHp:20,spd:0,fireCd:999,id:1}];r.players[0].x=899;r.players[0].keys={right:true};game.update(r,1/30);assert.ok(r.players[0].x<=882);
});
test('team synergy requires proximity, energy and cooldown',()=>{
 const r=game.newRoom();r.players=Array.from({length:4},(_,i)=>game.player(i,String(i)));for(const p of r.players)p.ws={readyState:1,send:()=>{}};
 game.beginWave(r);r.stage=4;r.stageTimer=100;r.enemies=[{x:25,y:25,type:'grunt',r:12,hp:20,maxHp:20,spd:0,fireCd:999,id:1}];
 const p=r.players[0];r.teamEnergy=100;p.hp=40;r.players[1].hp=50;
 assert.equal(game.castSynergy(r,p,'heal'),true);assert.ok(p.hp>40);assert.ok(r.players[1].hp>50);assert.equal(r.teamEnergy,50);
 assert.equal(game.castSynergy(r,p,'heal'),false);
 p.synergyCd=0;r.teamEnergy=100;assert.equal(game.castSynergy(r,p,'dome'),true);assert.equal(r.teamDome,5);
 p.synergyCd=0;r.teamEnergy=100;assert.equal(game.castSynergy(r,p,'volley'),true);assert.equal(r.bullets.filter(b=>b.rocket).length,16);
});
test('four player slots and readies exist',()=>{const r=game.newRoom();assert.equal(r.players.length,4);assert.equal(r.ready.length,4)});
test.after(()=>{game.stop();game.rooms.clear()});

test('admin rocket nova requires unlock, launches a ring, and respects cooldown',()=>{
 const r=game.newRoom();r.players=Array.from({length:4},(_,i)=>game.player(i,String(i)));for(const p of r.players)p.ws={readyState:1,send:()=>{}};game.beginWave(r);const p=r.players[0];
 assert.equal(game.adminRocketRing(r,p),false);assert.equal(r.bullets.length,0);
 p.admin=true;assert.equal(game.adminRocketRing(r,p),true);assert.equal(r.bullets.length,32);assert.ok(r.bullets.every(b=>b.rocket&&b.damage>=100));
 assert.equal(game.adminRocketRing(r,p),false);assert.equal(r.bullets.length,32);
 p.adminCooldown=0;p.adminReadyAt=0;assert.equal(game.adminRocketRing(r,p),true);assert.equal(r.bullets.length,64);
});
test('rocket ring splash damages a nearby enemy but not a distant one',()=>{
 const r=game.newRoom();r.players=Array.from({length:4},(_,i)=>game.player(i,String(i)));for(const p of r.players)p.ws={readyState:1,send:()=>{}};game.beginWave(r);
 const near={x:320,y:250,r:14,type:'grunt',hp:900,maxHp:900,id:1,transition:0};const far={x:700,y:250,r:14,type:'grunt',hp:900,maxHp:900,id:2,transition:0};r.enemies=[near,far];
 game.explodeAdminRocket(r,{x:320,y:250,owner:0,damage:145});assert.ok(near.hp<900);assert.equal(far.hp,900);
});
test('V18 profile values are sanitized and limited for four-player co-op',()=>{
 const p=game.player(0,'t');const profile=game.normalizeProfile({name:'Eason Prime',bestWave:12,completed:5,upgrades:{health:5,speed:5,damage:5},gear:{weapon:5,armor:5,charm:5}});
 assert.equal(profile.name,'Eason Prime');assert.equal(profile.completed,5);
 p.profile=profile;game.applyProfile(p);
 assert.ok(p.hp>100&&p.hp<=135);assert.ok(p.passiveDamage<=5);assert.ok(p.passiveSpeed<=24);assert.ok(p.passiveArmor<=4);
 assert.equal(game.normalizeProfile({name:'CHEATER',upgrades:{damage:10000},gear:{weapon:9999}}).damage,5);
});
