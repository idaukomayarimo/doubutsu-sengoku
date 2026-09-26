/*
 * 盤面の描画（Canvas）。ルールは知らず、渡された「見た目の材料」を描くだけ。
 *
 *   const board = Render.create(canvas, grid, { seats, padding });
 *   board.draw(view, overlay, now);
 *     view    … { terrain, owners, units, items }（ルールの状態、またはアニメ途中の盤面）
 *     overlay … 選択中の部隊・ハイライト・経路・攻撃の軌跡・ダメージ表示など
 */
window.Render = (() => {
  'use strict';

  const SQRT3 = Math.sqrt(3);
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const GOLD = '#f5b400';
  const GOLD_LIGHT = '#ffe38a';
  const HIGHLIGHT = {
    move: { fill: '#ffffff99', stroke: '#3b2a1a' },
    zone: { fill: '#ffffff55', stroke: null },
    target: { fill: `${GOLD_LIGHT}cc`, stroke: GOLD },
    enemy: { fill: '#ffb3a8aa', stroke: '#b3261e' },
  };

  function create(canvas, grid, { seats, padding = 8 }) {
    const ctx = canvas.getContext('2d');
    let layout = { size: 10, originX: 0, originY: 0, cssW: 0, cssH: 0 };
    const imageCache = new Map();

    function getImage(src) {
      if (!src) return null;
      if (!imageCache.has(src)) {
        const img = new Image();
        img.onerror = () => console.warn(`画像を読み込めませんでした: ${src}`);
        img.src = src;
        imageCache.set(src, img);
      }
      const img = imageCache.get(src);
      return img.complete && img.naturalWidth > 0 ? img : null;
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const availW = rect.width - padding * 2;
      const availH = rect.height - padding * 2;
      const size = Math.max(4, Math.min(
        availW / (SQRT3 * (grid.cols + 0.5)),
        availH / (1.5 * (grid.rows - 1) + 2),
      ));
      const boardW = SQRT3 * size * (grid.cols + 0.5);
      const boardH = size * (1.5 * (grid.rows - 1) + 2);
      layout = {
        size,
        originX: (rect.width - boardW) / 2 + (SQRT3 * size) / 2,
        originY: (rect.height - boardH) / 2 + size,
        cssW: rect.width,
        cssH: rect.height,
      };
    }

    const center = ({ col, row }) => ({
      x: layout.originX + SQRT3 * layout.size * (col + 0.5 * (row & 1)),
      y: layout.originY + 1.5 * layout.size * row,
    });

    /** 画面座標 → マス（最も近い中心。マスの外なら null） */
    function hexFromPoint(x, y) {
      let best = null;
      let bestDist = Infinity;
      grid.all.forEach((h) => {
        const c = center(h);
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d < bestDist) { bestDist = d; best = h; }
      });
      return bestDist <= layout.size ** 2 ? best : null;
    }

    function hexPath(cx, cy, r) {
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI / 180) * (60 * i - 30);
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }

    const emoji = (text, x, y, px) => {
      ctx.font = `${Math.round(px)}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y);
    };

    // ===== マス =====
    function tileFill(hex, owner, terrain) {
      if (owner !== null && owner !== undefined) return seats[owner].color;
      if (terrain.base) return terrain.base;
      return ((hex.col + hex.row) & 1) ? '#f4e2b8' : '#efd9a8';
    }

    function drawTile(view, hex) {
      const { x, y } = center(hex);
      const s = layout.size;
      const inner = s * 0.94;
      const terrainKey = view.terrain[hex.row][hex.col];
      const terrain = Terrain.TERRAINS[terrainKey];
      const owner = view.owners[hex.row][hex.col];
      const isMountain = !terrain.walkable;

      hexPath(x, y + s * (isMountain ? 0.14 : 0.07), inner);
      ctx.fillStyle = owner !== null ? seats[owner].dark : (isMountain ? '#6f8456' : '#c9b48a');
      ctx.fill();
      hexPath(x, y, inner);
      ctx.fillStyle = tileFill(hex, owner, terrain);
      ctx.fill();

      // 領地になった森・城は、地形の色を少し残して見分けやすくする
      if (owner !== null && terrainKey !== 'plain') {
        hexPath(x, y, inner * 0.62);
        ctx.fillStyle = terrain.base ?? '#fff';
        ctx.fill();
      }
      if (terrainKey === 'castle') {
        hexPath(x, y, inner * 0.9);
        ctx.lineWidth = Math.max(1.5, s * 0.1);
        ctx.strokeStyle = GOLD;
        ctx.stroke();
      }
      const img = getImage(terrain.sprite);
      if (img) ctx.drawImage(img, x - inner * 0.7, y - inner * 0.7, inner * 1.4, inner * 1.4);
      else if (terrain.icon) emoji(terrain.icon, x, y + s * 0.05, s * 0.85);
    }

    function drawHighlight(hex, style, pulse) {
      const { x, y } = center(hex);
      const look = HIGHLIGHT[style];
      hexPath(x, y, layout.size * (0.8 + 0.06 * pulse));
      ctx.fillStyle = look.fill;
      ctx.fill();
      if (look.stroke) {
        ctx.lineWidth = Math.max(1.5, layout.size * 0.1);
        ctx.strokeStyle = look.stroke;
        ctx.stroke();
      }
    }

    // ===== 部隊 =====
    /**
     * @param {object} unit 部隊
     * @param {{ x:number, y:number }} pos 描く位置（アニメ中は補間された座標）
     * @param {{ selected?:boolean, orderIcon?:string|null, alpha?:number, generalEmoji?:string, pulse:number }} o
     */
    function drawUnit(unit, pos, o) {
      const s = layout.size;
      const r = s * 0.74;
      const seat = seats[unit.seat];
      const isGeneral = unit.type === 'general';
      ctx.save();
      ctx.globalAlpha = o.alpha ?? 1;

      if (o.selected) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r * (1.25 + 0.1 * o.pulse), 0, Math.PI * 2);
        ctx.fillStyle = `${GOLD}aa`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(pos.x, pos.y + r * 0.12, r, 0, Math.PI * 2);
      ctx.fillStyle = '#00000040';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = Math.max(2, s * (isGeneral ? 0.2 : 0.14));
      ctx.strokeStyle = isGeneral ? GOLD : seat.color;
      ctx.stroke();
      if (isGeneral) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r - ctx.lineWidth * 0.9, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1, s * 0.07);
        ctx.strokeStyle = seat.color;
        ctx.stroke();
      }

      // ▼ イラスト差し替え：本陣は generals.js の sprite（無ければ武将の絵文字）
      const sprite = isGeneral ? getImage(o.generalSprite) : null;
      if (sprite) ctx.drawImage(sprite, pos.x - r * 0.8, pos.y - r * 0.8, r * 1.6, r * 1.6);
      else emoji(isGeneral ? o.generalEmoji : Units.UNIT_TYPES[unit.type].icon, pos.x, pos.y + r * 0.02, r * 1.05);

      // 兵数バッジ
      const label = String(unit.troops);
      const fontPx = Math.max(8, s * 0.52);
      ctx.font = `800 ${fontPx}px system-ui, sans-serif`;
      const w = Math.max(ctx.measureText(label).width + fontPx * 0.5, fontPx * 1.3);
      const by = pos.y + r * 0.95;
      ctx.beginPath();
      ctx.roundRect(pos.x - w / 2, by - fontPx * 0.6, w, fontPx * 1.2, fontPx * 0.6);
      ctx.fillStyle = seat.dark;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pos.x, by + fontPx * 0.04);

      if (o.orderIcon) emoji(o.orderIcon, pos.x + r * 0.85, pos.y - r * 0.8, s * 0.55);
      if (unit.powder) emoji('💥', pos.x - r * 0.85, pos.y - r * 0.8, s * 0.5);
      ctx.restore();
    }

    // ===== 演出 =====
    function drawRoute(from, to) {
      const a = center(from);
      const b = center(to);
      ctx.save();
      ctx.setLineDash([layout.size * 0.3, layout.size * 0.25]);
      ctx.lineWidth = Math.max(2, layout.size * 0.12);
      ctx.strokeStyle = '#3b2a1acc';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, layout.size * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = '#3b2a1a';
      ctx.fill();
      ctx.restore();
    }

    /** 攻撃の軌跡：近接は短い斬撃線、遠距離は弾が飛ぶ */
    function drawShot(fromHex, toHex, t, ranged) {
      const a = center(fromHex);
      const b = center(toHex);
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      ctx.save();
      if (ranged) {
        ctx.beginPath();
        ctx.arc(x, y, layout.size * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = '#3b2a1a';
        ctx.fill();
      } else {
        emoji('💢', x, y, layout.size * 1.1);
      }
      ctx.restore();
    }

    function drawPopup(p, now) {
      const t = Math.min(1, (now - p.startedAt) / p.duration);
      const { x, y } = center(p.hex);
      ctx.save();
      ctx.globalAlpha = 1 - t * t;
      ctx.font = `900 ${Math.round(layout.size * 0.9)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#fff';
      const py = y - layout.size * (0.6 + t * 1.2);
      ctx.strokeText(p.text, x, py);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, py);
      ctx.restore();
    }

    // ===== まとめて描画 =====
    function draw(view, overlay, now) {
      ctx.clearRect(0, 0, layout.cssW, layout.cssH);
      const pulse = (Math.sin(now / 250) + 1) / 2;

      grid.all.forEach((h) => drawTile(view, h));
      view.items.forEach((it) => {
        const { x, y } = center(it.pos);
        emoji(Battle.ITEMS[it.kind].icon, x, y + layout.size * 0.05, layout.size * (0.9 + 0.1 * pulse));
      });
      (overlay.highlights ?? []).forEach(({ hex, style }) => drawHighlight(hex, style, pulse));
      if (overlay.route) drawRoute(overlay.route.from, overlay.route.to);

      view.units.forEach((u) => {
        const moving = overlay.moving?.unitId === u.id ? overlay.moving : null;
        const pos = moving
          ? (() => { const a = center(moving.from); const b = center(moving.to); return { x: a.x + (b.x - a.x) * moving.t, y: a.y + (b.y - a.y) * moving.t }; })()
          : center(u.pos);
        drawUnit(u, pos, {
          pulse,
          selected: overlay.selectedId === u.id,
          orderIcon: overlay.orderIconFor?.(u) ?? null,
          generalEmoji: overlay.generalEmoji[u.seat],
          generalSprite: overlay.generalSprite?.[u.seat],
        });
      });
      (overlay.fading ?? []).forEach((f) => drawUnit(f.unit, center(f.unit.pos), {
        pulse, alpha: 1 - f.t, generalEmoji: overlay.generalEmoji[f.unit.seat],
      }));
      if (overlay.shot) drawShot(overlay.shot.from, overlay.shot.to, overlay.shot.t, overlay.shot.ranged);
      (overlay.popups ?? []).forEach((p) => drawPopup(p, now));
    }

    return { resize, draw, hexFromPoint, center, get size() { return layout.size; } };
  }

  return { create };
})();
