import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { validatePortEnv, validateRuntimeEnv } from '../src/lib/env.mjs';

const DEFAULT_PUBLIC_PORT = 3000;
const DEFAULT_NEXT_INTERNAL_PORT = 3001;
const DEFAULT_COLLAB_INTERNAL_PORT = 1234;
const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 25_000;

function resolvePort(name, rawValue, fallback) {
  const check = validatePortEnv(name, rawValue);
  if (!check.valid) {
    throw new Error(`[ProdEntrypoint] Invalid ${name}: ${check.error}`);
  }
  return check.port ?? fallback;
}

function resolveNextEntrypoint(cwd) {
  const standaloneDirect = path.resolve(cwd, 'server.js');
  const standaloneNested = path.resolve(cwd, '.next', 'standalone', 'server.js');
  const nextCli = path.resolve(cwd, 'node_modules', 'next', 'dist', 'bin', 'next');

  if (fs.existsSync(standaloneDirect)) {
    return { script: standaloneDirect, args: [], mode: 'standalone' };
  }
  if (fs.existsSync(standaloneNested)) {
    return { script: standaloneNested, args: [], mode: 'standalone-nested' };
  }
  if (fs.existsSync(nextCli)) {
    return { script: nextCli, args: ['start'], mode: 'next-start' };
  }

  throw new Error(
    '[ProdEntrypoint] Unable to locate Next.js standalone server.js or next CLI binary.'
  );
}

function waitForTcpPort(host, port, timeoutMs, shouldAbort) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (shouldAbort()) {
        reject(new Error(`Aborted waiting for ${host}:${port} because a process exited.`));
        return;
      }

      const socket = net.connect({ host, port });
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${host}:${port} after ${timeoutMs}ms.`));
          return;
        }
        setTimeout(attempt, 150);
      });
    };

    attempt();
  });
}

function buildUpgradeRawRequest(req, socket) {
  const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
  let hasXff = false;
  let hasXfp = false;

  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i];
    const value = req.rawHeaders[i + 1];
    const lower = name.toLowerCase();
    if (lower === 'x-forwarded-for') hasXff = true;
    if (lower === 'x-forwarded-proto') hasXfp = true;
    lines.push(`${name}: ${value}`);
  }

  if (!hasXff && socket.remoteAddress) {
    lines.push(`X-Forwarded-For: ${socket.remoteAddress}`);
  }
  if (!hasXfp) {
    lines.push('X-Forwarded-Proto: http');
  }

  return `${lines.join('\r\n')}\r\n\r\n`;
}

function forwardWebSocketUpgrade(req, socket, head, targetHost, targetPort, activeSockets) {
  activeSockets.add(socket);
  socket.once('close', () => activeSockets.delete(socket));

  const upstream = net.connect({ host: targetHost, port: targetPort });
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    socket.destroy();
    upstream.destroy();
  };

  upstream.once('connect', () => {
    socket.setNoDelay(true);
    upstream.setNoDelay(true);
    socket.setTimeout(0);
    upstream.setTimeout(0);

    upstream.write(buildUpgradeRawRequest(req, socket));
    if (head && head.length > 0) {
      upstream.write(head);
    }

    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.once('error', (err) => {
    console.warn(`[ProdEntrypoint] WebSocket upstream error: ${err.message}`);
    if (!socket.destroyed) {
      try {
        socket.write(
          'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nBad Gateway\r\n'
        );
      } catch {}
    }
    cleanup();
  });

  socket.once('error', cleanup);
  upstream.once('close', cleanup);
  socket.once('close', cleanup);
}

function forwardHttpRequest(req, res, targetHost, targetPort) {
  const isSse =
    req.headers.accept?.includes('text/event-stream') ||
    req.url?.includes('/pages/events');

  if (isSse) {
    req.socket?.setNoDelay(true);
    res.socket?.setNoDelay(true);
    req.setTimeout(0);
  }

  const headers = { ...req.headers };
  if (req.socket?.remoteAddress) {
    headers['x-forwarded-for'] = headers['x-forwarded-for']
      ? `${headers['x-forwarded-for']}, ${req.socket.remoteAddress}`
      : req.socket.remoteAddress;
  }
  if (!headers['x-forwarded-proto']) {
    headers['x-forwarded-proto'] = 'http';
  }
  if (!headers['x-forwarded-host'] && req.headers.host) {
    headers['x-forwarded-host'] = req.headers.host;
  }

  const upstreamReq = http.request(
    {
      host: targetHost,
      port: targetPort,
      path: req.url,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.setTimeout(isSse ? 0 : 60_000, () => {
    upstreamReq.destroy(new Error('Upstream HTTP request timeout'));
  });

  upstreamReq.on('error', (err) => {
    console.error(`[ProdEntrypoint] HTTP upstream error (${req.url}): ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upstream application unavailable' }));
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  res.on('close', () => {
    if (!res.writableEnded) {
      upstreamReq.destroy();
    }
  });

  req.pipe(upstreamReq);
}

