import { extractIssueKeys, groupIssueKeysByProject } from '../src/parse.js';
import type { CommitLike } from '../src/parse.js';

describe('parse utilities', () => {
  it('extracts unique issue keys from commit messages', () => {
    const commits: CommitLike[] = [
      { message: 'feat: add feature ABC-123 and def-456' },
      { subject: 'fix: handle xyz ABC-123, XYZ-9' },
      { body: 'docs: update for QWE-1' },
    ];

    const keys = extractIssueKeys(commits);
    expect(keys).toEqual(['ABC-123', 'QWE-1', 'XYZ-9']);
  });

  it('groups issue keys by project', () => {
    const grouped = groupIssueKeysByProject(['ABC-1', 'ABC-2', 'XYZ-9']);
    expect(grouped.get('ABC')).toEqual(['ABC-1', 'ABC-2']);
    expect(grouped.get('XYZ')).toEqual(['XYZ-9']);
  });
});
