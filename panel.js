/*
 * 画面下の操作パネル（DOM）。game.js が作る「モデル」を表示し、押されたら handlers を呼ぶだけ。
 *
 * model = {
 *   seat, seatLabel, phaseLabel,
 *   commands: { left, limit } | null,          // 采配（布陣中は null）
 *   unit: { own, icon, name, troops, maxTroops, stats, limits, currentOrder,
 *           orders: [{ key, icon, name, blocked }] } | null,
 *   hint, targeting: 'advance' | 'attack' | 'fort' | null,
 *   skill: { icon, name, desc, blocked } | null,
 *   main: { label, action } ,                  // 'finishDeploy' | 'endTurn' | 'fastForward' | 'cancelTarget' | 'showResult'
 *   sub: { label, action } | null,             // 'nearestEnemy' など
 * }
 */
window.Panel = (() => {
  'use strict';

  const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function commandPips({ left, limit }) {
    const total = Math.max(limit, left);
    const pips = Array.from({ length: total }, (_, i) => `<i class="pip${i < left ? ' on' : ''}"></i>`).join('');
    return `<span class="pips" aria-label="采配 残り${left}">采配 ${pips}</span>`;
  }

  function unitCard(unit) {
    const orders = unit.own
      ? `<div class="orders">${unit.orders.map((o) => `
          <button type="button" class="order-chip${o.key === unit.currentOrder ? ' current' : ''}${o.blocked ? ' blocked' : ''}"
                  data-order="${o.key}" aria-disabled="${Boolean(o.blocked)}" title="${esc(o.blocked ?? o.desc)}">
            <span class="oi">${o.icon}</span>${esc(o.name)}
          </button>`).join('')}</div>`
      : '<p class="enemy-note">敵の部隊（命令は見えません）</p>';
    return `
      <div class="unit-card">
        <div class="unit-head">
          <span class="unit-icon">${unit.icon}</span>
          <span class="unit-name">${esc(unit.name)}</span>
          <span class="unit-troops">兵 <b>${unit.troops}</b>/${unit.maxTroops}</span>
        </div>
        <p class="unit-stats">${esc(unit.stats)}<br><span class="unit-limits">${esc(unit.limits)}</span></p>
        ${orders}
      </div>`;
  }

  function create(root, handlers) {
    root.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.dataset.order) handlers.onOrder(btn.dataset.order);
      else if (btn.dataset.action) handlers.onAction(btn.dataset.action);
    });

    function render(model) {
      root.dataset.seat = String(model.seat + 1);
      const skill = model.skill
        ? `<button type="button" class="skill-mini${model.skill.blocked ? ' blocked' : ''}" data-action="skill"
                   title="${esc(model.skill.blocked ?? model.skill.desc)}">${model.skill.icon} ${esc(model.skill.name)}</button>`
        : '';
      const sub = model.sub ? `<button type="button" class="sub-action" data-action="${model.sub.action}">${esc(model.sub.label)}</button>` : '';
      root.innerHTML = `
        <div class="panel-top">
          <span class="phase-label">${esc(model.seatLabel)}・${esc(model.phaseLabel)}</span>
          ${model.commands ? commandPips(model.commands) : ''}
          ${skill}
        </div>
        ${model.unit ? unitCard(model.unit) : ''}
        <p class="panel-hint${model.targeting ? ' targeting' : ''}" role="status">${esc(model.hint)}</p>
        <div class="panel-actions">
          ${sub}
          <button type="button" class="main-action" data-action="${model.main.action}">${esc(model.main.label)}</button>
        </div>`;
    }

    return { render };
  }

  return { create };
})();
