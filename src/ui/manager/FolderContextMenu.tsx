import { FolderPlus, HeartPulse } from 'lucide-react';
export function FolderContextMenu({ onCreate, onHealth }: { onCreate(): void; onHealth(): void }) { return <menu aria-label="文件夹操作"><button onClick={onCreate}><FolderPlus size={15}/>新建子文件夹</button><button onClick={onHealth}><HeartPulse size={15}/>健康检查</button></menu>; }
