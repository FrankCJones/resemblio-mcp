/**
 * Thin HTTP client for the Resemblio v1 REST API.
 *
 * Wraps the five endpoints the MCP tools consume:
 *   POST /v1/extractions          - create a charged extraction
 *   GET  /v1/extractions          - paginated history
 *   GET  /v1/extractions/{id}     - fetch one extraction
 *   GET  /v1/library/manifests/apple - fetch the free canonical manifest
 *   GET  /v1/apple/exports/dtcg   - fetch an entitled export artifact
 *
 * Auth model: every call carries `Authorization: Bearer <apiKey>`. The key
 * is supplied at server-start via the `RESEMBLIO_API_KEY` env var (or the
 * `--api-key` flag handled in `index.ts`).
 *
 * Retry policy: transient HTTP failures (network errors and 5xx responses)
 * retry up to `maxRetries` times with exponential backoff. 4xx responses
 * are NOT retried; they are returned to the caller as `ResemblioApiError`
 * because the customer needs to see them (insufficient credit, invalid URL,
 * spend cap, etc.). This matches the public API's retry posture.
 */

import { createHash } from 'node:crypto';

/** Exact polymorphic record shape inside the Apple system artifact. */
export interface AppleSystemManifestRecord {
  record_id: string;
  slug: string;
  classification: 'foundation' | 'component' | 'composition';
  route: string;
  aliases: string[];
  readiness: Record<string, unknown>;
  evidence: Record<string, unknown>;
  facets: Record<string, unknown>;
  facet_evidence_sha256: string;
  relationships: Record<string, unknown>;
  compiler_version: string;
  [key: string]: unknown;
}

/** Canonical content-addressed public Apple library artifact. */
export interface AppleSystemManifest {
  schema_version: 'resemblio_apple_system_manifest_v1';
  artifact_id: string;
  artifact_version: string;
  compiler_version: string;
  normalization_policy_version: string;
  inventory_version: string;
  inventory_sha256: string;
  evidence_set_sha256: string;
  artifact_sha256: string;
  record_count: number;
  breakdown: Record<string, number>;
  attribution: Record<string, unknown>;
  scrub_policy: Record<string, unknown>;
  records: AppleSystemManifestRecord[];
  projections: Record<string, unknown>;
  [key: string]: unknown;
}

/** Additive API envelope around the untouched canonical artifact. */
export interface AppleSystemManifestResponse {
  schema_version: 2;
  data: AppleSystemManifest;
}

