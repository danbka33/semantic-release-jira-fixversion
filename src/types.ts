export type AuthMode = 'bearer' | 'basic';

export interface SemanticReleaseLogger {
  log(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  success?: (message: string, ...args: unknown[]) => void;
}

export interface SemanticReleaseCommit {
  message?: string;
  subject?: string;
  body?: string;
}

export interface SemanticReleaseContext {
  logger: SemanticReleaseLogger;
  options?: {
    dryRun?: boolean;
  };
  branch?: {
    prerelease?: string | boolean;
  };
  commits?: SemanticReleaseCommit[];
  nextRelease?: {
    version?: string;
    channel?: string | false;
  };
}

export interface PluginOptions {
  jiraBaseUrl?: string;
  issueRegex?: string;
  transitionName?: string;
  markReleased?: boolean;
  versionName?: string;
  types?: string[];
  dryRun?: boolean;
  authMode?: AuthMode;
}

export interface ResolvedPluginOptions {
  jiraBaseUrl: string;
  issueRegex: RegExp;
  transitionName: string;
  markReleased: boolean;
  versionName?: string;
  types?: string[];
  dryRun: boolean;
  authMode: AuthMode;
  timeout: number;
  maxRetries: number;
  token?: string;
  username?: string;
  password?: string;
}

export interface JiraVersion {
  id: string;
  name: string;
  released?: boolean;
  releaseDate?: string;
}

export interface JiraProject {
  id: string;
  key: string;
  versions?: JiraVersion[];
}

export interface JiraIssueFields {
  project: { key: string };
  fixVersions?: JiraVersion[];
  issuetype: { name: string };
  status: { name: string; statusCategory?: { key: string } };
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: JiraIssueFields;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string; statusCategory?: { key: string } };
}

export interface JiraComment {
  id: string;
  body: string;
}

export interface JiraClient {
  getServerInfo(): Promise<void>;
  getProjectVersions(projectKey: string): Promise<JiraVersion[]>;
  createVersion(projectKey: string, versionName: string): Promise<JiraVersion>;
  markVersionReleased(versionId: string, releaseDate: string): Promise<void>;
  getIssue(issueKey: string): Promise<JiraIssue>;
  updateIssueFixVersions(issueKey: string, versionIds: string[]): Promise<void>;
  getIssueComments(issueKey: string): Promise<JiraComment[]>;
  addIssueComment(issueKey: string, body: string): Promise<void>;
  getIssueTransitions(issueKey: string): Promise<JiraTransition[]>;
  transitionIssue(issueKey: string, transitionId: string): Promise<void>;
}
