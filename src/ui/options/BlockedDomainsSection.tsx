import { Plus, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const HIDDEN_PREFIX = 'siftmark.content.hidden.';

export function BlockedDomainsSection() {
  const [domains, setDomains] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const load = useCallback(async () => {
    const stored = await browser.storage.local.get();
    setDomains(
      Object.entries(stored)
        .filter(([key, value]) => key.startsWith(HIDDEN_PREFIX) && value === true)
        .map(([key]) => key.slice(HIDDEN_PREFIX.length))
        .sort((a, b) => a.localeCompare(b))
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const domain = normalizeDomain(draft);
    if (!domain) {
      setStatus('请输入有效域名');
      return;
    }
    await browser.storage.local.set({ [`${HIDDEN_PREFIX}${domain}`]: true });
    setDraft('');
    setStatus(`已屏蔽 ${domain}`);
    await load();
  };

  const restore = async (domain: string) => {
    await browser.storage.local.remove(`${HIDDEN_PREFIX}${domain}`);
    setStatus(`已恢复 ${domain}`);
    await load();
  };

  return (
    <section>
      <h2>页面内容读取屏蔽列表</h2>
      <p>收藏这些网站时只使用标题、网址和描述，不读取页面正文。</p>
      <form
        className="blocked-domain-form"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label>
          <span className="visually-hidden">要屏蔽的域名</span>
          <input
            value={draft}
            placeholder="example.com"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button type="submit">
          <Plus size={16} />
          添加域名
        </button>
      </form>
      <output>{status}</output>
      <ul className="settings-list blocked-domain-list">
        {domains.map((domain) => (
          <li key={domain}>
            <span>{domain}</span>
            <button type="button" onClick={() => void restore(domain)}>
              <RotateCcw size={16} />
              恢复显示
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLocaleLowerCase();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname;
  } catch {
    return '';
  }
}
