export class HttpError extends Error {
  public readonly status: number;
  public readonly body?: string;

  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export interface FetchRetryOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  backoffFactor?: number;
  retryStatusCodes?: number[];
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_RETRY_STATUS = [429, 500, 502, 503, 504];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface SafeHttpRequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Safe HTTP request that returns parsed JSON response.
 * Includes timeout and error handling.
 */
export async function safeHttpRequest(options: SafeHttpRequestOptions): Promise<unknown> {
  const { url, method = 'GET', headers = {}, body, timeoutMs = 30000 } = options;

  const requestInit: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body && method !== 'GET') {
    requestInit.body = JSON.stringify(body);
  }

  const response = await fetchWithRetry(url, requestInit, {
    timeoutMs,
    retries: 1,
  });

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryOptions: FetchRetryOptions = {}
): Promise<Response> {
  const {
    timeoutMs = 10000,
    retries = 2,
    retryDelayMs = 500,
    backoffFactor = 2,
    retryStatusCodes = DEFAULT_RETRY_STATUS,
    onRetry,
  } = retryOptions;

  let attempt = 0;
  let delayMs = retryDelayMs;

  while (true) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);

      if (response.ok) {
        return response;
      }

      const bodyText = await response.text();
      const error = new HttpError(`HTTP ${response.status}`, response.status, bodyText);

      if (attempt < retries && retryStatusCodes.includes(response.status)) {
        attempt += 1;
        if (onRetry) {
          onRetry(attempt, error);
        }
        await sleep(delayMs);
        delayMs *= backoffFactor;
        continue;
      }

      throw error;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown fetch error');
      const isAbort = err.name === 'AbortError';
      const isRetryableHttp = err instanceof HttpError && retryStatusCodes.includes(err.status);

      if (attempt < retries && (isAbort || isRetryableHttp)) {
        attempt += 1;
        if (onRetry) {
          onRetry(attempt, err);
        }
        await sleep(delayMs);
        delayMs *= backoffFactor;
        continue;
      }

      throw err;
    }
  }
}
