import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

const dataPath = new URL('./data.json', import.meta.url);
const initialState = JSON.parse(await readFile(dataPath, 'utf8'));

const projects = new Map(Object.entries(initialState.projects));
const issues = new Map(Object.entries(initialState.issues));

const findVersion = (versionId) => {
  for (const project of projects.values()) {
    const version = project.versions.find((item) => item.id === versionId);
    if (version) {
      return version;
    }
  }
  return undefined;
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(payload));
};

const parseBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) {
    return undefined;
  }
  return JSON.parse(buffer.toString('utf8'));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost:8080');

  if (url.pathname === '/health') {
    return sendJson(res, 200, { ok: true });
  }

  if (!req.headers.authorization) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing Authorization header' }));
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/rest/api/2/serverInfo') {
      return sendJson(res, 200, { baseUrl: 'http://mock-jira:8080', version: '9.0.0' });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/rest/api/2/project/')) {
      const [, , , projectKey, ,] = url.pathname.split('/');
      const project = projects.get(projectKey);
      if (!project) {
        return sendJson(res, 404, { error: `Unknown project ${projectKey}` });
      }
      return sendJson(res, 200, project.versions);
    }

    if (req.method === 'POST' && url.pathname === '/rest/api/2/version') {
      const body = await parseBody(req);
      const projectKey = body?.project;
      const name = body?.name;
      if (!projectKey || !name) {
        return sendJson(res, 400, { error: 'project and name are required' });
      }
      const project = projects.get(projectKey);
      if (!project) {
        return sendJson(res, 404, { error: `Unknown project ${projectKey}` });
      }
      const version = {
        id: randomUUID(),
        name,
        released: false,
      };
      project.versions.push(version);
      return sendJson(res, 201, version);
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/rest/api/2/version/')) {
      const versionId = url.pathname.split('/').at(-1);
      const version = findVersion(versionId);
      if (!version) {
        return sendJson(res, 404, { error: `Unknown version ${versionId}` });
      }
      const body = await parseBody(req);
      if (body?.released) {
        version.released = true;
        version.releaseDate = body.releaseDate ?? new Date().toISOString().slice(0, 10);
      }
      return sendJson(res, 200, version);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/rest/api/2/issue/')) {
      const [ , , , issueKey, ...rest ] = url.pathname.split('/');
      const issue = issues.get(issueKey);
      if (!issue) {
        return sendJson(res, 404, { error: `Unknown issue ${issueKey}` });
      }
      if (rest[0] === 'comment') {
        return sendJson(res, 200, { comments: issue.comments });
      }
      if (rest[0] === 'transitions') {
        return sendJson(res, 200, { transitions: issue.transitions });
      }
      return sendJson(res, 200, issue);
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/rest/api/2/issue/')) {
      const issueKey = url.pathname.split('/')[4];
      const issue = issues.get(issueKey);
      if (!issue) {
        return sendJson(res, 404, { error: `Unknown issue ${issueKey}` });
      }
      const body = await parseBody(req);
      const fixVersions = body?.fields?.fixVersions ?? [];
      issue.fields.fixVersions = fixVersions.map((item) => ({ id: item.id, name: findVersion(item.id)?.name ?? item.id }));
      return sendJson(res, 204, {});
    }

    if (req.method === 'POST' && url.pathname.endsWith('/comment')) {
      const issueKey = url.pathname.split('/')[4];
      const issue = issues.get(issueKey);
      if (!issue) {
        return sendJson(res, 404, { error: `Unknown issue ${issueKey}` });
      }
      const body = await parseBody(req);
      const comment = { id: randomUUID(), body: body?.body ?? '' };
      issue.comments.push(comment);
      return sendJson(res, 201, comment);
    }

    if (req.method === 'POST' && url.pathname.endsWith('/transitions')) {
      const issueKey = url.pathname.split('/')[4];
      const issue = issues.get(issueKey);
      if (!issue) {
        return sendJson(res, 404, { error: `Unknown issue ${issueKey}` });
      }
      const body = await parseBody(req);
      const transitionId = body?.transition?.id;
      const transition = issue.transitions.find((item) => item.id === transitionId);
      if (!transition) {
        return sendJson(res, 400, { error: `Unknown transition ${transitionId} for issue ${issueKey}` });
      }
      issue.fields.status = transition.to;
      return sendJson(res, 204, {});
    }

    sendJson(res, 404, { error: `Unhandled route ${req.method} ${url.pathname}` });
  } catch (error) {
    console.error('Mock Jira error', error);
    sendJson(res, 500, { error: error.message ?? 'Unexpected error' });
  }
});

server.listen(8080, () => {
  console.log('Mock Jira server listening on http://0.0.0.0:8080');
});
