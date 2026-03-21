const WebSocket = require('ws');

// 禁用自动UTF-8验证来查看原始数据
const ws = new WebSocket('ws://localhost:8765', {
  binaryType: 'arraybuffer',
  verifyUTF8: false
});

let messageCount = 0;

ws.on('open', () => {
  console.log('[Test] Connected');

  // 发送一个简单的JSON消息
  const message = JSON.stringify({ type: 'start' });
  const data = Buffer.from(message);

  // 构建WebSocket帧 (FIN + Text frame, no mask)
  const frame = Buffer.alloc(2 + data.length);
  frame[0] = 0x81; // FIN + Text frame
  frame[1] = data.length; // No mask, payload length
  data.copy(frame, 2);

  console.log('[Test] Sending frame:', frame);
  ws.send(frame);
});

ws.on('message', (data, isBinary) => {
  messageCount++;
  console.log(`[Test] Message #${messageCount}, binary: ${isBinary}, length: ${data.length}`);

  if (data instanceof ArrayBuffer) {
    const buffer = Buffer.from(data);
    console.log('[Test] Binary data:', buffer.slice(0, Math.min(100, buffer.length)));
    console.log('[Test] As string:', buffer.toString('utf8', 2, buffer[1] + 2));
  } else {
    console.log('[Test] Text data:', data.toString());
  }

  if (messageCount === 1) {
    setTimeout(() => {
      console.log('[Test] Closing...');
      ws.close();
    }, 1000);
  }
});

ws.on('error', (error) => {
  console.error('[Test] Error:', error.message);
});

ws.on('close', () => {
  console.log('[Test] Closed');
  process.exit(messageCount > 0 ? 0 : 1);
});

setTimeout(() => {
  console.error('[Test] Timeout');
  ws.close();
  process.exit(1);
}, 10000);
