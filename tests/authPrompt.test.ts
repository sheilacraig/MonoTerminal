import { describe, it, expect } from 'vitest';
import {
  detectAuthFailure,
  detectAuthPrompt,
  isMultiLineBlock,
  requiresElevation,
  stripAnsi
} from '../src/utils/authPrompt';

describe('stripAnsi', () => {
  it('removes CSI colour codes so prompts still match', () => {
    expect(stripAnsi('\x1b[0m[sudo] password for whh: \x1b[0m')).toBe('[sudo] password for whh: ');
  });

  it('normalises a bare CR (prompt redraw) into a newline', () => {
    expect(stripAnsi('one\rtwo')).toBe('one\ntwo');
  });
});

describe('detectAuthPrompt', () => {
  it('detects the English sudo prompt', () => {
    const match = detectAuthPrompt('whh@web:~$ sudo cat > /etc/x\n[sudo] password for whh: ');
    expect(match?.kind).toBe('sudo');
    expect(match?.requiresPassword).toBe(true);
  });

  it('detects the zh_CN sudo prompt', () => {
    const match = detectAuthPrompt('[sudo] whh 的密码：');
    expect(match?.kind).toBe('sudo');
    expect(match?.requiresPassword).toBe(true);
  });

  it('detects a coloured sudo prompt', () => {
    const match = detectAuthPrompt('\x1b[1;31m[sudo] password for root:\x1b[0m ');
    expect(match?.kind).toBe('sudo');
  });

  it('detects generic / ssh / passphrase prompts', () => {
    expect(detectAuthPrompt('Password:')?.kind).toBe('passwd');
    expect(detectAuthPrompt("whh@10.0.0.1's password:")?.kind).toBe('ssh');
    expect(detectAuthPrompt('Enter passphrase for key "/home/whh/.ssh/id_rsa":')?.kind).toBe('key');
  });

  it('detects the SSH host-key confirmation as a non-password prompt', () => {
    const match = detectAuthPrompt(
      'Are you sure you want to continue connecting (yes/no/[fingerprint])?'
    );
    expect(match?.kind).toBe('confirm');
    expect(match?.requiresPassword).toBe(false);
  });

  it('never fires on a plain shell prompt', () => {
    expect(detectAuthPrompt('root@prod-web01:/etc/nginx# ')).toBeNull();
    expect(detectAuthPrompt('whh@host:~$ ')).toBeNull();
    expect(detectAuthPrompt('PS C:\\Users\\whh>')).toBeNull();
  });

  it('ignores stale mentions of the word password', () => {
    expect(detectAuthPrompt('Password: accepted\nroot@host:~# ')).toBeNull();
  });
});

describe('detectAuthFailure', () => {
  it('recognises rejected passwords', () => {
    expect(detectAuthFailure('Sorry, try again.')).toBeTruthy();
    expect(detectAuthFailure('Sorry, try again.\n[sudo] password for whh:')).toContain('Sorry');
    expect(detectAuthFailure('sudo: 3 incorrect password attempts')).toBeTruthy();
    expect(detectAuthFailure('whh is not in the sudoers file.  This incident will be reported.')).toBeTruthy();
  });

  it('recognises the missing-tty error', () => {
    expect(detectAuthFailure('sudo: a terminal is required to read the password')).toBeTruthy();
  });

  it('stays quiet on success output', () => {
    expect(detectAuthFailure('')).toBeNull();
    expect(detectAuthFailure('file written')).toBeNull();
  });
});

describe('requiresElevation', () => {
  it('flags the usual escalation helpers', () => {
    expect(requiresElevation('sudo cat > /etc/nginx/nginx.conf')).toBe(true);
    expect(requiresElevation('doas pacman -Syu')).toBe(true);
    expect(requiresElevation('systemctl restart nginx && sudo systemctl status nginx')).toBe(true);
  });

  it('ignores commands that feed the password over stdin', () => {
    expect(requiresElevation('echo secret | sudo -S cat > /etc/x')).toBe(false);
    expect(requiresElevation('sudo -n systemctl restart nginx')).toBe(false);
  });

  it('does not fire on innocent commands mentioning sudo in a string or path', () => {
    expect(requiresElevation('echo "use sudo carefully"')).toBe(false);
    expect(requiresElevation("echo 'sudo make me a sandwich'")).toBe(false);
    expect(requiresElevation('cat /var/log/sudo.log')).toBe(false);
    expect(requiresElevation('systemctl status nginx')).toBe(false);
  });
});

describe('isMultiLineBlock', () => {
  it('detects the compound/heredoc shape produced by commandCleaner', () => {
    expect(isMultiLineBlock("sudo cat > /etc/x << 'EOF'\rserver {}\rEOF")).toBe(true);
    expect(isMultiLineBlock('sudo systemctl restart nginx')).toBe(false);
  });
});
