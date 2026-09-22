import { describe, it, expect } from 'vitest';
import {
  sanitizeTabsInLine,
  parseShellCommands,
  cleanCommandForExecution
} from '../src/utils/commandCleaner';

describe('commandCleaner', () => {
  describe('sanitizeTabsInLine', () => {
    it('should convert tab characters inside quotes to literal \\t', () => {
      const line = 'docker ps -a --format "table {{.ID}}\t{{.Names}}\t{{.Status}}"';
      const cleaned = sanitizeTabsInLine(line);
      expect(cleaned).toBe('docker ps -a --format "table {{.ID}}\\t{{.Names}}\\t{{.Status}}"');
      expect(cleaned).not.toContain('\t');
    });

    it('should convert leading tabs to 2 spaces', () => {
      const line = '\techo hello';
      const cleaned = sanitizeTabsInLine(line);
      expect(cleaned).toBe('  echo hello');
      expect(cleaned).not.toContain('\t');
    });

    it('should convert inline tabs outside quotes to a space', () => {
      const line = 'grep\t-rn\t"foo"\t.';
      const cleaned = sanitizeTabsInLine(line);
      expect(cleaned).toBe('grep -rn "foo" .');
      expect(cleaned).not.toContain('\t');
    });
  });

  describe('parseShellCommands', () => {
    it('should strip whole-line comments and empty lines', () => {
      const input = `
# 1. 查看磁盘分区整体使用情况
df -h

# 2. 查看容器
docker ps -a
`;
      const result = parseShellCommands(input);
      expect(result.strippedComments).toEqual([
        '# 1. 查看磁盘分区整体使用情况',
        '# 2. 查看容器'
      ]);
      expect(result.hasMultipleCommands).toBe(true);
      expect(result.individualCommands).toEqual(['df -hl', 'docker ps -a']);
      expect(result.cleanCommand).toBe('df -hl && docker ps -a');
    });

    it('should handle the exact user case with comments and tabs without crashing or hanging', () => {
      const input = `# 1. 查看磁盘分区整体使用情况
df -h
docker ps -a --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"`;

      const result = parseShellCommands(input);
      expect(result.hasMultipleCommands).toBe(true);
      expect(result.individualCommands.length).toBe(2);
      expect(result.individualCommands[0]).toBe('df -hl');
      expect(result.individualCommands[1]).toBe(
        'docker ps -a --format "table {{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}"'
      );
      expect(result.cleanCommand).toBe(
        'df -hl && docker ps -a --format "table {{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}"'
      );
      // Ensures no raw tabs in output
      expect(result.cleanCommand).not.toContain('\t');
      // Ensures no comments in output
      expect(result.cleanCommand).not.toContain('#');
    });

    it('should preserve compound loops and scripts without joining with &&', () => {
      const input = `# Start loop
for item in a b c; do
  echo "$item"
done`;

      const result = parseShellCommands(input);
      expect(result.hasMultipleCommands).toBe(false);
      expect(result.cleanCommand).toContain('for item in a b c; do');
      expect(result.cleanCommand).not.toContain('&&');
      expect(result.cleanCommand).not.toContain('# Start loop');
    });

    it('should preserve heredoc content even if it contains #', () => {
      const input = `cat << 'EOF' > test.conf
# This is a comment inside the file
port = 8080
EOF`;

      const result = parseShellCommands(input);
      expect(result.cleanCommand).toContain('# This is a comment inside the file');
      expect(result.cleanCommand).toContain('port = 8080');
    });

    it('should return empty cleanCommand if input is only comments', () => {
      const input = `# Just a comment
# Another comment`;

      const result = parseShellCommands(input);
      expect(result.cleanCommand).toBe('');
      expect(result.individualCommands).toHaveLength(0);
    });

    it('should handle single command properly', () => {
      const input = `  systemctl status nginx  `;
      const result = parseShellCommands(input);
      expect(result.hasMultipleCommands).toBe(false);
      expect(result.cleanCommand).toBe('systemctl status nginx');
      expect(result.individualCommands).toEqual(['systemctl status nginx']);
    });
  });

  describe('cleanCommandForExecution', () => {
    it('should return clean string directly', () => {
      const input = `# Check memory\nfree -m`;
      expect(cleanCommandForExecution(input)).toBe('free -m');
    });
  });
});
