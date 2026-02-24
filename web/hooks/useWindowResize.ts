import { useCallback, useRef } from 'react';
import { WindowBounds } from '../types';

const MIN_W = 420;
const MIN_H = 320;
const MENU_BAR_H = 25;

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface ResizeCallbacks {
  onResize: (bounds: WindowBounds) => void;
  getBounds: () => WindowBounds;
}

const CURSOR_MAP: Record<ResizeEdge, string> = {
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  nw: 'nwse-resize', se: 'nwse-resize',
};

export function useWindowResize(cb: ResizeCallbacks) {
  const resizing = useRef(false);

  const onEdgePointerDown = useCallback((edge: ResizeEdge, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;

    const startX = e.clientX;
    const startY = e.clientY;
    const startBounds = { ...cb.getBounds() };

    // Set cursor on body during resize
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = CURSOR_MAP[edge];

    const onPointerMove = (ev: PointerEvent) => {
      if (!resizing.current) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      let { x, y, width, height } = startBounds;

      // Horizontal
      if (edge.includes('e')) {
        width = Math.max(MIN_W, startBounds.width + dx);
      }
      if (edge.includes('w')) {
        const newW = Math.max(MIN_W, startBounds.width - dx);
        x = startBounds.x + (startBounds.width - newW);
        width = newW;
      }

      // Vertical
      if (edge.includes('s')) {
        height = Math.max(MIN_H, startBounds.height + dy);
      }
      if (edge.includes('n')) {
        const newH = Math.max(MIN_H, startBounds.height - dy);
        y = Math.max(MENU_BAR_H, startBounds.y + (startBounds.height - newH));
        height = newH;
      }

      cb.onResize({ x, y, width, height });
    };

    const onPointerUp = () => {
      resizing.current = false;
      document.body.style.cursor = prevCursor;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [cb]);

  return { onEdgePointerDown };
}

export { CURSOR_MAP };
