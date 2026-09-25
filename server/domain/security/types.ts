export type RiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ExecutionDecision = 'allow' | 'ask' | 'deny';

export interface ShellExecAction {
  kind: 'shell:exec';
  sessionId: string;
  command: string;
  cwd?: string;
}

export interface FsReadAction {
  kind: 'fs:read' | 'fs:list' | 'fs:stat';
  sessionId: string;
  path: string;
  sessionRoot?: string;
}

export interface FsWriteAction {
  kind: 'fs:write';
  sessionId: string;
  path: string;
  byteLength: number;
  sessionRoot?: string;
}

export interface FsMkdirAction {
  kind: 'fs:mkdir';
  sessionId: string;
  path: string;
  sessionRoot?: string;
}

export interface FsDeleteAction {
  kind: 'fs:delete';
  sessionId: string;
  path: string;
  isDirectory?: boolean;
  sessionRoot?: string;
}

export interface FsRenameAction {
  kind: 'fs:rename';
  sessionId: string;
  oldPath: string;
  newPath: string;
  sessionRoot?: string;
}

export interface FsChmodAction {
  kind: 'fs:chmod';
  sessionId: string;
  path: string;
  mode: number;
  sessionRoot?: string;
}

export type GuardrailAction =
  | ShellExecAction
  | FsReadAction
  | FsWriteAction
  | FsMkdirAction
  | FsDeleteAction
  | FsRenameAction
  | FsChmodAction;

export interface RiskAssessment {
  level: RiskLevel;
  reason?: string;
  matchedRule?: string;
}

export interface PolicyDecision {
  decision: ExecutionDecision;
  assessment: RiskAssessment;
}
