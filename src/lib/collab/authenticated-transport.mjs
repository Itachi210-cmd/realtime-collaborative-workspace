/**
 * Authenticated WebSocket Transport for Yjs
 * Real-Time Collaborative Workspace - Phase 6 Step 3
 *
 * Wraps WebSocket to enforce a strict first-message JWT handshake:
 * 1. Fetches a fresh collaboration token via the provided token getter.
 * 2. Connects to the room URL (strictly WITHOUT tokens in the URL).
 * 3. Sends the authentication frame { type: 'auth', token } immediately on open.
 * 4. Buffers any outgoing Yjs sync/awareness traffic until the server acknowledges authentication.
 * 5. Intercepts the server's { type: 'authenticated' } frame so Yjs does not attempt to parse JSON.
 * 6. Propagates permanent close codes (4401, 4403) to halt reconnect loops.
 */

/**
 * Creates an Authenticated WebSocket class configured with the specified token getter.
 * Can be passed as `WebSocketPolyfill` to y-websocket's `WebsocketProvider`.
 *
 * @param {() => Promise<string>} getToken
 * @param {any} [BaseWS]
 */
export function createAuthenticatedWebSocketClass(
  getToken,
  BaseWS = typeof window !== 'undefined' ? window.WebSocket : null
) {
  return class AuthenticatedWebSocket {
    // Static readyState constants required by y-websocket (e.g. ws.readyState === ws.OPEN)
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    // Instance readyState constants (in case provider checks instance properties)
    CONNECTING = 0;
    OPEN = 1;
    CLOSING = 2;
    CLOSED = 3;

    constructor(url, protocols) {
      // Validate that the URL does NOT contain any authentication tokens
      if (
        url.includes('token=') ||
        url.includes('jwt=') ||
        url.includes('auth=')
      ) {
        throw new Error('[CollabTransport] Security violation: Tokens in WebSocket URL are forbidden.');
      }

      this.url = url;
      this.protocols = protocols;
      this._binaryType = 'arraybuffer';
      this.readyState = 0; // CONNECTING

      this.onopen = null;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;

      this.rawWs = null;
      this.messageQueue = [];
      this.isHandshakeComplete = false;
      this.isClosed = false;

      this.initConnection();
    }

    get binaryType() {
      return this.rawWs ? this.rawWs.binaryType : this._binaryType;
    }

    set binaryType(val) {
      this._binaryType = val;
      if (this.rawWs) {
        this.rawWs.binaryType = val;
      }
    }

    async initConnection() {
      try {
        // Resolve target WebSocket constructor (browser window.WebSocket or Node.js ws)
        const ResolvedWS =
          BaseWS || (typeof window !== 'undefined' ? window.WebSocket : null);

        if (!ResolvedWS) {
          throw new Error('[CollabTransport] No WebSocket implementation available.');
        }

        // Fetch fresh collaboration token prior to initiating connection
        const token = await getToken();
        if (this.isClosed) return;

        if (!token || typeof token !== 'string') {
          throw new Error('[CollabTransport] Retrieved invalid or empty collaboration token.');
        }

        // Connect raw WebSocket without token in URL
        this.rawWs = new ResolvedWS(this.url, this.protocols);
        this.rawWs.binaryType = this._binaryType || 'arraybuffer';

        this.rawWs.onopen = (event) => {
          if (this.isClosed) return;

          // 1. Send authentication frame as the very first message over the wire
          try {
            this.rawWs.send(JSON.stringify({ type: 'auth', token }));
          } catch (err) {
            this.handleClose(4401, err?.message || 'Failed to transmit auth frame');
            return;
          }

          // 2. Mark this wrapper open and notify provider
          this.readyState = AuthenticatedWebSocket.OPEN;
          if (this.onopen) {
            this.onopen(event);
          }
        };

        this.rawWs.onmessage = (event) => {
          if (this.isClosed) return;

          // Check for JSON authentication acknowledgment
          if (typeof event.data === 'string') {
            try {
              const parsed = JSON.parse(event.data);
              if (parsed && parsed.type === 'authenticated') {
                this.isHandshakeComplete = true;

                // Flush any Yjs sync messages queued during verification
                while (this.messageQueue.length > 0) {
                  const queued = this.messageQueue.shift();
                  if (queued && this.rawWs && this.rawWs.readyState === AuthenticatedWebSocket.OPEN) {
                    this.rawWs.send(queued);
                  }
                }
                // Do not forward server's JSON handshake message to y-websocket
                return;
              }
            } catch {
              // Non-JSON string or plain text
            }
          }

          // Handle Blob payloads safely by converting to ArrayBuffer
          if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
            this.isHandshakeComplete = true;
            event.data.arrayBuffer().then((buffer) => {
              if (this.isClosed) return;
              if (this.onmessage) {
                this.onmessage({
                  ...event,
                  data: buffer,
                });
              }
            }).catch((err) => {
              console.error('[CollabTransport] Failed converting Blob to ArrayBuffer:', err);
            });
            return;
          }

          // Binary Yjs sync / awareness message (ArrayBuffer or Node Buffer)
          this.isHandshakeComplete = true;
          if (this.onmessage) {
            this.onmessage(event);
          }
        };

        this.rawWs.onerror = (event) => {
          if (this.onerror) {
            this.onerror(event);
          }
        };

        this.rawWs.onclose = (event) => {
          this.readyState = AuthenticatedWebSocket.CLOSED;
          if (this.onclose) {
            this.onclose(event);
          }
        };
      } catch (err) {
        // Token retrieval failure or connection initialization failure
        const code = err?.status === 403 || err?.message?.includes('403') ? 4403 : 4401;
        this.handleClose(code, err?.message || 'Authentication failed');
      }
    }

    handleClose(code, reason) {
      this.readyState = AuthenticatedWebSocket.CLOSED;
      if (this.onclose) {
        const closeEvt =
          typeof CloseEvent !== 'undefined'
            ? new CloseEvent('close', { code, reason, wasClean: false })
            : { code, reason, wasClean: false, type: 'close' };
        this.onclose(closeEvt);
      }
    }

    send(data) {
      if (this.isHandshakeComplete && this.rawWs && this.rawWs.readyState === AuthenticatedWebSocket.OPEN) {
        this.rawWs.send(data);
      } else {
        // Buffer until handshake acknowledgment is received
        this.messageQueue.push(data);
      }
    }

    close(code, reason) {
      this.isClosed = true;
      this.readyState = AuthenticatedWebSocket.CLOSING;
      if (this.rawWs) {
        try {
          this.rawWs.close(code, reason);
        } catch {}
      } else {
        this.handleClose(code || 1000, reason || 'Normal closure');
      }
    }
  };
}

