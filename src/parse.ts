export interface CommitLike {
  message?: string;
  subject?: string;
  body?: string;
}

export const DEFAULT_ISSUE_REGEX = /([A-Z][A-Z0-9]+-\d+)/g;

const collectText = (commit: CommitLike): string => {
  const parts = [commit.message, commit.subject, commit.body].filter(Boolean);
  return parts.join('\n');
};

export const extractIssueKeys = (
  commits: CommitLike[],
  regex: RegExp = DEFAULT_ISSUE_REGEX,
): string[] => {
  const keys = new Set<string>();

  for (const commit of commits) {
    const text = collectText(commit);
    if (!text) continue;

    const matches = text.match(regex);
    if (matches) {
      for (const match of matches) {
        keys.add(match.toUpperCase());
      }
    }
  }

  return Array.from(keys).sort();
};

export const groupIssueKeysByProject = (issueKeys: string[]): Map<string, string[]> => {
  const groups = new Map<string, string[]>();

  for (const key of issueKeys) {
    const [projectKey] = key.split('-');
    if (!projectKey) continue;
    const normalized = projectKey.toUpperCase();
    const current = groups.get(normalized) ?? [];
    current.push(key);
    groups.set(normalized, current);
  }

  return groups;
};
