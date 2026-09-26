/*
 * ヘクス座標ユーティリティ（ゲームルールに依存しない純粋な幾何計算）
 *
 *   - マップの保存は「odd-r オフセット座標」(col, row)。奇数行が右に半マスずれる、先の尖った(pointy-top)ヘクス。
 *   - 隣接判定・距離計算は「Axial 座標」(q, r) に変換して行う。
 *
 * 使い方：const grid = Hex.createGrid(9, 9); grid.neighbors({ col: 0, row: 4 });
 */
window.Hex = (() => {
  'use strict';

  const AXIAL_DIRS = [
    { q: +1, r: 0 }, { q: +1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: +1 }, { q: 0, r: +1 },
  ];

  const offsetToAxial = ({ col, row }) => ({ q: col - (row - (row & 1)) / 2, r: row });
  const axialToOffset = ({ q, r }) => ({ col: q + (r - (r & 1)) / 2, row: r });
  const sameHex = (a, b) => a.col === b.col && a.row === b.row;
  const hexKey = ({ col, row }) => `${col},${row}`;

  /** 2マス間の距離（歩数） */
  function distance(h1, h2) {
    const a = offsetToAxial(h1);
    const b = offsetToAxial(h2);
    return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
  }

  /** cols × rows の盤面に紐づいた関数群を返す */
  function createGrid(cols, rows) {
    const inBounds = ({ col, row }) => col >= 0 && col < cols && row >= 0 && row < rows;
    const all = Array.from({ length: rows * cols }, (_, i) => ({ col: i % cols, row: Math.floor(i / cols) }));

    /** 盤面内の隣接ヘクス（最大6方向） */
    function neighbors(hex) {
      const a = offsetToAxial(hex);
      return AXIAL_DIRS
        .map((d) => axialToOffset({ q: a.q + d.q, r: a.r + d.r }))
        .filter(inBounds);
    }

    /** マップ外周のマス（隣接マスが6未満）かどうか */
    const isEdge = (hex) => neighbors(hex).length < 6;

    /**
     * 盤面中央を軸にした点対称のマス（盤面外なら null）。
     * odd-r は奇数行が右にずれているため、完全な点対称にならないマスがある点に注意。
     */
    function mirror(hex) {
      const center = offsetToAxial({ col: Math.floor(cols / 2), row: Math.floor(rows / 2) });
      const a = offsetToAxial(hex);
      const m = axialToOffset({ q: 2 * center.q - a.q, r: 2 * center.r - a.r });
      return inBounds(m) ? m : null;
    }

    return { cols, rows, all, inBounds, neighbors, isEdge, mirror };
  }

  return { createGrid, distance, sameHex, hexKey, offsetToAxial, axialToOffset };
})();
