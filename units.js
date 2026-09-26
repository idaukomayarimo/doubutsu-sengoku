/*
 * 兵種と命令の定義（データのみ）
 *
 * 兵種の追加方法：UNIT_TYPES に1件足し、generals.js の army で使うだけ。
 *   move        … 1回の行動で進めるマス数
 *   attack      … 攻撃力（兵数に掛ける係数）
 *   range       … 射程（1=隣だけ、2=2マス先まで）
 *   noEnter     … 入れない地形
 *   orders      … 使える命令（ORDERS のキー）。ここに無い命令は「この兵種にはできない」
 *   canCapture  … 城を自分のものにできるか
 *   noFireAfterMove … true なら、動いた番は撃てない（鉄砲）
 *   noFireWhenAdjacent … true なら、隣に敵がいると撃てない（鉄砲）
 *   chargeBonus … 動いた番の攻撃倍率（騎馬の突撃）
 *   limits      … 画面に出す「できないこと」の説明
 */
window.Units = (() => {
  'use strict';

  const UNIT_TYPES = {
    general: {
      name: '本陣', icon: '🚩', move: 1, attack: 0.25, range: 1,
      noEnter: [], orders: ['advance', 'attack', 'defend'], canCapture: false,
      limits: '占領はできない。倒されると技が使えなくなる',
    },
    ashigaru: {
      name: '足軽', icon: '🗡️', move: 1, attack: 0.25, range: 1,
      noEnter: [], orders: ['advance', 'attack', 'defend', 'capture'], canCapture: true,
      limits: 'なんでもできるが足が遅い',
    },
    cavalry: {
      name: '騎馬', icon: '🐎', move: 2, attack: 0.3, range: 1, chargeBonus: 1.5,
      noEnter: ['mountain', 'forest'], orders: ['advance', 'attack'], canCapture: false,
      limits: '山・森に入れない。守備・占領はできない',
    },
    musket: {
      name: '鉄砲', icon: '🔫', move: 1, attack: 0.45, range: 2,
      noFireAfterMove: true, noFireWhenAdjacent: true,
      noEnter: [], orders: ['advance', 'attack', 'defend', 'capture'], canCapture: true,
      limits: '動いた番は撃てない。隣に敵がいると撃てない',
    },
    archer: {
      name: '弓', icon: '🏹', move: 1, attack: 0.2, range: 2,
      noEnter: [], orders: ['advance', 'attack', 'defend'], canCapture: false,
      limits: '占領はできない',
    },
  };

  /*
   * 命令。needsTarget:
   *   'hex'  … 目的地のマスを選ぶ
   *   'enemy'… 敵部隊を選ぶ（選ばなければ一番近い敵）
   *   null   … 選ぶものなし
   */
  const ORDERS = {
    advance: { name: '進軍', icon: '➡️', desc: '目的地へ向かう。着いたら守備に切り替わる', needsTarget: 'hex' },
    attack: { name: '攻撃', icon: '⚔️', desc: '敵を追いかけて攻撃する', needsTarget: 'enemy' },
    defend: { name: '守備', icon: '🛡️', desc: 'その場で守る（受けるダメージ 2/3）', needsTarget: null },
    capture: { name: '占領', icon: '🏯', desc: '一番近い、自分のでない城を取りに行く', needsTarget: null },
  };
  const ORDER_KEYS = Object.keys(ORDERS);

  // 戦闘の補正
  const COMBAT = {
    counterRate: 0.5,         // 近接攻撃を受けた側の反撃の強さ
    defendGuard: 1.5,         // 守備中は受けるダメージを 1/1.5 に
    luckMin: 0.9,             // ダメージの運の幅
    luckMax: 1.1,
    powderRate: 2,            // 火薬を使った攻撃の倍率
  };

  /** その兵種が命令を使えるか。使えないときは理由の文字列、使えるなら null */
  function orderBlockedReason(typeKey, orderKey) {
    const type = UNIT_TYPES[typeKey];
    if (type.orders.includes(orderKey)) return null;
    return `${type.name}は${ORDERS[orderKey].name}できない`;
  }

  const canEnterTerrain = (typeKey, terrainKey) => !UNIT_TYPES[typeKey].noEnter.includes(terrainKey);

  return { UNIT_TYPES, ORDERS, ORDER_KEYS, COMBAT, orderBlockedReason, canEnterTerrain };
})();
