/*
 * 地形の定義とランダムマップ生成
 *
 * 地形の追加方法：TERRAINS にエントリを足し、MAP_RECIPE に配置数を書く。
 *   walkable … 部隊が入れるか（false のマスは塗れず、包囲判定では「壁」として働く）
 *   value    … 領地1マスあたりの得点
 *   guard    … その地形にいる部隊が受けるダメージの割り算（1.3 なら 1/1.3 に減る）
 *   icon     … マス上に描く絵文字（sprite 未設定時のフォールバック）
 *   sprite   … ▼ イラスト差し替えポイント：PNG パスを入れると icon の代わりに描画
 *   base     … 誰の領地でもないときの塗り色（null なら通常の地面色）
 */
window.Terrain = (() => {
  'use strict';

  const TERRAINS = {
    plain: { name: '平地', walkable: true, value: 1, guard: 1, icon: null, sprite: null, base: null },
    castle: { name: '城', walkable: true, value: 5, guard: 1.3, icon: '🏯', sprite: null, base: '#f7d77a' },
    forest: { name: '森', walkable: true, value: 1, guard: 1.3, icon: '🌲', sprite: null, base: '#cfe0a8' },
    mountain: { name: '山', walkable: false, value: 0, guard: 1, icon: '⛰️', sprite: null, base: '#9fb47f' },
  };

  // 1ゲームあたりの配置数。pairs は点対称に2マスずつ置く組の数（公平さのため）
  // 城は「各陣の本城 2」＋「中立 castlePairs×2」＝ 10
  const MAP_RECIPE = {
    castlePairs: 4,
    mountainPairs: 6,
    forestPairs: 6,
    minDistFromBase: { castle: 3, mountain: 2, forest: 2 },
  };
  const MAX_ATTEMPTS = 80;

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

  /**
   * @param {object} grid Hex.createGrid の戻り値
   * @param {{ bases: object[], reserved: object[] }} layout
   *   bases    … 各陣の本城（ここに城を置く）
   *   reserved … 布陣エリアなど、城・山を置かないマス
   */
  function tryGenerate(grid, { bases, reserved }, rng) {
    const terrain = Array.from({ length: grid.rows }, () => Array(grid.cols).fill('plain'));
    const used = new Set(bases.map(Hex.hexKey));
    const reservedKeys = new Set(reserved.map(Hex.hexKey));
    const place = (hex, type) => { terrain[hex.row][hex.col] = type; used.add(Hex.hexKey(hex)); };
    bases.forEach((b) => { terrain[b.row][b.col] = 'castle'; });

    const pairCandidates = (type) => shuffle(grid.all, rng).filter((h) => {
      const m = grid.mirror(h);
      if (!m || Hex.sameHex(h, m)) return false;
      if (type !== 'forest' && (reservedKeys.has(Hex.hexKey(h)) || reservedKeys.has(Hex.hexKey(m)))) return false;
      const minDist = MAP_RECIPE.minDistFromBase[type];
      return bases.every((b) => Hex.distance(b, h) >= minDist && Hex.distance(b, m) >= minDist);
    });

    const placePairs = (type, count) => {
      let placed = 0;
      pairCandidates(type).forEach((h) => {
        const m = grid.mirror(h);
        if (placed >= count || used.has(Hex.hexKey(h)) || used.has(Hex.hexKey(m))) return;
        place(h, type);
        place(m, type);
        placed += 1;
      });
    };
    placePairs('castle', MAP_RECIPE.castlePairs);
    placePairs('mountain', MAP_RECIPE.mountainPairs);
    placePairs('forest', MAP_RECIPE.forestPairs);
    return terrain;
  }

  /**
   * ランダムな地形マップを返す（terrain[row][col] = TERRAINS のキー）。
   * 山で道がふさがらない配置になるまで作り直す。
   */
  function generate(grid, layout, rng = Math.random) {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const terrain = tryGenerate(grid, layout, rng);
      if (isConnected(grid, terrain)) return terrain;
    }
    console.warn('地形の生成に失敗したため、城だけのマップにします');
    const plain = Array.from({ length: grid.rows }, () => Array(grid.cols).fill('plain'));
    layout.bases.forEach((b) => { plain[b.row][b.col] = 'castle'; });
    return plain;
  }

  return { TERRAINS, MAP_RECIPE, generate };
})();
