const { Buffer } = require('node:buffer');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const process = require('node:process');
const { extractErrorMessage } = require('foxts/extract-error-message');
const { wait } = require('foxts/wait');

const targetHost = '127.0.0.1';
const targetPort = 9222;
const frontendHost = 'chrome-devtools-frontend.appspot.com';
const frontendRevision = '69d83ee009fdf624e84ae922a579aee77cf0f071';
const publicHost = new URL(process.env.PUBLIC_URL).host;
const RE_FRONTEND_REVISION = /\/serve_rev\/@[^/]+/g;

function cleanHeaders(headers, host) {
  const cleaned = { ...headers, host };
  delete cleaned.cookie;
  delete cleaned.authorization;
  return cleaned;
}

function relay(upstream, response) {
  const headers = { ...upstream.headers };
  delete headers['set-cookie'];
  response.writeHead(upstream.statusCode ?? 502, headers);
  upstream.pipe(response);
}

function readTargets() {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: targetHost,
        port: targetPort,
        path: '/json/list',
        headers: { host: `${targetHost}:${targetPort}` },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
  });
}

async function waitForRenderer() {
  for (;;) {
    try {
      const targets = await readTargets();
      if (targets.some((target) => target.type === 'page')) return;
    } catch {
      // Electron starts in parallel with this service.
    }
    await wait(250);
  }
}

function redirectToTarget(response) {
  readTargets()
    .then((targets) => {
      const target = targets.find((entry) => entry.type === 'page');
      if (!target) throw new Error('No Electron renderer target');
      const location = `/serve_rev/@${frontendRevision}/devtools_app.html?wss=${publicHost}/devtools/page/${target.id}`;
      response.writeHead(302, { location, 'cache-control': 'no-store' });
      response.end();
    })
    .catch((error) => {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(
        `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="1"><title>LinkCode DevTools</title><p>Waiting for Electron renderer…</p><pre>${extractErrorMessage(error)}</pre>`,
      );
    });
}

const server = http.createServer((request, response) => {
  if (request.url === '/' || request.url.startsWith('/?')) {
    redirectToTarget(response);
    return;
  }

  if (request.url.startsWith('/serve_rev/')) {
    const frontend = https.request(
      {
        hostname: frontendHost,
        path: request.url,
        method: request.method,
        headers: cleanHeaders(request.headers, frontendHost),
      },
      (upstream) => relay(upstream, response),
    );
    frontend.on('error', (error) => {
      response.writeHead(502);
      response.end(extractErrorMessage(error));
    });
    request.pipe(frontend);
    return;
  }

  const proxy = http.request(
    {
      hostname: targetHost,
      port: targetPort,
      path: request.url,
      method: request.method,
      headers: cleanHeaders(request.headers, `${targetHost}:${targetPort}`),
    },
    (upstream) => {
      if (!request.url.startsWith('/json')) {
        relay(upstream, response);
        return;
      }

      const chunks = [];
      upstream.on('data', (chunk) => chunks.push(chunk));
      upstream.on('end', () => {
        const body = Buffer.concat(chunks)
          .toString()
          .replaceAll(RE_FRONTEND_REVISION, `/serve_rev/@${frontendRevision}`)
          .replaceAll('/inspector.html', '/devtools_app.html')
          .replaceAll(`ws://${targetHost}:${targetPort}`, `wss://${publicHost}`)
          .replaceAll(`ws=${targetHost}:${targetPort}`, `wss=${publicHost}`)
          .replaceAll(`https://${frontendHost}`, `https://${publicHost}`);
        const headers = {
          ...upstream.headers,
          'content-length': Buffer.byteLength(body),
        };
        delete headers['set-cookie'];
        response.writeHead(upstream.statusCode ?? 502, headers);
        response.end(body);
      });
    },
  );
  proxy.on('error', (error) => {
    response.writeHead(502);
    response.end(extractErrorMessage(error));
  });
  request.pipe(proxy);
});

server.on('upgrade', (request, socket, head) => {
  const upstream = net.connect(targetPort, targetHost, () => {
    const headers = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      const lowerName = name.toLowerCase();
      if (lowerName === 'origin' || lowerName === 'cookie' || lowerName === 'authorization') {
        continue;
      }
      const value =
        lowerName === 'host' ? `${targetHost}:${targetPort}` : request.rawHeaders[index + 1];
      headers.push(`${name}: ${value}`);
    }
    upstream.write(
      `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`,
    );
    if (head.length > 0) {
      upstream.write(head);
    }
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
});

waitForRenderer()
  .then(() => server.listen(Number(process.env.PORT), targetHost))
  .catch((error) => {
    console.error(extractErrorMessage(error));
    process.exitCode = 1;
  });
