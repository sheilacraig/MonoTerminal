import WebSocket from 'ws';
import os from 'os';

async function testE2E() {
  // Fetch the per-startup bearer token from the local bootstrap endpoint
  // (WS handshakes require it as ?token= — see server/auth.ts).
  const bootRes = await fetch('http://localhost:3001/api/auth/bootstrap');
  const boot = (await bootRes.json()) as { token: string };
  if (!boot.token) throw new Error('bootstrap did not return a token');

  console.log('Connecting to ws://localhost:3001/ws...');
  const ws = new WebSocket(`ws://localhost:3001/ws?token=${boot.token}`);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      console.log('✓ WebSocket connected successfully');
      resolve();
    });
    ws.on('error', err => reject(err));
  });

  // 1. Test Ping / Pong for latency RTT
  const pingPromise = new Promise<number>(resolve => {
    const start = Date.now();
    const handler = (data: string) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'pong') {
        ws.off('message', handler);
        const rtt = Date.now() - start;
        console.log(`✓ RTT Ping/Pong passed: ${rtt}ms`);
        resolve(rtt);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'ping', timestamp: start }));
  });
  await pingPromise;

  // 2. Init the local shell session (falls back to demoHost = local-shell)
  const sessionId = 'test-session-' + Date.now();
  const readyPromise = new Promise<string>(resolve => {
    const handler = (data: string) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'term:ready' && msg.sessionId === sessionId) {
        ws.off('message', handler);
        console.log(`✓ Local shell session ready (host: ${msg.hostName}, cwd: ${msg.cwd})`);
        resolve(msg.cwd);
      } else if (msg.type === 'term:error' && msg.sessionId === sessionId) {
        ws.off('message', handler);
        throw new Error(`term:init failed: ${msg.message}`);
      }
    };
    ws.on('message', handler);
    ws.send(
      JSON.stringify({
        type: 'term:init',
        sessionId,
        hostId: 'local-shell',
        cols: 80,
        rows: 24
      })
    );
  });
  await readyPromise;

  // 3. Type a command and wait for its echo from the real local PTY
  const echoPromise = new Promise<string>(resolve => {
    let received = '';
    const handler = (data: string) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'term:data' && msg.sessionId === sessionId) {
        received += msg.data;
        if (received.includes('E2E_PTY_OK')) {
          ws.off('message', handler);
          console.log('✓ Local PTY echo passed: command output received');
          resolve(received);
        }
      }
    };
    ws.on('message', handler);
    // Give the shell a moment to print its banner/prompt first
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'term:input', sessionId, data: 'echo E2E_PTY_OK\r' }));
    }, 1500);
  });
  await echoPromise;

  // 4. Test SFTP List against the local filesystem (home directory)
  const sftpListPromise = new Promise<{ name: string; isDirectory: boolean }[]>(resolve => {
    const requestId = 'req-list-1';
    const handler = (data: string) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'sftp:response' && msg.requestId === requestId) {
        ws.off('message', handler);
        if (!msg.success) throw new Error(`sftp:list failed: ${msg.error}`);
        console.log(`✓ Local FS directory listing passed, found ${msg.data.length} items`);
        resolve(msg.data);
      }
    };
    ws.on('message', handler);
    ws.send(
      JSON.stringify({
        type: 'sftp:list',
        requestId,
        sessionId,
        dirPath: os.homedir()
      })
    );
  });
  await sftpListPromise;

  // 5. Test SFTP Read of a well-known file
  const sftpReadPromise = new Promise<void>(resolve => {
    const requestId = 'req-read-1';
    const handler = (data: string) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'sftp:response' && msg.requestId === requestId) {
        ws.off('message', handler);
        if (!msg.success) throw new Error(`sftp:read failed: ${msg.error}`);
        console.log('✓ Local FS file read passed');
        resolve();
      }
    };
    ws.on('message', handler);
    ws.send(
      JSON.stringify({
        type: 'sftp:read',
        requestId,
        sessionId,
        filePath: process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hostname'
      })
    );
  });
  await sftpReadPromise;

  // 6. Test AI Chat Streaming
  const aiStreamPromise = new Promise<string>(resolve => {
    const requestId = 'req-ai-1';
    let full = '';
    const handler = (data: string) => {
      const msg = JSON.parse(data.toString());
      if (msg.requestId === requestId) {
        if (msg.type === 'ai:content') {
          full += msg.delta;
        } else if (msg.type === 'ai:done') {
          ws.off('message', handler);
          console.log('✓ AI streaming completed, output contains actionable commands');
          resolve(full);
        }
      }
    };
    ws.on('message', handler);
    ws.send(
      JSON.stringify({
        type: 'ai:chat',
        requestId,
        messages: [{ role: 'user', content: 'Nginx 80 端口冲突，请给出排查命令' }],
        opsContext: { terminalSnippet: 'bind() to 0.0.0.0:80 failed (98: Address already in use)' }
      })
    );
  });
  const aiResult = await aiStreamPromise;
  if (!aiResult.includes('```bash')) {
    throw new Error('AI response missing actionable bash codeblock');
  }

  // Cleanup — also releases the backend PTY process
  ws.send(JSON.stringify({ type: 'term:close', sessionId }));
  ws.close();
  console.log('\n🎉 ALL E2E WebSocket tests passed successfully!');
}

testE2E().catch(err => {
  console.error('E2E Test Failed:', err);
  process.exit(1);
});
