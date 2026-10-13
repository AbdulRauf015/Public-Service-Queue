// public/js/socket.js
// Socket.IO client manager with reconnect handling and polling fallback

function createSocketManager() {
  let socket = null;
  let isConnected = false;
  let pollingInterval = null;

  function init(options = {}) {
    if (typeof io === 'undefined') {
      console.warn('Socket.IO library not loaded');
      return;
    }

    socket = io();

    socket.on('connect', () => {
      isConnected = true;
      console.log('[Socket] Connected, ID:', socket.id);
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      if (options.onConnect) options.onConnect(socket);
    });

    socket.on('disconnect', () => {
      isConnected = false;
      console.warn('[Socket] Disconnected. Activating polling fallback...');
      if (options.onDisconnect) options.onDisconnect();

      // Start fallback polling if polling callback provided
      if (options.onPoll && !pollingInterval) {
        pollingInterval = setInterval(() => {
          options.onPoll();
        }, 5000);
      }
    });

    if (options.onQueueUpdate) {
      socket.on('queue:updated', options.onQueueUpdate);
    }
    if (options.onTokenUpdate) {
      socket.on('token:updated', options.onTokenUpdate);
    }
    if (options.onTokenCalled) {
      socket.on('token:called', options.onTokenCalled);
    }
    if (options.onCounterUpdate) {
      socket.on('counter:updated', options.onCounterUpdate);
    }
    if (options.onNotifyAlert) {
      socket.on('notify:alert', options.onNotifyAlert);
    }

    return socket;
  }

  function joinBranch(branchId) {
    if (socket && isConnected) {
      socket.emit('join:branch', branchId);
    }
  }

  function joinToken(publicId) {
    if (socket && isConnected) {
      socket.emit('join:token', publicId);
    }
  }

  return {
    init,
    joinBranch,
    joinToken,
    getSocket: () => socket,
    isConnected: () => isConnected
  };
}

window.SocketManager = createSocketManager();
