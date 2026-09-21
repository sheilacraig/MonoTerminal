/**
 * Thin re-export of the AgentChat context hook.
 *
 * The chat state used to live inside this hook as `useState`, which meant
 * every time `AgentView` unmounted (e.g. the user pressed Ctrl+\ to fold the
 * panel) the entire conversation was destroyed. State is now hosted in
 * `AgentChatProvider`, keyed by sessionId, so the hook simply forwards the
 * context value. This file is kept as a stable import path for consumers.
 */
export { useAgentChat } from '../context/AgentChatContext';
