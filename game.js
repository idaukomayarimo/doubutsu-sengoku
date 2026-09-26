/*
 * どうぶつ戦国 陣取り合戦 v2 — 画面の司令塔
 *
 * ファイル構成：
 *   hex.js / terrain.js … ヘクス座標・地形
 *   units.js            … 兵種と命令
 *   generals.js         … 武将の名簿と編成
 *   skills.js           … 武将の技の説明
 *   battle.js           … 合戦のルール（画面なし・テストは tests/）
 *   render.js           … 盤面の描画
 *   panel.js            … 画面下の操作パネル
 *   screens.js/.css     … 武将選択・交代・結果・確認の画面
 *   sound.js            … 効果音と振動
 *   game.js             … それらをつなぐ（このファイル）
 */
(() => {
  'use strict';

  const { sameHex } = Hex;
  const { UNIT_TYPES, ORDERS, ORDER_KEYS } = Units;
  const { SKILLS } = Skills;

  const SEATS = [
    { id: 0, label: '赤の陣', dot: '🔴', color: '#e8453c', light: '#ffb3a8', dark: '#a82a22' },
    { id: 1, label: '青の陣', dot: '🔵', color: '#2f7de1', light: '#a9cdfb', dark: '#1d4f94' },
  ];

  // アニメーションの長さ（ミリ秒）
  const EVENT_MS = {
    move: 170, attack: 380, counter: 320, destroyed: 400, capture: 420,
    enclose: 520, item: 420, heal: 380, order: 150, itemSpawn: 520,
  };
  const POPUP_MS = 950;
  const FLASH_MS = 2200;
  const FAST_SPEED = 4;
  const MOVE_SOUND_GAP_MS = 110;

  const ATTACK_LABEL = (a) => (a >= 0.4 ? 'とても強' : a >= 0.3 ? '強' : a >= 0.25 ? '普通' : '弱');

  // ===== 状態 =====
  let players = [];
  let state = null;
  const ui = {
    selectedId: null,
    targeting: null,        // 'advance' | 'attack' | 'fort'
    flash: null,            // { text, until }
    playing: null,          // 行動アニメの再生状態
    popups: [],
    lastMoveSoundAt: 0,
  };

  const buildPlayers = (keys) => SEATS.map((seat, i) => ({ ...Generals.byKey(keys[i]), ...seat }));
  const viewOf = (s) => ({ terrain: s.terrain, owners: s.owners, units: s.units, items: s.items });
  const seatOfUnitId = (id) => Number(String(id)[0]);

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);
  const canvas = $('board');
  const board = Render.create(canvas, Battle.grid, { seats: SEATS, padding: 6 });
  const hud = [0, 1].map((i) => ({
    panel: $(`p${i + 1}Panel`), face: $(`p${i + 1}Emoji`), name: $(`p${i + 1}Name`),
    troops: $(`p${i + 1}Troops`), bar: $(`p${i + 1}Bar`), score: $(`p${i + 1}Score`),
  }));
  const turnInfo = $('turnInfo');
  const toast = $('toast');
  let toastTimer = 0;

  function showToast(text, seat, ms = 1400) {
    clearTimeout(toastTimer);
    toast.textContent = text;
    toast.className = `show p${seat + 1}`;
    toastTimer = setTimeout(() => { toast.className = ''; }, ms);
  }

  function flash(text) {
    ui.flash = { text, until: performance.now() + FLASH_MS };
    renderPanel();
    setTimeout(renderPanel, FLASH_MS + 50);
  }

  // ===== 上部の表示 =====
  function updateHud() {
    if (!state) return;
    [0, 1].forEach((seat) => {
      const p = players[seat];
      const h = hud[seat];
      const troops = Battle.armyTroops(state, seat);
      h.face.textContent = p.emoji;
      h.name.textContent = p.name;
      h.troops.textContent = troops;
      h.bar.style.width = `${Math.min(100, (troops / Generals.totalTroops(p)) * 100)}%`;
      h.score.textContent = `${Battle.score(state, seat).total}点`;
      h.panel.classList.toggle('active', state.phase !== 'over' && state.current === seat);
    });
    turnInfo.textContent = state.phase === 'deploy' ? '布陣' : state.phase === 'over' ? '終戦' : `${state.turn}/${Battle.CONFIG.maxTurns}`;
  }

  // ===== 操作パネル =====
  const panel = Panel.create($('panel'), { onOrder, onAction });

  function unitCardModel(unit) {
    const type = UNIT_TYPES[unit.type];
    const own = unit.seat === state.current && !ui.playing && state.phase !== 'over';
    const player = players[unit.seat];
    return {
      own,
      icon: unit.type === 'general' ? player.emoji : type.icon,
      name: unit.type === 'general' ? `${player.name}（本陣）` : `${type.name}隊`,
      troops: unit.troops,
      maxTroops: unit.maxTroops,
      stats: `移動${type.move}・射程${type.range}・攻撃${ATTACK_LABEL(type.attack)}${unit.powder ? '・💥火薬あり' : ''}`,
      limits: type.limits,
      currentOrder: unit.order.kind,
      orders: ORDER_KEYS.map((key) => ({
        key, icon: ORDERS[key].icon, name: ORDERS[key].name, desc: ORDERS[key].desc,
        blocked: Battle.orderBlockedReason(state, unit.id, key),
      })),
    };
  }

  const TARGET_HINT = {
    advance: '進軍先のマスをタップ（山と、入れない地形は選べない）',
    attack: '狙う敵部隊をタップ',
    fort: SKILLS.fort.hint,
  };

  function panelModel() {
    const seat = state.current;
    const base = { seat, seatLabel: `${SEATS[seat].dot} ${players[seat].name}` };
    const flashText = ui.flash && ui.flash.until > performance.now() ? ui.flash.text : null;
    if (ui.playing) {
      return {
        ...base, phaseLabel: '行動中', commands: null, unit: null, skill: null, targeting: null,
        hint: flashText ?? '部隊が命令どおりに動いています…',
        main: { label: ui.playing.speed > 1 ? '⏭ 最後までとばす' : '⏩ 早送り', action: 'fastForward' },
      };
    }
    if (state.phase === 'over') {
      return { ...base, phaseLabel: '合戦終了', hint: '', main: { label: '🏆 結果を見る', action: 'showResult' } };
    }
    const selected = ui.selectedId ? Battle.unitById(state, ui.selectedId) : null;
    const skillKey = players[seat].skill;
    const skill = {
      ...SKILLS[skillKey],
      blocked: state.phase === 'deploy' ? '合戦が始まってから使える' : Battle.skillBlockedReason(state),
    };
    const isDeploy = state.phase === 'deploy';
    let hint;
    if (ui.targeting) hint = TARGET_HINT[ui.targeting];
    else if (selected && selected.seat === seat) {
      hint = isDeploy
        ? '明るいマスをタップで移動。命令も決めておこう（布陣中は何度でも変更OK）'
        : `いまの命令：${ORDERS[selected.order.kind].icon}${ORDERS[selected.order.kind].name} — ${ORDERS[selected.order.kind].desc}`;
    } else hint = isDeploy ? '部隊をタップして選ぶ' : '部隊をタップして命令を変える。決めたら「行動開始」';

    const main = ui.targeting
      ? { label: 'やめる', action: 'cancelTarget' }
      : isDeploy ? { label: '布陣完了 ✓', action: 'finishDeploy' } : { label: '⚔️ 行動開始', action: 'endTurn' };
    return {
      ...base,
      phaseLabel: isDeploy ? '布陣' : '命令',
      commands: isDeploy ? null : { left: Battle.commandsLeft(state), limit: Battle.commandLimit(state) },
      unit: selected ? unitCardModel(selected) : null,
      skill,
      targeting: ui.targeting,
      hint: flashText ?? hint,
      main,
      sub: ui.targeting === 'attack' ? { label: '一番近い敵を狙う', action: 'nearestEnemy' } : null,
    };
  }

  function renderPanel() {
    if (state) panel.render(panelModel());
  }

  function refresh() {
    updateHud();
    renderPanel();
  }

  // ===== 盤面の見た目 =====
  function highlightsFor(selected) {
    if (ui.targeting === 'attack') {
      return state.units.filter((u) => u.seat !== state.current).map((u) => ({ hex: u.pos, style: 'enemy' }));
    }
    if (ui.targeting === 'fort') return Battle.fortTargets(state).map((hex) => ({ hex, style: 'target' }));
    if (state.phase === 'deploy' && selected?.seat === state.current && !ui.targeting) {
      return Battle.deployZone(state.current)
        .filter((h) => !Battle.deployBlockedReason(state, selected.id, h) && !sameHex(h, selected.pos))
        .map((hex) => ({ hex, style: 'move' }));
    }
    return [];
  }

  function baseOverlay() {
    const selected = ui.selectedId ? Battle.unitById(state, ui.selectedId) : null;
    const showOrders = !ui.playing && state.phase !== 'over';
    const destination = selected && selected.seat === state.current && showOrders ? Battle.orderDestination(state, selected) : null;
    return {
      selectedId: ui.playing ? null : ui.selectedId,
      highlights: ui.playing ? [] : highlightsFor(selected),
      route: destination && !sameHex(destination, selected.pos) ? { from: selected.pos, to: destination } : null,
      orderIconFor: showOrders ? (u) => (u.seat === state.current ? ORDERS[u.order.kind].icon : null) : null,
      generalEmoji: players.map((p) => p.emoji),
      generalSprite: players.map((p) => p.sprite),
      popups: ui.popups,
    };
  }

  // ===== 行動アニメーション =====
  const easeOut = (t) => 1 - (1 - t) ** 2;

  function addPopup(hex, text, color) {
    ui.popups.push({ hex, text, color, startedAt: performance.now(), duration: POPUP_MS / (ui.playing?.speed ?? 1) });
  }

  function unitIn(view, id) {
    return view.units.find((u) => u.id === id) ?? null;
  }

  /** 出来事が始まった瞬間の音・数字の演出 */
  function onEventStart(ev, prevView) {
    if (ui.playing.speed > FAST_SPEED) return; // 「最後までとばす」中は音も数字も出さない
    const now = performance.now();
    if (ev.type === 'move' && now - ui.lastMoveSoundAt > MOVE_SOUND_GAP_MS) {
      ui.lastMoveSoundAt = now;
      Sound.play('move', { seat: seatOfUnitId(ev.unitId) });
    }
    if (ev.type === 'attack' || ev.type === 'counter') {
      const target = unitIn(prevView, ev.defenderId);
      Sound.play(ev.ranged ? 'shoot' : 'clash');
      if (target) addPopup(target.pos, `-${ev.damage}`, ev.type === 'counter' ? '#7a4a00' : '#b3261e');
    }
    if (ev.type === 'destroyed') Sound.play('destroy');
    if (ev.type === 'capture') { Sound.play('castle'); addPopup(ev.hex, '🏯占領!', '#8a6200'); }
    if (ev.type === 'enclose') { Sound.play('capture'); addPopup(ev.cells[0], `包囲 +${ev.cells.length}`, SEATS[ev.seat].dark); }
    if (ev.type === 'item') {
      Sound.play('item');
      const u = unitIn(ev.snap, ev.unitId) ?? unitIn(prevView, ev.unitId);
      if (u) addPopup(u.pos, `${Battle.ITEMS[ev.kind].icon}${Battle.ITEMS[ev.kind].name}`, '#1d6b3a');
    }
    if (ev.type === 'heal') ev.unitIds.forEach((id) => { const u = unitIn(ev.snap, id); if (u) addPopup(u.pos, `+${ev.amount}`, '#1d7a3a'); });
    if (ev.type === 'itemSpawn') { Sound.play('arm'); showToast(`${Battle.ITEMS[ev.kind].icon} ${Battle.ITEMS[ev.kind].name}が現れた！`, state.current, 1300); }
  }

  /** 再生中の1コマの盤面とオーバーレイ */
  function playbackFrame(now) {
    const p = ui.playing;
    let ev = p.events[p.index];
    while (ev) {
      if (!p.started) {
        p.started = true;
        p.startedAt = now;
        onEventStart(ev, p.view);
      }
      const t = Math.min(1, ((now - p.startedAt) * p.speed) / (EVENT_MS[ev.type] ?? 200));
      if (t < 1) return { view: frameView(p, ev, t), extra: frameExtra(p, ev, t) };
      p.view = { ...p.view, ...ev.snap };
      p.index += 1;
      p.started = false;
      ev = p.events[p.index];
    }
    finishPlayback();
    return null;
  }

  function frameView(p, ev, t) {
    if (ev.type === 'attack' || ev.type === 'counter') return t < 0.6 ? p.view : { ...p.view, ...ev.snap };
    return { ...p.view, ...ev.snap };
  }

  function frameExtra(p, ev, t) {
    if (ev.type === 'move') return { moving: { unitId: ev.unitId, from: ev.from, to: ev.to, t: easeOut(t) } };
    if (ev.type === 'attack' || ev.type === 'counter') {
      const a = unitIn(p.view, ev.attackerId);
      const d = unitIn(p.view, ev.defenderId);
      return a && d ? { shot: { from: a.pos, to: d.pos, t: Math.min(1, t / 0.6), ranged: Boolean(ev.ranged) } } : {};
    }
    if (ev.type === 'destroyed') {
      const gone = unitIn(p.view, ev.unitId);
      return gone ? { fading: [{ unit: gone, t }] } : {};
    }
    return {};
  }

  function startPlayback(before, events, onDone) {
    ui.selectedId = null;
    ui.targeting = null;
    ui.playing = { events, index: 0, started: false, startedAt: 0, view: viewOf(before), speed: 1, onDone };
    refresh();
  }

  function finishPlayback() {
    const done = ui.playing?.onDone;
    ui.playing = null;
    refresh();
    if (done) done();
  }

  // ===== 描画ループ =====
  function loop(now) {
    if (state) {
      ui.popups = ui.popups.filter((p) => now - p.startedAt < p.duration);
      const frame = ui.playing ? playbackFrame(now) : null;
      board.draw(frame ? frame.view : viewOf(state), { ...baseOverlay(), ...(frame ? frame.extra : {}) }, now);
    }
    requestAnimationFrame(loop);
  }

  // ===== 盤面のタップ =====
  function onBoardTap(ev) {
    if (!state || ui.playing || state.phase === 'over' || screens.isAnyOpen()) return;
    const rect = canvas.getBoundingClientRect();
    const hex = board.hexFromPoint(ev.clientX - rect.left, ev.clientY - rect.top);
    if (!hex) return;
    if (ui.targeting) {
      handleTargetTap(hex);
      return;
    }
    const tapped = Battle.unitAt(state, hex);
    const selected = ui.selectedId ? Battle.unitById(state, ui.selectedId) : null;
    if (tapped) {
      ui.selectedId = tapped.id === ui.selectedId ? null : tapped.id;
      Sound.play('tick');
    } else if (state.phase === 'deploy' && selected?.seat === state.current) {
      const reason = Battle.deployBlockedReason(state, selected.id, hex);
      if (reason) flash(reason);
      else { state = Battle.deployMove(state, selected.id, hex); Sound.play('move', { seat: state.current }); }
    } else {
      ui.selectedId = null;
    }
    refresh();
  }

  function handleTargetTap(hex) {
    const unitId = ui.selectedId;
    if (ui.targeting === 'advance') {
      if (!Battle.canEnterHex(state, unitId, hex)) { flash('そのマスには入れない'); return; }
      applyOrder(unitId, { kind: 'advance', target: { hex } });
    } else if (ui.targeting === 'attack') {
      const enemy = Battle.unitAt(state, hex);
      if (!enemy || enemy.seat === state.current) { flash('敵の部隊をタップしてね'); return; }
      applyOrder(unitId, { kind: 'attack', target: { unitId: enemy.id } });
    } else if (ui.targeting === 'fort') {
      if (!Battle.fortTargets(state).some((h) => sameHex(h, hex))) { flash('金色のマスを選んでね'); return; }
      activateSkill(hex);
    }
  }

  function applyOrder(unitId, order) {
    const next = Battle.setOrder(state, unitId, order);
    ui.targeting = null;
    if (next === state) { flash('その命令は出せない'); return; }
    state = next;
    Sound.play('arm');
    refresh();
  }

  // ===== パネルの操作 =====
  function onOrder(orderKey) {
    const unit = Battle.unitById(state, ui.selectedId);
    if (!unit) return;
    const reason = Battle.orderBlockedReason(state, unit.id, orderKey);
    if (reason) { Sound.play('pass'); flash(reason); return; }
    const need = ORDERS[orderKey].needsTarget;
    if (need === 'hex') { ui.targeting = 'advance'; Sound.play('tick'); refresh(); return; }
    if (need === 'enemy') { ui.targeting = 'attack'; Sound.play('tick'); refresh(); return; }
    applyOrder(unit.id, { kind: orderKey, target: null });
  }

  function onAction(action) {
    if (action === 'fastForward') {
      if (!ui.playing) return;
      if (ui.playing.speed > 1) ui.playing.speed = 1000;
      else ui.playing.speed = FAST_SPEED;
      renderPanel();
    } else if (action === 'showResult') openResult();
    else if (action === 'cancelTarget') { ui.targeting = null; Sound.play('tick'); refresh(); }
    else if (action === 'nearestEnemy') applyOrder(ui.selectedId, { kind: 'attack', target: null });
    else if (action === 'skill') onSkill();
    else if (action === 'finishDeploy') finishDeploy();
    else if (action === 'endTurn') endTurn();
  }

  function onSkill() {
    const reason = state.phase === 'deploy' ? '合戦が始まってから使える' : Battle.skillBlockedReason(state);
    if (reason) { Sound.play('pass'); flash(reason); return; }
    const skill = SKILLS[players[state.current].skill];
    if (skill.needsTarget === 'hex') {
      if (Battle.fortTargets(state).length === 0) { flash('城を建てられる平地が近くにない'); return; }
      ui.selectedId = null;
      ui.targeting = 'fort';
      Sound.play('arm');
      refresh();
      return;
    }
    screens.confirm({
      title: `${skill.icon} ${skill.name}を使う？`,
      text: `${skill.desc}（1回だけ）`,
      yesLabel: '使う！',
      onYes: () => activateSkill(null),
    });
  }

  function activateSkill(hex) {
    const skill = SKILLS[players[state.current].skill];
    state = Battle.useSkill(state, hex);
    ui.targeting = null;
    Sound.play('skill');
    showToast(`${skill.icon} ${skill.name}！`, state.current, 1600);
    refresh();
  }

  // ===== 手番の流れ =====
  function finishDeploy() {
    const prev = state.current;
    state = Battle.finishDeploy(state);
    ui.selectedId = null;
    refresh();
    if (state.phase === 'deploy') {
      handoff(state.current, `${SEATS[state.current].label}の布陣`, `${players[prev].name}側の人は見ないでね。部隊を並べて、最初の命令を決めよう。`);
    } else {
      handoff(0, '合戦開始！', 'スマホを赤の陣に渡してください。', [], () => Sound.play('start'));
    }
  }

  function endTurn() {
    const mover = state.current;
    const before = state;
    const result = Battle.endTurn(state);
    state = result.state;
    startPlayback(before, result.events, () => afterTurn(mover, result.events));
  }

  function afterTurn(mover, events) {
    if (state.phase === 'over') {
      Sound.play('win');
      openResult();
      return;
    }
    const seat = state.current;
    handoff(seat, `${SEATS[seat].label}の番（${state.turn}/${Battle.CONFIG.maxTurns}ターン）`,
      'スマホを渡してください。', summarize(mover, events));
  }

  /** 交代画面に出す「さっきの番に起きたこと」 */
  function summarize(mover, events) {
    const enemy = 1 - mover;
    const damageTo = [0, 0];
    const lostUnits = [[], []];
    let captures = 0;
    let enclosed = 0;
    const items = [];
    events.forEach((e) => {
      if (e.type === 'attack' || e.type === 'counter') damageTo[seatOfUnitId(e.defenderId)] += e.damage;
      if (e.type === 'destroyed') lostUnits[e.seat].push(e.unitType === 'general' ? `${players[e.seat].emoji}本陣` : `${UNIT_TYPES[e.unitType].icon}${UNIT_TYPES[e.unitType].name}隊`);
      if (e.type === 'capture') captures += 1;
      if (e.type === 'enclose') enclosed += e.cells.length;
      if (e.type === 'item' && seatOfUnitId(e.unitId) === mover) items.push(`${Battle.ITEMS[e.kind].icon}${Battle.ITEMS[e.kind].name}`);
    });
    const m = players[mover];
    const lines = [`${SEATS[mover].dot} ${m.name}軍の行動`];
    if (damageTo[enemy]) lines.push(`⚔️ 敵に ${damageTo[enemy]} の損害`);
    if (damageTo[mover]) lines.push(`🩸 反撃などで ${damageTo[mover]} の損害`);
    if (lostUnits[enemy].length) lines.push(`💥 撃破：${lostUnits[enemy].join('・')}`);
    if (lostUnits[mover].length) lines.push(`😵 失った部隊：${lostUnits[mover].join('・')}`);
    if (captures) lines.push(`🏯 城を ${captures} つ占領`);
    if (enclosed) lines.push(`🔁 包囲で ${enclosed} マス獲得`);
    if (items.length) lines.push(`🎁 ${items.join('・')} を入手`);
    if (lines.length === 1) lines.push('大きな動きはなし');
    return lines;
  }

  function handoff(seat, title, text, summary = [], onGo = null) {
    screens.showHandoff({
      player: players[seat], title, text, summary,
      onGo: () => { Sound.play('tick'); if (onGo) onGo(); refresh(); },
    });
  }

  function openResult() {
    screens.showResult(players, {
      winner: state.winner,
      reason: state.endReason,
      scores: [Battle.score(state, 0), Battle.score(state, 1)],
    });
  }

  /** 選ばれた武将で新しい合戦を始める（地形も毎回作り直し） */
  function startGame(generalKeys) {
    players = buildPlayers(generalKeys);
    state = Battle.create({ generalKeys, seed: Math.floor(Math.random() * 2 ** 31) });
    ui.selectedId = null;
    ui.targeting = null;
    ui.playing = null;
    ui.popups = [];
    board.resize();
    refresh();
    Sound.play('start');
    handoff(0, `${SEATS[0].label}の布陣`, `${players[1].name}側の人は見ないでね。部隊を並べて、最初の命令を決めよう。`);
  }

  const currentKeys = () => (players.length ? players.map((p) => p.key) : []);

  const screens = Screens.create({
    generals: Generals.GENERALS,
    skills: SKILLS,
    seats: SEATS,
    onStart: startGame,
    onRematch: () => startGame(currentKeys()),
  });

  canvas.addEventListener('pointerdown', onBoardTap);
  $('resetBtn').addEventListener('click', () => {
    const isMidGame = state && state.phase !== 'over' && !(state.phase === 'deploy' && state.current === 0);
    if (!isMidGame) { screens.showSelect(currentKeys()); return; }
    screens.confirm({
      title: 'いまの合戦をやめますか？',
      text: '盤面は消えて、武将選びからやり直しになります。',
      yesLabel: 'やめて武将選びへ',
      onYes: () => screens.showSelect(currentKeys()),
    });
  });
  window.addEventListener('resize', () => board.resize());
  new ResizeObserver(() => board.resize()).observe(canvas);

  board.resize();
  requestAnimationFrame(loop);
  screens.showSelect(['nobu', 'shin']);

  // デバッグ・動作確認用
  window.HexGame = {
    getState: () => state, getUi: () => ui, startGame, board,
    /** 再生中のアニメを最後まで一気に進める（画面が裏にあって描画が止まるときの確認用） */
    flushPlayback: () => {
      if (!ui.playing) return;
      ui.playing.speed = 1e6;
      while (ui.playing) playbackFrame(performance.now() + 1e9);
    },
  };
})();
