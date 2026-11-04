export type AuthTokenGetter = () => Promise<string>;

export interface AuthenticatedWebSocketOptions {
  getToken: AuthTokenGetter;
  BaseWS?: unknown;
}

export {
  createAuthenticatedWebSocketClass,
} from './authenticated-transport.mjs';
