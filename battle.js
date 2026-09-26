/*
 * 合戦のルールエンジン（画面を持たない純粋なロジック）
 *
 *   const s0 = Battle.create({ generalKeys: ['nobu', 'shin'], seed: 1 });
 *   const s1 = Battle.setOrder(s0, unitId, { kind: 'advance', target: { hex } });
 *   const { state, events } = Battle.endTurn(s1);   // 自分の全部隊が命令どおり自動で動く
 *
 * - 状態は外から見て不変：どの関数も新しい状態を返す（内部では複製を作ってから書き換える）。
 * - 乱数は state.seed から作るので、同じ入力なら同じ結果になる（テストしやすい）。
 * - endTurn の events には、画面のアニメーション用に各出来事の直後の盤面（snap）が付く。
 */
window.Battle = (() => {
  'use strict';

  const { sameHex, hexKey } = Hex;
  const { TERRAINS } = Terrain;
  const { UNIT_TYPES, COMBAT } = Units;

  const CONFIG = {
    cols: 11,
    rows: 15,
    maxTurns: 50,          // 赤・青それぞれ50回ずつ
    deployRows: 3,         // 布陣できる手前の列数
    castleHeal: 5,         // 自分の城にいる部隊の毎ターン回復
    itemEvery: 5,          // 何ターンごとにアイテムが出るか
    riceAmount: 30,
    reinforcement: { type: 'ashigaru', troops: 30 },
    fanBonus: 2,
    troopsPerPoint: 10,    // 残った兵 10人で1点
  };

  const ITEMS = {
    rice: { name: '兵糧', icon: '🍙', desc: 'その部隊の兵 +30' },
    reinforce: { name: '援軍', icon: '📯', desc: '自分の城に足軽隊（兵30）が出る' },
    powder: { name: '火薬', icon: '💥', desc: 'その部隊の次の攻撃が2倍' },
    fan: { name: '軍配', icon: '📜', desc: '次の番だけ采配 +2' },
  };
  const ITEM_KEYS = Object.keys(ITEMS);

  const grid = Hex.createGrid(CONFIG.cols, CONFIG.rows);
  // 本城：赤は下、青は上（点対称）
  const BASES = [{ col: 5, row: CONFIG.rows - 2 }];
  BASES.push(grid.mirror(BASES[0]));

  const deployZone = (seat) => grid.all.filter((h) => (seat === 0
    ? h.row >= CONFIG.rows - CONFIG.deployRows
    : h.row < CONFIG.deployRows));

  // ===== 乱数（mulberry32）=====
  function nextRandom(seed) {
    const t = (seed + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
  }
  /** s.seed を進めながら 0〜1 の乱数を返す関数（s は作業用の複製） */
  const randomFrom = (s) => () => {
    const [value, seed] = nextRandom(s.seed);
    s.seed = seed;
    return value;
  };

  // ===== 状態の複製・参照 =====
  function clone(state) {
    return {
      ...state,
      terrain: state.terrain.map((row) => [...row]),
      owners: state.owners.map((row) => [...row]),
      units: state.units.map((u) => ({ ...u, pos: { ...u.pos }, order: { ...u.order } })),
      items: state.items.map((it) => ({ ...it, pos: { ...it.pos } })),
      skillUsed: [...state.skillUsed],
      activeSkill: [...state.activeSkill],
      guardBoost: [...state.guardBoost],
      bonusCommand: [...state.bonusCommand],
      bonusNext: [...state.bonusNext],
      changed: [...state.changed],
    };
  }

  const general = (state, seat) => Generals.byKey(state.generalKeys[seat]);
  const unitById = (state, id) => state.units.find((u) => u.id === id) ?? null;
  const unitAt = (state, hex) => state.units.find((u) => sameHex(u.pos, hex)) ?? null;
  const unitsOf = (state, seat) => state.units.filter((u) => u.seat === seat);
  const enemiesOf = (state, seat) => state.units.filter((u) => u.seat !== seat);
  const itemAt = (state, hex) => state.items.find((it) => sameHex(it.pos, hex)) ?? null;
  const terrainKeyAt = (state, h) => state.terrain[h.row][h.col];
  const armyTroops = (state, seat) => unitsOf(state, seat).reduce((sum, u) => sum + u.troops, 0);
  const canEnter = (state, unit, h) => TERRAINS[terrainKeyAt(state, h)].walkable
    && Units.canEnterTerrain(unit.type, terrainKeyAt(state, h));

  const defaultOrder = (type) => ({ kind: UNIT_TYPES[type].orders.includes('defend') ? 'defend' : 'attack', target: null });

  // ===== 開始 =====
  /** 陣の布陣エリアに、本陣を本城に置き、残りを本城に近い順に並べる */
  function autoFormation(state, seat, army) {
    const zone = deployZone(seat);
    const base = BASES[seat];
    const units = [];
    army.forEach(([type, troops], i) => {
      const unit = {
        id: `${seat}-${i}`, seat, type, troops, maxTroops: troops,
        pos: base, order: defaultOrder(type), powder: false,
      };
      const free = zone
        .filter((h) => canEnter(state, unit, h) && !units.some((u) => sameHex(u.pos, h)))
        .sort((a, b) => Hex.distance(a, base) - Hex.distance(b, base));
      units.push({ ...unit, pos: { ...(i === 0 && free.some((h) => sameHex(h, base)) ? base : free[0]) } });
    });
    return units;
  }

  function create({ generalKeys, seed = Date.now() }) {
    const rngState = { seed: seed >>> 0 };
    const terrain = Terrain.generate(grid, { bases: BASES, reserved: [...deployZone(0), ...deployZone(1)] }, randomFrom(rngState));
    const owners = Array.from({ length: CONFIG.rows }, () => Array(CONFIG.cols).fill(null));
    BASES.forEach((b, seat) => { owners[b.row][b.col] = seat; });

    const draft = {
      phase: 'deploy',          // deploy → command → over
      current: 0,
      turn: 1,
      generalKeys,
      terrain,
      owners,
      units: [],
      items: [],
      nextItemId: 1,
      nextUnitId: 1,
      seed: rngState.seed,
      skillUsed: [false, false],
      activeSkill: [null, null],   // この番に発動した技
      guardBoost: [false, false],  // 風林火山の守り（次の自分の番まで）
      bonusCommand: [0, 0],        // この番の采配の上乗せ（軍配）
      bonusNext: [0, 0],
      changed: [],                 // この番に命令を変えた部隊の id
      winner: null,                // 0 / 1 / 'draw'
      endReason: null,             // 'annihilation' | 'turns'
    };
    const units = [0, 1].flatMap((seat) => autoFormation(draft, seat, general(draft, seat).army));
    return { ...draft, units };
  }

  // ===== 布陣 =====
  function deployBlockedReason(state, unitId, hex) {
    const unit = unitById(state, unitId);
    if (state.phase !== 'deploy' || !unit || unit.seat !== state.current) return '今は動かせない';
    if (!deployZone(unit.seat).some((h) => sameHex(h, hex))) return '布陣できるのは手前の3列だけ';
    if (!canEnter(state, unit, hex)) return `${UNIT_TYPES[unit.type].name}はそこに入れない`;
    const other = unitAt(state, hex);
    if (other && other.seat !== unit.seat) return '敵がいる';
    if (other && !canEnter(state, other, unit.pos)) return '入れ替えられない';
    return null;
  }

  /** 布陣中の移動。味方がいれば入れ替える */
  function deployMove(state, unitId, hex) {
    if (deployBlockedReason(state, unitId, hex)) return state;
    const s = clone(state);
    const unit = unitById(s, unitId);
    const other = unitAt(s, hex);
    if (other) other.pos = { ...unit.pos };
    unit.pos = { ...hex };
    return s;
  }

  function finishDeploy(state) {
    if (state.phase !== 'deploy') return state;
    if (state.current === 0) return { ...state, current: 1 };
    return { ...state, phase: 'command', current: 0, turn: 1 };
  }

  // ===== 命令 =====
  const commandLimit = (state, seat = state.current) => general(state, seat).command + state.bonusCommand[seat];
  const commandsLeft = (state) => (state.phase === 'deploy'
    ? Infinity
    : commandLimit(state) - state.changed.length);

  /** 命令を出せない理由（出せるなら null） */
  function orderBlockedReason(state, unitId, orderKey) {
    const unit = unitById(state, unitId);
    if (!unit || unit.seat !== state.current || state.phase === 'over') return '自分の部隊ではない';
    const typeReason = Units.orderBlockedReason(unit.type, orderKey);
    if (typeReason) return typeReason;
    if (state.phase === 'command' && !state.changed.includes(unitId) && commandsLeft(state) <= 0) {
      return '采配を使い切った';
    }
    return null;
  }

  /**
   * @param {{ kind: string, target?: { hex?: object, unitId?: string } | null }} order
   */
  /** 命令の目標が正しいか（進軍先は入れるマス、攻撃目標は敵部隊） */
  function isValidTarget(state, unit, order) {
    const { kind, target } = order;
    if (kind === 'advance') return Boolean(target?.hex) && canEnter(state, unit, target.hex);
    if (kind === 'attack' && target?.unitId) return unitById(state, target.unitId)?.seat === 1 - unit.seat;
    return true;
  }

  function setOrder(state, unitId, order) {
    if (orderBlockedReason(state, unitId, order.kind)) return state;
    if (!isValidTarget(state, unitById(state, unitId), order)) return state;
    const s = clone(state);
    const unit = unitById(s, unitId);
    unit.order = { kind: order.kind, target: order.target ?? null };
    if (s.phase === 'command' && !s.changed.includes(unitId)) s.changed.push(unitId);
    return s;
  }

  // ===== 技 =====
  function skillBlockedReason(state) {
    if (state.phase !== 'command') return '今は使えない';
    if (state.skillUsed[state.current]) return '使用済み（1回まで）';
    if (!unitsOf(state, state.current).some((u) => u.type === 'general')) return '本陣が倒されたので使えない';
    return null;
  }

  /** 一夜城で城を建てられるマス：味方部隊の隣の空いた平地 */
  function fortTargets(state) {
    const seat = state.current;
    const keys = new Set();
    return unitsOf(state, seat)
      .flatMap((u) => grid.neighbors(u.pos))
      .filter((h) => terrainKeyAt(state, h) === 'plain' && !unitAt(state, h) && !itemAt(state, h))
      .filter((h) => (keys.has(hexKey(h)) ? false : keys.add(hexKey(h))));
  }

  function useSkill(state, targetHex = null) {
    if (skillBlockedReason(state)) return state;
    const seat = state.current;
    const key = general(state, seat).skill;
    if (key === 'fort' && !fortTargets(state).some((h) => targetHex && sameHex(h, targetHex))) return state;
    const s = clone(state);
    s.skillUsed[seat] = true;
    s.activeSkill[seat] = key;
    if (key === 'fort') {
      s.terrain[targetHex.row][targetHex.col] = 'castle';
      s.owners[targetHex.row][targetHex.col] = seat;
    }
    return s;
  }

  // ===== 経路探索 =====
  /**
   * start から isGoal を満たすマスまでの最短経路（start を含まない）。見つからなければ null。
   * blockFriends=false なら味方部隊は通り抜けられるものとして探す（実際の移動は空いている所まで）。
   */
  function findPath(state, unit, isGoal, blockFriends) {
    const startKey = hexKey(unit.pos);
    const prev = new Map([[startKey, null]]);
    const queue = [unit.pos];
    while (queue.length > 0) {
      const hex = queue.shift();
      if (!sameHex(hex, unit.pos) && isGoal(hex)) {
        const path = [];
        for (let h = hex; h && hexKey(h) !== startKey; h = prev.get(hexKey(h))) path.unshift(h);
        return path;
      }
      grid.neighbors(hex).forEach((n) => {
        if (prev.has(hexKey(n)) || !canEnter(state, unit, n)) return;
        const occupant = unitAt(state, n);
        if (occupant && (occupant.seat !== unit.seat || blockFriends) && !isGoal(n)) return;
        prev.set(hexKey(n), hex);
        queue.push(n);
      });
    }
    return null;
  }

  const pathTo = (state, unit, isGoal) => findPath(state, unit, isGoal, true) ?? findPath(state, unit, isGoal, false);

  // ===== 戦闘 =====
  const snapOf = (s) => ({
    units: s.units.map((u) => ({ ...u, pos: { ...u.pos } })),
    owners: s.owners.map((row) => [...row]),
    items: s.items.map((it) => ({ ...it })),
  });

  function damageFor(s, attacker, defender, { moved, isCounter }, rand) {
    const type = UNIT_TYPES[attacker.type];
    let power = attacker.troops * type.attack;
    if (moved && type.chargeBonus && !isCounter) power *= type.chargeBonus;
    if (attacker.type === 'musket' && s.activeSkill[attacker.seat] === 'sandan' && !isCounter) power *= 1.5;
    if (attacker.powder && !isCounter) power *= COMBAT.powderRate;
    if (isCounter) power *= COMBAT.counterRate;
    power /= TERRAINS[terrainKeyAt(s, defender.pos)].guard;
    if (defender.order.kind === 'defend') power /= COMBAT.defendGuard;
    if (s.guardBoost[defender.seat]) power /= 1.5;
    power *= COMBAT.luckMin + (COMBAT.luckMax - COMBAT.luckMin) * rand();
    return Math.max(1, Math.round(power));
  }

  function removeIfDead(s, unit, events) {
    if (unit.troops > 0) return false;
    s.units = s.units.filter((u) => u.id !== unit.id);
    events.push({ type: 'destroyed', unitId: unit.id, seat: unit.seat, unitType: unit.type, snap: snapOf(s) });
    return true;
  }

  function attack(s, attacker, defender, moved, events, rand) {
    const distance = Hex.distance(attacker.pos, defender.pos);
    const damage = damageFor(s, attacker, defender, { moved, isCounter: false }, rand);
    const usedPowder = attacker.powder;
    attacker.powder = false;
    defender.troops -= damage;
    events.push({
      type: 'attack', attackerId: attacker.id, defenderId: defender.id, damage,
      ranged: distance > 1, powder: usedPowder, snap: snapOf(s),
    });
    if (removeIfDead(s, defender, events) || distance > 1) return;

    const counter = damageFor(s, defender, attacker, { moved: false, isCounter: true }, rand);
    attacker.troops -= counter;
    events.push({ type: 'counter', attackerId: defender.id, defenderId: attacker.id, damage: counter, snap: snapOf(s) });
    removeIfDead(s, attacker, events);
  }

  /** 攻撃できる敵（射程内・兵種の制約を満たす） */
  function attackableEnemies(s, unit, moved) {
    const type = UNIT_TYPES[unit.type];
    const sandan = unit.type === 'musket' && s.activeSkill[unit.seat] === 'sandan';
    if (type.noFireAfterMove && moved && !sandan) return [];
    const enemies = enemiesOf(s, unit.seat);
    if (type.noFireWhenAdjacent && enemies.some((e) => Hex.distance(e.pos, unit.pos) === 1)) return [];
    return enemies.filter((e) => Hex.distance(e.pos, unit.pos) <= type.range);
  }

  function tryAttack(s, unit, moved, events, rand, preferredId = null) {
    if (!unitById(s, unit.id)) return;
    const targets = attackableEnemies(s, unit, moved);
    if (targets.length === 0) return;
    const target = targets.find((t) => t.id === preferredId)
      ?? [...targets].sort((a, b) => a.troops - b.troops)[0];
    attack(s, unit, target, moved, events, rand);
  }

  // ===== 移動 =====
  function applyItem(s, unit, item, events) {
    s.items = s.items.filter((it) => it.id !== item.id);
    if (item.kind === 'rice') unit.troops = Math.min(unit.maxTroops, unit.troops + CONFIG.riceAmount);
    if (item.kind === 'powder') unit.powder = true;
    if (item.kind === 'fan') s.bonusNext[unit.seat] += CONFIG.fanBonus;
    if (item.kind === 'reinforce') spawnReinforcement(s, unit.seat, unit);
    events.push({ type: 'item', unitId: unit.id, kind: item.kind, snap: snapOf(s) });
  }

  /** 援軍：自分の城（本城優先）の空きマス、無ければ拾った部隊の隣に出す */
  function spawnReinforcement(s, seat, picker) {
    const { type, troops } = CONFIG.reinforcement;
    const probe = { type, seat };
    const ownCastles = grid.all
      .filter((h) => terrainKeyAt(s, h) === 'castle' && s.owners[h.row][h.col] === seat)
      .sort((a, b) => Hex.distance(a, BASES[seat]) - Hex.distance(b, BASES[seat]));
    const spot = [...ownCastles, ...grid.neighbors(picker.pos)]
      .find((h) => !unitAt(s, h) && canEnter(s, probe, h));
    if (!spot) {
      picker.troops = Math.min(picker.maxTroops, picker.troops + troops);
      return;
    }
    s.units.push({
      id: `${seat}-r${s.nextUnitId}`, seat, type, troops, maxTroops: troops,
      pos: { ...spot }, order: defaultOrder(type), powder: false,
    });
    s.nextUnitId += 1;
  }

  /** 1マス進む：塗る・城を取る・アイテムを拾う */
  function step(s, unit, hex, events) {
    const from = unit.pos;
    unit.pos = { ...hex };
    const terrainKey = terrainKeyAt(s, hex);
    const canPaint = terrainKey !== 'castle' || UNIT_TYPES[unit.type].canCapture;
    const wasOwner = s.owners[hex.row][hex.col];
    if (canPaint) s.owners[hex.row][hex.col] = unit.seat;
    events.push({ type: 'move', unitId: unit.id, from, to: { ...hex }, snap: snapOf(s) });
    if (terrainKey === 'castle' && canPaint && wasOwner !== unit.seat) {
      events.push({ type: 'capture', unitId: unit.id, hex: { ...hex }, seat: unit.seat, snap: snapOf(s) });
    }
    const item = itemAt(s, hex);
    if (item) applyItem(s, unit, item, events);
  }

  /** isGoal に向かって最大 budget マス進む。1マスでも進んだら true */
  function moveToward(s, unit, isGoal, budget, events) {
    const path = pathTo(s, unit, isGoal);
    if (!path) return false;
    let moved = false;
    for (const hex of path.slice(0, budget)) {
      if (unitAt(s, hex)) break;
      step(s, unit, hex, events);
      moved = true;
    }
    return moved;
  }

  // ===== 命令ごとの自動行動 =====
  const moveBudget = (s, unit) => UNIT_TYPES[unit.type].move + (s.activeSkill[unit.seat] === 'furin' ? 1 : 0);

  /**
   * 目的地に着いたら守備に切り替える。守備できない兵種（騎馬）は、進軍命令のまま
   * その場で待機する（射程に入った敵には攻撃する）。
   */
  function switchToDefend(unit, events, s) {
    if (!UNIT_TYPES[unit.type].orders.includes('defend') || unit.order.kind === 'defend') return;
    const next = { kind: 'defend', target: null };
    unit.order = next;
    events.push({ type: 'order', unitId: unit.id, kind: next.kind, reason: 'arrived', snap: snapOf(s) });
  }

  function actAdvance(s, unit, events, rand) {
    const dest = unit.order.target?.hex;
    if (!dest || sameHex(unit.pos, dest)) {
      switchToDefend(unit, events, s);
      tryAttack(s, unit, false, events, rand);
      return;
    }
    const moved = moveToward(s, unit, (h) => sameHex(h, dest), moveBudget(s, unit), events);
    if (sameHex(unit.pos, dest)) switchToDefend(unit, events, s);
    tryAttack(s, unit, moved, events, rand);
  }

  function nearestEnemy(s, unit) {
    return [...enemiesOf(s, unit.seat)]
      .sort((a, b) => Hex.distance(unit.pos, a.pos) - Hex.distance(unit.pos, b.pos) || a.troops - b.troops)[0] ?? null;
  }

  function actAttack(s, unit, events, rand) {
    const chosen = unit.order.target?.unitId ? unitById(s, unit.order.target.unitId) : null;
    const target = chosen ?? nearestEnemy(s, unit);
    if (!target) return;
    if (attackableEnemies(s, unit, false).some((e) => e.id === target.id)) {
      attack(s, unit, target, false, events, rand);
      return;
    }
    const range = UNIT_TYPES[unit.type].range;
    const moved = moveToward(s, unit, (h) => Hex.distance(h, target.pos) <= range && !unitAt(s, h), moveBudget(s, unit), events);
    tryAttack(s, unit, moved, events, rand, target.id);
  }

  function actCapture(s, unit, events, rand) {
    const isTargetCastle = (h) => terrainKeyAt(s, h) === 'castle' && s.owners[h.row][h.col] !== unit.seat;
    const moved = moveToward(s, unit, isTargetCastle, moveBudget(s, unit), events);
    if (!moved && !grid.all.some(isTargetCastle)) switchToDefend(unit, events, s);
    tryAttack(s, unit, moved, events, rand);
  }

  function actUnit(s, unitId, events, rand) {
    const unit = unitById(s, unitId);
    if (!unit) return;
    const kind = unit.order.kind;
    if (kind === 'advance') actAdvance(s, unit, events, rand);
    else if (kind === 'attack') actAttack(s, unit, events, rand);
    else if (kind === 'capture') actCapture(s, unit, events, rand);
    else tryAttack(s, unit, false, events, rand);
  }

  // ===== 包囲（v1 と同じ：自分の領地と山で囲んだら中を取る） =====
  function findEnclosedCells(terrain, owners, seat, protectedHexes) {
    const isOpen = (h) => TERRAINS[terrain[h.row][h.col]].walkable && owners[h.row][h.col] !== seat;
    const visited = new Set();
    const captured = [];
    grid.all.filter(isOpen).forEach((start) => {
      if (visited.has(hexKey(start))) return;
      const region = [];
      const queue = [start];
      visited.add(hexKey(start));
      while (queue.length > 0) {
        const hex = queue.shift();
        region.push(hex);
        grid.neighbors(hex)
          .filter((n) => isOpen(n) && !visited.has(hexKey(n)))
          .forEach((n) => { visited.add(hexKey(n)); queue.push(n); });
      }
      const touchesEdge = region.some(grid.isEdge);
      const hasEnemy = region.some((h) => protectedHexes.some((p) => sameHex(p, h)));
      if (!touchesEdge && !hasEnemy) captured.push(...region);
    });
    return captured;
  }

  // ===== アイテム出現 =====
  function spawnItems(s, rand) {
    const reserved = new Set([...deployZone(0), ...deployZone(1)].map(hexKey));
    const isFree = (h) => h && terrainKeyAt(s, h) === 'plain' && !reserved.has(hexKey(h)) && !unitAt(s, h) && !itemAt(s, h);
    const candidates = grid.all.filter((h) => isFree(h) && isFree(grid.mirror(h)) && !sameHex(h, grid.mirror(h)));
    if (candidates.length === 0) return null;
    const hex = candidates[Math.floor(rand() * candidates.length)];
    const kind = ITEM_KEYS[Math.floor(rand() * ITEM_KEYS.length)];
    [hex, grid.mirror(hex)].forEach((pos) => {
      s.items.push({ id: s.nextItemId, kind, pos: { ...pos } });
      s.nextItemId += 1;
    });
    return kind;
  }

  // ===== 得点・勝敗 =====
  function score(state, seat) {
    let territory = 0;
    let castles = 0;
    grid.all.forEach((h) => {
      if (state.owners[h.row][h.col] !== seat) return;
      const t = terrainKeyAt(state, h);
      if (t === 'castle') castles += 1;
      else territory += TERRAINS[t].value;
    });
    const troops = Math.floor(armyTroops(state, seat) / CONFIG.troopsPerPoint);
    const castlePoints = castles * TERRAINS.castle.value;
    return { territory, castles, castlePoints, troops, total: territory + castlePoints + troops };
  }

  function judgeByScore(s) {
    const [a, b] = [score(s, 0).total, score(s, 1).total];
    if (a === b) return 'draw';
    return a > b ? 0 : 1;
  }

  // ===== ターン実行 =====
  function healOnCastles(s, seat, events) {
    const healed = unitsOf(s, seat).filter((u) => terrainKeyAt(s, u.pos) === 'castle'
      && s.owners[u.pos.row][u.pos.col] === seat && u.troops < u.maxTroops);
    healed.forEach((u) => { u.troops = Math.min(u.maxTroops, u.troops + CONFIG.castleHeal); });
    if (healed.length > 0) events.push({ type: 'heal', unitIds: healed.map((u) => u.id), amount: CONFIG.castleHeal, snap: snapOf(s) });
  }

  /**
   * 今の陣の全部隊が命令どおりに動き、手番が相手に移る。
   * @returns {{ state: object, events: object[] }}
   */
  function endTurn(state) {
    if (state.phase !== 'command') return { state, events: [] };
    const s = clone(state);
    const seat = s.current;
    const rand = randomFrom(s);
    const events = [];

    s.guardBoost[seat] = s.activeSkill[seat] === 'furin';
    healOnCastles(s, seat, events);
    const rounds = s.activeSkill[seat] === 'double' ? 2 : 1;
    for (let r = 0; r < rounds; r += 1) {
      // 本陣は最後に動く（前線が先に動いてから）
      const order = unitsOf(s, seat).sort((a, b) => (a.type === 'general') - (b.type === 'general')).map((u) => u.id);
      order.forEach((id) => actUnit(s, id, events, rand));
    }

    const enclosed = findEnclosedCells(s.terrain, s.owners, seat, enemiesOf(s, seat).map((u) => u.pos));
    if (enclosed.length > 0) {
      enclosed.forEach((h) => { s.owners[h.row][h.col] = seat; });
      events.push({ type: 'enclose', seat, cells: enclosed, snap: snapOf(s) });
    }

    s.activeSkill[seat] = null;
    s.changed = [];
    s.bonusCommand[seat] = s.bonusNext[seat];
    s.bonusNext[seat] = 0;

    const loser = [0, 1].find((st) => unitsOf(s, st).length === 0);
    if (loser !== undefined) {
      s.phase = 'over';
      s.winner = unitsOf(s, 1 - loser).length === 0 ? 'draw' : 1 - loser;
      s.endReason = 'annihilation';
      return { state: s, events };
    }

    if (seat === 1) s.turn += 1;
    if (s.turn > CONFIG.maxTurns) {
      s.phase = 'over';
      s.winner = judgeByScore(s);
      s.endReason = 'turns';
      return { state: s, events };
    }
    s.current = 1 - seat;
    if (seat === 1 && s.turn % CONFIG.itemEvery === 0) {
      const kind = spawnItems(s, rand);
      if (kind) events.push({ type: 'itemSpawn', kind, snap: snapOf(s) });
    }
    return { state: s, events };
  }

  // ===== 画面向けの予測（命令の行き先を線で見せる等） =====
  /** 部隊の今の命令で向かう先（無ければ null） */
  function orderDestination(state, unit) {
    const { kind, target } = unit.order;
    if (kind === 'advance') return target?.hex ?? null;
    if (kind === 'attack') return (target?.unitId ? unitById(state, target.unitId) : nearestEnemy(state, unit))?.pos ?? null;
    if (kind === 'capture') {
      const path = pathTo(state, unit, (h) => terrainKeyAt(state, h) === 'castle' && state.owners[h.row][h.col] !== unit.seat);
      return path ? path[path.length - 1] : null;
    }
    return null;
  }

  return {
    CONFIG, ITEMS, BASES, grid,
    create, deployZone, deployBlockedReason, deployMove, finishDeploy,
    commandLimit, commandsLeft, orderBlockedReason, setOrder,
    skillBlockedReason, fortTargets, useSkill,
    endTurn, score, armyTroops, orderDestination,
    unitAt, unitById, unitsOf, itemAt, general,
    canEnterHex: (state, unitId, hex) => canEnter(state, unitById(state, unitId), hex),
    // テスト用
    _internal: { findPath, findEnclosedCells, damageFor, clone, nextRandom },
  };
})();
