import path from 'path';

/**
 * Lightweight PowerShell OSC 133 & OSC 7 Semantic Shell Integration Hook (Phase 5 / P0-A / P1-1).
 *
 * Uses single quotes and `+` concatenation exclusively (zero `"` characters) so Windows
 * command-line argument quoting in `node-pty` / `CreateProcessW` never strips quotes.
 *
 * - Explicitly imports PSReadLine (if available) and wraps `PSConsoleHostReadLine`
 *   to emit `OSC 133;E;<cmd>` + `OSC 133;C` before command execution
 * - Also falls back to `Get-History -Count 1` inside `prompt` to emit `OSC 133;E;<cmd>`
 *   before `OSC 133;D;<exitCode>` even when PSReadLine is unavailable (P1-1)
 * - Emits `OSC 7;file://localhost/<cwd>` (with `#` / `?` / `%` escaped per P2-4)
 * - Emits `OSC 133;A` (Prompt Start) and `OSC 133;B` (Command Start)
 */
export const POWERSHELL_OSC133_HOOK_SCRIPT = [
  'Import-Module PSReadLine -ErrorAction SilentlyContinue;',
  '$Global:__MonoOrigPrompt = $function:prompt;',
  '$h0 = Get-History -Count 1; $Global:__MonoLastHistId = if ($h0) { $h0.Id } else { 0 };',
  'function Global:prompt {',
  '  $ec = if ($? -eq $false) { if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 } } else { 0 };',
  '  $e = [char]27; $bel = [char]7;',
  '  $h = Get-History -Count 1;',
  "  $oscE = '';",
  '  if ($h -and $h.Id -ne $Global:__MonoLastHistId) {',
  '    $Global:__MonoLastHistId = $h.Id;',
  "    $cmdText = ($h.CommandLine -replace '[\\r\\n]+', ' ');",
  "    $oscE = $e + ']133;E;' + $cmdText + $bel;",
  '  }',
  "  $p = ($PWD.Path -replace '\\\\', '/' -replace '%', '%25' -replace '#', '%23' -replace '\\?', '%3F');",
  "  $oscD = $e + ']133;D;' + $ec + $bel;",
  "  $osc7 = $e + ']7;file://localhost/' + $p + $bel;",
  "  $oscA = $e + ']133;A' + $bel;",
  "  $oscB = $e + ']133;B' + $bel;",
  "  $body = if ($Global:__MonoOrigPrompt) { & $Global:__MonoOrigPrompt } else { 'PS ' + $PWD.Path + '> ' };",
  '  return $oscE + $oscD + $osc7 + $oscA + $body + $oscB;',
  '}',
  'if (Test-Path function:PSConsoleHostReadLine) {',
  '  $Global:__MonoOrigReadLine = $function:PSConsoleHostReadLine;',
  '  function Global:PSConsoleHostReadLine {',
  '    $line = & $Global:__MonoOrigReadLine;',
  '    $e = [char]27; $bel = [char]7;',
  "    [Console]::Write($e + ']133;E;' + $line + $bel + $e + ']133;C' + $bel);",
  '    return $line;',
  '  }',
  '}'
].join(' ');

export function isPowerShellExecutable(command: string): boolean {
  const base = path.basename(command).toLowerCase();
  return (
    base === 'pwsh' ||
    base === 'pwsh.exe' ||
    base === 'powershell' ||
    base === 'powershell.exe'
  );
}

export function buildPowerShellOsc133Args(existingArgs: string[] = []): string[] {
  const hasCommandFlag = existingArgs.some(arg => {
    const lower = arg.toLowerCase();
    return lower === '-command' || lower === '-c';
  });
  if (hasCommandFlag) {
    return existingArgs;
  }
  return [...existingArgs, '-NoLogo', '-NoExit', '-Command', POWERSHELL_OSC133_HOOK_SCRIPT];
}
