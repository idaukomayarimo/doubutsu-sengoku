/*
 * 武将の名簿（データのみ）
 *
 * 武将の追加方法：GENERALS に1件足すだけで選択画面に並びます。
 *   skill  … skills.js の SKILLS のキー
 *   sprite … ▼ イラスト差し替えポイント：PNG パスを入れると盤面・選択画面で emoji の代わりに表示
 * 色（赤/青）は武将ではなく「陣（先手/後手）」で決まります。
 */
window.Generals = (() => {
  'use strict';

  const GENERALS = [
    {
      key: 'nobu', name: 'のぶネコ', emoji: '🐱', model: '織田信長',
      catchphrase: '天下布武のうつけ猫', skill: 'jump', sprite: null,  // 例) 'img/nobuneko.png'
    },
    {
      key: 'shin', name: 'しんタイガー', emoji: '🐯', model: '武田信玄',
      catchphrase: '甲斐の風林火山虎', skill: 'roar', sprite: null,
    },
    {
      key: 'ieyasu', name: 'いえタヌキ', emoji: '🦝', model: '徳川家康',
      catchphrase: '待ってからの二段構え', skill: 'double', sprite: null,
    },
    {
      key: 'hide', name: 'ひでザル', emoji: '🐵', model: '豊臣秀吉',
      catchphrase: '一夜で城建つ出世猿', skill: 'fort', sprite: null,
    },
  ];

  const byKey = (key) => GENERALS.find((g) => g.key === key);

  return { GENERALS, byKey };
})();
