/*
 * どうぶつ戦国 陣取り合戦
 *   ステップ1：ヘクスマップ基盤 / 2：包囲 / 3：武将の技 / 4：地形 / 5：武将選択
 *
 * ファイル構成：
 *   hex.js      … ヘクス座標の計算（隣接・距離・点対称）
 *   terrain.js  … 地形の定義とランダムマップ生成
 *   generals.js … 武将の名簿
 *   skills.js   … 武将の技
 *   screens.js  … 武将選択画面・結果画面（見た目は screens.css）
 *   game.js     … ルール・描画・操作（このファイル）
 */
(() => {
  'use strict';

  const { sameHex, hexKey } = Hex;
  const { TERRAINS } = Terrain;

  // ===== 設定 =====
  const COLS = 9;
  const ROWS = 9;
  const MAX_ROUNDS = 20;        // 各プレイヤーの手番数。全て終わったら得点で勝敗判定
  const BOARD_PADDING = 12;     // キャンバス端とマップの余白(px)
  const TOAST_MS = 900;
  const CAPTURE_TOAST_MS = 1300;
  const CAPTURE_POP_MS = 420;     // 包囲マスが弾むアニメーションの長さ
  const CAPTURE_STAGGER_MS = 45;  // マスごとの演出開始のずれ
  const SKILL_COLOR = '#f5b400';        // 技モードのハイライト（金）
  const SKILL_COLOR_LIGHT = '#ffe38a';

  const grid = Hex.createGrid(COLS, ROWS);
  const { neighbors } = grid;

  // 陣（先手=赤 / 後手=青）。色と初期位置は陣で決まり、武将は選択画面で選ぶ
  const SEATS = [
    { id: 0, label: '赤の陣', color: '#e8453c', light: '#ffb3a8', dark: '#a82a22', start: { col: 0, row: 4 } },
    { id: 1, label: '青の陣', color: '#2f7de1', light: '#a9cdfb', dark: '#1d4f94', start: { col: COLS - 1, row: 4 } },
  ];
  /** 陣 + 選ばれた武将（name, emoji, skill, sprite …）を合わせたプレイヤー情報 */
  const buildPlayers = (generalKeys) => SEATS.map((seat, i) => ({ ...Generals.byKey(generalKeys[i]), ...seat }));
  let players = buildPlayers(['nobu', 'shin']);

  // ▼ 領地の塗り用イラストの差し替えポイント（地形ごとの絵は terrain.js の sprite で設定）
  const TILE_SPRITES = {
    neutral: null,   // 例) 'img/tile_grass.png'
    p0: null,        // 例) 'img/tile_red_flag.png'
    p1: null,        // 例) 'img/tile_blue_flag.png'
  };

  // ===== 画像ローダー（未設定・読み込み失敗時は null を返し、フォールバック描画される） =====
  const imageCache = new Map();
  function getImage(src) {
    if (!src) return null;
    if (!imageCache.has(src)) {
      const img = new Image();
      img.onload = () => requestRender();
      img.onerror = () => console.warn(`画像を読み込めませんでした: ${src}`);
      img.src = src;
      imageCache.set(src, img);
    }
    const img = imageCache.get(src);
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  // ===== 盤面の参照ヘルパー =====
  const myPos = (state) => state.positions[state.current];
  const enemyPos = (state) => state.positions[1 - state.current];
  const terrainKeyAt = (state, h) => state.terrain[h.row][h.col];
  const terrainAt = (state, h) => TERRAINS[terrainKeyAt(state, h)];
  const isWalkable = (state, h) => terrainAt(state, h).walkable;
  /** 武将が入れる（山でなく、相手武将もいない）マス */
  const isEnterable = (state, h) => isWalkable(state, h) && !sameHex(h, enemyPos(state));

  function legalMoves(state) {
    if (state.isOver) return [];
    return neighbors(myPos(state)).filter((h) => isEnterable(state, h));
  }

  // ===== 武将の技（中身は skills.js） =====
  const SKILLS = Skills.create({ grid, myPos, isEnterable, legalMoves, terrainKeyAt });
  const skillOf = (playerId) => SKILLS[players[playerId].skill];

  // ===== ゲーム状態（更新は常に新しいオブジェクトを返す） =====
  function createInitialState() {
    const owners = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    SEATS.forEach((s) => { owners[s.start.row][s.start.col] = s.id; });
    return {
      terrain: Terrain.generate(grid, SEATS.map((s) => s.start)),  // terrain[row][col] = TERRAINS のキー
      owners,                                  // owners[row][col] = playerId | null
      positions: SEATS.map((s) => ({ ...s.start })),
      current: 0,
      turn: 1,                                 // 通算手数(1始まり)
      isOver: false,
      skillUsed: SEATS.map(() => false),
      lastCaptured: [],
      lastSkillPaint: [],
      lastCastles: 0,
      lastPassed: false,
      lastExtraTurn: false,
    };
  }

  const canUseSkill = (state) => !state.isOver && !state.skillUsed[state.current];

  /** owners の指定マス群を pid の色に塗った新しい盤面を返す */
  function paintCells(owners, cells, pid) {
    const keys = new Set(cells.map(hexKey));
    return owners.map((row, r) => row.map((o, c) => (keys.has(hexKey({ col: c, row: r })) ? pid : o)));
  }

  /**
   * 包囲判定：pid の領地（と山）で完全に囲まれた「pid 以外のマスのかたまり」を返す。
   *   - 山は通れない「壁」として扱う（山そのものは取れない）
   *   - かたまりがマップ外周に触れていたら包囲ではない（外へ逃げ道がある）
   *   - 相手武将がいるかたまりは取れない（武将は捕まえられない）
   *   - 空白マスだけでなく、中にある相手の領地も奪える
   */
  function findEnclosedCells(terrain, owners, pid, protectedHexes) {
    const isOpen = (h) => TERRAINS[terrain[h.row][h.col]].walkable && owners[h.row][h.col] !== pid;
    const visited = new Set();
    const captured = [];
    grid.all.filter(isOpen).forEach((start) => {
      if (visited.has(hexKey(start))) return;

      // 幅優先探索で「開いている」マスの連結成分を集める
      const region = [];
      const queue = [start];
      visited.add(hexKey(start));
      while (queue.length > 0) {
        const hex = queue.shift();
        region.push(hex);
        neighbors(hex)
          .filter((n) => isOpen(n) && !visited.has(hexKey(n)))
          .forEach((n) => { visited.add(hexKey(n)); queue.push(n); });
      }

      const touchesEdge = region.some(grid.isEdge);
      const hasGeneral = region.some((h) => protectedHexes.some((p) => sameHex(p, h)));
      if (!touchesEdge && !hasGeneral) captured.push(...region);
    });
    return captured;
  }

  const isStuck = (state) => legalMoves(state).length === 0
    && (!canUseSkill(state) || skillOf(state.current).targets(state).length === 0);

  /**
   * 手番を相手に渡す。相手が動けない（技も使えない）なら自動でパスして戻す。
   * 両者とも動けなければその時点で終戦。
   */
  function advanceTurn(state, passes = 0) {
    const turn = state.turn + 1;
    const next = { ...state, current: 1 - state.current, turn, isOver: turn > MAX_ROUNDS * SEATS.length };
    if (next.isOver || !isStuck(next)) return { ...next, lastPassed: passes > 0 };
    if (passes >= 1) return { ...next, isOver: true, lastPassed: true };
    return advanceTurn(next, passes + 1);
  }

  /** build 指定があれば地形を書き換えた新しい地形マップを返す */
  function applyBuild(terrain, build) {
    if (!build) return terrain;
    return terrain.map((row, r) => row.map((t, c) => (sameHex({ col: c, row: r }, build.hex) ? build.terrain : t)));
  }

  /**
   * 1手を実行した新しい状態を返す。通常移動も技もここを通る。
   * @param {{ moveTo: {col:number,row:number}, paint: {col:number,row:number}[],
   *           extraTurn?: boolean, build?: { hex: {col:number,row:number}, terrain: string } }} action
   * @param {boolean} isSkill 技を使った手かどうか
   */
  function applyAction(state, action, isSkill) {
    const pid = state.current;
    const paint = action.paint.filter((h) => isWalkable(state, h));
    const terrain = applyBuild(state.terrain, action.build);
    const painted = paintCells(state.owners, paint, pid);
    const positions = state.positions.map((pos, i) => (i === pid ? { ...action.moveTo } : pos));
    const enemyGenerals = positions.filter((_, i) => i !== pid);
    const captured = findEnclosedCells(terrain, painted, pid, enemyGenerals);
    const gained = [...paint, ...captured].filter((h) => state.owners[h.row][h.col] !== pid);
    const acted = {
      ...state,
      terrain,
      owners: paintCells(painted, captured, pid),
      positions,
      skillUsed: state.skillUsed.map((used, i) => used || (isSkill && i === pid)),
      lastCaptured: captured,                        // 演出用：直前の手で包囲したマス
      lastSkillPaint: isSkill ? paint : [],          // 演出用：技で塗ったマス
      // 元から城だったマスを取った数（一夜城で建てた城は「落とした」に数えない）
      lastCastles: gained.filter((h) => state.terrain[h.row][h.col] === 'castle').length,
      lastPassed: false,
      lastExtraTurn: false,
    };
    // 続けてもう1手（二段構え）。ただし動ける場所が無ければ普通に手番交代
    if (action.extraTurn && legalMoves(acted).length > 0) return { ...acted, lastExtraTurn: true };
    return advanceTurn(acted);
  }

  const applyMove = (state, target) => applyAction(state, { moveTo: target, paint: [target] }, false);
  const applySkill = (state, target) => applyAction(state, skillOf(state.current).resolve(state, target), true);

  /** 各プレイヤーの得点（地形ごとの value の合計。城は1マスで3点） */
  function countScore(state) {
    const scores = SEATS.map(() => 0);
    grid.all.forEach((h) => {
      const o = state.owners[h.row][h.col];
      if (o !== null) scores[o] += terrainAt(state, h).value;
    });
    return scores;
  }

  // ===== レイアウト（画面サイズに合わせてヘクスの大きさを自動計算） =====
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const SQRT3 = Math.sqrt(3);
  let layout = { size: 20, originX: 0, originY: 0, cssW: 0, cssH: 0 };

  function computeLayout() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const availW = rect.width - BOARD_PADDING * 2;
    const availH = rect.height - BOARD_PADDING * 2;
    // pointy-top: 幅 = √3·size·(COLS + 0.5)、高さ = size·(1.5·(ROWS-1) + 2)
    const size = Math.max(4, Math.min(
      availW / (SQRT3 * (COLS + 0.5)),
      availH / (1.5 * (ROWS - 1) + 2),
    ));
    const boardW = SQRT3 * size * (COLS + 0.5);
    const boardH = size * (1.5 * (ROWS - 1) + 2);
    layout = {
      size,
      originX: (rect.width - boardW) / 2 + (SQRT3 * size) / 2,
      originY: (rect.height - boardH) / 2 + size,
      cssW: rect.width,
      cssH: rect.height,
    };
  }

  function hexCenter({ col, row }) {
    const { size, originX, originY } = layout;
    return {
      x: originX + SQRT3 * size * (col + 0.5 * (row & 1)),
      y: originY + 1.5 * size * row,
    };
  }

  /** タップ位置 → ヘクス。最も近い中心を持つヘクスが該当（ヘクス格子のボロノイ性質） */
  function pixelToHex(x, y) {
    let best = null;
    let bestDist = Infinity;
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const c = hexCenter({ col, row });
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d < bestDist) { bestDist = d; best = { col, row }; }
      }
    }
    return bestDist <= layout.size ** 2 ? best : null;
  }

  // ===== 描画 =====
  function hexPath(cx, cy, size) {
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      const px = cx + size * Math.cos(angle);
      const py = cy + size * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  /**
   * @param {null|'move'|'skill'|'preview'} mark
   *   move=通常の移動先 / skill=技の対象マス / preview=技の効果範囲（点線）
   */
  function drawClippedImage(img, x, y, inner) {
    ctx.save();
    hexPath(x, y, inner);
    ctx.clip();
    ctx.drawImage(img, x - inner, y - inner, inner * 2, inner * 2);
    ctx.restore();
  }

  function drawTerrainIcon(terrain, x, y, s) {
    const img = getImage(terrain.sprite);
    if (img) {
      drawClippedImage(img, x, y, s * 0.92);
      return;
    }
    ctx.font = `${Math.round(s * 0.95)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(terrain.icon, x, y + s * 0.06);
  }

  function tileFill(hex, player, terrain) {
    if (player) return player.color;
    if (terrain.base) return terrain.base;
    return ((hex.col + hex.row) & 1) ? '#f4e2b8' : '#efd9a8';
  }

  /**
   * @param {null|'move'|'skill'|'preview'} mark
   *   move=通常の移動先 / skill=技の対象マス / preview=技の効果範囲（点線）
   */
  function drawTile(hex, owner, terrainKey, mark, pulse, popT = 1) {
    const { x, y } = hexCenter(hex);
    const s = layout.size;
    const inner = s * 0.92 * popScale(popT);
    const player = owner === null ? null : players[owner];
    const terrain = TERRAINS[terrainKey];
    const isMountain = !terrain.walkable;

    // 影（ポップな立体感。山は少し高く盛り上げる）
    hexPath(x, y + s * (isMountain ? 0.16 : 0.08), inner);
    ctx.fillStyle = player ? player.dark : (isMountain ? '#6f8456' : '#c9b48a');
    ctx.fill();

    // 本体
    hexPath(x, y, inner);
    ctx.fillStyle = tileFill(hex, player, terrain);
    ctx.fill();

    // ▼ 領地イラストを重ねる（TILE_SPRITES に PNG を設定した場合のみ）
    const tileImg = getImage(TILE_SPRITES[player ? `p${owner}` : 'neutral']);
    if (tileImg && terrain.walkable) drawClippedImage(tileImg, x, y, inner);

    // 城は金の縁取りで「得点が高いマス」だと分かるように
    if (terrainKey === 'castle') {
      hexPath(x, y, inner * 0.9);
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.strokeStyle = SKILL_COLOR;
      ctx.stroke();
    }
    if (terrain.icon || terrain.sprite) drawTerrainIcon(terrain, x, y, inner);

    if (mark === 'move' || mark === 'skill') {
      const me = players[state.current];
      const isSkill = mark === 'skill';
      hexPath(x, y, inner * (0.78 + 0.06 * pulse));
      ctx.fillStyle = isSkill ? `${SKILL_COLOR_LIGHT}dd` : `${me.light}cc`;
      ctx.fill();
      ctx.lineWidth = Math.max(2, s * 0.09);
      ctx.strokeStyle = isSkill ? SKILL_COLOR : me.color;
      ctx.stroke();
    } else if (mark === 'preview') {
      hexPath(x, y, inner * 0.8);
      ctx.setLineDash([s * 0.18, s * 0.12]);
      ctx.lineDashOffset = -pulse * s * 0.6;
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.strokeStyle = SKILL_COLOR;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawGeneral(player, hex, isGlowing, pulse) {
    const { x, y } = hexCenter(hex);
    const r = layout.size * 0.62;

    // 技の発動対象（自分をタップ）のときは金色のオーラ
    if (isGlowing) {
      ctx.beginPath();
      ctx.arc(x, y, r * (1.18 + 0.12 * pulse), 0, Math.PI * 2);
      ctx.fillStyle = `${SKILL_COLOR}99`;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, y + r * 0.12, r, 0, Math.PI * 2);
    ctx.fillStyle = '#00000033';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = Math.max(2, layout.size * 0.1);
    ctx.strokeStyle = player.dark;
    ctx.stroke();

    // ▼ 武将イラスト：generals.js の sprite に PNG を設定すると、絵文字の代わりに描画
    const img = getImage(player.sprite);
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
      ctx.restore();
    } else {
      ctx.font = `${Math.round(r * 1.25)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(player.emoji, x, y + r * 0.08);
    }
  }

  /** 包囲演出：0→1 の進行度から、ぽよんと弾む拡大率を返す（easeOutBack） */
  function popScale(t) {
    if (t >= 1) return 1;
    const c = 1.9;
    const u = t - 1;
    return 0.4 + 0.6 * (1 + (c + 1) * u ** 3 + c * u ** 2);
  }

  // 包囲されたマスの演出タイミング（マスごとに少しずつずらして波のように）
  let captureAnim = { keys: new Map(), startedAt: 0 };
  function startCaptureAnim(cells) {
    const keys = new Map(cells.map((h, i) => [hexKey(h), i * CAPTURE_STAGGER_MS]));
    captureAnim = { keys, startedAt: performance.now() };
  }
  function capturePopT(hex, now) {
    const delay = captureAnim.keys.get(hexKey(hex));
    if (delay === undefined) return 1;
    return Math.max(0, Math.min(1, (now - captureAnim.startedAt - delay) / CAPTURE_POP_MS));
  }

  function render(now) {
    ctx.clearRect(0, 0, layout.cssW, layout.cssH);
    const pulse = (Math.sin(now / 250) + 1) / 2;
    const targets = currentTargets();
    const previews = isSkillMode ? skillOf(state.current).preview(state) : [];
    const has = (list, h) => list.some((m) => sameHex(m, h));
    const markOf = (h) => {
      if (has(targets, h)) return isSkillMode ? 'skill' : 'move';
      return has(previews, h) ? 'preview' : null;
    };

    grid.all.forEach((hex) => {
      drawTile(hex, state.owners[hex.row][hex.col], state.terrain[hex.row][hex.col], markOf(hex), pulse, capturePopT(hex, now));
    });
    players.forEach((p, i) => {
      const pos = state.positions[i];
      drawGeneral(p, pos, isSkillMode && i === state.current && has(targets, pos), pulse);
    });
  }

  // 移動可能マスの点滅のため常時ループ（盤面が小さいので負荷は軽い）
  let rafId = 0;
  function loop(now) {
    render(now);
    rafId = requestAnimationFrame(loop);
  }
  function requestRender() {
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  // ===== UI =====
  const el = {
    p1Panel: document.getElementById('p1Panel'),
    p2Panel: document.getElementById('p2Panel'),
    p1Score: document.getElementById('p1Score'),
    p2Score: document.getElementById('p2Score'),
    turnInfo: document.getElementById('turnInfo'),
    toast: document.getElementById('toast'),
    reset: document.getElementById('resetBtn'),
    skill: document.getElementById('skillBtn'),
    skillName: document.getElementById('skillName'),
    skillDesc: document.getElementById('skillDesc'),
    skillBadges: [document.getElementById('p1Skill'), document.getElementById('p2Skill')],
    faces: [document.getElementById('p1Emoji'), document.getElementById('p2Emoji')],
    names: [document.getElementById('p1Name'), document.getElementById('p2Name')],
  };
  const RESULT_DELAY_MS = 1100;   // 最後の一手を見せてから結果画面を出すまでの間
  const FOLLOWUP_SOUND_MS = 220;  // 移動音のあと、包囲・城などの音を鳴らすまでの間
  const SKILL_SOUND_MS = 350;     // 技の太鼓が鳴り終わるのを待つ分
  let isSkillMode = false;   // UI 状態：技ボタンを押して対象マスを選んでいる最中か

  function currentTargets() {
    if (state.isOver) return [];
    return isSkillMode ? skillOf(state.current).targets(state) : legalMoves(state);
  }
  let toastTimer = 0;

  /** durationMs に null を渡すとタップされるまで表示し続ける */
  function showToast(text, cls, durationMs = TOAST_MS) {
    clearTimeout(toastTimer);
    el.toast.textContent = text;
    el.toast.className = `show ${cls}`;
    if (durationMs !== null) toastTimer = setTimeout(() => { el.toast.className = ''; }, durationMs);
  }

  function updateHud() {
    const [s1, s2] = countScore(state);
    el.p1Score.textContent = s1;
    el.p2Score.textContent = s2;
    el.p1Panel.classList.toggle('active', !state.isOver && state.current === 0);
    el.p2Panel.classList.toggle('active', !state.isOver && state.current === 1);
    const round = Math.ceil(state.turn / SEATS.length);
    el.turnInfo.textContent = state.isOver ? '終戦' : `${Math.min(round, MAX_ROUNDS)} / ${MAX_ROUNDS}\n手目`;
    updateSkillUi();
  }

  function updatePlayerPanels() {
    players.forEach((p, i) => {
      el.faces[i].textContent = p.emoji;
      el.names[i].textContent = p.name;
    });
  }

  function updateSkillUi() {
    players.forEach((p, i) => {
      const badge = el.skillBadges[i];
      badge.textContent = skillOf(i).icon;
      badge.classList.toggle('used', state.skillUsed[i]);
      badge.title = state.skillUsed[i] ? '技：使用済み' : `技：${skillOf(i).name}`;
    });

    const skill = skillOf(state.current);
    const isAvailable = canUseSkill(state);
    el.skill.disabled = !isAvailable && !state.isOver;
    el.skill.dataset.player = state.isOver ? 'end' : String(state.current + 1);
    el.skill.classList.toggle('armed', isSkillMode);
    if (state.isOver) {
      el.skillName.textContent = '🏆 結果を見る';
      el.skillDesc.textContent = '合戦終了';
    } else if (isSkillMode) {
      el.skillName.textContent = 'やめる';
      el.skillDesc.textContent = skill.hint;
    } else {
      el.skillName.textContent = `${skill.icon} ${skill.name}`;
      el.skillDesc.textContent = isAvailable ? skill.desc : '使用済み（1回まで）';
    }
  }

  function announceTurn() {
    const p = players[state.current];
    showToast(`${p.emoji} ${p.name}の番！`, `p${state.current + 1}`);
  }

  /** 技・包囲・城取り・パスがあった手の実況。何もなければ通常の手番表示 */
  function announceAction(moverId, isSkill) {
    const lines = [];
    const p = players[moverId];
    if (isSkill) lines.push(`${skillOf(moverId).icon} ${skillOf(moverId).name}！`);
    if (state.lastCaptured.length > 0) lines.push(`${p.emoji} 包囲！ +${state.lastCaptured.length}マス`);
    if (state.lastCastles > 0) lines.push(`🏯 城を${state.lastCastles > 1 ? `${state.lastCastles}つ` : ''}落とした！`);
    if (state.lastPassed) lines.push(`${players[1 - moverId].emoji} 動けない…パス！`);
    if (lines.length === 0) {
      announceTurn();
      return;
    }
    const next = players[state.current];
    const isSamePlayer = state.lastPassed || state.lastExtraTurn;
    lines.push(state.lastExtraTurn ? 'もう1歩どうぞ！' : `${isSamePlayer ? '続けて' : '次は'} ${next.emoji} ${next.name}`);
    const extraMs = (lines.length - 2) * 400;
    showToast(lines.join('\n'), `p${moverId + 1} capture`, CAPTURE_TOAST_MS + Math.max(0, extraMs));
  }

  let resultTimer = 0;
  function announceResult() {
    showToast('🏯 合戦終了！', 'end', RESULT_DELAY_MS);
    clearTimeout(resultTimer);
    resultTimer = setTimeout(() => {
      Sound.play('win');
      openResult();
    }, RESULT_DELAY_MS);
  }
  const openResult = () => screens.showResult(players, countScore(state));

  /** 1手の効果音：まず移動/技の音、続けて包囲・城・パスの音を少しずつずらして鳴らす */
  function playActionSounds(moverId, isSkill) {
    Sound.play(isSkill ? 'skill' : 'move', { seat: moverId });
    const followUps = [
      state.lastCaptured.length > 0 && 'capture',
      state.lastCastles > 0 && 'castle',
      state.lastPassed && 'pass',
    ].filter(Boolean);
    const offset = isSkill ? SKILL_SOUND_MS : 0;
    followUps.forEach((name, i) => setTimeout(() => Sound.play(name), offset + FOLLOWUP_SOUND_MS * (i + 1)));
  }

  let state = createInitialState();

  function onTap(ev) {
    if (state.isOver) return;
    const rect = canvas.getBoundingClientRect();
    const hex = pixelToHex(ev.clientX - rect.left, ev.clientY - rect.top);
    if (!hex) return;
    if (!currentTargets().some((m) => sameHex(m, hex))) return;

    const mover = state.current;
    const isSkill = isSkillMode;
    state = isSkill ? applySkill(state, hex) : applyMove(state, hex);
    isSkillMode = false;
    updateHud();
    const popped = [...state.lastSkillPaint, ...state.lastCaptured];
    if (popped.length > 0) startCaptureAnim(popped);
    playActionSounds(mover, isSkill);

    if (state.isOver) announceResult();
    else announceAction(mover, isSkill);
  }

  function onSkillButton() {
    if (state.isOver) {
      openResult();
      return;
    }
    if (!canUseSkill(state)) return;
    isSkillMode = !isSkillMode;
    Sound.play(isSkillMode ? 'arm' : 'tick');
    updateSkillUi();
  }

  /** 選ばれた武将で新しい合戦を始める（地形も毎回作り直し） */
  function startGame(generalKeys) {
    clearTimeout(resultTimer);
    players = buildPlayers(generalKeys);
    state = createInitialState();
    isSkillMode = false;
    captureAnim = { keys: new Map(), startedAt: 0 };
    updatePlayerPanels();
    updateHud();
    announceTurn();
    Sound.play('start');
  }

  const currentKeys = () => players.map((p) => p.key);

  const screens = Screens.create({
    generals: Generals.GENERALS,
    skills: SKILLS,
    seats: SEATS,
    onStart: startGame,
    onRematch: () => startGame(currentKeys()),
  });

  canvas.addEventListener('pointerdown', onTap);
  el.skill.addEventListener('click', onSkillButton);
  el.reset.addEventListener('click', () => {
    const isMidGame = state.turn > 1 && !state.isOver;
    if (!isMidGame) {
      screens.showSelect(currentKeys());
      return;
    }
    screens.confirm({
      title: 'いまの合戦をやめますか？',
      text: '盤面は消えて、武将選びからやり直しになります。',
      yesLabel: 'やめて武将選びへ',
      onYes: () => screens.showSelect(currentKeys()),
    });
  });
  window.addEventListener('resize', computeLayout);
  new ResizeObserver(computeLayout).observe(canvas);

  computeLayout();
  updatePlayerPanels();
  updateHud();
  requestRender();
  screens.showSelect(currentKeys());

  // デバッグ・拡張用に一部を公開
  window.HexGame = {
    grid, SKILLS, getState: () => state, startGame,
    rules: { findEnclosedCells, legalMoves, applyMove, applySkill, advanceTurn, countScore },
  };
})();
