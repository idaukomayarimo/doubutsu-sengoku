/*
 * 武将の名簿（データのみ）
 *
 * 武将の追加方法：GENERALS に1件足すだけで選択画面に並びます。
 *   army     … 部隊の編成 [兵種キー, 兵数]。先頭は必ず本陣（general）
 *   command  … 采配：1ターンに命令を変えられる部隊の数
 *   skill    … skills.js の SKILLS のキー
 *   sprite   … ▼ イラスト差し替えポイント：PNG パスを入れると emoji の代わりに表示
 * 色（赤/青）は武将ではなく「陣（先手/後手）」で決まります。
 */
window.Generals = (() => {
  'use strict';

  const GENERALS = [
    {
      key: 'nobu', name: 'のぶネコ', emoji: '🐱', model: '織田信長',
      catchphrase: '鉄砲で天下布武', skill: 'sandan', command: 2, sprite: null,
      army: [['general', 50], ['musket', 60], ['musket', 60], ['ashigaru', 45], ['ashigaru', 45]],
    },
    {
      key: 'shin', name: 'しんタイガー', emoji: '🐯', model: '武田信玄',
      catchphrase: '騎馬で駆ける甲斐の虎', skill: 'furin', command: 2, sprite: null,
      army: [['general', 60], ['cavalry', 60], ['cavalry', 60], ['ashigaru', 50], ['archer', 40]],
    },
    {
      key: 'ieyasu', name: 'いえタヌキ', emoji: '🦝', model: '徳川家康',
      catchphrase: '守って粘る大軍勢', skill: 'double', command: 2, sprite: null,
      army: [['general', 70], ['ashigaru', 60], ['ashigaru', 60], ['archer', 50], ['musket', 60]],
    },
    {
      key: 'hide', name: 'ひでザル', emoji: '🐵', model: '豊臣秀吉',
      catchphrase: '数と采配の出世猿', skill: 'fort', command: 3, sprite: null,
      army: [['general', 40], ['ashigaru', 40], ['ashigaru', 40], ['ashigaru', 40], ['cavalry', 40], ['archer', 40]],
    },
  ];

  const byKey = (key) => GENERALS.find((g) => g.key === key);
  const totalTroops = (general) => general.army.reduce((sum, [, n]) => sum + n, 0);

  return { GENERALS, byKey, totalTroops };
})();
