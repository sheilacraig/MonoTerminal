import { errorMessage } from '../../../shared/errors';
import type { DefaultSessionManager } from '../../application/session/DefaultSessionManager';
import type { VerificationSpec } from '../planner/Plan';
import type { ShellTool } from '../tools/ShellTool';
import type { ToolExecutionContext } from '../tools/Tool';

export interface VerificationResult {
  passed: boolean;
  message: string;
  details?: unknown;
}

export class CommandExitCodeVerifier {
  constructor(private readonly shellTool: ShellTool) {}

  public async verify(
    spec: Extract<VerificationSpec, { type: 'command_exit_code' }>,
    ctx: ToolExecutionContext
  ): Promise<VerificationResult> {
    const expectedCode = spec.expectedExitCode ?? 0;
    const res = await this.shellTool.execute(
      { command: spec.command, cwd: ctx.cwd, timeoutMs: 10_000 },
      ctx
    );

    const actualCode = res.output?.exitCode ?? (res.success ? 0 : 1);
    if (actualCode !== expectedCode) {
      return {
        passed: false,
        message: `验证命令 "${spec.command}" 退出码为 ${actualCode}，预期为 ${expectedCode}`,
        details: res.output
      };
    }

    if (spec.expectedOutputContains) {
      const combined = `${res.output?.stdout || ''}\n${res.output?.stderr || ''}`;
      if (!combined.includes(spec.expectedOutputContains)) {
        return {
          passed: false,
          message: `验证命令 "${spec.command}" 输出未包含预期内容 "${spec.expectedOutputContains}"`,
          details: res.output
        };
      }
    }

    return {
      passed: true,
      message: `验证命令 "${spec.command}" 通过 (exitCode=${actualCode})`
    };
  }
}

export class FileMutationVerifier {
  constructor(private readonly sessionManager: DefaultSessionManager) {}

  public async verify(
    spec: Extract<VerificationSpec, { type: 'file_mutation' }>,
    ctx: ToolExecutionContext
  ): Promise<VerificationResult> {
    try {
      const { provider } = this.sessionManager.getFileSystemProvider(ctx.sessionId);
      // Use internal: true so verification never emits FileOpenedEvent (P1-E)
      const content = await provider.read(ctx.sessionId, spec.path, { internal: true });

      if (spec.mustContain && !content.includes(spec.mustContain)) {
        return {
          passed: false,
          message: `文件 ${spec.path} 未包含预期内容 "${spec.mustContain}"`
        };
      }

      if (spec.mustNotContain && content.includes(spec.mustNotContain)) {
        return {
          passed: false,
          message: `文件 ${spec.path} 仍包含应移除的内容 "${spec.mustNotContain}"`
        };
      }

      return {
        passed: true,
        message: `文件 ${spec.path} 变更验证通过`
      };
    } catch (err) {
      return {
        passed: false,
        message: `无法读取验证目标文件 ${spec.path}: ${errorMessage(err)}`
      };
    }
  }
}

export class ServiceActiveVerifier {
  constructor(private readonly shellTool: ShellTool) {}

  public async verify(
    spec: Extract<VerificationSpec, { type: 'service_active' }>,
    ctx: ToolExecutionContext
  ): Promise<VerificationResult> {
    const safeName = spec.serviceName.replace(/[^A-Za-z0-9_.@-]/g, '');
    const res = await this.shellTool.execute(
      { command: `systemctl is-active ${safeName}`, cwd: ctx.cwd, timeoutMs: 10_000 },
      ctx
    );

    const stdout = (res.output?.stdout || '').trim().toLowerCase();
    const isActive = res.output?.exitCode === 0 && stdout.startsWith('active');
    if (!isActive) {
      return {
        passed: false,
        message: `服务 ${safeName} 未处于 active 状态 (实际: ${stdout || res.error || 'unknown'})`,
        details: res.output
      };
    }

    return {
      passed: true,
      message: `服务 ${safeName} 运行状态验证为 active`
    };
  }
}

export class VerifierRegistry {
  private readonly cmdVerifier: CommandExitCodeVerifier;
  private readonly fileVerifier: FileMutationVerifier;
  private readonly serviceVerifier: ServiceActiveVerifier;

  constructor(deps: { sessionManager: DefaultSessionManager; shellTool: ShellTool }) {
    this.cmdVerifier = new CommandExitCodeVerifier(deps.shellTool);
    this.fileVerifier = new FileMutationVerifier(deps.sessionManager);
    this.serviceVerifier = new ServiceActiveVerifier(deps.shellTool);
  }

  public async verify(
    spec: VerificationSpec,
    ctx: ToolExecutionContext
  ): Promise<VerificationResult> {
    switch (spec.type) {
      case 'command_exit_code':
        return this.cmdVerifier.verify(spec, ctx);
      case 'file_mutation':
        return this.fileVerifier.verify(spec, ctx);
      case 'service_active':
        return this.serviceVerifier.verify(spec, ctx);
    }
  }
}
