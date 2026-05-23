import type { components } from '../../generated/api-types';

type ProblemDetails = components['schemas']['ProblemDetailsDto'];
type ValidationProblemDetails =
  components['schemas']['ValidationProblemDetailsDto'];

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails | ValidationProblemDetails | null;

  constructor(
    status: number,
    message: string,
    problem: ProblemDetails | ValidationProblemDetails | null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

function readBaseUrl(): string {
  const raw: unknown = import.meta.env.VITE_API_URL;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Missing VITE_API_URL in environment');
  }

  return raw.replace(/\/+$/, '');
}

function isProblem(value: unknown): value is ProblemDetails {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const maybe = value as Record<string, unknown>;
  return typeof maybe.detail === 'string' && typeof maybe.title === 'string';
}

async function parseProblem(
  response: Response,
): Promise<ProblemDetails | ValidationProblemDetails | null> {
  try {
    const body: unknown = await response.json();
    if (isProblem(body)) {
      return body;
    }
    return null;
  } catch {
    return null;
  }
}

export type RequestOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  body?: unknown;
  bearer?: string;
};

export async function apiRequest<TResponse>(
  options: RequestOptions,
): Promise<TResponse> {
  const baseUrl = readBaseUrl();
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.bearer) {
    headers.Authorization = `Bearer ${options.bearer}`;
  }

  const response = await fetch(`${baseUrl}${options.path}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 204) {
    return undefined as TResponse;
  }

  if (!response.ok) {
    const problem = await parseProblem(response);
    const message =
      problem?.detail ?? `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, problem);
  }

  return (await response.json()) as TResponse;
}
