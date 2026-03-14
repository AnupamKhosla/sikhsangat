const DEFAULT_ALLOWED_HOSTS = ['www.sikhsangat.com', 'files.sikhsangat.com'];
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-scraper-token, content-type, accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

function readAllowedHosts() {
  const raw = process.env.ALLOWED_FETCH_HOSTS;
  if (!raw) {
    return new Set(DEFAULT_ALLOWED_HOSTS);
  }

  return new Set(
    raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function readProvidedToken(req) {
  const headerToken = req.headers['x-scraper-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }

  const authorization = req.headers.authorization;
  if (typeof authorization === 'string') {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) {
      return match[1].trim();
    }
  }

  return '';
}

function json(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed. Use GET.' });
    return;
  }

  const expectedToken = process.env.SCRAPER_PROXY_TOKEN || process.env.REMOTE_FETCH_TOKEN || '';
  if (!expectedToken) {
    json(res, 500, { error: 'Server misconfigured. Missing SCRAPER_PROXY_TOKEN.' });
    return;
  }

  const providedToken = readProvidedToken(req);
  if (!providedToken || providedToken !== expectedToken) {
    json(res, 401, { error: 'Unauthorized.' });
    return;
  }

  const requestUrl = new URL(req.url, 'https://local.vercel.internal');
  const targetUrl = requestUrl.searchParams.get('url') || '';
  if (!targetUrl) {
    json(res, 400, { error: 'Missing url query parameter.' });
    return;
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    json(res, 400, { error: 'Invalid target URL.' });
    return;
  }

  if (parsedTarget.protocol !== 'https:') {
    json(res, 400, { error: 'Only https URLs are allowed.' });
    return;
  }

  const allowedHosts = readAllowedHosts();
  if (!allowedHosts.has(parsedTarget.hostname.toLowerCase())) {
    json(res, 403, { error: `Host not allowed: ${parsedTarget.hostname}` });
    return;
  }

  try {
    const upstreamResponse = await fetch(parsedTarget, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: req.headers.accept || '*/*',
        'User-Agent': process.env.REMOTE_FETCH_USER_AGENT || DEFAULT_USER_AGENT,
      },
    });

    const body = Buffer.from(await upstreamResponse.arrayBuffer());
    const contentType = upstreamResponse.headers.get('content-type') || 'application/octet-stream';
    const cacheControl = upstreamResponse.headers.get('cache-control');

    res.status(upstreamResponse.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControl || 'no-store');
    res.setHeader('X-Proxy-Upstream-Status', String(upstreamResponse.status));
    res.setHeader('X-Proxy-Target-Host', parsedTarget.hostname);
    res.send(body);
  } catch (error) {
    json(res, 502, {
      error: 'Upstream fetch failed.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
