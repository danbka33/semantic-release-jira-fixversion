# semantic-release-jira-fixversion

A production-ready [semantic-release](https://semantic-release.gitbook.io/) plugin that synchronizes releases with Jira Server/Data Center. The plugin automatically creates Jira Versions across affected projects, adds fixVersions and release comments to issues referenced in commits, and transitions them to "Closed" (configurable).

## Features

- ✅ Works with multiple Jira projects in a single repository.
- ✅ Finds issue keys from semantic-release commit metadata (no git parsing).
- ✅ Creates or reuses Jira Versions per project and optionally marks them as released.
- ✅ Adds idempotent release comments and fixVersions to each referenced issue.
- ✅ Transitions issues to a configurable workflow state when available.
- ✅ Supports dry-run mode, bearer or basic authentication, configurable regex and issue-type filtering.
- ✅ Resilient HTTP client with retries, backoff, and timeout controls.

## Requirements

- Node.js 20+
- semantic-release 20+
- Jira Server or Data Center with REST API access

## Installation

```bash
npm install --save-dev semantic-release-jira-fixversion
```

## Environment Variables

Create a `.env` (or configure your CI environment) with the following variables:

```ini
JIRA_BASE_URL=https://jira.example.com
JIRA_TOKEN=<token>                # Required for bearer auth
JIRA_USERNAME=<optional>          # Required for basic auth
JIRA_PASSWORD=<optional>          # Required for basic auth
JIRA_TIMEOUT_MS=10000             # Optional request timeout (ms)
JIRA_RATE_MAX_RETRIES=5           # Optional max retry attempts
```

Set `JIRA_AUTH_MODE=basic` if you want to use basic authentication; bearer tokens are used by default.

## Usage

Add the plugin to your `release.config.js` (or `.releaserc`):

```js
module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    // ... other plugins (changelog, git, npm, etc.)
    [
      'semantic-release-jira-fixversion',
      {
        jiraBaseUrl: process.env.JIRA_BASE_URL,
        transitionName: 'Closed',
        markReleased: true,
        // versionPrefix: 'bdd-integration-', // optional release name prefix
        // issueRegex: '([A-Z][A-Z0-9]+-\\d+)', // optional override
        // types: ['Bug', 'Story'],
      },
    ],
  ],
};
```

semantic-release passes the collected commits and the next release version to the plugin. For each unique Jira issue key matching the configurable regex, the plugin:

1. Determines the Jira project and ensures a Version exists with the release name.
2. Adds the version to the issue's `fixVersions` field (idempotent).
3. Appends a stable release comment with marker `[#sr-jira:<version>]`.
4. Transitions the issue to the configured state (defaults to `Closed`) when available.

### Pre-releases

When semantic-release marks a release as a pre-release (for example, channel `beta` or version `1.2.0-beta.1`),
the plugin skips Jira updates entirely. Only full releases trigger version creation, fixVersions, comments, and
transitions.

### Dry Run

Dry runs are supported via semantic-release's `--dry-run` flag or the plugin option `dryRun: true`. In dry-run mode, the plugin fetches data but only logs the actions it *would* perform (version creation, fixVersion updates, comments, and transitions).

### Authentication

- **Bearer (default):** Requires `JIRA_TOKEN`. The plugin sends `Authorization: Bearer <token>`.
- **Basic:** Set `authMode: 'basic'` in plugin options or `JIRA_AUTH_MODE=basic`. Requires `JIRA_USERNAME` and `JIRA_PASSWORD`.

### Jira Versions

A separate Jira Version is ensured for every project represented in the commits. When `markReleased` is true (default), the version is marked as released with today's date once created or reused.

### Issue Filters

Use the `types` option to restrict processing to specific Jira issue types (e.g., `['Bug', 'Story']`). All issue types are processed by default.

### Custom Issue Regex

Override the issue key detection with the `issueRegex` option (string). The default is `([A-Z][A-Z0-9]+-\d+)` and is applied case-insensitively.

### Version Prefix

Use the `versionPrefix` option to prepend a stable identifier to the release name (for example, to distinguish
microservices in a monorepo). When set to `bdd-integration-` and the release version is `1.9.0`, the Jira version
created and referenced will be `bdd-integration-1.9.0`. The default prefix is empty.

## GitLab CI Example

Add a release job to `.gitlab-ci.yml`:

```yaml
stages: [release]

release:
  image: node:20
  stage: release
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
  script:
    - npm ci
    - npx semantic-release
  variables:
    GIT_AUTHOR_NAME: "CI"
    GIT_AUTHOR_EMAIL: "ci@example.com"
    GIT_COMMITTER_NAME: "CI"
    GIT_COMMITTER_EMAIL: "ci@example.com"
```

Ensure the necessary Jira environment variables are stored as masked CI variables.

## Troubleshooting

- **Missing credentials:** Verify `JIRA_TOKEN` (bearer) or `JIRA_USERNAME`/`JIRA_PASSWORD` (basic) are available in the environment.
- **Transition not found:** The plugin logs when the requested transition is unavailable; double-check the workflow name and permissions.
- **Rate limiting:** Retries are automatic for `429` and `5xx` responses with exponential backoff. Adjust `JIRA_RATE_MAX_RETRIES` or `JIRA_TIMEOUT_MS` if needed.
- **No issues detected:** Confirm commit messages include Jira keys that match the regex (`PROJECT-123`).

## Development

- `npm run lint` – ESLint with TypeScript and import rules
- `npm test` – Jest unit tests
- `npm run build` – Compiles TypeScript to `dist/`

The library is published as an ES module and exposes its semantic-release hooks via `dist/index.js`.

### Local semantic-release testing with Docker Compose

You can exercise the plugin end-to-end without hitting a real Jira instance by using the bundled Docker Compose setup. It
starts a lightweight mock Jira API and runs `semantic-release` inside a Node.js container against the current repository.

1. Copy the example environment file and adjust credentials if needed:

   ```bash
   cp .env.example .env.local
   ```

   The defaults use the mock server with a bearer token of `mock-token`. Switch to basic auth by uncommenting the
   corresponding lines.

2. Ensure you have at least one commit that references a Jira issue key (for example, `TEST-123`) and that you are on the
   `main` branch. `semantic-release` requires a Git tag history; you can initialize it with:

   ```bash
   git tag v0.9.0
   ```

3. Build the TypeScript sources so the plugin is available at `dist/index.js`:

   ```bash
   npm run build
   ```

4. Run the semantic-release container. This will automatically start the mock Jira service and execute a release using the
   configuration in `release.config.cjs`:

   ```bash
   docker compose up --build semantic-release
   ```

   The command installs dependencies inside the container on first run, compiles the plugin, and then calls `semantic-release
   --no-ci`. Logs from both the mock Jira API and semantic-release are streamed to your terminal.

5. To iterate quickly, you can re-run the release without rebuilding the images:

   ```bash
   docker compose run --rm semantic-release
   ```

6. When finished, stop the services and clean up volumes:

   ```bash
   docker compose down --volumes
   ```

The mock Jira server persists data only for the life of the container. Restarting the stack restores the initial state defined
in `docker/mock-jira/data.json`.
