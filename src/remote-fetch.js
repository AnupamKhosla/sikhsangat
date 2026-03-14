import axios from 'axios';

const REMOTE_FETCH_ENDPOINT =
  process.env.SCRAPER_REMOTE_FETCH_ENDPOINT || process.env.REMOTE_FETCH_ENDPOINT || '';
const REMOTE_FETCH_TOKEN = process.env.SCRAPER_REMOTE_FETCH_TOKEN || process.env.REMOTE_FETCH_TOKEN || '';
const DEFAULT_TIMEOUT_MS = Number(process.env.SCRAPER_REMOTE_FETCH_TIMEOUT_MS) || 45000;

function buildRemoteFetchUrl(targetUrl) {
  const endpoint = new URL(REMOTE_FETCH_ENDPOINT);
  endpoint.searchParams.set('url', targetUrl);
  return endpoint.toString();
}

export function isRemoteFetchEnabled() {
  return Boolean(REMOTE_FETCH_ENDPOINT && REMOTE_FETCH_TOKEN);
}

export async function remoteFetch(targetUrl, options = {}) {
  if (!isRemoteFetchEnabled()) {
    throw new Error('Remote fetch is not configured.');
  }

  const response = await axios.get(buildRemoteFetchUrl(targetUrl), {
    responseType: options.responseType || 'arraybuffer',
    timeout: Number(options.timeout) || DEFAULT_TIMEOUT_MS,
    headers: {
      Accept: options.accept || '*/*',
      Authorization: `Bearer ${REMOTE_FETCH_TOKEN}`,
      'X-Scraper-Token': REMOTE_FETCH_TOKEN,
    },
    validateStatus: () => true,
  });

  return response;
}
