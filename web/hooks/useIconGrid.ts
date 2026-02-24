import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

const STORAGE_KEY = 'desktop-icon-positions';

export interface GridPos {
  col: number;
  row: number;
}

export interface IconGridConfig {
  cellW: number;
  cellH: number;
  paddingTop: number;
  paddingLeft: number;
  paddingRight: number;
  paddingBottom: number;
}

const DEFAULT_CONFIG: IconGridConfig = {
  cellW: 90,
  cellH: 105,
  paddingTop: 50,
  paddingLeft: 12,
  paddingRight: 12,
  paddingBottom: 100,
};

function loadPositions(): Record<string, GridPos> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function savePositions(positions: Record<string, GridPos>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch { /* ignore */ }
}

function computeGridDimensions(config: IconGridConfig) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const usableW = vw - config.paddingLeft - config.paddingRight;
  const usableH = vh - config.paddingTop - config.paddingBottom;
  const cols = Math.max(1, Math.floor(usableW / config.cellW));
  const rows = Math.max(1, Math.floor(usableH / config.cellH));
  return { cols, rows };
}

function autoLayout(appIds: string[], config: IconGridConfig): Record<string, GridPos> {
  const { cols, rows } = computeGridDimensions(config);
  const positions: Record<string, GridPos> = {};
  let col = 0;
  let row = 0;
  for (const id of appIds) {
    positions[id] = { col, row };
    row++;
    if (row >= rows) {
      row = 0;
      col++;
      if (col >= cols) col = 0;
    }
  }
  return positions;
}

export function useIconGrid(appIds: string[], config: IconGridConfig = DEFAULT_CONFIG) {
  const [positions, setPositions] = useState<Record<string, GridPos>>(() => {
    const saved = loadPositions();
    const hasAll = appIds.every(id => id in saved);
    if (hasAll) return saved;
    const layout = autoLayout(appIds, config);
    Object.keys(saved).forEach(id => {
      if (appIds.includes(id)) layout[id] = saved[id];
    });
    return layout;
  });

  const dragging = useRef<{ id: string; startX: number; startY: number; origCol: number; origRow: number } | null>(null);
  const [dragState, setDragState] = useState<{ id: string; dx: number; dy: number } | null>(null);

  useEffect(() => {
    savePositions(positions);
  }, [positions]);

  useEffect(() => {
    const onResize = () => {
      setPositions(prev => {
        const { cols, rows } = computeGridDimensions(config);
        const clamped: Record<string, GridPos> = {};
        for (const [id, pos] of Object.entries(prev)) {
          clamped[id] = {
            col: Math.min(pos.col, cols - 1),
            row: Math.min(pos.row, rows - 1),
          };
        }
        return clamped;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [config]);

  const getPixelPos = useCallback((pos: GridPos) => ({
    x: config.paddingLeft + pos.col * config.cellW,
    y: config.paddingTop + pos.row * config.cellH,
  }), [config]);

  // #5 Compute preview positions during drag — other icons animate to let-position
  const [hoverCell, setHoverCell] = useState<GridPos | null>(null);

  const previewPositions = useMemo(() => {
    if (!dragState || !hoverCell) return positions;
    const id = dragState.id;
    const preview = { ...positions };
    const occupant = Object.entries(preview).find(
      ([oid, opos]) => oid !== id && opos.col === hoverCell.col && opos.row === hoverCell.row
    );
    if (occupant) {
      preview[occupant[0]] = { ...positions[id] };
    }
    preview[id] = { col: hoverCell.col, row: hoverCell.row };
    return preview;
  }, [positions, dragState, hoverCell]);

  const onIconPointerDown = useCallback((id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Don't start drag on mobile (single tap = open)
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;

    const pos = positions[id];
    if (!pos) return;

    dragging.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      origCol: pos.col,
      origRow: pos.row,
    };

    let moved = false;

    const onPointerMove = (ev: PointerEvent) => {
      if (!dragging.current || dragging.current.id !== id) return;
      const dx = ev.clientX - dragging.current.startX;
      const dy = ev.clientY - dragging.current.startY;
      if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      moved = true;
      setDragState({ id, dx, dy });

      // Update hover cell for preview positions
      const origPixel = getPixelPos({ col: dragging.current.origCol, row: dragging.current.origRow });
      const hx = origPixel.x + dx;
      const hy = origPixel.y + dy;
      const { cols, rows } = computeGridDimensions(config);
      const hCol = Math.max(0, Math.min(Math.round((hx - config.paddingLeft) / config.cellW), cols - 1));
      const hRow = Math.max(0, Math.min(Math.round((hy - config.paddingTop) / config.cellH), rows - 1));
      setHoverCell({ col: hCol, row: hRow });
    };

    const onPointerUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);

      if (!dragging.current || dragging.current.id !== id) return;

      if (moved) {
        const dx = ev.clientX - dragging.current.startX;
        const dy = ev.clientY - dragging.current.startY;
        const origPixel = getPixelPos({ col: dragging.current.origCol, row: dragging.current.origRow });
        const dropX = origPixel.x + dx;
        const dropY = origPixel.y + dy;

        const { cols, rows } = computeGridDimensions(config);
        let newCol = Math.round((dropX - config.paddingLeft) / config.cellW);
        let newRow = Math.round((dropY - config.paddingTop) / config.cellH);
        newCol = Math.max(0, Math.min(newCol, cols - 1));
        newRow = Math.max(0, Math.min(newRow, rows - 1));

        setPositions(prev => {
          const next = { ...prev };
          const occupant = Object.entries(next).find(
            ([oid, opos]) => oid !== id && opos.col === newCol && opos.row === newRow
          );
          if (occupant) {
            next[occupant[0]] = { col: dragging.current!.origCol, row: dragging.current!.origRow };
          }
          next[id] = { col: newCol, row: newRow };
          return next;
        });
      }

      dragging.current = null;
      setDragState(null);
      setHoverCell(null);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [positions, config, getPixelPos]);

  return { positions, previewPositions, dragState, getPixelPos, onIconPointerDown, config };
}
