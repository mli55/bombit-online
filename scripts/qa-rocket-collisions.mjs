/* Real-engine rocket collision and cleanup regressions. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, headless: true });
const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const output = resolve(process.env.QA_OUTPUT_DIR || '.local/rocket-collisions-qa');
const errors = [];
try {
  const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/game/');
  await page.waitForFunction(() => window.onlineBridge?.state === 'mainMenuState');
  const run = () => {
    const game = Game.App.getInstance(), results = [];
    const advance = n => { for (let i=0;i<n;i++) onlineBridge.advance([onlineBridge.frame+1,[0,0,0,0]],true); };
    const directions = [['LEFT',-1,0],['RIGHT',1,0],['UP',0,-1],['DOWN',0,1]];
    const start = () => {
      onlineBridge.start({seed:'rocket-collisions',difficulty:1,round:1,scores:[0,0,0,0],players:[0,1,2,3].map((character,seat)=>({character,seat}))});
      const grid = game.state.getCurrentState().grid;
      for (const p of grid.players) { p.invincible=true;p.invincibilityTimer=-1e8; }
      return grid;
    };
    const place = (p,c) => { p.gridCell=c;p.gridPositionX=c.gridPositionX;p.gridPositionY=c.gridPositionY;p.x=c.centerX;p.y=c.centerY; };
    for (const [direction,dx,dy] of directions) for (const kind of ['near-wall','far-wall','edge','brick','bomb']) {
      const grid=start(),p=grid.players[0];
      let source=grid.cells[6][5],target=grid.cells[6+dx*(kind==='far-wall'?3:1)][5+dy*(kind==='far-wall'?3:1)];
      const box=kind==='brick'?grid.boxes.find(b=>b.gridPositionX>2&&b.gridPositionX<12&&b.gridPositionY>2&&b.gridPositionY<8):null;
      if (box) { target=grid.cells[box.gridPositionX][box.gridPositionY];source=grid.cells[box.gridPositionX-dx][box.gridPositionY-dy]; }
      for (const b of grid.boxes) if(b!==box)b.destroy();grid.boxes=box?[box]:[];
      for (const col of grid.cells) for (const c of col) { c.cellContains=Game.MAP.FREE;c.isEmpty=true;c.isDangerCell=c.isFreezeCell=c.isItemCell=false; }
      if(kind.includes('wall')||kind==='brick'){target.cellContains=kind==='brick'?Game.MAP.BLOCK:Game.MAP.WALL;target.isEmpty=false;}
      let bomb;
      if(kind==='bomb'){place(p,target);p.putBomb();bomb=grid.bombs[0];}
      place(p,source);p.direction=Game.DIRECTION[direction];p.createWeapon(Game.ITEM_TYPE.ROCKET);p.useWeapon();
      const rocket=grid.weapons.find(w=>w instanceof Game.Rocket);
      let flightFrames=0,trail=false;
      while(rocket.exists&&flightFrames<180){advance(1);flightFrames++;if(rocket.exists&&rocket.gridCell.isDangerCell)trail=true;}
      const blast=rocket.impactExplosion;
      if(!blast)throw Error(`No impact: ${direction} ${kind}`);
      const expected=kind==='brick'||kind==='bomb'?target:kind==='near-wall'?source:kind==='far-wall'?
        grid.cells[target.gridPositionX-dx][target.gridPositionY-dy]:grid.cells[dx<0?0:dx>0?Game.SETTINGS.GRID_WIDTH-1:6][dy<0?0:dy>0?Game.SETTINGS.GRID_HEIGHT-1:5];
      const impact={correctCell:blast.gridCell===expected,danger:blast.gridCell.isDangerCell,rocketGone:!rocket.exists&&!rocket.animationRocket.visible,trail};
      rocket.createExplosion();
      const uniqueImpact=grid.weaponExplosions.filter(b=>b===blast).length===1;
      let blastFrames=0;while(blast.exists&&blastFrames<60){advance(1);blastFrames++;}
      advance(60);
      results.push({direction,kind,flightFrames,blastFrames,impact,uniqueImpact,
        wallIntact:!kind.includes('wall')||(target.cellContains===Game.MAP.WALL&&!target.isEmpty),
        sourceFree:source.cellContains===Game.MAP.FREE&&source.isEmpty,
        clear:!blast.gridCell.isDangerCell,brickDestroyed:kind!=='brick'||!grid.boxes.includes(box),
        bombTriggered:kind!=='bomb'||!bomb.exists});
    }
    for (const [direction,dx,dy] of directions) {
      const grid=start(),p=grid.players[0],victim=grid.players[1];
      for(const b of grid.boxes)b.destroy();grid.boxes=[];
      for(const col of grid.cells)for(const c of col){c.cellContains=Game.MAP.FREE;c.isEmpty=true;c.isDangerCell=c.isFreezeCell=c.isItemCell=false;}
      place(p,grid.cells[6][5]);place(victim,grid.cells[6+dx*3][5+dy*3]);
      victim.invincible=false;victim.initialBlinking=false;victim.invulnerable=false;
      p.direction=Game.DIRECTION[direction];p.createWeapon(Game.ITEM_TYPE.ROCKET);p.useWeapon();
      const rocket=grid.weapons[0];let frames=0;
      while(rocket.exists&&frames++<100)advance(1);
      advance(2);
      results.push({kind:'player',direction,hit:!rocket.exists&&rocket.impactExplosion?.gridCell===victim.gridCell&&victim.dead});
    }
    // A rocket blast expiring must not erase a newer blast in the same cell.
    const grid=start(),p=grid.players[0],cell=p.gridCell;
    p.direction=Game.DIRECTION.RIGHT;p.createWeapon(Game.ITEM_TYPE.ROCKET);p.useWeapon();
    const rocket=grid.weapons[0];rocket.createExplosion();const first=rocket.impactExplosion;
    advance(10);
    const second=new Game.WeaponExplosion(game,grid,cell,0,p,Game.DIRECTION.ALL);
    grid.weaponExplosions.push(second);grid.rowsGroup[cell.gridPositionY].add(second);second.makeExplosion();
    advance(8);const overlapKept=!first.exists&&second.exists&&cell.isDangerCell;
    const timer=second.timer;grid.gameStatus=Game.GAME_STATUS.PAUSED;advance(30);
    const paused=second.timer===timer&&second.exists;
    grid.gameStatus=Game.GAME_STATUS.PLAYING;advance(20);
    results.push({kind:'overlap-pause',overlapKept,paused,clear:!second.exists&&!cell.isDangerCell});
    return {results,checksum:onlineBridge.checksum()};
  };
  const first=await page.evaluate(run);
  const peer=await browser.newPage();peer.on('pageerror',e=>errors.push(e.message));
  await peer.goto(base+'/game/');await peer.waitForFunction(()=>window.onlineBridge?.state==='mainMenuState');
  assert.deepEqual(await peer.evaluate(run),first,'A fresh client must reproduce collisions and final state');
  const {results}=first;
  for(const r of results){
    if(r.kind==='player'){assert.ok(r.hit,JSON.stringify(r));continue;}
    if(r.kind==='overlap-pause'){assert.ok(r.overlapKept&&r.paused&&r.clear,JSON.stringify(r));continue;}
    assert.deepEqual(r.impact,{correctCell:true,danger:true,rocketGone:true,trail:false},JSON.stringify(r));
    assert.ok(r.blastFrames>=17&&r.blastFrames<=18,JSON.stringify(r));
    for(const key of ['uniqueImpact','wallIntact','sourceFree','clear','brickDestroyed','bombTriggered'])assert.ok(r[key],`${key}: ${JSON.stringify(r)}`);
  }
  assert.deepEqual(errors,[]);
  await mkdir(output,{recursive:true});await writeFile(resolve(output,'results.json'),JSON.stringify({baseURL:base,results},null,2)+'\n');
  console.log(JSON.stringify({baseURL:base,passed:results.length,results},null,2));
} finally { await browser.close(); }
