import { createLogger } from './logger.js';
import type { Logger } from './logger.js';
import type { JiraClient, JiraIssue, JiraVersion, ResolvedPluginOptions } from './types.js';

const commentMarker = (versionName: string): string => `[#sr-jira:${versionName}]`;

const formatReleaseDate = (date: Date): string => date.toISOString().split('T')[0];

interface ActionContext {
  client: JiraClient;
  options: ResolvedPluginOptions;
  logger?: Logger;
}

export const ensureVersion = async (
  projectKey: string,
  versionName: string,
  { client, options, logger: providedLogger }: ActionContext,
): Promise<JiraVersion> => {
  const logger = providedLogger ?? createLogger();
  const versions = await client.getProjectVersions(projectKey);
  let version = versions.find((v) => v.name === versionName);

  if (!version) {
    if (options.dryRun) {
      logger.info(`Would create version ${versionName} in project ${projectKey}`);
      version = { id: `dry-${projectKey}-${versionName}`, name: versionName };
    } else {
      version = await client.createVersion(projectKey, versionName);
      logger.info(`Created Jira version ${versionName} in project ${projectKey}`);
    }
  } else {
    logger.debug(`Reusing existing version ${versionName} in project ${projectKey}`);
  }

  if (options.markReleased) {
    const alreadyReleased = version.released === true && Boolean(version.releaseDate);
    if (!alreadyReleased) {
      const releaseDate = formatReleaseDate(new Date());
      if (options.dryRun) {
        logger.info(`Would mark version ${versionName} as released on ${releaseDate}`);
      } else {
        await client.markVersionReleased(version.id, releaseDate);
        logger.info(`Marked version ${versionName} as released on ${releaseDate}`);
      }
      version = { ...version, released: true, releaseDate };
    }
  }

  return version;
};

export const ensureFixVersion = async (
  issue: JiraIssue,
  version: JiraVersion,
  { client, options, logger: providedLogger }: ActionContext,
): Promise<boolean> => {
  const logger = providedLogger ?? createLogger();
  const existingIds = (issue.fields.fixVersions ?? []).map((v) => v.id);
  if (existingIds.includes(version.id)) {
    logger.debug(`Issue ${issue.key} already has fixVersion ${version.name}`);
    return false;
  }

  if (options.dryRun) {
    logger.info(`Would set fixVersion ${version.name} on issue ${issue.key}`);
    return true;
  }

  const updatedIds = [...existingIds, version.id];
  await client.updateIssueFixVersions(issue.key, updatedIds);
  logger.info(`Updated fixVersions for issue ${issue.key} -> ${version.name}`);
  return true;
};

export const ensureComment = async (
  issue: JiraIssue,
  versionName: string,
  { client, options, logger: providedLogger }: ActionContext,
): Promise<boolean> => {
  const logger = providedLogger ?? createLogger();
  const marker = commentMarker(versionName);
  const comments = await client.getIssueComments(issue.key);
  const existing = comments.find((comment) => comment.body.includes(marker));

  if (existing) {
    logger.debug(`Issue ${issue.key} already has release comment for ${versionName}`);
    return false;
  }

  const body = `Resolved in ${versionName} [semantic-release-jira] ${marker}`;
  if (options.dryRun) {
    logger.info(`Would add comment to ${issue.key}: ${body}`);
    return true;
  }

  await client.addIssueComment(issue.key, body);
  logger.info(`Added release comment to issue ${issue.key}`);
  return true;
};

export const ensureTransition = async (
  issue: JiraIssue,
  transitionName: string,
  { client, options, logger: providedLogger }: ActionContext,
): Promise<boolean> => {
  const logger = providedLogger ?? createLogger();
  const normalizedTarget = transitionName.toLowerCase();
  const currentStatus = issue.fields.status;
  const currentStatusName = currentStatus.name.toLowerCase();
  const statusCategory = currentStatus.statusCategory?.key?.toLowerCase();

  if (currentStatusName === normalizedTarget || statusCategory === 'done') {
    logger.debug(`Issue ${issue.key} already in desired status (${currentStatus.name})`);
    return false;
  }

  const transitions = await client.getIssueTransitions(issue.key);
  const targetTransition = transitions.find(
    (transition) =>
      transition.name.toLowerCase() === normalizedTarget ||
      transition.to.name.toLowerCase() === normalizedTarget,
  );

  if (!targetTransition) {
    logger.warn(`No transition named ${transitionName} available for issue ${issue.key}`);
    return false;
  }

  if (options.dryRun) {
    logger.info(`Would transition issue ${issue.key} via ${transitionName}`);
    return true;
  }

  await client.transitionIssue(issue.key, targetTransition.id);
  logger.info(`Transitioned issue ${issue.key} via ${transitionName}`);
  return true;
};