async function main() {
  validateRuntimeEnv({ target: 'all', throwOnError: true });

  const cwd = process.cwd();
  const bindHost = process.env.HOSTNAME || '0.0.0.0';
  const publicPort = resolvePort('PORT', process.env.PORT, DEFAULT_PUBLIC_PORT);
  const collabInternalPort = resolvePort(
    'COLLAB_PORT',
    process.env.COLLAB_PORT,
    DEFAULT_COLLAB_INTERNAL_PORT
  );
  const nextDefaultInternal =
    publicPort === DEFAULT_NEXT_INTERNAL_PORT ? DEFAULT_NEXT_INTERNAL_PORT + 1 : DEFAULT_NEXT_INTERNAL_PORT;
  const nextInternalPort = resolvePort(
    'NEXT_INTERNAL_PORT',
    process.env.NEXT_INTERNAL_PORT,
    nextDefaultInternal
  );
  const collabPublicPort = process.env.COLLAB_PUBLIC_PORT
    ? resolvePort('COLLAB_PUBLIC_PORT', process.env.COLLAB_PUBLIC_PORT, null)
    : null;

  if (
    nextInternalPort === publicPort ||
    nextInternalPort === collabInternalPort ||
    (collabPublicPort !== null &&
      (collabPublicPort === publicPort ||
        collabPublicPort === nextInternalPort ||
        collabPublicPort === collabInternalPort))
  ) {
    throw new Error(
      `[ProdEntrypoint] Internal/public ports must be distinct (PORT=${publicPort}, NEXT_INTERNAL_PORT=${nextInternalPort}, COLLAB_PORT=${collabInternalPort}, COLLAB_PUBLIC_PORT=${collabPublicPort ?? 'unset'}).`
    );
  }

  const nextEntry = resolveNextEntrypoint(cwd);
  const collabEntry = path.resolve(cwd, 'src', 'server', 'collab-server.mjs');
  if (!fs.existsSync(collabEntry)) {
    throw new Error(`[ProdEntrypoint] Collaboration server entrypoint missing: ${collabEntry}`);
  }

  let shuttingDown = false;
  let unexpectedExit = false;
  let publicServer = null;
  let collabPublicServer = null;
  const activeWsSockets = new Set();

  console.log(
    `[ProdEntrypoint] Starting Next.js (${nextEntry.mode} on 127.0.0.1:${nextInternalPort}) and CollabServer (127.0.0.1:${collabInternalPort})...`
  );

  const nextChild = spawn(process.execPath, [nextEntry.script, ...nextEntry.args], {
    cwd,
    env: {
      ...process.env,
      HOSTNAME: '127.0.0.1',
      PORT: String(nextInternalPort),
      COLLAB_PORT: String(collabInternalPort),
    },
    stdio: 'inherit',
  });

  const collabChild = spawn(process.execPath, [collabEntry], {
    cwd,
    env: {
      ...process.env,
      COLLAB_HOST: '127.0.0.1',
      COLLAB_PORT: String(collabInternalPort),
    },
    stdio: 'inherit',
  });

  const waitForExit = (child) =>
    new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve({ code: child.exitCode, signal: child.signalCode });
        return;
      }
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });

  const shutdown = async (reason, exitCodeOverride = null) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[ProdEntrypoint] Shutting down (${reason})...`);

    const closeHttpServer = (srv) =>
      new Promise((resolve) => {
        if (!srv || !srv.listening) {
          resolve();
          return;
        }
        srv.close(() => resolve());
        srv.closeIdleConnections?.();
      });

    await Promise.all([
      closeHttpServer(publicServer),
      closeHttpServer(collabPublicServer),
    ]);

    for (const sock of activeWsSockets) {
      try {
        sock.end();
      } catch {}
    }

    if (collabChild.exitCode === null && collabChild.signalCode === null) {
      collabChild.kill('SIGTERM');
    }
    if (nextChild.exitCode === null && nextChild.signalCode === null) {
      nextChild.kill('SIGTERM');
    }

    const forceTimer = setTimeout(() => {
      console.warn('[ProdEntrypoint] Shutdown timeout exceeded; sending SIGKILL to remaining children.');
      for (const sock of activeWsSockets) {
        try {
          sock.destroy();
        } catch {}
      }
      if (collabChild.exitCode === null && collabChild.signalCode === null) {
        collabChild.kill('SIGKILL');
      }
      if (nextChild.exitCode === null && nextChild.signalCode === null) {
        nextChild.kill('SIGKILL');
      }
    }, SHUTDOWN_TIMEOUT_MS);

    const [collabRes, nextRes] = await Promise.all([
      waitForExit(collabChild),
      waitForExit(nextChild),
    ]);
    clearTimeout(forceTimer);

    const finalCode =
      exitCodeOverride !== null
        ? exitCodeOverride
        : (collabRes.code && collabRes.code !== 0) || (nextRes.code && nextRes.code !== 0)
          ? 1
          : 0;
    console.log(
      `[ProdEntrypoint] Children exited (next=${nextRes.code ?? nextRes.signal}, collab=${collabRes.code ?? collabRes.signal}). Exiting ${finalCode}.`
    );
    process.exit(finalCode);
  };

  nextChild.once('exit', (code, signal) => {
    if (!shuttingDown) {
      unexpectedExit = true;
      console.error(`[ProdEntrypoint] Next.js process exited unexpectedly (code=${code}, signal=${signal}).`);
      void shutdown('next-unexpected-exit', code && code !== 0 ? code : 1);
    }
  });

  collabChild.once('exit', (code, signal) => {
    if (!shuttingDown) {
      unexpectedExit = true;
      console.error(`[ProdEntrypoint] Collab server exited unexpectedly (code=${code}, signal=${signal}).`);
      void shutdown('collab-unexpected-exit', code && code !== 0 ? code : 1);
    }
  });

  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.on('SIGINT', () => void shutdown('SIGINT', 0));

  try {
    await Promise.all([
      waitForTcpPort('127.0.0.1', nextInternalPort, STARTUP_TIMEOUT_MS, () => shuttingDown || unexpectedExit),
      waitForTcpPort('127.0.0.1', collabInternalPort, STARTUP_TIMEOUT_MS, () => shuttingDown || unexpectedExit),
    ]);
  } catch (err) {
    console.error(`[ProdEntrypoint] Startup check failed: ${err.message}`);
    await shutdown('startup-failure', 1);
    return;
  }

  publicServer = http.createServer((req, res) => {
    const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    if (pathname.startsWith('/internal/')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }

    forwardHttpRequest(req, res, '127.0.0.1', nextInternalPort);
  });

  publicServer.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    if (pathname.startsWith('/internal/')) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    forwardWebSocketUpgrade(req, socket, head, '127.0.0.1', collabInternalPort, activeWsSockets);
  });

  await new Promise((resolve, reject) => {
    publicServer.once('error', reject);
    publicServer.listen(publicPort, bindHost, () => {
      console.log(`[ProdEntrypoint] Public ingress listening on http://${bindHost}:${publicPort}`);
      resolve();
    });
  });

  if (collabPublicPort !== null) {
    collabPublicServer = http.createServer((req, res) => {
      const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
      if (pathname.startsWith('/internal/')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      if (pathname === '/health' || pathname === '/healthz') {
        forwardHttpRequest(req, res, '127.0.0.1', collabInternalPort);
        return;
      }
      res.writeHead(426, { 'Content-Type': 'text/plain' });
      res.end('Upgrade Required');
    });

    collabPublicServer.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
      if (pathname.startsWith('/internal/')) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      forwardWebSocketUpgrade(req, socket, head, '127.0.0.1', collabInternalPort, activeWsSockets);
    });

    await new Promise((resolve, reject) => {
      collabPublicServer.once('error', reject);
      collabPublicServer.listen(collabPublicPort, bindHost, () => {
        console.log(
          `[ProdEntrypoint] Dedicated Collab WS ingress listening on ws://${bindHost}:${collabPublicPort}`
        );
        resolve();
      });
    });
  }
}

main().catch((err) => {
  console.error('[ProdEntrypoint] Fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

