import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../original/azerion-libs.min.js',import.meta.url),'utf8');
const begin=source.indexOf('update:function(time){if(this.time.update(time)'),end=source.indexOf(',updateLogic:function(timeStep)',begin);
assert.ok(begin>=0&&end>begin);
const actualUpdate=vm.runInNewContext('('+source.slice(begin+'update:'.length,end)+')');
const patch=readFileSync(new URL('../public/simulation-clock.js',import.meta.url),'utf8');
function fixture(patched){
 const Phaser={Game:function(){}};Phaser.Game.prototype.update=actualUpdate;
 Phaser.Game.prototype.updateLogic=function(){if(!this.paused)this.timer+=this.time.elapsedMS;};
 if(patched)vm.runInNewContext(patch,{Phaser});
 const game=new Phaser.Game();Object.assign(game,{state:{current:'gameplayState'},timer:0,_deltaTime:0,_kickstart:false,_spiraling:0,_lastCount:0,forceSingleUpdate:true,updateRender(){}});
 game.time={time:0,now:0,desiredFps:60,desiredFpsMult:1/60,slowMotion:1,update(time){this.elapsedMS=this.elapsed=time-this.now;this.now=this.time=time;},refresh(){this.elapsedMS=0;}};
 return game;
}
function detonate(rate,patched=true){const game=fixture(patched);let time=0;while(game.timer<60000/35&&time<10000){time+=1000/(typeof rate==='function'?rate(time):rate);game.update(time);}return {time,timer:game.timer};}
test('bundled native scheduler uses display delta and doubles the fuse at 120 Hz without the fix',()=>{
 assert.ok(Math.abs(detonate(120,false).time-3433)<30);
});
for(const hz of [30,60,120,144,240])test(`native ${hz} Hz advances the fuse in 60 Hz simulation time`,()=>{
 const result=detonate(hz);assert.ok(Math.abs(result.time-60000/35)<1000/hz+18,JSON.stringify(result));
});
test('changing from 120 Hz to 30 Hz never changes the bomb duration',()=>{
 const result=detonate(time=>time<800?120:30);assert.ok(Math.abs(result.time-60000/35)<51,JSON.stringify(result));
});
test('native pause consumes no fuse time; resume does not include paused wall time',()=>{
 const game=fixture(true);for(let i=1;i<=30;i++)game.update(i*1000/60);const before=game.timer;game.paused=true;
 for(let i=31;i<=150;i++)game.update(i*1000/60);assert.equal(game.timer,before);game.paused=false;game.update(151*1000/60);assert.ok(game.timer-before<34);
});
