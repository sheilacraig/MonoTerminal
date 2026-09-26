import { describe, it, expect } from 'vitest';
import {
  parseQuickConnect,
  formatSshCommand,
  normalizeHostGroup
} from '../src/utils/quickConnect';

describe('quickConnect utilities', () => {
  it('parses user@host with default port 22', () => {
    expect(parseQuickConnect('root@10.0.1.24')).toEqual({
      username: 'root',
      host: '10.0.1.24',
      port: 22,
      name: 'root@10.0.1.24'
    });
  });

  it('parses user@host:port syntax', () => {
    expect(parseQuickConnect('root@10.0.1.30:2222')).toEqual({
      username: 'root',
      host: '10.0.1.30',
      port: 2222,
      name: 'root@10.0.1.30:2222'
    });
  });

  it('parses ssh -p <port> user@host syntax', () => {
    expect(parseQuickConnect('ssh -p 2222 ubuntu@prod-web-01')).toEqual({
      username: 'ubuntu',
      host: 'prod-web-01',
      port: 2222,
      name: 'ubuntu@prod-web-01:2222'
    });
  });

  it('parses ssh user@host -p <port> syntax', () => {
    expect(parseQuickConnect('ssh admin@192.168.1.50 -p 6022')).toEqual({
      username: 'admin',
      host: '192.168.1.50',
      port: 6022,
      name: 'admin@192.168.1.50:6022'
    });
  });

  it('parses bare host or host:port with default user root', () => {
    expect(parseQuickConnect('10.0.1.30:22')).toEqual({
      username: 'root',
      host: '10.0.1.30',
      port: 22,
      name: 'root@10.0.1.30'
    });
  });

  it('returns null on empty input', () => {
    expect(parseQuickConnect('   ')).toBeNull();
  });

  it('formats SSH command properly', () => {
    expect(
      formatSshCommand({
        host: '10.0.1.24',
        port: 22,
        username: 'root',
        authType: 'password'
      })
    ).toBe('ssh root@10.0.1.24');

    expect(
      formatSshCommand({
        host: '10.0.1.30',
        port: 2222,
        username: 'ubuntu',
        authType: 'privateKey'
      })
    ).toBe('ssh -p 2222 ubuntu@10.0.1.30');
  });

  it('P2-3: formats local session command according to platform (powershell on Windows, $SHELL on POSIX)', () => {
    expect(
      formatSshCommand(
        {
          host: 'localhost',
          port: 0,
          username: 'local',
          authType: 'local'
        },
        'Win32'
      )
    ).toBe('powershell');

    expect(
      formatSshCommand(
        {
          host: 'localhost',
          port: 0,
          username: 'local',
          authType: 'local'
        },
        'MacIntel'
      )
    ).toBe('$SHELL');

    expect(
      formatSshCommand(
        {
          host: 'localhost',
          port: 0,
          username: 'local',
          authType: 'local'
        },
        'Linux x86_64'
      )
    ).toBe('$SHELL');
  });

  it('normalizes legacy local group names to 本机终端', () => {
    expect(normalizeHostGroup({ group: '本地', authType: 'local' })).toBe('本机终端');
    expect(normalizeHostGroup({ group: '本机与沙盒', authType: 'local' })).toBe('本机终端');
    expect(normalizeHostGroup({ group: '生产环境', authType: 'password' })).toBe('生产环境');
  });
});
