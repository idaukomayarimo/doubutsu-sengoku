/*
 * 画面遷移：武将選択画面 / 結果画面（DOM オーバーレイ）
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
            <span class="card-skill">${skill.icon} ${skill.name}</span>
            <span class="card-desc">${skill.desc}</span>
          </button>`;
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

    function showResult(players, scores) {
      const [s1, s2] = scores;
      const isDraw = s1 === s2;
      const winner = isDraw ? null : players[s1 > s2 ? 0 : 1];
      el.result.dataset.seat = winner ? String(winner.id + 1) : 'draw';
      el.resultFace.innerHTML = winner
        ? faceHtml(winner, 'result-face-img')
        : players.map((p) => faceHtml(p, 'result-face-img small')).join('');
      el.resultTitle.textContent = winner ? `${winner.name}の天下！` : '引き分け！';
      el.resultScore.innerHTML = players
        .map((p, i) => `<span class="seat${i + 1}">${p.emoji} ${scores[i]}点</span>`)
        .join('<span class="vs">対</span>');
      el.result.hidden = false;
    }

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

    return { showSelect, showResult, confirm };
  }

  return { create };
})();
