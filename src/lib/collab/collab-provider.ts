import type * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import type { AuthTokenGetter } from './authenticated-transport';
import {
  fetchCollabToken,
  createCollabWebsocketProvider as createCollabWebsocketProviderJs,
} from './collab-provider.mjs';

export type CollabConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'auth_error';

export interface SaveStatusDetails {
  type?: 'save_status';
  status: 'saved' | 'saving' | 'error';
  pageId?: string;
  stateVersion?: number;
  savedAt?: string;
  error?: string;
}

export interface CollabProviderOptions {
  workspaceId: string;
  pageId: string;
  ydoc: Y.Doc;
  awareness?: unknown;
  serverUrl?: string;
  getToken?: AuthTokenGetter;
  onStatusChange?: (status: CollabConnectionStatus, error?: string | null) => void;
  onSaveStatusChange?: (status: string, details?: SaveStatusDetails) => void;
  onSyncChange?: (isSynced: boolean) => void;
  BaseWS?: unknown;
  disableBc?: boolean;
}

export type CollabWebsocketProvider = WebsocketProvider & {
  saveStatus?: 'saved' | 'saving' | 'error';
  stateVersion?: number;
  isSynced?: boolean;
  retrySave?: () => void;
};

export const createCollabWebsocketProvider = createCollabWebsocketProviderJs as (
  options: CollabProviderOptions
) => CollabWebsocketProvider;

export { fetchCollabToken };
