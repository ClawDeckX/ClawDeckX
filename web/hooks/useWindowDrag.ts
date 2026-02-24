import { useCallback, useRef } from 'react';
import { WindowBounds } from '../types';

const MENU_BAR_H = 25;
const DOCK_H = 85;
const SNAP_THRESHOLD = 8;

export type SnapZone = 'left' | 'right' | 'top' | null;

interface DragCallbacks {
  onMove: (x: number, y: number) => void;
  onSnapPreview: (zone: SnapZone) => void;
  onSnapCommit: (zone: SnapZone) => void;
  getBounds: () => WindowBounds;
}

export function useWindowDrag(cb: DragCallbacks) {
  const dragging = useRef(false);
  const offset = useRef({ dx: 0, dy: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only left button; ignore clicks on buttons/inputs
    if (e.button !== 0) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SVG' || tag === 'LINE' || tag === 'PATH') return;

    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;

    const bounds = cb.getBounds();
    offset.current = { dx: e.clientX - bounds.x, dy: e.clientY - bounds.y };

    const onPointerMove = (ev: PointerEvent) => {
      if (!dragging.current) return;
      const nx = ev.clientX - offset.current.dx;
      const ny = ev.clientY - offset.current.dy;

      // Clamp: keep title bar visible
      const clampedY = Math.max(MENU_BAR_H, ny);
      cb.onMove(nx, clampedY);

      // Detect snap zone
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let zone: SnapZone = null;
      if (ev.clientX <= SNAP_THRESHOLD) zone = 'left';
      else if (ev.clientX >= vw - SNAP_THRESHOLD) zone = 'right';
      else if (ev.clientY <= MENU_BAR_H + SNAP_THRESHOLD) zone = 'top';
      cb.onSnapPreview(zone);
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);

      // Commit snap if cursor is at edge
      const vw = window.innerWidth;
      let zone: SnapZone = null;
      if (ev.clientX <= SNAP_THRESHOLD) zone = 'left';
      else if (ev.clientX >= vw - SNAP_THRESHOLD) zone = 'right';
      else if (ev.clientY <= MENU_BAR_H + SNAP_THRESHOLD) zone = 'top';
      cb.onSnapCommit(zone);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [cb]);

  return { onPointerDown };
}

export function getSnapBounds(zone: SnapZone): WindowBounds | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const usableH = vh - MENU_BAR_H - DOCK_H;
  switch (zone) {
    case 'left':
      return { x: 0, y: MENU_BAR_H, width: Math.round(vw / 2), height: usableH };
    case 'right':
      return { x: Math.round(vw / 2), y: MENU_BAR_H, width: Math.round(vw / 2), height: usableH };
    case 'top':
      return { x: 0, y: MENU_BAR_H, width: vw, height: usableH };
    default:
      return null;
  }
}
