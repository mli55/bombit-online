/* Audit effective settings and actual-engine durations; run after build with the server started.
   PLAYWRIGHT_MODULE, CHROME_BIN, BASE_URL and QA_OUTPUT_DIR match the other QA scripts. */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const output = resolve(process.env.QA_OUTPUT_DIR || '.local/settings-qa');
await mkdir(output, { recursive: true });
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true});
try {
 const page=await browser.newPage();
 await page.goto((process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '') + '/game/');
 await page.waitForFunction(()=>window.onlineBridge?.state==='mainMenuState');
 const settings=await page.evaluate(()=>JSON.parse(JSON.stringify({...Game.SETTINGS})));
 await page.evaluate(()=>{
  Game.Instances.DataManager.getTutorialComplete=()=>true;
  Game.PlayerAI.prototype.update=Game.Player.prototype.update;
  const g=Game.App.getInstance();
  g.state.start('gameplayState',true,false,Game.GAME_MODE.ARCADE,1,Game.PLAYER_MODE.SINGLE_PLAYER,Game.MAP_THEME.RANDOM,[0],1);
 });
 await page.waitForFunction(()=>Game.App.getInstance().state.getCurrentState().grid?.players?.length===4);
 const single=await page.evaluate(()=>({settings:JSON.parse(JSON.stringify({...Game.SETTINGS})),lives:Game.App.getInstance().state.getCurrentState().grid.players.map(p=>p.lives)}));
 const measured=await page.evaluate(()=>{
 const game=Game.App.getInstance(),bridge=onlineBridge;
 const advance=n=>{for(let i=0;i<n;i++)bridge.advance([bridge.frame+1,[0,0,0,0]],true);};
 const start=()=>{
  bridge.start({seed:'settings-audit',difficulty:1,round:1,scores:[0,0,0,0],players:[0,1,2,3].map((character,seat)=>({character,seat}))});
  const state=game.state.getCurrentState(),grid=state.grid;
  for(const p of grid.players){p.invincible=true;p.initialBlinking=false;}
  for(const box of grid.boxes)box.destroy();grid.boxes=[];
  for(const col of grid.cells)for(const cell of col){cell.cellContains=Game.MAP.FREE;cell.isEmpty=true;cell.isDangerCell=cell.isFreezeCell=cell.isItemCell=false;}
  return {state,grid,p:grid.players[0]};
 };
 const flames=[];
 for(const power of [1,5]){
  const {grid,p}=start();p.power=power;p.putBomb();const bomb=grid.bombs[0],blast=bomb.bombExplosion;
  bomb.explode();let frames=0;while(blast.exists&&frames<100){advance(1);frames++;}
  flames.push({power,frames,ms:frames*1000/60});
 }
 let {grid,p}=start();p.direction=Game.DIRECTION.RIGHT;p.createWeapon(Game.ITEM_TYPE.ROCKET);p.useWeapon();
 const rocket=grid.weapons[0];rocket.createExplosion();const impact=rocket.impactExplosion;
 let rocketFrames=0;while(impact.exists&&rocketFrames<100){advance(1);rocketFrames++;}
 const rocketImpact={frames:rocketFrames,ms:rocketFrames*1000/60,cleared:!impact.gridCell.isDangerCell};
 ({grid,p}=start());p.createWeapon(Game.ITEM_TYPE.MINE);p.useWeapon();const mine=grid.mines[0];
 let hideFrames=0;while(mine.visible&&hideFrames<300){advance(1);hideFrames++;}
 const mineHide={frames:hideFrames,ms:hideFrames*1000/60};
 ({grid,p}=start());p.invincible=false;p.shieldActive=true;p.gridCell.isDangerCell=true;p.gridCell.dangerOwner=p;
 advance(1);p.gridCell.isDangerCell=false;let shieldFrames=1;while(p.invulnerable&&shieldFrames<200){advance(1);shieldFrames++;}
 const shield={frames:shieldFrames,ms:shieldFrames*1000/60,lives:p.lives};
 const result=start();const onlineLives=result.grid.players.map(p=>p.lives);
 return {flames,rocketImpact,mineHide,shield,onlineLives};
 });
 const data={menu:settings,single,measured};
 if(single.lives.some(v=>v!==1)||measured.onlineLives.some(v=>v!==1))throw Error('Initial lives regression');
 await writeFile(resolve(output, 'results.json'),JSON.stringify(data,null,2)+'\n');
 console.log(JSON.stringify({ singleLives: single.lives, measured },null,2));
} finally {await browser.close();}
