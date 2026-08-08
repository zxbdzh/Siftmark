const TRACKING_PARAMETER_NAMES = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', '_hsenc', '_hsmi']);

export function normalizeUrlConservatively(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return value;
    url.protocol = url.protocol.toLocaleLowerCase();
    url.hostname = url.hostname.toLocaleLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) url.port = '';
    for (const name of [...url.searchParams.keys()]) {
      if (name.toLocaleLowerCase().startsWith('utm_') || TRACKING_PARAMETER_NAMES.has(name.toLocaleLowerCase())) url.searchParams.delete(name);
    }
    return url.toString();
  } catch {
    return value;
  }
}
