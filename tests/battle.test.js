/* global test, expect, Battle, Hex, Terrain, Generals */
(() => {
  'use strict';

  const { grid, CONFIG } = Battle;
  const H = (col, row) => ({ col, row });
  const key = Hex.hexKey;

  /**
   * テスト用の盤面を作る。地形は全部平地（terrain で上書き）、部隊は units の通り。
   * @param {{ units: object[], terrain?: Record<string,string>, owners?: Record<string,number>,
   *           current?: number, generalKeys?: string[], turn?: number, items?: object[] }} opts
   */
  function scenario({ units, terrain = {}, owners = {}, current = 0, generalKeys = ['nobu', 'shin'], turn = 1, items = [] }) {
    const s = Battle._internal.clone(Battle.create({ generalKeys, seed: 42 }));
    s.terrain = Array.from({ length: CONFIG.rows }, () => Array(CONFIG.cols).fill('plain'));
    Object.entries(terrain).forEach(([k, t]) => { const [c, r] = k.split(',').map(Number); s.terrain[r][c] = t; });
    s.owners = Array.from({ length: CONFIG.rows }, () => Array(CONFIG.cols).fill(null));
    Object.entries(owners).forEach(([k, o]) => { const [c, r] = k.split(',').map(Number); s.owners[r][c] = o; });
    s.units = units.map((u, i) => ({
      id: u.id ?? `${u.seat}-t${i}`, seat: u.seat, type: u.type, troops: u.troops,
      maxTroops: u.maxTroops ?? u.troops, pos: { ...u.pos },
      order: u.order ?? { kind: 'attack', target: null }, powder: u.powder ?? false,
    }));
    s.items = items;
    s.phase = 'command';
    s.current = current;
    s.turn = turn;
    return s;
  }
  // 盤面の隅に置く「遠くの敵」。全滅扱いで試合が終わらないようにするため
  const farEnemy = (seat = 1) => ({ id: `far${seat}`, seat, type: 'ashigaru', troops: 50, pos: seat === 1 ? H(0, 0) : H(10, 14), order: { kind: 'defend', target: null } });
  const eventsOf = (events, type) => events.filter((e) => e.type === type);
  const fixed = (v) => () => v;
  /** base から見て、ちょうど distance だけ離れた、盤内の平地マスを1つ */
  const hexAtDistance = (base, distance) => grid.all.find((h) => Hex.distance(base, h) === distance && h.row === base.row);

  // ===== 開始・マップ =====
  test('開始時：各武将の編成どおりに部隊が並び、本陣は本城にいる', () => {
    const s = Battle.create({ generalKeys: ['nobu', 'shin'], seed: 1 });
    expect(s.phase).toBe('deploy');
    expect(Battle.unitsOf(s, 0).length).toBe(5);
    expect(Battle.armyTroops(s, 0)).toBe(260);
    expect(Battle.armyTroops(s, 1)).toBe(270);
    [0, 1].forEach((seat) => {
      const gen = Battle.unitsOf(s, seat).find((u) => u.type === 'general');
      expect(key(gen.pos)).toBe(key(Battle.BASES[seat]));
      const zone = new Set(Battle.deployZone(seat).map(key));
      Battle.unitsOf(s, seat).forEach((u) => expect(zone.has(key(u.pos))).toBeTruthy());
      expect(s.owners[Battle.BASES[seat].row][Battle.BASES[seat].col]).toBe(seat);
    });
  });

  test('ひでザルは6部隊・軍勢240・采配3', () => {
    const s = Battle.create({ generalKeys: ['hide', 'ieyasu'], seed: 3 });
    expect(Battle.unitsOf(s, 0).length).toBe(6);
    expect(Battle.armyTroops(s, 0)).toBe(240);
    expect(Battle.armyTroops(s, 1)).toBe(300);
    expect(Battle.commandLimit({ ...s, phase: 'command' }, 0)).toBe(3);
  });

  test('マップ：60通りの乱数で、城10・点対称・布陣エリアに山と中立の城なし・全マスつながる', () => {
    const zoneKeys = new Set([...Battle.deployZone(0), ...Battle.deployZone(1)].map(key));
    const baseKeys = new Set(Battle.BASES.map(key));
    for (let seed = 1; seed <= 60; seed += 1) {
      const { terrain } = Battle.create({ generalKeys: ['nobu', 'shin'], seed });
      const at = (h) => terrain[h.row][h.col];
      expect(grid.all.filter((h) => at(h) === 'castle').length).toBe(10);
      grid.all.forEach((h) => {
        const m = grid.mirror(h);
        if (m && at(h) !== 'plain') expect(at(m)).toBe(at(h));
        if (zoneKeys.has(key(h)) && !baseKeys.has(key(h))) {
          expect(['castle', 'mountain'].includes(at(h))).toBeFalsy();
        }
      });
      const walk = grid.all.filter((h) => at(h) !== 'mountain');
      const seen = new Set([key(walk[0])]);
      const queue = [walk[0]];
      while (queue.length) {
        grid.neighbors(queue.shift()).filter((n) => at(n) !== 'mountain' && !seen.has(key(n)))
          .forEach((n) => { seen.add(key(n)); queue.push(n); });
      }
      expect(seen.size).toBe(walk.length);
    }
  });

  test('同じ seed なら同じマップ・同じ戦闘結果になる', () => {
    const a = Battle.create({ generalKeys: ['nobu', 'shin'], seed: 7 });
    const b = Battle.create({ generalKeys: ['nobu', 'shin'], seed: 7 });
    expect(JSON.stringify(a.terrain)).toBe(JSON.stringify(b.terrain));
    const sc = () => scenario({ units: [
      { seat: 0, type: 'ashigaru', troops: 100, pos: H(5, 7) },
      { seat: 1, type: 'ashigaru', troops: 100, pos: H(6, 7) }] });
    expect(JSON.stringify(Battle.endTurn(sc()).events.map((e) => e.damage)))
      .toBe(JSON.stringify(Battle.endTurn(sc()).events.map((e) => e.damage)));
  });

  // ===== 布陣 =====
  test('布陣：手前3列の中なら動かせ、外や敵陣には置けない。味方とは入れ替わる', () => {
    let s = Battle.create({ generalKeys: ['nobu', 'shin'], seed: 1 });
    const [u1, u2] = Battle.unitsOf(s, 0).slice(1, 3);
    const freeHex = Battle.deployZone(0).find((h) => !Battle.unitAt(s, h) && s.terrain[h.row][h.col] !== 'mountain');
    expect(Battle.deployBlockedReason(s, u1.id, H(5, 5))).toBe('布陣できるのは手前の3列だけ');
    s = Battle.deployMove(s, u1.id, freeHex);
    expect(key(Battle.unitById(s, u1.id).pos)).toBe(key(freeHex));
    const u2pos = Battle.unitById(s, u2.id).pos;
    s = Battle.deployMove(s, u1.id, u2pos);
    expect(key(Battle.unitById(s, u1.id).pos)).toBe(key(u2pos));
    expect(key(Battle.unitById(s, u2.id).pos)).toBe(key(freeHex));
  });

  test('布陣完了：赤→青→命令フェイズ（赤から）', () => {
    let s = Battle.create({ generalKeys: ['nobu', 'shin'], seed: 1 });
    s = Battle.finishDeploy(s);
    expect(s.current).toBe(1);
    expect(s.phase).toBe('deploy');
    s = Battle.finishDeploy(s);
    expect(s.phase).toBe('command');
    expect(s.current).toBe(0);
  });

  // ===== 命令の制約 =====
  test('兵種ごとの命令の制約：騎馬は守備・占領不可、弓と本陣は占領不可、足軽は全部できる', () => {
    const s = scenario({ units: [
      { id: 'cav', seat: 0, type: 'cavalry', troops: 50, pos: H(3, 7) },
      { id: 'arc', seat: 0, type: 'archer', troops: 50, pos: H(4, 7) },
      { id: 'gen', seat: 0, type: 'general', troops: 50, pos: H(5, 7) },
      { id: 'ash', seat: 0, type: 'ashigaru', troops: 50, pos: H(6, 7) }, farEnemy()] });
    expect(Battle.orderBlockedReason(s, 'cav', 'defend')).toBe('騎馬は守備できない');
    expect(Battle.orderBlockedReason(s, 'cav', 'capture')).toBe('騎馬は占領できない');
    expect(Battle.orderBlockedReason(s, 'arc', 'capture')).toBe('弓は占領できない');
    expect(Battle.orderBlockedReason(s, 'gen', 'capture')).toBe('本陣は占領できない');
    ['advance', 'attack', 'defend', 'capture'].forEach((k) => expect(Battle.orderBlockedReason(s, 'ash', k)).toBe(null));
  });

  test('采配：1ターンに変えられるのは2部隊まで（同じ部隊の出し直しは無料）', () => {
    let s = scenario({ units: [
      { id: 'a', seat: 0, type: 'ashigaru', troops: 50, pos: H(3, 7) },
      { id: 'b', seat: 0, type: 'ashigaru', troops: 50, pos: H(4, 7) },
      { id: 'c', seat: 0, type: 'ashigaru', troops: 50, pos: H(5, 7) }, farEnemy()] });
    s = Battle.setOrder(s, 'a', { kind: 'defend' });
    s = Battle.setOrder(s, 'a', { kind: 'capture' });
    s = Battle.setOrder(s, 'b', { kind: 'defend' });
    expect(Battle.commandsLeft(s)).toBe(0);
    expect(Battle.orderBlockedReason(s, 'c', 'defend')).toBe('采配を使い切った');
    const unchanged = Battle.setOrder(s, 'c', { kind: 'defend' });
    expect(Battle.unitById(unchanged, 'c').order.kind).toBe('attack');
    expect(Battle.unitById(s, 'a').order.kind).toBe('capture');
  });

  test('進軍の目的地は、その兵種が入れるマスだけ（騎馬は森を指定できない）', () => {
    const s = scenario({ terrain: { '5,5': 'forest' }, units: [{ id: 'cav', seat: 0, type: 'cavalry', troops: 50, pos: H(5, 8) }, farEnemy()] });
    const after = Battle.setOrder(s, 'cav', { kind: 'advance', target: { hex: H(5, 5) } });
    expect(Battle.unitById(after, 'cav').order.kind).toBe('attack');
    expect(Battle.canEnterHex(s, 'cav', H(5, 5))).toBeFalsy();
  });

  // ===== 自動行動：移動 =====
  test('進軍：足軽は1マス、騎馬は2マス進み、通ったマスが自分の色になる', () => {
    const dest = H(5, 3);
    let s = scenario({ units: [
      { id: 'ash', seat: 0, type: 'ashigaru', troops: 50, pos: H(3, 10), order: { kind: 'advance', target: { hex: dest } } },
      { id: 'cav', seat: 0, type: 'cavalry', troops: 50, pos: H(7, 10), order: { kind: 'advance', target: { hex: dest } } },
      farEnemy()] });
    const before = { ash: Hex.distance(H(3, 10), dest), cav: Hex.distance(H(7, 10), dest) };
    const { state, events } = Battle.endTurn(s);
    s = state;
    const ash = Battle.unitById(s, 'ash');
    const cav = Battle.unitById(s, 'cav');
    expect(Hex.distance(ash.pos, dest)).toBe(before.ash - 1);
    expect(Hex.distance(cav.pos, dest)).toBe(before.cav - 2);
    expect(s.owners[ash.pos.row][ash.pos.col]).toBe(0);
    expect(eventsOf(events, 'move').length).toBe(3);
  });

  test('進軍：目的地に着いたら自動で守備に切り替わる', () => {
    const dest = H(5, 6);
    const start = grid.neighbors(dest)[0];
    const s = scenario({ units: [
      { id: 'ash', seat: 0, type: 'ashigaru', troops: 50, pos: start, order: { kind: 'advance', target: { hex: dest } } }, farEnemy()] });
    const { state, events } = Battle.endTurn(s);
    expect(key(Battle.unitById(state, 'ash').pos)).toBe(key(dest));
    expect(Battle.unitById(state, 'ash').order.kind).toBe('defend');
    expect(eventsOf(events, 'order').length).toBe(1);
  });

  test('騎馬は森を避けて回り道する（森には入らない）', () => {
    // 5,6 を森にして、5,8 → 5,4 を目指す
    const s = scenario({ terrain: { '5,6': 'forest', '5,7': 'forest' }, units: [
      { id: 'cav', seat: 0, type: 'cavalry', troops: 50, pos: H(5, 8), order: { kind: 'advance', target: { hex: H(5, 4) } } }, farEnemy()] });
    let st = s;
    for (let i = 0; i < 3; i += 1) {
      st = Battle.endTurn(st).state;
      const cav = Battle.unitById(st, 'cav');
      expect(st.terrain[cav.pos.row][cav.pos.col] === 'forest').toBeFalsy();
      st = Battle.endTurn(st).state; // 青の番（何もしない）
    }
    expect(key(Battle.unitById(st, 'cav').pos)).toBe(key(H(5, 4)));
  });

  test('守備できない騎馬は、目的地に着いたらその場で待機する（遠くの敵に突っ込まない）', () => {
    let s = scenario({ units: [
      { id: 'cav', seat: 0, type: 'cavalry', troops: 50, pos: H(5, 7), order: { kind: 'advance', target: { hex: H(5, 6) } } }, farEnemy()] });
    for (let i = 0; i < 3; i += 1) s = Battle.endTurn(Battle.endTurn(s).state).state;
    expect(key(Battle.unitById(s, 'cav').pos)).toBe('5,6');
    expect(Battle.unitById(s, 'cav').order.kind).toBe('advance');
  });

  // ===== 自動行動：戦闘 =====
  test('近接攻撃：兵100の足軽は約25の損害を与え、生き残った相手から反撃を受ける', () => {
    const s = scenario({ units: [
      { id: 'a', seat: 0, type: 'ashigaru', troops: 100, pos: H(5, 7) },
      { id: 'd', seat: 1, type: 'ashigaru', troops: 100, pos: hexAtDistance(H(5, 7), 1) }] });
    const { state, events } = Battle.endTurn(s);
    const [atk] = eventsOf(events, 'attack');
    expect(atk.damage).toBeGreaterThan(21);
    expect(atk.damage).toBeLessThan(29);
    expect(eventsOf(events, 'counter').length).toBe(1);
    expect(Battle.unitById(state, 'd').troops).toBe(100 - atk.damage);
    expect(Battle.unitById(state, 'a').troops).toBeLessThan(100);
  });

  test('弓は2マス先を撃てて、反撃を受けない', () => {
    const s = scenario({ units: [
      { id: 'arc', seat: 0, type: 'archer', troops: 100, pos: H(5, 7), order: { kind: 'defend', target: null } },
      { id: 'd', seat: 1, type: 'ashigaru', troops: 100, pos: hexAtDistance(H(5, 7), 2) }] });
    const { events } = Battle.endTurn(s);
    expect(eventsOf(events, 'attack').length).toBe(1);
    expect(eventsOf(events, 'attack')[0].ranged).toBeTruthy();
    expect(eventsOf(events, 'counter').length).toBe(0);
  });

  test('鉄砲：動いた番は撃てない／止まっていれば撃てる／隣に敵がいると撃てない', () => {
    const enemyPos = H(5, 4);
    const moving = scenario({ units: [
      { id: 'mus', seat: 0, type: 'musket', troops: 100, pos: H(5, 7), order: { kind: 'attack', target: null } },
      { id: 'd', seat: 1, type: 'ashigaru', troops: 100, pos: enemyPos, order: { kind: 'defend', target: null } }] });
    const r1 = Battle.endTurn(moving);
    expect(eventsOf(r1.events, 'move').length).toBe(1);
    expect(eventsOf(r1.events, 'attack').length).toBe(0);

    const inRange = scenario({ units: [
      { id: 'mus', seat: 0, type: 'musket', troops: 100, pos: H(5, 6), order: { kind: 'defend', target: null } },
      { id: 'd', seat: 1, type: 'ashigaru', troops: 100, pos: enemyPos, order: { kind: 'attack', target: null } }] });
    const r2 = Battle.endTurn(inRange);
    expect(eventsOf(r2.events, 'attack').length).toBe(1);

    const adjacent = scenario({ units: [
      { id: 'mus', seat: 0, type: 'musket', troops: 100, pos: H(5, 7), order: { kind: 'defend', target: null } },
      { id: 'd', seat: 1, type: 'ashigaru', troops: 100, pos: hexAtDistance(H(5, 7), 1) }] });
    expect(eventsOf(Battle.endTurn(adjacent).events, 'attack').length).toBe(0);
  });

  test('騎馬の突撃：動いてから攻撃すると 1.5倍（兵100で約45）', () => {
    const s = scenario({ units: [
      { id: 'cav', seat: 0, type: 'cavalry', troops: 100, pos: H(2, 7), order: { kind: 'attack', target: null } },
      { id: 'd', seat: 1, type: 'ashigaru', troops: 200, pos: H(5, 7) }] });
    const { events } = Battle.endTurn(s);
    expect(eventsOf(events, 'move').length).toBe(2);
    const [atk] = eventsOf(events, 'attack');
    expect(atk.damage).toBeGreaterThan(39);
    expect(atk.damage).toBeLessThan(51);
  });

  test('守りの補正：守備中は 2/3、森・城は 1/1.3 のダメージ', () => {
    const base = { seat: 0, type: 'ashigaru', troops: 100, pos: H(5, 7) };
    const s = scenario({ terrain: { '7,7': 'forest' }, units: [
      { ...base, id: 'a' },
      { id: 'open', seat: 1, type: 'ashigaru', troops: 100, pos: H(6, 7), order: { kind: 'attack' } },
      { id: 'def', seat: 1, type: 'ashigaru', troops: 100, pos: H(4, 7), order: { kind: 'defend' } },
      { id: 'wood', seat: 1, type: 'ashigaru', troops: 100, pos: H(7, 7), order: { kind: 'attack' } }] });
    const dmg = (id) => Battle._internal.damageFor(s, Battle.unitById(s, 'a'), Battle.unitById(s, id), { moved: false, isCounter: false }, fixed(0.5));
    expect(dmg('open')).toBe(25);
    expect(dmg('def')).toBe(17);
    expect(dmg('wood')).toBe(19);
  });

  test('全滅させたら即勝利', () => {
    const s = scenario({ units: [
      { id: 'a', seat: 0, type: 'ashigaru', troops: 100, pos: H(5, 7) },
      { id: 'd', seat: 1, type: 'ashigaru', troops: 5, pos: H(6, 7) }] });
    const { state, events } = Battle.endTurn(s);
    expect(eventsOf(events, 'destroyed').length).toBe(1);
    expect(state.phase).toBe('over');
    expect(state.winner).toBe(0);
    expect(state.endReason).toBe('annihilation');
  });

  // ===== 城・占領 =====
  test('占領：足軽は一番近い城へ向かい、乗ったら自分の城にする', () => {
    let s = scenario({ terrain: { '5,5': 'castle' }, units: [
      { id: 'ash', seat: 0, type: 'ashigaru', troops: 50, pos: H(5, 7), order: { kind: 'capture', target: null } }, farEnemy()] });
    let captured = false;
    for (let i = 0; i < 3 && !captured; i += 1) {
      const r = Battle.endTurn(s);
      captured = eventsOf(r.events, 'capture').length > 0;
      s = Battle.endTurn(r.state).state;
    }
    expect(captured).toBeTruthy();
    expect(s.owners[5][5]).toBe(0);
  });

  test('騎馬が城を通っても、城は取れない（色も塗られない）', () => {
    const s = scenario({ terrain: { '5,6': 'castle' }, units: [
      { id: 'cav', seat: 0, type: 'cavalry', troops: 50, pos: H(5, 7), order: { kind: 'advance', target: { hex: H(5, 6) } } }, farEnemy()] });
    const { state } = Battle.endTurn(s);
    expect(key(Battle.unitById(state, 'cav').pos)).toBe('5,6');
    expect(state.owners[6][5]).toBe(null);
  });

  test('自分の城にいる部隊は毎ターン兵 +5', () => {
    const s = scenario({ terrain: { '5,7': 'castle' }, owners: { '5,7': 0 }, units: [
      { id: 'a', seat: 0, type: 'ashigaru', troops: 50, maxTroops: 60, pos: H(5, 7), order: { kind: 'defend' } }, farEnemy()] });
    const { state } = Battle.endTurn(s);
    expect(Battle.unitById(state, 'a').troops).toBe(55);
  });

  // ===== 包囲 =====
  test('包囲：自分の色で囲むと中のマスも取れる', () => {
    const center = H(5, 7);
    const ring = grid.neighbors(center);
    const last = ring[0];
    const owners = {};
    ring.slice(1).forEach((h) => { owners[key(h)] = 0; });
    const start = grid.neighbors(last).find((h) => !Hex.sameHex(h, center) && !ring.some((r) => Hex.sameHex(r, h)));
    const s = scenario({ owners, units: [
      { id: 'a', seat: 0, type: 'ashigaru', troops: 50, pos: start, order: { kind: 'advance', target: { hex: last } } }, farEnemy()] });
    const { state, events } = Battle.endTurn(s);
    expect(state.owners[center.row][center.col]).toBe(0);
    expect(eventsOf(events, 'enclose').length).toBe(1);
  });

  // ===== アイテム =====
  test('兵糧：兵 +30（元の兵数まで）', () => {
    const s = scenario({ items: [{ id: 1, kind: 'rice', pos: H(5, 6) }], units: [
      { id: 'a', seat: 0, type: 'ashigaru', troops: 40, maxTroops: 60, pos: H(5, 7), order: { kind: 'advance', target: { hex: H(5, 6) } } }, farEnemy()] });
    const { state, events } = Battle.endTurn(s);
    expect(Battle.unitById(state, 'a').troops).toBe(60);
    expect(state.items.length).toBe(0);
    expect(eventsOf(events, 'item')[0].kind).toBe('rice');
  });

  test('火薬：次の攻撃だけ2倍になる', () => {
    const s = scenario({ units: [
      { id: 'a', seat: 0, type: 'ashigaru', troops: 100, pos: H(5, 7), powder: true },
      { id: 'd', seat: 1, type: 'ashigaru', troops: 300, pos: H(6, 7) }] });
    const { state, events } = Battle.endTurn(s);
    const [atk] = eventsOf(events, 'attack');
    expect(atk.powder).toBeTruthy();
    expect(atk.damage).toBeGreaterThan(44);
    expect(Battle.unitById(state, 'a').powder).toBeFalsy();
  });

  test('軍配：次の自分の番だけ采配 +2', () => {
    const s = scenario({ items: [{ id: 1, kind: 'fan', pos: H(5, 6) }], units: [
      { id: 'a', seat: 0, type: 'ashigaru', troops: 40, pos: H(5, 7), order: { kind: 'advance', target: { hex: H(5, 6) } } }, farEnemy()] });
    const afterRed = Battle.endTurn(s).state;
    expect(Battle.commandLimit(afterRed, 0)).toBe(4);
    const nextRed = Battle.endTurn(Battle.endTurn(afterRed).state).state;
    expect(Battle.commandLimit(nextRed, 0)).toBe(2);
  });

  test('援軍：自分の城に足軽隊（兵30）が出る', () => {
    const s = scenario({ terrain: { '5,13': 'castle' }, owners: { '5,13': 0 }, items: [{ id: 1, kind: 'reinforce', pos: H(5, 6) }], units: [
      { id: 'a', seat: 0, type: 'ashigaru', troops: 40, pos: H(5, 7), order: { kind: 'advance', target: { hex: H(5, 6) } } }, farEnemy()] });
    const { state } = Battle.endTurn(s);
    const mine = Battle.unitsOf(state, 0);
    expect(mine.length).toBe(2);
    const added = mine.find((u) => u.id !== 'a');
    expect(added.type).toBe('ashigaru');
    expect(added.troops).toBe(30);
    expect(key(added.pos)).toBe('5,13');
  });

  test('5ターンごとにアイテムが点対称に2つ出る', () => {
    const s = scenario({ turn: 4, current: 1, units: [farEnemy(0), farEnemy(1)] });
    const { state, events } = Battle.endTurn(s);
    expect(state.turn).toBe(5);
    expect(state.items.length).toBe(2);
    expect(key(grid.mirror(state.items[0].pos))).toBe(key(state.items[1].pos));
    expect(eventsOf(events, 'itemSpawn').length).toBe(1);
  });

  // ===== 50ターン・得点 =====
  test('50ターン目の青の番が終わると得点で決着（領地1・城5・兵10人で1点）', () => {
    const s = scenario({ turn: 50, current: 1, terrain: { '3,3': 'castle' },
      owners: { '3,3': 0, '1,1': 0, '2,2': 1 },
      units: [farEnemy(0), { ...farEnemy(1), troops: 55 }] });
    const { state } = Battle.endTurn(s);
    expect(state.phase).toBe('over');
    expect(state.endReason).toBe('turns');
    expect(Battle.score(state, 0)).toEqual({ territory: 1, castles: 1, castlePoints: 5, troops: 5, total: 11 });
    expect(state.winner).toBe(0);
  });

  // ===== 技 =====
  test('三段撃ち：鉄砲が動いた番でも撃てる', () => {
    let s = scenario({ generalKeys: ['nobu', 'shin'], units: [
      { id: 'g', seat: 0, type: 'general', troops: 50, pos: H(0, 14), order: { kind: 'defend' } },
      { id: 'mus', seat: 0, type: 'musket', troops: 100, pos: H(5, 7), order: { kind: 'attack', target: null } },
      { id: 'd', seat: 1, type: 'ashigaru', troops: 200, pos: H(5, 4), order: { kind: 'defend' } }] });
    s = Battle.useSkill(s);
    const { state, events } = Battle.endTurn(s);
    expect(eventsOf(events, 'move').length).toBe(1);
    expect(eventsOf(events, 'attack').length).toBe(1);
    expect(state.skillUsed[0]).toBeTruthy();
    expect(Battle.skillBlockedReason({ ...state, current: 0 })).toBe('使用済み（1回まで）');
  });

  test('風林火山：足軽も2マス進める／狸の二段構え：2回行動', () => {
    const run = (generalKeys) => {
      let s = scenario({ generalKeys, units: [
        { id: 'g', seat: 0, type: 'general', troops: 50, pos: H(0, 14), order: { kind: 'defend' } },
        { id: 'a', seat: 0, type: 'ashigaru', troops: 50, pos: H(5, 10), order: { kind: 'advance', target: { hex: H(5, 2) } } },
        farEnemy()] });
      s = Battle.useSkill(s);
      return Hex.distance(Battle.unitById(Battle.endTurn(s).state, 'a').pos, H(5, 10));
    };
    expect(run(['shin', 'nobu'])).toBe(2);
    expect(run(['ieyasu', 'nobu'])).toBe(2);
  });

  test('一夜城：味方の隣の平地に自分の城が建つ', () => {
    const s = scenario({ generalKeys: ['hide', 'nobu'], units: [
      { id: 'g', seat: 0, type: 'general', troops: 40, pos: H(5, 7), order: { kind: 'defend' } }, farEnemy()] });
    const targets = Battle.fortTargets(s);
    expect(targets.length).toBe(6);
    const after = Battle.useSkill(s, targets[0]);
    expect(after.terrain[targets[0].row][targets[0].col]).toBe('castle');
    expect(after.owners[targets[0].row][targets[0].col]).toBe(0);
    expect(Battle.useSkill(s, H(0, 0)) === s).toBeTruthy();
  });

  // ===== 通しのシミュレーション =====
  test('ランダムな命令で20試合を最後まで：ルール違反の状態が一度も起きない', () => {
    const generalKeys = Generals.GENERALS.map((g) => g.key);
    let annihilations = 0;
    for (let game = 0; game < 20; game += 1) {
      let seed = 1000 + game;
      const rand = () => { const [v, next] = Battle._internal.nextRandom(seed); seed = next; return v; };
      const pick = (list) => list[Math.floor(rand() * list.length)];
      let s = Battle.create({ generalKeys: [generalKeys[game % 4], generalKeys[(game + 1) % 4]], seed: game + 1 });
      s = Battle.finishDeploy(Battle.finishDeploy(s));
      let guard = 0;
      while (s.phase !== 'over' && guard < 200) {
        guard += 1;
        Battle.unitsOf(s, s.current).forEach((u) => {
          const kind = pick(Units.UNIT_TYPES[u.type].orders);
          const target = kind === 'advance' ? { hex: pick(grid.all.filter((h) => Battle.canEnterHex(s, u.id, h))) } : null;
          s = Battle.setOrder(s, u.id, { kind, target });
        });
        if (rand() < 0.1 && !Battle.skillBlockedReason(s)) s = Battle.useSkill(s, Battle.fortTargets(s)[0] ?? null);
        s = Battle.endTurn(s).state;

        const seen = new Set();
        s.units.forEach((u) => {
          expect(seen.has(key(u.pos))).toBeFalsy();
          seen.add(key(u.pos));
          expect(u.troops > 0 && u.troops <= u.maxTroops + 30).toBeTruthy();
          expect(Battle.canEnterHex(s, u.id, u.pos)).toBeTruthy();
        });
      }
      expect(s.phase).toBe('over');
      expect([0, 1, 'draw'].includes(s.winner)).toBeTruthy();
      if (s.endReason === 'annihilation') annihilations += 1;
    }
    // 参考：何試合が全滅で決着したか（バランス調整の目安）
    window.__simAnnihilations = annihilations;
  });

  test('本陣が倒されると技は使えない', () => {
    const s = scenario({ units: [{ id: 'a', seat: 0, type: 'ashigaru', troops: 50, pos: H(5, 7) }, farEnemy()] });
    expect(Battle.skillBlockedReason(s)).toBe('本陣が倒されたので使えない');
  });
})();
