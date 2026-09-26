/*
 * 画面遷移：武将選択画面 / 交代画面 / 結果画面 / 確認画面（DOM オーバーレイ）
 *
 * 選択の流れ（1台を交互に持つ前提）：
 *   赤の陣が選ぶ → 決定 → 青の陣が選ぶ（赤が選んだ武将は選べない）→ 出陣！
 */
window.Screens = (() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /** 武将の顔：sprite があれば画像、無ければ絵文字 */
  function faceHtml(general, cls) {
    if (general.sprite) return `<img class="${cls}" src="${general.sprite}" alt="${general.name}">`;
    return `<span class="${cls}" aria-hidden="true">${general.emoji}</span>`;
  }

  /**
   * @param {{ generals: object[], skills: object, seats: object[],
   *           onStart: (keys: string[]) => void, onRematch: () => void }} opts
   */
  function create({ generals, skills, seats, onStart, onRematch }) {
    const el = {
      select: $('selectScreen'),
      step: $('selectStep'),
      grid: $('generalGrid'),
      back: $('selectBack'),
      go: $('selectGo'),
      result: $('resultScreen'),
      resultFace: $('resultFace'),
      resultTitle: $('resultTitle'),
      resultScore: $('resultScore'),
      resultReason: $('resultReason'),
      rematch: $('rematchBtn'),
      reselect: $('reselectBtn'),
      viewBoard: $('viewBoardBtn'),
    };

    // 選択画面の状態（picks[i] = 陣 i が選んだ武将キー）
    let seatIndex = 0;
    let picks = [];

    // 先に選び終えた陣（seatIndex より前）の武将だけが「選択済み」でロックされる
    const takenSeat = (key) => picks.findIndex((k, i) => i < seatIndex && k === key);
    const isTakenByOther = (key) => takenSeat(key) >= 0;

    function renderCards() {
      el.grid.innerHTML = generals.map((g) => {
        const skill = skills[g.skill];
        const takenBy = takenSeat(g.key);
        const isPicked = picks[seatIndex] === g.key;
        return `
          <button type="button" class="general-card${isPicked ? ' picked' : ''}" data-key="${g.key}"
                  ${takenBy >= 0 ? 'disabled' : ''}>
            ${takenBy >= 0 ? `<span class="taken seat${takenBy + 1}">${seats[takenBy].label}</span>` : ''}
            ${faceHtml(g, 'card-face')}
            <span class="card-name">${g.name}</span>
            <span class="card-model">モデル：${g.model}</span>
            <span class="card-catch">${g.catchphrase}</span>
            <span class="card-army">軍勢 <b>${Generals.totalTroops(g)}</b>・采配 <b>${g.command}</b></span>
            <span class="card-units">${armyHtml(g)}</span>
            <span class="card-skill">${skill.icon} ${skill.name}</span>
            <span class="card-desc">${skill.desc}</span>
          </button>`;
      }).join('');
    }

    /** 編成を「🔫60×2」のように同じ兵種・兵数をまとめて表示 */
    function armyHtml(g) {
      const groups = [];
      g.army.forEach(([type, n]) => {
        const last = groups[groups.length - 1];
        if (last && last.type === type && last.n === n) last.count += 1;
        else groups.push({ type, n, count: 1 });
      });
      return groups.map(({ type, n, count }) => {
        const icon = type === 'general' ? g.emoji : Units.UNIT_TYPES[type].icon;
        return `<span class="army-chip" title="${Units.UNIT_TYPES[type].name}">${icon}${n}${count > 1 ? `×${count}` : ''}</span>`;
      }).join('');
    }

    function renderSelect() {
      const seat = seats[seatIndex];
      el.select.dataset.seat = String(seatIndex + 1);
      el.step.textContent = `${seat.label}：武将を選べ！`;
      el.back.hidden = seatIndex === 0;
      el.go.disabled = !picks[seatIndex] || isTakenByOther(picks[seatIndex]);
      el.go.textContent = seatIndex === seats.length - 1 ? '出陣！' : '決定 → 次の陣へ';
      renderCards();
    }

    el.grid.addEventListener('click', (ev) => {
      const card = ev.target.closest('.general-card');
      if (!card || card.disabled) return;
      picks = picks.map((k, i) => (i === seatIndex ? card.dataset.key : k));
      Sound.play('tick');
      renderSelect();
    });

    el.back.addEventListener('click', () => {
      Sound.play('tick');
      seatIndex = Math.max(0, seatIndex - 1);
      renderSelect();
    });

    el.go.addEventListener('click', () => {
      if (seatIndex < seats.length - 1) {
        Sound.play('tick');
        seatIndex += 1;
        // 前回の選択が、いま前の陣に取られた武将なら選び直してもらう
        if (isTakenByOther(picks[seatIndex])) picks = picks.map((k, i) => (i === seatIndex ? null : k));
        renderSelect();
        return;
      }
      el.select.hidden = true;
      onStart([...picks]);
    });

    /** 選択画面を開く。前回の選択を初期値として残す（同じ武将なら決定を押すだけ） */
    function showSelect(previousKeys = []) {
      el.result.hidden = true;
      seatIndex = 0;
      picks = seats.map((_, i) => previousKeys[i] ?? null);
      renderSelect();
      el.select.hidden = false;
    }

    /**
     * @param {object[]} players 陣＋武将
     * @param {{ winner: 0|1|'draw', reason: 'annihilation'|'turns', scores: object[] }} outcome
     */
    function showResult(players, { winner, reason, scores }) {
      const champ = winner === 'draw' ? null : players[winner];
      el.result.dataset.seat = champ ? String(champ.id + 1) : 'draw';
      el.resultFace.innerHTML = champ
        ? faceHtml(champ, 'result-face-img')
        : players.map((p) => faceHtml(p, 'result-face-img small')).join('');
      el.resultTitle.textContent = champ ? `${champ.name}の天下！` : '引き分け！';
      el.resultReason.textContent = reason === 'annihilation'
        ? (champ ? `${players[1 - champ.id].name}の軍勢が全滅` : '両軍とも全滅')
        : '50ターンが終わり、得点で決着';
      const row = (label, pick) => `<tr><th>${label}</th>${scores.map((sc, i) => `<td class="seat${i + 1}">${pick(sc)}</td>`).join('')}</tr>`;
      el.resultScore.innerHTML = `
        <table class="score-table">
          <thead><tr><th></th>${players.map((p, i) => `<th class="seat${i + 1}">${p.emoji} ${p.name}</th>`).join('')}</tr></thead>
          <tbody>
            ${row('領地', (sc) => `${sc.territory}点`)}
            ${row('城', (sc) => `${sc.castles}城 = ${sc.castlePoints}点`)}
            ${row('残った兵', (sc) => `${sc.troops}点`)}
            ${row('合計', (sc) => `<b>${sc.total}点</b>`)}
          </tbody>
        </table>`;
      el.result.hidden = false;
    }

    // ===== 交代画面（1台を渡すとき、相手の画面を見ないように挟む） =====
    const handoffEl = {
      root: $('handoffScreen'), face: $('handoffFace'), title: $('handoffTitle'),
      text: $('handoffText'), summary: $('handoffSummary'), go: $('handoffGo'),
    };
    let onHandoffGo = null;

    /** @param {{ player: object, title: string, text: string, summary?: string[], onGo: () => void }} opts */
    function showHandoff({ player, title, text, summary = [], onGo }) {
      handoffEl.root.dataset.seat = String(player.id + 1);
      handoffEl.face.innerHTML = faceHtml(player, 'result-face-img');
      handoffEl.title.textContent = title;
      handoffEl.text.textContent = text;
      handoffEl.summary.innerHTML = summary.map((line) => `<li>${line}</li>`).join('');
      handoffEl.summary.hidden = summary.length === 0;
      onHandoffGo = onGo;
      handoffEl.root.hidden = false;
      handoffEl.go.focus();
    }
    handoffEl.go.addEventListener('click', () => {
      handoffEl.root.hidden = true;
      const go = onHandoffGo;
      onHandoffGo = null;
      if (go) go();
    });

    el.rematch.addEventListener('click', () => {
      el.result.hidden = true;
      onRematch();
    });
    el.reselect.addEventListener('click', () => showSelect(picks));
    el.viewBoard.addEventListener('click', () => { el.result.hidden = true; });

    // ===== 確認画面 =====
    const confirmEl = {
      root: $('confirmScreen'), title: $('confirmTitle'), text: $('confirmText'),
      yes: $('confirmYes'), no: $('confirmNo'),
    };
    let onConfirmYes = null;

    /** @param {{ title: string, text: string, yesLabel: string, onYes: () => void }} opts */
    function confirm({ title, text, yesLabel, onYes }) {
      confirmEl.title.textContent = title;
      confirmEl.text.textContent = text;
      confirmEl.yes.textContent = yesLabel;
      onConfirmYes = onYes;
      confirmEl.root.hidden = false;
      confirmEl.no.focus();
    }
    const closeConfirm = () => { confirmEl.root.hidden = true; onConfirmYes = null; };

    confirmEl.yes.addEventListener('click', () => {
      const action = onConfirmYes;
      closeConfirm();
      if (action) action();
    });
    confirmEl.no.addEventListener('click', () => {
      Sound.play('tick');
      closeConfirm();
    });

    const isAnyOpen = () => [el.select, el.result, handoffEl.root, confirmEl.root].some((r) => !r.hidden);

    return { showSelect, showResult, showHandoff, confirm, isAnyOpen };
  }

  return { create };
})();
