/* 4399 random map: hard walls placed by local shape, then 60% soft bricks. Source: DoAction.as (frame 1 and 2). */
(() => {
  const W = 15, H = 13;
  const spawns = [[3, 3], [W - 4, 3], [3, H - 4], [W - 4, H - 4]];
  const xy = [[-1, 0], [0, -1], [1, 0], [0, 1]];
  const around = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];

  // Returns rows of '' (open) and 'wall'. random(n) is Flash random(n).
  function generate(random) {
    const brick = Array.from({ length: H }, () => Array(W).fill(''));
    // Out of bounds reads as undefined, which Flash treats as not open.
    const at = (x, y) => brick[y]?.[x];
    const x0 = Math.floor(W / 2) - 1, y0 = Math.floor(H / 2) - 1;
    for (let y = y0; y <= y0 + 1; y++) for (let x = x0; x <= x0 + 1; x++) brick[y][x] = 'wall';
    const ranMap = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const near = spawns.some(([hx, hy]) => (x === hx && y === hy) || xy.some(([dx, dy]) => x === hx + dx && y === hy + dy));
      if (!near) ranMap.push([x, y]);
    }
    const length = ranMap.length;
    for (let i = 0; i < length; i++) {
      const j = random(length);
      [ranMap[i], ranMap[j]] = [ranMap[j], ranMap[i]];
    }
    // Spawn diagonals are tried first. The loop still stops at the original
    // length, so the last 16 shuffled cells are never tried.
    for (const [hx, hy] of spawns) for (let j = 1; j < 8; j += 2) ranMap.unshift([hx + around[j][0], hy + around[j][1]]);
    const nb = (x, y, j) => at(x + around[j][0], y + around[j][1]);
    for (let i = 0; i < length; i++) {
      const [x, y] = ranMap[i];
      if (at(x, y) !== '') continue;
      // Skip a cell with a closed corner: an edge, its diagonal and the next edge.
      let j = 0;
      for (; j < 8; j += 2) if (nb(x, y, j) !== '' && nb(x, y, (j + 1) % 8) !== '' && nb(x, y, (j + 2) % 8) !== '') break;
      if (j < 8) continue;
      // Count open and closed runs around the cell. A wall goes in only where
      // the ring has at most three runs, so it never splits open space.
      let empty = at(x - 1, y) === '';
      let totalEmpty = empty ? 1 : 0, totalBrick = empty ? 0 : 1;
      for (j = 1; j < 8; j++) {
        const cell = nb(x, y, j);
        if (empty) {
          if (cell !== '') { empty = false; totalBrick++; }
        } else if (cell === '') {
          if (j % 2 === 0) { empty = true; totalEmpty++; }
          else if (nb(x, y, (j + 1) % 8) === '') { empty = true; totalEmpty++; }
          else j += 2;
        }
      }
      if (totalEmpty + totalBrick <= 3) brick[y][x] = 'wall';
    }
    return brick;
  }
  Game.ClassicMap = { generate, spawns };

  // Feed the generated layout to the port's map builder in its own format.
  const createMap = Game.Grid.prototype.createMap;
  Game.Grid.prototype.createMap = function () {
    const random = n => this.game.rnd.integerInRange(0, n - 1);
    const layout = generate(random);
    const x0 = Math.floor(W / 2) - 1, y0 = Math.floor(H / 2) - 1;
    const grid = layout.map((row, y) => row.map((value, x) =>
      x >= x0 && x <= x0 + 1 && y >= y0 && y <= y0 + 1 ? Game.MAP.TOTEM :
        value ? Game.MAP.WALL : spawns.some(([hx, hy]) => hx === x && hy === y) ? Game.GRID_DATA.PLAYER : Game.MAP.FREE));
    const cache = this.game.cache, getJSON = cache.getJSON;
    cache.getJSON = function (key, ...rest) {
      return key === 'maps' ? { maps: [{ grid, blockers: Infinity }] } : getJSON.call(this, key, ...rest);
    };
    try { return createMap.call(this); } finally { delete cache.getJSON; if (cache.getJSON !== getJSON) cache.getJSON = getJSON; }
  };

  // Every cell that is not a wall gets a soft brick with random(100) < 60, in
  // Flash's row order. Spawns and their four neighbors are then cleared.
  Game.Grid.prototype.createBoxes = function () {
    const styles = _.sample(this.possibleBlockers, 3);
    for (let y = 0; y < Game.SETTINGS.GRID_HEIGHT; y++) for (let x = 0; x < Game.SETTINGS.GRID_WIDTH; x++) {
      const cell = this.cells[x][y];
      if (!cell.isEmpty || this.game.rnd.integerInRange(0, 99) >= 60 || cell.isStartingCell) continue;
      cell.isEmpty = false;
      cell.cellContains = Game.MAP.BLOCK;
      const box = new Game.Box(this.game, cell.x, cell.y, styles[this.game.rnd.integerInRange(0, 2)], this, cell);
      this.astarGrid.grid[x][y].weight = 0;
      this.boxes.push(box);
      this.rowsGroup[y].add(box);
      this.blockersCreated++;
    }
  };
})();
