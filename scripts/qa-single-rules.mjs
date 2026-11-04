/* Native Single Player rules audit: actual engine, controlled boards and display clock. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
const base=(process.env.BASE_URL||'http://localhost:3000').replace(/\/$/,'');
const output=resolve(process.env.QA_OUTPUT_DIR||'.local/single-rules-qa');
const errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/game/?single-rules-qa');await page.waitForFunction(()=>window.onlineBridge?.state==='mainMenuState');
 const result=await page.evaluate(()=>{
  const game=Game.App.getInstance();game.raf.stop();TweenLite.ticker.sleep();Game.Instances.DataManager.getTutorialComplete=()=>true;
  const aiUpdate=Game.PlayerAI.prototype.update;Game.PlayerAI.prototype.update=Game.Player.prototype.update;
  let wall=game.time.time,raf=game.time.now;const oldNow=Date.now;Date.now=()=>wall;
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  const step=(n=1)=>{for(let i=0;i<n;i++){wall+=1000/60;raf+=1000/60;game.update(raf);}};
  const place=(p,c)=>{p.gridCell=c;p.gridPositionX=c.gridPositionX;p.gridPositionY=c.gridPositionY;p.x=c.centerX;p.y=c.centerY;};
  const start=(difficulty=1,round=1,controlled=true)=>{
   game.rnd.sow(['native-rules-'+difficulty+'-'+round]);
   game.state.start('gameplayState',true,false,Game.GAME_MODE.ARCADE,difficulty,Game.PLAYER_MODE.SINGLE_PLAYER,Game.MAP_THEME.RANDOM,[0],round);step(4);
   const state=game.state.getCurrentState(),grid=state.grid,p=grid.players[0];
   if(controlled){for(const b of grid.boxes)b.destroy();grid.boxes=[];
    for(const col of grid.cells)for(const c of col){c.cellContains=Game.MAP.FREE;c.isEmpty=true;c.isDangerCell=c.isFreezeCell=c.isItemCell=false;}
    for(const p of grid.players){p.invincible=true;p.invincibilityTimer=-1e8;}place(p,grid.cells[1][1]);}
   return {state,grid,p};
  };
  try{
   const difficulty=[];
   for(const level of [0,1,2]){const{state,grid,p}=start(level);const score=state.scoreManager;
    score.addScoreBlock(p.playerID);score.addScorePowerUp(p.playerID);score.addScoreKills(p.playerID);score.addExtraScore(p.playerID);score.addLeftOverTime(30000,p.playerID);
    const values={difficulty:level,lives:grid.players.map(p=>p.lives),shield:p.shieldActive,blockAndPickup:score.destructionScores[p.playerID],hit:score.killScores[p.playerID],win:score.extraScores[p.playerID],time:score.leftOverScores[p.playerID]};
    check(values.blockAndPickup===[105,110,115][level]&&values.hit===1000&&values.win===1000&&values.time===1500,'native scores');
    check(values.lives.every(n=>n===1)&&values.shield===(level===0),'initial lives and easy shield');difficulty.push(values);
   }
   const speeds=[];for(const shoes of [0,1,2,3,4]){const{p,grid}=start();
    for(let i=0;i<shoes;i++){const c=p.gridCell,item=new Game.Item(game,c,'powerup_fast',Game.ITEM_TYPE.SPEED);grid.items.push(item);grid.rowsGroup[c.gridPositionY].add(item);c.isItemCell=true;c.cellContains=Game.MAP.ITEM;p.checkItemPickUp();}
    const x=p.x,started=wall;p.inputController.rightPressed=true;step(30);p.inputController.rightPressed=false;
    const cells=(p.x-x)/Game.SETTINGS.CELL_WIDTH,frames=Math.max(3,6-shoes);check(Math.abs(cells-17.5/frames)<0.2,'native speed '+shoes);speeds.push({shoes,cells,wallMS:wall-started});
   }
   const status=[];for(const [flag,timer,expected]of [['frozen','frozenTimer',300000/35],['slowed','slowTimer',600000/35]]){
    const{p}=start();p[flag]=true;p[timer]=0;const started=wall;let frames=0;while(p[flag]&&frames++<1200)step();
    const ms=wall-started;check(Math.abs(ms-expected)<35,'native '+flag);status.push({flag,ms});
   }
   const weapons=[];for(const type of ['BATTERY','FIRE','FREEZE','GRENADE','MINE','ROCKET']){const{p,grid}=start();p.direction=Game.DIRECTION.RIGHT;p.createWeapon(Game.ITEM_TYPE[type]);const charges=p.weaponTotalUses;p.useWeapon();check(p.weaponCurrentUses===1,'native weapon use '+type);weapons.push({type,charges,launched:grid.weapons.length});}
   const pairs=[];for(const round of [1,2,3]){start(1,round);pairs.push(Game.SETTINGS.WEAPON_CHANCES.map(x=>x.name));}check(new Set(pairs.flat()).size===6,'native three-round weapon rotation');
   let{p,grid}=start();p.createWeapon(Game.ITEM_TYPE.MINE);p.useWeapon();const mine=grid.mines[0],mineStart=wall;let limit=0;while(mine.visible&&limit++<300)step();const mineHideMS=wall-mineStart;
   ({p,grid}=start());p.invincible=false;p.shieldActive=true;p.gridCell.isDangerCell=true;p.gridCell.dangerOwner=grid.players[1];p.checkDangerZone();p.gridCell.isDangerCell=false;const shieldStart=wall;limit=0;while(p.invulnerable&&limit++<200)step();const shieldMS=wall-shieldStart;
   const settings=JSON.parse(JSON.stringify({...Game.SETTINGS}));check(settings.MAX_BOMB_POWER===10&&settings.CHANCE_POWER_UP===65&&settings.CHANCE_POWER_UP_BEING_WEAPON===20,'effective settings');
   const ai=[];Game.PlayerAI.prototype.update=aiUpdate;
   for(const level of[0,1,2]){const{grid,p,state}=start(level,1,false);p.invincible=true;p.invincibilityTimer=-1e8;const positions=grid.players.map(p=>[p.x,p.y]);let moved=0,bombs=0;
    for(let i=0;i<1200&&game.state.current==='gameplayState';i++){step();if(i%60===0){moved+=grid.players.filter((p,n)=>p.isAI&&(p.x!==positions[n][0]||p.y!==positions[n][1])).length;bombs+=grid.bombs.length;}}
    check(moved>0&&bombs>0,'native AI '+level);ai.push({difficulty:level,moved,bombs,gameMS:state.gameTimer});
   }
   return {difficulty,speeds,status,weapons,pairs,mineHideMS,shieldMS,settings,ai};
  }finally{Date.now=oldNow;}
 });
 assert.deepEqual(errors,[]);await mkdir(output,{recursive:true});await writeFile(resolve(output,'results.json'),JSON.stringify({baseURL:base,result},null,2)+'\n');console.log(JSON.stringify({baseURL:base,result},null,2));
}finally{await browser.close();}
