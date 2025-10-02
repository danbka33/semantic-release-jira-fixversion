module.exports = {
  branches: ['main'],
  repositoryUrl: 'https://github.com/danbka33/semantic-release-jira-fixversion.git',
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/npm',
    '@semantic-release/github',
  ],
};
