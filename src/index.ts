import { ensureComment, ensureFixVersion, ensureTransition, ensureVersion } from './actions.js';
import { createJiraClient } from './jiraClient.js';
import { createLogger, redact } from './logger.js';
import type { Logger } from './logger.js';
import { extractIssueKeys } from './parse.js';
import type {
  JiraIssue,
  JiraVersion,
  PluginOptions,
  ResolvedPluginOptions,
  SemanticReleaseContext,
} from './types.js';

const DEFAULT_REGEX_SOURCE = '([A-Z][A-Z0-9]+-\\d+)';

type SRPluginFunction = (
  pluginConfig: PluginOptions | undefined,
  context: SemanticReleaseContext,
) => Promise<void>;

const isPrerelease = (context: SemanticReleaseContext, versionName: string): boolean => {
  const channel = context.nextRelease?.channel;
  const branchPrerelease = context.branch?.prerelease;

  if (channel) {
    return true;
  }

  if (branchPrerelease) {
    return true;
  }

  if (/-/.test(versionName)) {
    return true;
  }

  return false;
};

const resolveOptions = (
  pluginConfig: PluginOptions,
  context: SemanticReleaseContext,
  logger?: Logger,
): ResolvedPluginOptions => {
  const baseUrl = pluginConfig.jiraBaseUrl ?? process.env.JIRA_BASE_URL;
  logger?.info('[resolveOptions] jiraBaseUrl raw="%s"', baseUrl ?? '<undefined>');
  if (!baseUrl) {
    throw new Error('jiraBaseUrl must be provided via options or JIRA_BASE_URL environment variable.');
  }

  const regexSource = pluginConfig.issueRegex ?? DEFAULT_REGEX_SOURCE;
  const issueRegex = new RegExp(regexSource, 'gi');

  const transitionName = pluginConfig.transitionName ?? 'Closed';
  const markReleased = pluginConfig.markReleased ?? true;
  const dryRun = pluginConfig.dryRun ?? Boolean(context.options?.dryRun);
  const authModeEnv = process.env.JIRA_AUTH_MODE as ResolvedPluginOptions['authMode'] | undefined;
  const authMode = pluginConfig.authMode ?? authModeEnv ?? 'bearer';

  const timeoutValue = Number(process.env.JIRA_TIMEOUT_MS ?? 10000);
  const timeout = Number.isFinite(timeoutValue) ? timeoutValue : 10000;
  const retriesValue = Number(process.env.JIRA_RATE_MAX_RETRIES ?? 5);
  const maxRetries = Number.isFinite(retriesValue) ? retriesValue : 5;

  const token = process.env.JIRA_TOKEN;
  const username = process.env.JIRA_USERNAME;
  const password = process.env.JIRA_PASSWORD;

  return {
    jiraBaseUrl: baseUrl,
    issueRegex,
    transitionName,
    markReleased,
    versionName: pluginConfig.versionName,
    types: pluginConfig.types,
    dryRun,
    authMode,
    timeout,
    maxRetries,
    token,
    username,
    password,
  };
};

const logResolvedOptions = (
  options: ResolvedPluginOptions,
  logger: Logger,
  context: SemanticReleaseContext,
  phase: 'verifyConditions' | 'success',
  resolvedVersionName?: string,
): void => {
  logger.info(
    '[%s] Jira plugin configuration: baseUrl=%s authMode=%s transition=%s markReleased=%s dryRun=%s timeoutMs=%d maxRetries=%d',
    phase,
    options.jiraBaseUrl,
    options.authMode,
    options.transitionName,
    options.markReleased,
    options.dryRun,
    options.timeout,
    options.maxRetries,
  );

  logger.info(
    '[%s] Release context: versionName=%s issueRegex=%s types=%s',
    phase,
    resolvedVersionName ?? options.versionName ?? context.nextRelease?.version ?? '<unknown>',
    options.issueRegex.source,
    options.types?.join(', ') ?? 'all',
  );

  logger.debug(
    '[%s] Jira credentials (redacted): token=%s username=%s password=%s',
    phase,
    redact(options.token),
    redact(options.username),
    redact(options.password),
  );
};

