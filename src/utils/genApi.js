// src/utils/genApi.js
const GEN_API_ENDPOINT = 'https://api.gen-api.ru/api/v1/functions/remove-background';
const GEN_API_STATUS_ENDPOINT = 'https://api.gen-api.ru/api/v1/request/get';
const DEFAULT_IMPLEMENTATION = process.env.GEN_API_IMPLEMENTATION || 'modnet';
const DEFAULT_POLL_INTERVAL_MS = Number(process.env.GEN_API_POLL_INTERVAL_MS || 2000);
const DEFAULT_POLL_TIMEOUT_MS = Number(process.env.GEN_API_POLL_TIMEOUT_MS || 60000);

function assertToken() {
  const token = process.env.GEN_API_TOKEN;
  if (!token) {
    throw new Error('GEN_API_TOKEN is not configured');
  }
  return token;
}

async function extractBuffer(payload) {
  if (typeof payload !== 'string' || !payload.trim()) {
    throw new Error('Unexpected GenAPI response: missing image payload');
  }

  const trimmed = payload.trim();

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const response = await fetch(trimmed);
    if (!response.ok) {
      throw new Error(`Failed to download processed image (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: response.headers.get('content-type') || 'image/png',
    };
  }

  if (trimmed.startsWith('data:')) {
    const [, meta = '', data = ''] = trimmed.match(/^data:([^;]+);base64,(.+)$/) || [];
    if (!data) {
      throw new Error('Invalid data URL received from GenAPI');
    }
    return {
      buffer: Buffer.from(data, 'base64'),
      mimeType: meta || 'image/png',
    };
  }

  return {
    buffer: Buffer.from(trimmed, 'base64'),
    mimeType: 'image/png',
  };
}

function pickPayload(source) {
  if (!source) return null;

  const queue = [source];
  while (queue.length) {
    const current = queue.shift();
    if (typeof current === 'string' && current.trim()) {
      return current;
    }

    if (Array.isArray(current)) {
      queue.push(...current.filter(value => value !== undefined && value !== null));
      continue;
    }

    if (current && typeof current === 'object') {
      const directUrl =
        current.url ||
        current.image_url ||
        current.href ||
        current.link;
      if (typeof directUrl === 'string' && directUrl.trim()) {
        return directUrl;
      }

      const directData =
        current.base64 ||
        current.data64 ||
        current.encoded ||
        current.content ||
        current.value ||
        current.file;
      if (typeof directData === 'string' && directData.trim()) {
        return directData;
      }

      [
        current.output,
        current.image,
        current.result,
        current.data,
        current.payload,
        current.response,
        current.images,
        current.results,
      ]
        .filter(value => value !== undefined && value !== null)
        .forEach(value => queue.push(value));
    }
  }

  return null;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollRequestResult(requestId, token, {
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
} = {}) {
  if (!requestId) {
    throw new Error('GenAPI response did not include request_id');
  }

  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    const statusResponse = await fetch(`${GEN_API_STATUS_ENDPOINT}/${requestId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!statusResponse.ok) {
      const text = await statusResponse.text().catch(() => '');
      lastError = new Error(`GenAPI status request failed (${statusResponse.status}): ${text || 'no details'}`);
      await sleep(intervalMs);
      continue;
    }

    let statusPayload;
    try {
      statusPayload = await statusResponse.json();
    } catch {
      lastError = new Error('Unable to parse GenAPI status response');
      await sleep(intervalMs);
      continue;
    }

    const status = String(statusPayload?.status || '').toLowerCase();
    if (status === 'success') {
      return statusPayload;
    }
    if (status === 'failed' || status === 'error') {
      const message =
        statusPayload?.message ||
        statusPayload?.error ||
        statusPayload?.output ||
        'GenAPI task failed';
      throw new Error(message);
    }

    await sleep(intervalMs);
  }

  throw lastError || new Error('GenAPI request timed out');
}

export async function removeBackgroundViaGenApi({
  imageDataUrl,
  imageUrl,
  imageBuffer,
  mimeType,
  fileName,
  implementation,
}) {
  const token = assertToken();

  if (!imageDataUrl && !imageUrl && !imageBuffer) {
    throw new Error('Either imageUrl or imageBuffer must be provided');
  }

  const resolvedImplementation = implementation || DEFAULT_IMPLEMENTATION;
  const headers = {
    Authorization: `Bearer ${token}`,
  };

  let body;
  if (imageBuffer) {
    const formData = new FormData();
    formData.set('implementation', resolvedImplementation);
    const blob = new Blob([imageBuffer], { type: mimeType || 'image/png' });
    formData.set('image', blob, fileName || 'image.png');
    body = formData;
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({
      implementation: resolvedImplementation,
      image: imageUrl || imageDataUrl,
    });
  }

  const response = await fetch(GEN_API_ENDPOINT, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GenAPI request failed (${response.status}): ${text || 'no details'}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error('Unable to parse GenAPI response');
  }

  let payload = pickPayload(data);
  if (!payload) {
    const requestId = data?.request_id ?? data?.id ?? data?.requestId;
    const finalResult = await pollRequestResult(requestId, token);
    payload = pickPayload(finalResult);
    if (!payload) {
      throw new Error('GenAPI response does not contain processed image');
    }
    return extractBuffer(payload);
  }

  return extractBuffer(payload);
}

export { DEFAULT_IMPLEMENTATION as DEFAULT_GEN_API_IMPLEMENTATION };
