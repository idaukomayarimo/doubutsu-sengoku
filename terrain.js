/*
 * 地形の定義とランダムマップ生成
 *
 * 地形の追加方法：TERRAINS にエントリを足し、MAP_RECIPE に配置数を書く。
 *   walkable … 武将が入れるか（false のマスは塗れず、包囲判定では「壁」として働く）
 *   value    … 領地1マスあたりの得点
 *   icon     … マス上に描く絵文字（sprite 未設定時のフォールバック）
 *   sprite   … ▼ イラスト差し替えポイント：PNG パスを入れると icon の代わりに描画
 *   base     … 誰の領地でもないときの塗り色（null なら通常の地面色）
 */
window.Terrain = (() => {
  'use strict';

  const TERRAINS = {
    plain: { name: '平地', walkable: true, value: 1, icon: null, sprite: null, base: null },
    castle: { name: '城', walkable: true, value: 3, icon: '🏯', sprite: null, base: '#f7d77a' },
    mountain: { name: '山', walkable: false, value: 0, icon: '⛰️', sprite: null, base: '#9fb47f' },
  };

  // 1ゲームあたりの配置数。pairs は点対称に2マスずつ置く組の数（公平さのため）
  const MAP_RECIPE = {
    centerCastle: true,
    castlePairs: 1,
    mountainPairs: 3,
    minDistFromStart: { castle: 3, mountain: 2 },
  };
  const MAX_ATTEMPTS = 60;

  const shuffle = (list, rng) => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  /** 山以外のマスがすべて1つにつながっているか（閉じ込められる場所がないか） */
  function isConnected(grid, terrain) {
    const walkable = grid.all.filter((h) => TERRAINS[terrain[h.row][h.col]].walkable);
    if (walkable.length === 0) return false;
    const seen = new Set([Hex.hexKey(walkable[0])]);
    const queue = [walkable[0]];
    while (queue.length > 0) {
      const hex = queue.shift();
      grid.neighbors(hex)
        .filter((n) => TERRAINS[terrain[n.row][n.col]].walkable && !seen.has(Hex.hexKey(n)))
        .forEach((n) => { seen.add(Hex.hexKey(n)); queue.push(n); });
    }
    return seen.size === walkable.length;
  }

  function tryGenerate(grid, starts, rng) {
    const terrain = Array.from({ length: grid.rows }, () => Array(grid.cols).fill('plain'));
    const used = new Set(starts.map(Hex.hexKey));
    const place = (hex, type) => { terrain[hex.row][hex.col] = type; used.add(Hex.hexKey(hex)); };

    const center = { col: Math.floor(grid.cols / 2), row: Math.floor(grid.rows / 2) };
    if (MAP_RECIPE.centerCastle && !used.has(Hex.hexKey(center))) place(center, 'castle');

    const pairCandidates = (minDist) => shuffle(grid.all, rng).filter((h) => {
      const m = grid.mirror(h);
      return m && !Hex.sameHex(h, m)
        && starts.every((s) => Hex.distance(s, h) >= minDist && Hex.distance(s, m) >= minDist);
    });

    const placePairs = (type, count) => {
      let placed = 0;
      pairCandidates(MAP_RECIPE.minDistFromStart[type]).forEach((h) => {
        const m = grid.mirror(h);
        if (placed >= count || used.has(Hex.hexKey(h)) || used.has(Hex.hexKey(m))) return;
        place(h, type);
        place(m, type);
        placed += 1;
      });
    };
    placePairs('castle', MAP_RECIPE.castlePairs);
    placePairs('mountain', MAP_RECIPE.mountainPairs);
    return terrain;
  }

  /**
   * ランダムな地形マップを返す（terrain[row][col] = TERRAINS のキー）。
   * 山で道がふさがらない配置になるまで作り直す。
   */
  function generate(grid, starts, rng = Math.random) {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const terrain = tryGenerate(grid, starts, rng);
      if (isConnected(grid, terrain)) return terrain;
    }
    console.warn('地形の生成に失敗したため、平地だけのマップにします');
    return Array.from({ length: grid.rows }, () => Array(grid.cols).fill('plain'));
  }

  return { TERRAINS, generate };
})();