export const APPLE_SYSTEM_MANIFEST_PATH = '/v1/library/manifests/apple';
export const APPLE_LIBRARY_EXPORT_PATH = '/v1/apple/exports/dtcg';
const APPLE_SYSTEM_MANIFEST_SCHEMA = 'resemblio_apple_system_manifest_v1';
const APPLE_LIBRARY_EXPORT_MEDIA_TYPE = 'application/design-tokens+json';
const DTCG_SCHEMA_URL = 'https://www.designtokens.org/schemas/2025.10/format.json';
const SHA256_RE = /^[a-f0-9]{64}$/;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Apple system manifest has invalid ${field}`);
  }
}

function jsonAsciiString(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Serialize canonical sorted compact ASCII JSON for the artifact hash. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as { [key: string]: JsonValue };
    return `{${Object.keys(object).sort().map((key) =>
      `${jsonAsciiString(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  if (typeof value === 'string') return jsonAsciiString(value);
  return JSON.stringify(value);
}

/** Validate the canonical artifact without adding an MCP-specific shape. */
export function validateAppleSystemManifest(payload: unknown): AppleSystemManifest {
  if (!isPlainObject(payload)) throw new Error('Apple system manifest must be an object');
  if (payload.schema_version !== APPLE_SYSTEM_MANIFEST_SCHEMA) {
    throw new Error('Apple system manifest has an unsupported schema_version');
  }
  for (const field of [
    'artifact_id', 'artifact_version', 'compiler_version',
    'normalization_policy_version', 'inventory_version', 'inventory_sha256',
    'evidence_set_sha256', 'artifact_sha256',
  ]) requireNonEmptyString(payload[field], field);
  for (const field of ['inventory_sha256', 'evidence_set_sha256', 'artifact_sha256']) {
    if (!SHA256_RE.test(payload[field] as string)) {
      throw new Error(`Apple system manifest has invalid ${field}`);
    }
  }
  if (!Number.isInteger(payload.record_count) || (payload.record_count as number) < 0) {
    throw new Error('Apple system manifest has invalid record_count');
  }
  if (!isPlainObject(payload.breakdown) || !isPlainObject(payload.attribution) ||
      !isPlainObject(payload.scrub_policy) || !isPlainObject(payload.projections)) {
    throw new Error('Apple system manifest has invalid public metadata');
  }
  if (!Array.isArray(payload.records) || payload.records.length !== payload.record_count) {
    throw new Error('Apple system manifest has invalid records');
  }
  const { artifact_sha256: suppliedDigest, ...body } = payload;
  const expectedDigest = createHash('sha256')
    .update(`${canonicalJson(body as JsonValue)}\n`, 'utf8')
    .digest('hex');
  if (suppliedDigest !== expectedDigest) {
    throw new Error('Apple system manifest artifact_sha256 does not match its body');
  }
  return payload as AppleSystemManifest;
}

/** Validate the outer API envelope and expose its data payload unchanged. */
export function validateAppleSystemManifestResponse(payload: unknown): AppleSystemManifest {
  if (!isPlainObject(payload) || payload.schema_version !== 2 || !('data' in payload)) {
    throw new Error('Apple system manifest response has an unsupported schema_version');
  }
  return validateAppleSystemManifest(payload.data);
}

/** Decode strict UTF-8 and validate a pure DTCG root without reserializing it. */
export function validateDesignTokensBytes(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Apple design tokens are not valid UTF-8');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Apple design tokens are not valid JSON');
  }
  if (!isPlainObject(payload) || payload.$schema !== DTCG_SCHEMA_URL) {
    throw new Error('Apple design tokens do not have a pure DTCG root');
  }
  return text;
}

/**
 * Compact extraction-list-item shape returned by GET /v1/extractions.
 * Matches the extraction list-item shape in the public REST API contract.
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
   * window replay the original response without re-charging.
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

  /** Fetch the verified canonical Apple artifact without charging credits. */
  async getAppleSystemManifest(): Promise<AppleSystemManifest> {
    const envelope = await this.request<unknown>('GET', APPLE_SYSTEM_MANIFEST_PATH);
    return validateAppleSystemManifestResponse(envelope);
  }

  /** Fetch the entitled canonical design.tokens.json body without reserializing it. */
  async getAppleLibraryExport(): Promise<string> {
    const response = await this.requestResponse('GET', APPLE_LIBRARY_EXPORT_PATH, {
      headers: { Accept: APPLE_LIBRARY_EXPORT_MEDIA_TYPE },
    });
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    if (contentType !== APPLE_LIBRARY_EXPORT_MEDIA_TYPE) {
      throw new Error('Apple design tokens have an unexpected content type');
    }
    return validateDesignTokensBytes(new Uint8Array(await response.arrayBuffer()));
  }

  /**
   * Core request method. Adds the Bearer header, retries 5xx + network
   * errors with exponential backoff, and surfaces structured errors via
   * `ResemblioApiError` for 4xx responses (no retry, no swallow).
   */
  private async request<T>(method: string, path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.requestResponse(method, path, init);
    return (await response.json()) as T;
  }

  /** Return a successful raw response while preserving retry and error policy. */
  private async requestResponse(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${this.apiKey}`,
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchImpl(url, { ...init, method, headers });
        if (response.ok) {
          return response;
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
