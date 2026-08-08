import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';

export function IncognitoSection() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => { void browser.extension.isAllowedIncognitoAccess().then(setAllowed); }, []);
  return <section><h2>无痕模式</h2><p>{allowed ? '已由浏览器授权' : '未授权，需在扩展详情页开启'}</p><p>授权后，无痕书签与普通书签共用本地数据，不保留无痕来源标记。</p><button type="button" onClick={() => void browser.tabs.create({ url: `chrome://extensions/?id=${browser.runtime.id}` })}><ExternalLink size={16}/>打开扩展详情页</button></section>;
}
