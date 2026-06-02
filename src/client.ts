/**
 * Thin HTTP client for the Resemblio v1 REST API.
 *
 * Wraps the three endpoints the MCP tools consume:
 *   POST /v1/extractions          - create a charged extraction
 *   GET  /v1/extractions          - paginated history
 *   GET  /v1/extractions/{id}     - fetch one extraction
 *
 * Auth model: every call carries `Authorization: Bearer <apiKey>`. The key
 * is supplied at server-start via the `RESEMBLIO_API_KEY` env var (or the
 * `--api-key` flag handled in `index.ts`).
 *
 * Retry policy: transient HTTP failures (network errors and 5xx responses)
 * retry up to `maxRetries` times with exponential backoff. 4xx responses
 * are NOT retried; they are returned to the caller as `ResemblioApiError`
 * because the customer needs to see them (insufficient credit, invalid URL,
 * spend cap, etc.). Mirrors the retry posture of
 * `projects/Resemblio/code/api/app/extractor_bridge.py`.
 */

/**
 * Compact extraction-list-item shape returned by GET /v1/extractions.
 * Matches `ExtractionListItem` in `code/api/app/schemas.py`.
 */
export interface ExtractionListItem {
  id: number;
  url: string;
  status: string;
  extracted_at: string;
  schema_version: number;
}

/**
 * Paginated list envelope returned by GET /v1/extractions.
 * Matches `ExtractionListResponse` in the API schemas.
 */
export interface ExtractionListResponse {
  items: ExtractionListItem[];
  schema_version: number;
}

/**
 * v1.1 manifest envelope: the canonical pointer record a client persists.
 * Matches `ExtractionManifest` in the API schemas.
 */
export interface ExtractionManifest {
  id: number;
  status: string;
  source_url: string;
  created_at_utc: string;
  schema_version: number;
  quality_score: number | null;
  tokens_url: string | null;
  download_url: string | null;
}

/**
 * Full extraction-detail response returned by POST /v1/extractions and
 * GET /v1/extractions/{id}. Matches `ExtractionResponse` in the API schemas.
 *
 * The inline `tokens` + `dtcg` payload is convenience; clients that prefer
 * the pointer-only contract should read `manifest.tokens_url` and
 * `manifest.download_url`.
 */
export interface ExtractionResponse {
  id: number;
  status: string;
  tokens: Record<string, unknown> | null;
  dtcg: Record<string, unknown> | null;
  download_url: string | null;
  schema_version: number;
  tokens_url: string | null;
  manifest: ExtractionManifest | null;
  error_log?: unknown;
  error_code?: string | null;
  quality_score?: number | null;
  refunded?: boolean | null;
}

/**
 * Request body for POST /v1/extractions.
 * `private` defaults to false (public extraction at $5/call).
 */
export interface ExtractionCreateRequest {
  url: string;
  private?: boolean;
}

/**
 * Structured API error. Carries the HTTP status plus the parsed JSON body
 * (`error_code`, `error_log`, etc.) so the MCP tool layer can surface a
 * useful message to the calling assistant without re-parsing.
 */
export class ResemblioApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Resemblio API error ${status}`);
    this.name = 'ResemblioApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Construction options for `ResemblioClient`.
 */
export interface ResemblioClientOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.resemblio.com';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 250;

/**
 * Thin async client for the Resemblio v1 REST surface.
 *
 * Construction is pure (no network call); all methods are async and
 * idempotent except `createExtraction`, which charges credits server-side.
 * `createExtraction` accepts an optional idempotency key that the API
 * honors per `app/idempotency.py`.
 */
export class ResemblioClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ResemblioClientOptions) {
    if (!options.apiKey || options.apiKey.trim() === '') {
      throw new Error(
        'ResemblioClient: apiKey is required. Set RESEMBLIO_API_KEY or pass --api-key.'
      );
    }
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Create a charged extraction. Server returns the full ExtractionResponse
   * synchronously (the v1 extractor is sync; no polling needed).
   *
   * Optional `idempotencyKey` lets a retried call within the API's TTL
   * window replay the original response without re-charging. See
   * `code/api/app/idempotency.py`.
   */
  async createExtraction(
    request: ExtractionCreateRequest,
    idempotencyKey?: string,
  ): Promise<ExtractionResponse> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    return this.request<ExtractionResponse>('POST', '/v1/extractions', {
      headers,
      body: JSON.stringify(request),
    });
  }

  /**
   * List the calling user's extraction history. `before` is a cursor
   * (extraction id); `limit` is bounded server-side to [1, 100].
   */
  async listExtractions(params: { limit?: number; before?: number } = {}): Promise<ExtractionListResponse> {
    const search = new URLSearchParams();
    if (params.limit !== undefined) search.set('limit', String(params.limit));
    if (params.before !== undefined) search.set('before', String(params.before));
    const qs = search.toString();
    const path = qs ? `/v1/extractions?${qs}` : '/v1/extractions';
    return this.request<ExtractionListResponse>('GET', path);
  }

  /**
   * Fetch a previously-completed extraction by id without re-charging.
   */
  async getExtraction(extractionId: number): Promise<ExtractionResponse> {
    return this.request<ExtractionResponse>('GET', `/v1/extractions/${extractionId}`);
  }

  /**
   * Core request method. Adds the Bearer header, retries 5xx + network
   * errors with exponential backoff, and surfaces structured errors via
   * `ResemblioApiError` for 4xx responses (no retry, no swallow).
   */
  private async request<T>(method: string, path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchImpl(url, { ...init, method, headers });
        if (response.ok) {
          return (await response.json()) as T;
        }
        const body = await this.safeJson(response);
        if (response.status >= 400 && response.status < 500) {
          throw new ResemblioApiError(response.status, body);
        }
        // 5xx: retry path
        lastError = new ResemblioApiError(response.status, body);
      } catch (err) {
        if (err instanceof ResemblioApiError && err.status >= 400 && err.status < 500) {
          throw err;
        }
        lastError = err;
      }
      if (attempt < this.maxRetries) {
        await this.sleep(this.backoffMs * Math.pow(2, attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Resemblio API: exhausted retries');
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
