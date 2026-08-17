// Minimal LiveKit integration placeholder.
// Replace with real initialization and token handling when ready.

const LiveKitClient = window.livekit || window.LiveKit; // depends on the CDN script

async function initLiveKit(token, roomName) {
  if (!LiveKitClient) {
    console.warn('LiveKit client not found on window. Include LiveKit SDK before this script.');
    return null;
  }
  // Example usage (application should create proper access token server-side):
  // const url = 'wss://your-livekit-server';
  // const room = await LiveKitClient.connect(url, token);
  // return room;
  return null;
}

window.livekitClient = { initLiveKit };
