import plugin from '../src/index.js';
import type { SemanticReleaseContext, SemanticReleaseLogger } from '../src/types.js';

const createLogger = (): jest.Mocked<SemanticReleaseLogger> => ({
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
});

const createContext = (
  overrides: Partial<SemanticReleaseContext> = {},
): SemanticReleaseContext & { logger: jest.Mocked<SemanticReleaseLogger> } => {
  const logger = createLogger();

  return {
    logger,
    options: {},
    commits: [{ message: 'feat: TEST-123 add prerelease check' }],
    nextRelease: { version: '1.0.0' },
    ...overrides,
  } as SemanticReleaseContext & { logger: jest.Mocked<SemanticReleaseLogger> };
};

describe('success prerelease handling', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      JIRA_BASE_URL: 'https://jira.example.com',
      JIRA_TOKEN: 'secret-token-value',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('skips Jira synchronization when branch prerelease is set', async () => {
    const context = createContext({
      branch: { prerelease: 'beta' },
      nextRelease: { version: '1.2.0-beta.1' },
    });

    await plugin.success?.({}, context);

    expect(context.logger.log).toHaveBeenCalledWith(
      'Detected pre-release %s; skipping Jira synchronization.',
      '1.2.0-beta.1',
    );
    expect(context.logger.log).not.toHaveBeenCalledWith(
      expect.stringContaining('Processing'),
      expect.anything(),
    );
  });

  it('skips Jira synchronization when nextRelease.channel is set', async () => {
    const context = createContext({
      nextRelease: { version: '1.0.0', channel: 'next' },
    });

    await plugin.success?.({}, context);

    expect(context.logger.log).toHaveBeenCalledWith(
      'Detected pre-release %s; skipping Jira synchronization.',
      '1.0.0',
    );
  });

  it('skips Jira synchronization when version contains prerelease suffix', async () => {
    const context = createContext({
      nextRelease: { version: '2.0.0-rc.1' },
    });

    await plugin.success?.({}, context);

    expect(context.logger.log).toHaveBeenCalledWith(
      'Detected pre-release %s; skipping Jira synchronization.',
      '2.0.0-rc.1',
    );
  });

  it('does not treat normal releases as prereleases', async () => {
    const context = createContext({
      commits: [],
      nextRelease: { version: '1.0.0' },
    });

    await plugin.success?.({}, context);

    expect(context.logger.log).not.toHaveBeenCalledWith(
      'Detected pre-release %s; skipping Jira synchronization.',
      expect.anything(),
    );
    expect(context.logger.log).toHaveBeenCalledWith(
      'No commits provided by semantic-release; skipping Jira updates.',
    );
  });

  it('applies versionPrefix to the resolved release version in logs', async () => {
    const context = createContext({
      commits: [],
      nextRelease: { version: '1.0.0' },
    });

    await plugin.success?.({ versionPrefix: 'release-' }, context);

    expect(context.logger.log).toHaveBeenCalledWith(
      '[%s] Release context: versionName=%s issueRegex=%s types=%s',
      'success',
      'release-1.0.0',
      '([A-Z][A-Z0-9]+-\\d+)',
      'all',
    );
  });

  it('does not duplicate versionPrefix when version already starts with it', async () => {
    const context = createContext({
      commits: [],
      nextRelease: { version: 'release-1.0.0' },
    });

    await plugin.success?.({ versionPrefix: 'release-' }, context);

    expect(context.logger.log).toHaveBeenCalledWith(
      '[%s] Release context: versionName=%s issueRegex=%s types=%s',
      'success',
      'release-1.0.0',
      '([A-Z][A-Z0-9]+-\\d+)',
      'all',
    );
  });

  it('normalizes jiraBaseUrl by trimming and removing trailing slashes', async () => {
    process.env.JIRA_BASE_URL = '  https://jira.example.com///  ';
    const context = createContext({
      commits: [],
      nextRelease: { version: '1.0.0' },
    });

    await plugin.success?.({}, context);

    expect(context.logger.log).toHaveBeenCalledWith(
      '[resolveOptions] jiraBaseUrl raw="%s" trimmed="%s"',
      '  https://jira.example.com///  ',
      'https://jira.example.com///',
    );
    expect(context.logger.log).toHaveBeenCalledWith(
      '[%s] Jira plugin configuration: baseUrl=%s authMode=%s transition=%s markReleased=%s dryRun=%s timeoutMs=%d maxRetries=%d versionPrefix=%s',
      'success',
      'https://jira.example.com',
      'bearer',
      'Closed',
      true,
      false,
      10000,
      5,
      '<empty>',
    );
  });

  it('throws when jiraBaseUrl is not a valid URL', async () => {
    process.env.JIRA_BASE_URL = 'not a valid url';
    const context = createContext();

    await expect(plugin.success?.({}, context)).rejects.toThrow('jiraBaseUrl is not a valid URL');
  });
});
