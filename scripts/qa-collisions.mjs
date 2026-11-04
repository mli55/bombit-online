/* Native one/two-player and online two-player collision/target regression matrix. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
const base=(process.env.BASE_URL||'http://localhost:3000').replace(/\/$/,'');
const output=resolve(process.env.QA_OUTPUT_DIR||'.local/collision-parity-qa');
const errors=[],results=[];
try{
 for(const mode of ['single','native-two','online-two']){
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/game/?collision-qa');await page.waitForFunction(()=>window.onlineBridge?.state==='mainMenuState');
  const exercise=mode=>{
   const game=Game.App.getInstance(),online=mode==='online-two',directions=[['LEFT',-1,0],['RIGHT',1,0],['UP',0,-1],['DOWN',0,1]],cases=[];
   game.raf.stop();TweenLite.ticker.sleep();Game.Instances.DataManager.getTutorialComplete=()=>true;Game.PlayerAI.prototype.update=Game.Player.prototype.update;
   let wall=game.time.time,raf=game.time.now;const oldNow=Date.now;Date.now=()=>wall;
   const check=(ok,msg)=>{if(!ok)throw Error(mode+': '+msg);};
   let fingerprint=2166136261;
   const step=(n=1)=>{for(let i=0;i<n;i++){if(online)onlineBridge.advance([onlineBridge.frame+1,[0,0,0,0]],true);else{wall+=1000/60;raf+=1000/60;game.update(raf);}if(online)for(const char of onlineBridge.checksum())fingerprint=Math.imul(fingerprint^char.charCodeAt(0),16777619)>>>0;}};
   const place=(p,c)=>{p.gridCell=c;p.gridPositionX=c.gridPositionX;p.gridPositionY=c.gridPositionY;p.x=c.centerX;p.y=c.centerY;};
   const start=()=>{
    if(online)onlineBridge.start({seed:'collision-parity',campaignSeed:'collision-parity',difficulty:1,round:1,scores:[0,0,0,0],players:[{seat:0,character:0},{seat:1,character:1}]});
    else{game.state.start('gameplayState',true,false,Game.GAME_MODE.ARCADE,1,mode==='single'?Game.PLAYER_MODE.SINGLE_PLAYER:Game.PLAYER_MODE.MULTI_PLAYER,Game.MAP_THEME.RANDOM,mode==='single'?[0]:[0,1],1);step(4);}
    const state=game.state.getCurrentState(),grid=state.grid,p=grid.players[0];
    for(const b of grid.boxes)b.destroy();grid.boxes=[];
    for(const col of grid.cells)for(const c of col){c.cellContains=Game.MAP.FREE;c.isEmpty=true;c.isDangerCell=c.isFreezeCell=c.isItemCell=false;}
    for(const p of grid.players){p.invincible=true;p.invincibilityTimer=-1e8;}
    place(p,grid.cells[6][5]);p.bombs=10;
    return {state,grid,p};
   };
   try{
    for(const [direction,dx,dy]of directions)for(const obstacle of ['wall','brick','bomb','edge','no-kick','open']){
     const {grid,p}=start();let x=6,y=5;
     if(obstacle==='edge'){x=dx<0?0:dx>0?Game.SETTINGS.GRID_WIDTH-1:x;y=dy<0?0:dy>0?Game.SETTINGS.GRID_HEIGHT-1:y;}
     const cell=grid.cells[x][y];place(p,cell);p.putBomb();const bomb=grid.bombs[0];
     const next=grid.cells[x+dx]?.[y+dy];
     if(['wall','brick','bomb'].includes(obstacle)){next.isEmpty=false;next.cellContains=obstacle==='wall'?Game.MAP.WALL:obstacle==='brick'?Game.MAP.BLOCK:Game.MAP.BOMB;}
     // Invoke actual player movement, including its kick ability guard.
     place(p,grid.cells[x-dx][y-dy]);p.canKickBombs=obstacle!=='no-kick';p['checkMove'+direction[0]+direction.slice(1).toLowerCase()]();step(6);
     if(obstacle==='open')check(bomb.exists&&bomb.isKicked,'valid kick must move before collision');
     else check(bomb.exists&&!bomb.isKicked&&bomb.timer<200,'contact must not explode blocked or unkickable bomb '+direction+' '+obstacle);
     cases.push({kind:'bomb-contact',direction,obstacle,alive:bomb.exists,kicked:bomb.isKicked});
    }
    for(const[direction,dx,dy]of directions){
     const{state,grid,p}=start();p.direction=Game.DIRECTION[direction];p.createWeapon(Game.ITEM_TYPE.GRENADE);p.checkGrenadeIndicator();
     // Same aim axis, new perpendicular coordinate: upstream marker went stale.
     place(p,grid.cells[6+(dy?1:0)][5+(dx?1:0)]);p.checkGrenadeIndicator();
     const target=grid.cells[p.gridPositionX+2*dx][p.gridPositionY+2*dy];
     check(p.grenadeIndicator.visible&&p.grenadeIndicator.x===target.centerX&&p.grenadeIndicator.y===target.centerY,'marker follows both coordinates '+direction);
     target.cellContains=Game.MAP.WALL;target.isEmpty=false;p.checkGrenadeIndicator();p.useWeapon();
     check(!p.grenadeIndicator.visible&&p.weaponCurrentUses===0&&grid.weapons.length===0,'wall refuses launch and hides target');
     target.cellContains=Game.MAP.FREE;target.isEmpty=true;p.checkGrenadeIndicator();p.useWeapon();const grenade=grid.weapons[0];
     check(grenade.cellFinal===target&&p.weaponCurrentUses===1,'launch uses visible marker');
     place(p,grid.cells[1][1]);step(8);state.pauseGame();const before=grenade.classicFlightMS;step(60);
     check(grenade.exists&&grenade.classicFlightMS===before&&!grenade.grenadeExplosion,'pause freezes flight');
     state.unpauseGame();let steps=8;while(grenade.exists&&steps<60){step();steps++;}
     const blast=grenade.grenadeExplosion;
     check(blast&&blast.gridCell===target&&target.isDangerCell,'blast at launch-time target');
     const actual=[target,...blast.cellsUsed].map(c=>[c.gridPositionX,c.gridPositionY]).sort();
     const expected=[[target.gridPositionX,target.gridPositionY],...directions.map(([,x,y])=>[target.gridPositionX+x,target.gridPositionY+y])].sort();
     check(JSON.stringify(actual)===JSON.stringify(expected),'five-cell cross damage '+direction);
     check(steps>=29&&steps<=31,'flight duration uses simulation time');step(25);check(!target.isDangerCell,'impact cleans up');
     cases.push({kind:'grenade',direction,steps,target:[target.gridPositionX,target.gridPositionY],damage:actual,paused:true});
     // Invalid boundary after a rejected wall shot must not reuse its old target.
     const retry=start();retry.p.direction=Game.DIRECTION[direction];retry.p.createWeapon(Game.ITEM_TYPE.GRENADE);
     const blocked=retry.grid.cells[6+dx*2][5+dy*2];blocked.cellContains=Game.MAP.WALL;blocked.isEmpty=false;retry.p.useWeapon();
     place(retry.p,retry.grid.cells[dx<0?0:dx>0?Game.SETTINGS.GRID_WIDTH-1:6][dy<0?0:dy>0?Game.SETTINGS.GRID_HEIGHT-1:5]);retry.p.checkGrenadeIndicator();retry.p.useWeapon();
     check(retry.p.weaponCurrentUses===0&&!retry.p.grenadeIndicator.visible&&retry.grid.weapons.length===0,'edge rejects stale target '+direction);
     cases.push({kind:'grenade-edge',direction,rejected:true});
    }
    return {mode,cases,replayFingerprint:online?String(fingerprint):null};
   }finally{Date.now=oldNow;}
  };
  const result=await page.evaluate(exercise,mode);
  if(mode==='online-two'){
   const peer=await browser.newPage();peer.on('pageerror',e=>errors.push(e.message));
   await peer.goto(base+'/game/?collision-qa');await peer.waitForFunction(()=>window.onlineBridge?.state==='mainMenuState');
   assert.deepEqual(await peer.evaluate(exercise,mode),result,'Two independent clients must match all collision frames');await peer.close();
  }
  results.push(result);await page.close();
 }
 assert.deepEqual(errors,[]);await mkdir(output,{recursive:true});await writeFile(resolve(output,'results.json'),JSON.stringify({baseURL:base,results},null,2)+'\n');
 console.log(JSON.stringify({baseURL:base,passed:results.reduce((n,r)=>n+r.cases.length,0),results},null,2));
}finally{await browser.close();}
