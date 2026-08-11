export const HOME_POSTER_WIDTH = 1122;
export const HOME_POSTER_HEIGHT = 1402;

function parseHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('invalid_panel_address');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('unsupported_protocol');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error('invalid_panel_address');
  }
  parsed.hash = '';
  return parsed;
}

export function normalizePanelAddress(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('empty_panel_address');
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    ? raw
    : raw.startsWith('//')
      ? `http:${raw}`
      : `http://${raw}`;
  const parsed = parseHttpUrl(candidate);
  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');

  return {
    href: parsed.toString(),
    display: `${parsed.host}${path}${parsed.search}`,
  };
}

export function detectedPanelAddress(locationLike = globalThis.location) {
  if (!locationLike?.href) {
    return 'http://localhost:8888/';
  }

  const detected = parseHttpUrl(locationLike.href);
  detected.search = '';
  detected.hash = '';
  return detected.toString();
}
