import { BookmarkPlus, GripVertical, Minus, X } from 'lucide-react';
import { useRef, useState } from 'react';

export function FloatingButton({ enabled, onSave, onHide, initialPosition = { x: 0, y: 0 }, onPositionChange }: { enabled: boolean; onSave(): void; onHide(): void; initialPosition?: { x: number; y: number }; onPositionChange?(position: { x: number; y: number }): void }) {
  const [minimized, setMinimized] = useState(false);
  const start = useRef<{ pointerX: number; pointerY: number; x: number; y: number }>();
  const [position, setPosition] = useState(initialPosition);
  if (!enabled) return null;
  return <div className="siftmark-floating" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}><button type="button" aria-label="拖动悬浮按钮" className="siftmark-drag" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); start.current = { pointerX: event.clientX, pointerY: event.clientY, ...position }; }} onPointerMove={(event) => { if (!start.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return; const next = { x: start.current.x + event.clientX - start.current.pointerX, y: start.current.y + event.clientY - start.current.pointerY }; setPosition(next); }} onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); const origin = start.current; start.current = undefined; if (origin) onPositionChange?.({ x: origin.x + event.clientX - origin.pointerX, y: origin.y + event.clientY - origin.pointerY }); }}><GripVertical/></button>{minimized ? null : <button type="button" aria-label="保存到 Siftmark" onClick={onSave}><BookmarkPlus/></button>}<button type="button" aria-label={minimized ? '展开悬浮按钮' : '最小化悬浮按钮'} onClick={() => setMinimized((value) => !value)}><Minus/></button>{minimized ? null : <button type="button" aria-label="在此网站隐藏" onClick={onHide}><X/></button>}</div>;
}
