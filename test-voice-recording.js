const WebSocket = require('ws');

console.log('Starting voice recording test...');

const ws = new WebSocket('ws://localhost:8765');

let messageCount = 0;

ws.on('open', () => {
  console.log('[Test] Connected to voice service');

  console.log('[Test] Sending start recording command...');
  ws.send(JSON.stringify({ type: 'start' }));
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    messageCount++;

    console.log(`[Test] Message #${messageCount}:`, message.type);

    if (message.type === 'status') {
      console.log('[Test] Status:', message.status);

      if (message.status && message.status.isRecording && !this.hasStartedTimer) {
        this.hasStartedTimer = true;
        console.log('[Test] Recording started, waiting 5 seconds...');

        setTimeout(() => {
          console.log('[Test] Sending stop command...');
          ws.send(JSON.stringify({ type: 'stop' }));
        }, 5000);
      }
    }

    if (message.type === 'audio_saved') {
      console.log('[Test] ✅ Audio saved successfully!');
      console.log('[Test] Audio path:', message.audioPath);

      setTimeout(() => {
        console.log('[Test] Closing connection...');
        ws.close();
        process.exit(0);
      }, 1000);
    }

    if (message.type === 'error') {
      console.error('[Test] ❌ Error:', message.errorMessage);
    }

  } catch (error) {
    console.error('[Test] Failed to parse message:', error);
  }
});

ws.on('error', (error) => {
  console.error('[Test] WebSocket error:', error);
});

ws.on('close', () => {
  console.log('[Test] Connection closed');

  if (messageCount === 0) {
    console.error('[Test] ❌ No messages received!');
    process.exit(1);
  } else {
    console.log('[Test] ✅ Test completed successfully!');
    process.exit(0);
  }
});

setTimeout(() => {
  console.error('[Test] Timeout after 30 seconds');
  ws.close();
  process.exit(1);
}, 30000);
