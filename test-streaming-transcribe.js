const WebSocket = require('ws');

console.log('Starting streaming transcription test...');

const ws = new WebSocket('ws://localhost:8765');

let transcriptCount = 0;

ws.on('open', () => {
  console.log('[Test] Connected to voice service');

  console.log('[Test] Sending start recording command...');
  ws.send(JSON.stringify({ type: 'start' }));
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    
    if (message.type === 'status') {
      console.log('[Test] Status:', message.status?.isRecording ? 'Recording' : 'Stopped');
    }
    
    if (message.type === 'transcript') {
      transcriptCount++;
      console.log(`[Test] Transcript #${transcriptCount}:`, message.text);
    }
    
    if (message.type === 'audio_saved') {
      console.log('[Test] Audio saved:', message.audioPath);
    }
    
    if (message.type === 'error') {
      console.error('[Test] Error:', message.errorMessage);
    }
    
  } catch (error) {
    console.error('[Test] Parse error:', error);
  }
});

ws.on('error', (error) => {
  console.error('[Test] WebSocket error:', error);
});

ws.on('close', () => {
  console.log('[Test] Connection closed');
  console.log(`[Test] Total transcripts received: ${transcriptCount}`);
  process.exit(0);
});

setTimeout(() => {
  console.log('[Test] Recording for 10 seconds, stopping...');
  ws.send(JSON.stringify({ type: 'stop' }));
  
  setTimeout(() => {
    console.log('[Test] Closing connection...');
    ws.close();
  }, 2000);
}, 10000);
