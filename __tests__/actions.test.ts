import { ensureComment, ensureFixVersion, ensureTransition, ensureVersion } from '../src/actions.js';
import type { JiraClient, JiraIssue, ResolvedPluginOptions } from '../src/types.js';

const baseOptions: ResolvedPluginOptions = {
  jiraBaseUrl: 'https://example.com',
  issueRegex: /ABC/,
  transitionName: 'Closed',
  markReleased: true,
  dryRun: false,
  authMode: 'bearer',
  timeout: 1000,
  maxRetries: 1,
};

const createLogger = () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
});

const createIssue = (overrides: Partial<JiraIssue> = {}): JiraIssue => ({
  id: '1',
  key: 'ABC-1',
  fields: {
    project: { key: 'ABC' },
    fixVersions: [],
    issuetype: { name: 'Bug' },
    status: { name: 'Open', statusCategory: { key: 'to-do' } },
  },
  ...overrides,
});

const createClient = (overrides: Partial<JiraClient>): JiraClient => ({
  getServerInfo: jest.fn(),
  getProjectVersions: jest.fn().mockResolvedValue([]),
  createVersion: jest.fn(),
  markVersionReleased: jest.fn(),
  getIssue: jest.fn(),
  updateIssueFixVersions: jest.fn(),
  getIssueComments: jest.fn().mockResolvedValue([]),
  addIssueComment: jest.fn(),
  getIssueTransitions: jest.fn().mockResolvedValue([]),
  transitionIssue: jest.fn(),
  ...overrides,
});

describe('actions', () => {
  it('creates versions in dry-run mode without calling Jira', async () => {
    const client = createClient({ getProjectVersions: jest.fn().mockResolvedValue([]) });
    const options = { ...baseOptions, dryRun: true };
    const version = await ensureVersion('ABC', '1.0.0', { client, options, logger: createLogger() });
    expect(version.id).toContain('dry-ABC-1.0.0');
    expect(client.createVersion).not.toHaveBeenCalled();
  });

  it('skips fix version update when already present', async () => {
    const issue = createIssue({
      fields: {
        project: { key: 'ABC' },
        fixVersions: [{ id: '1', name: '1.0.0' }],
        issuetype: { name: 'Bug' },
        status: { name: 'Open', statusCategory: { key: 'to-do' } },
      },
    });
    const client = createClient({});
    const changed = await ensureFixVersion(issue, { id: '1', name: '1.0.0' }, {
      client,
      options: baseOptions,
      logger: createLogger(),
    });
    expect(changed).toBe(false);
    expect(client.updateIssueFixVersions).not.toHaveBeenCalled();
  });

  it('avoids duplicate comments when marker exists', async () => {
    const client = createClient({
      getIssueComments: jest
        .fn()
        .mockResolvedValue([{ id: 'c1', body: 'Resolved in 1.0.0 [semantic-release-jira] [#sr-jira:1.0.0]' }]),
    });
    const issue = createIssue();
    const changed = await ensureComment(issue, '1.0.0', { client, options: baseOptions, logger: createLogger() });
    expect(changed).toBe(false);
    expect(client.addIssueComment).not.toHaveBeenCalled();
  });

  it('skips transition when already done', async () => {
    const issue = createIssue({
      fields: {
        project: { key: 'ABC' },
        fixVersions: [],
        issuetype: { name: 'Bug' },
        status: { name: 'Closed', statusCategory: { key: 'done' } },
      },
    });
    const client = createClient({});
    const changed = await ensureTransition(issue, 'Closed', {
      client,
      options: baseOptions,
      logger: createLogger(),
    });
    expect(changed).toBe(false);
    expect(client.transitionIssue).not.toHaveBeenCalled();
  });
});
