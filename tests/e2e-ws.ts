import WebSocket from 'ws';

async function testE2E() {
  console.log('Connecting to ws://localhost:3001/ws...');
  const ws = new WebSocket('ws://localhost:3001/ws');

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      console.log('✓ WebSocket connected successfully');
      resolve();
    });
    ws.on('error', (err) => reject(err));
  });

  // 1. Test Ping / Pong for latency RTT
  const pingPromise = new Promise<number>((resolve) => {
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

  // 2. Test Terminal Session Init
  const sessionId = 'test-session-' + Date.now();
  const termDataPromise = new Promise<string>((resolve) => {
    let received = '';
    const handler = (data: string) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'term:data' && msg.sessionId === sessionId) {
        received += msg.data;
        if (received.includes('root@prod-web01')) {
          ws.off('message', handler);
          console.log('✓ Terminal session ready, received prompt from sandbox');
          resolve(received);
        }
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({
      type: 'term:init',
      sessionId,
      hostId: 'mock-local-demo',
      cols: 80,
      rows: 24
    }));
  });
  await termDataPromise;

  // 3. Test SFTP List
  const sftpListPromise = new Promise<any[]>((resolve) => {
    const requestId = 'req-list-1';
    const handler = (data: string) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'sftp:response' && msg.requestId === requestId) {
        ws.off('message', handler);
        console.log(`✓ SFTP directory listing passed, found ${msg.data.length} items`);
        resolve(msg.data);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({
      type: 'sftp:list',
      requestId,
      sessionId,
      dirPath: '/etc/nginx'
    }));
  });
  const files = await sftpListPromise;
  if (!files.some(f => f.name === 'nginx.conf')) {
    throw new Error('Expected nginx.conf in /etc/nginx');
  }

  // 4. Test SFTP Read
  const sftpReadPromise = new Promise<string>((resolve) => {
    const requestId = 'req-read-1';
    const handler = (data: string) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'sftp:response' && msg.requestId === requestId) {
        ws.off('message', handler);
        console.log('✓ SFTP read file passed: read /etc/nginx/nginx.conf');
        resolve(msg.data);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({
      type: 'sftp:read',
      requestId,
      sessionId,
      filePath: '/etc/nginx/nginx.conf'
    }));
  });
  const fileContent = await sftpReadPromise;
  if (!fileContent.includes('worker_processes')) {
    throw new Error('nginx.conf content mismatch');
  }

  // 5. Test AI Chat Streaming
  const aiStreamPromise = new Promise<string>((resolve) => {
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
    ws.send(JSON.stringify({
      type: 'ai:chat',
      requestId,
      messages: [{ role: 'user', content: 'Nginx 80 端口冲突，请给出排查命令' }],
      opsContext: { terminalSnippet: 'bind() to 0.0.0.0:80 failed (98: Address already in use)' }
    }));
  });
  const aiResult = await aiStreamPromise;
  if (!aiResult.includes('```bash')) {
    throw new Error('AI response missing actionable bash codeblock');
  }

  // Cleanup
  ws.send(JSON.stringify({ type: 'term:close', sessionId }));
  ws.close();
  console.log('\n🎉 ALL E2E WebSocket tests passed successfully!');
}

testE2E().catch(err => {
  console.error('E2E Test Failed:', err);
  process.exit(1);
});
