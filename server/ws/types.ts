import type { WsInboundMessage, WsOutboundMessage } from '../../shared/wsProtocol';
import type { AIService } from '../aiService';
import type { SshManager } from '../sshManager';
import type { LocalStorageManager, HostAsset } from '../storage';
import type { MockFileSystem, MockTerminalSession } from '../mockServer';
import type { LocalPtyManagerApi } from '../localPtyManager';
import type { LocalFsManagerApi } from '../localFsManager';

/** One active mock terminal session (virtual FS + terminal emulator). */
export interface MockSessionEntry {
  term: MockTerminalSession;
  fs: MockFileSystem;
}

/**
 * Dependencies shared by every handler. Injected (rather than imported as
 * singletons) so handlers can be unit-tested with fakes.
 */
export interface WsDependencies {
  aiService: AIService;
  sshManager: SshManager;
  storage: LocalStorageManager;
  /** Active mock sessions, keyed by sessionId. */
  mockSessions: Map<string, MockSessionEntry>;
  /** Fallback host used when term:init references an unknown hostId. */
  demoHost: HostAsset;
  /** Factory for creating a fresh mock terminal session. */
  createMockSession: (sessionId: string) => MockSessionEntry;
  /** Native local PTY sessions (authType === 'local'). */
  localPtyManager: LocalPtyManagerApi;
  /** Local filesystem operations for local sessions (SFTP protocol mapping). */
  localFsManager: LocalFsManagerApi;
}

/** Per-connection state and outbound helper handed to each handler. */
export interface WsConnection {
  /** Send a typed outbound message (no-op when the socket is not open). */
  send: (msg: WsOutboundMessage) => void;
  /** Session ids owned by this connection, cleaned up on socket close. */
  clientSessions: Set<string>;
  /** Underlying WebSocket instance or event emitter, if available. */
  socket?: { once?: (event: string, cb: () => void) => void };
}

/** A handler for one specific inbound message type. */
export type WsHandler<T extends WsInboundMessage = WsInboundMessage> = (
  msg: T,
  conn: WsConnection,
  deps: WsDependencies
) => void | Promise<void>;

/** Message-type → handler map covering every inbound message type. */
export type WsHandlerMap = {
  [K in WsInboundMessage['type']]: WsHandler<Extract<WsInboundMessage, { type: K }>>;
};