const buildClient = (options: ResolvedPluginOptions, context: SemanticReleaseContext) =>
  createJiraClient({
    baseUrl: options.jiraBaseUrl,
    token: options.token,
    username: options.username,
    password: options.password,
    authMode: options.authMode,
    timeout: options.timeout,
    maxRetries: options.maxRetries,
    logger: createLogger(context),
  });

const validateAuth = (options: ResolvedPluginOptions): void => {
  if (options.authMode === 'bearer') {
    if (!options.token) {
      throw new Error('JIRA_TOKEN is required for bearer authentication.');
    }
  } else {
    if (!options.username || !options.password) {
      throw new Error('JIRA_USERNAME and JIRA_PASSWORD are required for basic authentication.');
    }
  }
};

const verifyConditions: SRPluginFunction = async (pluginConfig, context) => {
  const logger = createLogger(context);
  const options = resolveOptions(pluginConfig ?? {}, context, logger);
  validateAuth(options);
  logResolvedOptions(options, logger, context, 'verifyConditions');
  logger.info('Verifying Jira configuration at %s with auth mode %s', options.jiraBaseUrl, options.authMode);

  try {
    const client = buildClient(options, context);
    await client.getServerInfo();
    logger.success(`Connected to Jira at ${options.jiraBaseUrl}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to verify Jira connectivity: %s', message);
    throw new Error(`Unable to verify Jira configuration: ${message}`);
  }
};

const success: SRPluginFunction = async (pluginConfig, context) => {
  const logger = createLogger(context);
  const options = resolveOptions(pluginConfig ?? {}, context, logger);
  validateAuth(options);

  const versionName = options.versionName ?? context.nextRelease?.version;
  if (!versionName) {
    throw new Error('semantic-release did not provide nextRelease.version and no versionName override was supplied.');
  }

  logResolvedOptions(options, logger, context, 'success', versionName);

  if (isPrerelease(context, versionName)) {
    logger.info('Detected pre-release %s; skipping Jira synchronization.', versionName);
    return;
  }

  if (!context.commits || context.commits.length === 0) {
    logger.info('No commits provided by semantic-release; skipping Jira updates.');
    return;
  }

  const issueKeys = extractIssueKeys(context.commits, options.issueRegex);
  if (issueKeys.length === 0) {
    logger.info('No Jira issue keys found in commits; nothing to do.');
    return;
  }

  const client = buildClient(options, context);
  logger.info(
    `Processing ${issueKeys.length} Jira issues for release ${versionName}${options.dryRun ? ' (dry-run)' : ''}`,
  );

  const issues: JiraIssue[] = [];
  for (const issueKey of issueKeys) {
    try {
      const issue = await client.getIssue(issueKey);
      if (options.types && !options.types.includes(issue.fields.issuetype.name)) {
        logger.info(`Skipping issue ${issueKey} of type ${issue.fields.issuetype.name}`);
        continue;
      }
      issues.push(issue);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to load Jira issue ${issueKey}: ${message}`);
    }
  }

  if (issues.length === 0) {
    logger.info('No Jira issues remain after filtering; nothing to do.');
    return;
  }

  const projectVersions = new Map<string, JiraVersion>();
  const actionContext = {
    client,
    options,
    logger,
  };

  for (const issue of issues) {
    const projectKey = issue.fields.project.key;
    if (!projectVersions.has(projectKey)) {
      const version = await ensureVersion(projectKey, versionName, actionContext);
      projectVersions.set(projectKey, version);
    }
  }

  for (const issue of issues) {
    const projectKey = issue.fields.project.key;
    const version = projectVersions.get(projectKey);
    if (!version) {
      logger.warn(`No version cached for project ${projectKey}; skipping issue ${issue.key}`);
      continue;
    }

    await ensureFixVersion(issue, version, actionContext);
    await ensureComment(issue, versionName, actionContext);
    await ensureTransition(issue, options.transitionName, actionContext);
  }

  logger.success(
    `Jira synchronization for version ${versionName} completed${options.dryRun ? ' (dry-run)' : ''}.`,
  );
};

export default { verifyConditions, success };
