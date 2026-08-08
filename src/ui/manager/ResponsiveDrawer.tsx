import type { ReactNode } from 'react';

export function ResponsiveDrawer({ open, label, children, onClose }: { open: boolean; label: string; children: ReactNode; onClose(): void }) {
  return open ? <div className="responsive-drawer" role="dialog" aria-label={label} aria-modal="true"><button type="button" onClick={onClose}>关闭</button>{children}</div> : null;
}
