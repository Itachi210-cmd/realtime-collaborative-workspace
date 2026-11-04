import type * as Y from 'yjs';
import type { AuthTokenGetter } from './authenticated-transport';

export type CollabConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'auth_error';

export interface CollabProviderOptions {
  workspaceId: string;
  pageId: string;
  ydoc: Y.Doc;
  awareness?: unknown;
  serverUrl?: string;
  getToken?: AuthTokenGetter;
  onStatusChange?: (status: CollabConnectionStatus, error?: string | null) => void;
  BaseWS?: unknown;
  disableBc?: boolean;
}

export {
  fetchCollabToken,
  createCollabWebsocketProvider,
} from './collab-provider.mjs';
