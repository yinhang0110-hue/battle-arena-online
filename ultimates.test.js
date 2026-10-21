'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const game=require('../server');
function fixture(kind='guardian'){
 const r=game.newRoom(); const p=game.player(0,'test');p.alive=true;p.ultimate=kind;p.ultCharge=100;p.ultReadyAt=0;r.players[0]=p;r.phase='combat';return {r,p};
}
for(const kind of ['guardian','scout','engineer'])test(kind+' ultimate spends charge and enters cooldown',()=>{
 const {r,p}=fixture(kind);r.enemies=[];
 assert.equal(game.castUltimate(r,p),true);assert.equal(p.ultCharge,0);assert.ok(p.ultReadyAt>Date.now());
 assert.equal(game.castUltimate(r,p),false);game.rooms.delete(r.code);
});
test('ultimate cannot trigger in lobby or without a full meter',()=>{
 const {r,p}=fixture();p.ultCharge=90;assert.equal(game.castUltimate(r,p),false);
 p.ultCharge=100;r.phase='lobby';assert.equal(game.castUltimate(r,p),false);game.rooms.delete(r.code);
});
test('Guardian ultimate protects its caster',()=>{
 const {r,p}=fixture('guardian');assert.equal(game.castUltimate(r,p),true);assert.ok(p.shieldTime>=6);game.rooms.delete(r.code);
});
test('profile never replaces ultimate preference',()=>{
 const {r,p}=fixture('engineer');p.profile={health:5,damage:5};game.applyProfile(p);assert.equal(p.ultimate,'engineer');game.rooms.delete(r.code);
});
