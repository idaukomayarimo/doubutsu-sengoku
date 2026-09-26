/*
 * 武将の技（1ゲームに1回・本陣が生きている間だけ）— 説明文のデータ
 *
 * 効果そのものは battle.js が技のキーで処理する：
 *   sandan … 鉄砲の「動いた番は撃てない」を解除し、威力 1.5倍（この番のみ）
 *   furin  … 全部隊の移動 +1（この番）、受けるダメージ 2/3（次の自分の番まで）
 *   double … 全部隊がこの番 2回行動
 *   fort   … 味方部隊の隣の空いた平地に城を建てる（needsTarget: 'hex'）
 */
window.Skills = (() => {
  'use strict';

  const SKILLS = {
    sandan: {
      name: '三段撃ち', icon: '🔫',
      desc: 'この番、鉄砲隊が動いても撃てて威力1.5倍',
      needsTarget: null,
    },
    furin: {
      name: '風林火山', icon: '🔥',
      desc: 'この番、全部隊の移動+1。次の番まで守りも固い',
      needsTarget: null,
    },
    double: {
      name: '狸の二段構え', icon: '🍃',
      desc: 'この番、全部隊が2回行動する',
      needsTarget: null,
    },
    fort: {
      name: '墨俣一夜城', icon: '🔨',
      desc: '味方の隣の平地に城を建てる',
      hint: '城を建てる金色のマスをタップ',
      needsTarget: 'hex',
    },
  };

  return { SKILLS };
})();
