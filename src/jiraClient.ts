import { setTimeout as delay } from 'timers/promises';

import { fetch } from 'undici';

import { createLogger } from './logger.js';
import type { Logger } from './logger.js';
import type { JiraClient, JiraComment, JiraIssue, JiraTransition, JiraVersion } from './types.js';

interface JiraClientOptions {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
  authMode: 'bearer' | 'basic';
  timeout: number;
  maxRetries: number;
  logger?: Logger;
}

class JiraError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = 'JiraError';
  }
}

const jitter = (base: number): number => {
  const rand = Math.random() * base * 0.2;
  return base + rand;
};

const isRetryableStatus = (status: number): boolean => status === 429 || (status >= 500 && status < 600);

export class JiraClientImpl implements JiraClient {
  private readonly logger: Logger;

  constructor(private readonly options: JiraClientOptions) {
    this.logger = options.logger ?? createLogger();
  }

  async getServerInfo(): Promise<void> {
    await this.request('GET', '/rest/api/2/serverInfo');
  }

  async getProjectVersions(projectKey: string): Promise<JiraVersion[]> {
    const data = await this.request(
      'GET',
      `/rest/api/2/project/${encodeURIComponent(projectKey)}/versions`,
    );
    return (data as JiraVersion[]).map((version) => ({
      id: version.id,
      name: version.name,
      released: version.released,
      releaseDate: version.releaseDate,
    }));
  }

  async createVersion(projectKey: string, versionName: string): Promise<JiraVersion> {
    const body = {
      name: versionName,
      project: projectKey,
    };
    const data = await this.request('POST', '/rest/api/2/version', body);
    const version = data as JiraVersion;
    return {
      id: version.id,
      name: version.name,
      released: version.released,
      releaseDate: version.releaseDate,
    };
  }

  async markVersionReleased(versionId: string, releaseDate: string): Promise<void> {
    const body = {
      released: true,
      releaseDate,
    };
    await this.request('PUT', `/rest/api/2/version/${encodeURIComponent(versionId)}`, body);
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    const data = await this.request('GET', `/rest/api/2/issue/${encodeURIComponent(issueKey)}`);
    return data as JiraIssue;
  }

  async updateIssueFixVersions(issueKey: string, versionIds: string[]): Promise<void> {
    const body = {
      fields: {
        fixVersions: versionIds.map((id) => ({ id })),
      },
    };
    await this.request('PUT', `/rest/api/2/issue/${encodeURIComponent(issueKey)}`, body);
  }

  async getIssueComments(issueKey: string): Promise<JiraComment[]> {
    const data = await this.request(
      'GET',
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment?maxResults=1000`,
    );
    const comments = (data as { comments?: JiraComment[] }).comments ?? [];
    return comments.map((comment) => ({ id: comment.id, body: comment.body }));
  }

  async addIssueComment(issueKey: string, body: string): Promise<void> {
    await this.request('POST', `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`, {
      body,
    });
  }

  async getIssueTransitions(issueKey: string): Promise<JiraTransition[]> {
    const data = await this.request(
      'GET',
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions?expand=transitions.fields`,
    );
    const transitions = (data as { transitions?: JiraTransition[] }).transitions ?? [];
    return transitions.map((transition) => ({
      id: transition.id,
      name: transition.name,
      to: transition.to,
    }));
  }

  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.request('POST', `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`, {
      transition: { id: transitionId },
    });
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = new URL(path, this.options.baseUrl);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.options.authMode === 'bearer') {
      if (this.options.token) {
        headers.Authorization = `Bearer ${this.options.token}`;
      }
    } else {
      const credential = `${this.options.username ?? ''}:${this.options.password ?? ''}`;
      const encoded = Buffer.from(credential, 'utf8').toString('base64');
      headers.Authorization = `Basic ${encoded}`;
    }

    const maxAttempts = Math.max(1, this.options.maxRetries + 1);
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxAttempts) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);
      if (typeof timeoutId === 'object' && 'unref' in timeoutId && typeof timeoutId.unref === 'function') {
        timeoutId.unref();
      }

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (isRetryableStatus(response.status)) {
          const retryAfter = this.parseRetryAfter(response.headers.get('retry-after'));
          lastError = new JiraError(
            `Jira request failed with status ${response.status} (${method} ${url.pathname})`,
            response.status,
          );
          attempt += 1;
          if (attempt >= maxAttempts) {
            break;
          }
          const delayMs = retryAfter ?? jitter(1000 * 2 ** (attempt - 1));
          this.logger.warn(
            `Retrying Jira request ${method} ${url.pathname} in ${Math.round(delayMs)}ms (status: ${response.status})`,
          );
          await delay(delayMs);
          continue;
        }

        if (!response.ok) {
          const text = await response.text();
          throw new JiraError(
            `Jira request failed with status ${response.status}: ${text}`,
            response.status,
            text,
          );
        }

        if (response.status === 204) {
          return undefined;
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          return await response.json();
        }

        return await response.text();
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof JiraError) {
          throw error;
        }
        if ((error as Error).name === 'AbortError') {
          lastError = new Error(`Jira request timed out after ${this.options.timeout}ms`);
        } else {
          lastError = error;
        }
        attempt += 1;
        if (attempt >= maxAttempts) {
          break;
        }
        const delayMs = jitter(1000 * 2 ** (attempt - 1));
        this.logger.warn(
          `Retrying Jira request ${method} ${url.pathname} in ${Math.round(delayMs)}ms due to ${
            (error as Error).message
          }`,
        );
        await delay(delayMs);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Jira request failed for ${method} ${url.pathname}`);
  }

  private parseRetryAfter(header: string | null): number | undefined {
    if (!header) return undefined;
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return seconds * 1000;
    }
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
      return Math.max(0, date - Date.now());
    }
    return undefined;
  }
}

export const createJiraClient = (options: JiraClientOptions): JiraClient => new JiraClientImpl(options);
