/*
 * 武将の技（1ゲームに1回）
 *
 * 技の追加方法：create() の返す SKILLS にエントリを足し、generals.js で skill にキーを書くだけ。
 *   targets(state)         … 技モード中にタップできるマス
 *   resolve(state, target) … 行動を返す：
 *        { moveTo: 武将の移動先, paint: 自分の色に塗るマス[],
 *          extraTurn?: true なら続けてもう1手, build?: { hex, terrain } なら地形を書き換える }
 *   preview(state)         … 発動前に「効果範囲」として点線で見せるマス（任意）
 *   desc / hint            … 説明文（通常時 / 技モード中）
 */
window.Skills = (() => {
  'use strict';

  /**
   * @param {object} rules game.js の盤面ヘルパー
   *   { grid, myPos, isEnterable, legalMoves, terrainKeyAt }
   */
  function create(rules) {
    const { grid, myPos, isEnterable, legalMoves, terrainKeyAt } = rules;
    const roarArea = (state) => grid.neighbors(myPos(state)).filter((h) => isEnterable(state, h));

    return {
      jump: {
        name: 'ねこまた大跳躍',
        icon: '🐾',
        desc: '2マス先まで一気に跳べる（山も越える）',
        hint: '金色のマスをタップで跳ぶ！',
        targets: (state) => grid.all.filter((h) => {
          const d = Hex.distance(myPos(state), h);
          return d >= 1 && d <= 2 && isEnterable(state, h);
        }),
        resolve: (state, target) => ({ moveTo: target, paint: [target] }),
        preview: () => [],
      },
      roar: {
        name: '風林火山の咆哮',
        icon: '🔥',
        desc: 'その場で周り6マスを一気に塗る',
        hint: '自分の武将をタップで発動！',
        targets: (state) => [myPos(state)],
        resolve: (state) => ({ moveTo: myPos(state), paint: roarArea(state) }),
        preview: roarArea,
      },
      double: {
        name: '狸の二段構え',
        icon: '🍃',
        desc: 'この番に2回続けて動ける',
        hint: '1歩目のマスをタップ！すぐ2歩目へ',
        targets: legalMoves,
        resolve: (state, target) => ({ moveTo: target, paint: [target], extraTurn: true }),
        preview: () => [],
      },
      fort: {
        name: '墨俣一夜城',
        icon: '🔨',
        desc: '隣の平地に城（3点）を建てて入る',
        hint: '城を建てる平地をタップ！',
        targets: (state) => legalMoves(state).filter((h) => terrainKeyAt(state, h) === 'plain'),
        resolve: (state, target) => ({
          moveTo: target,
          paint: [target],
          build: { hex: target, terrain: 'castle' },
        }),
        preview: () => [],
      },
    };
  }

  return { create };
})();
