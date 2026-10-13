// public/js/notify.js
// Client notifications: Web Notifications API, in-page banner, Web Audio chime synthesis, and vibration

(function(window) {
  'use strict';

  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Synthesize musical chime via Web Audio API (reliable offline fallback)
  function playChime(level) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      if (level === 'called') {
        // Uplifting 3-tone chime for "Your turn" (C5 -> E5 -> G5)
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.15);

          gain.gain.setValueAtTime(0.001, now + idx * 0.15);
          gain.gain.exponentialRampToValueAtTime(0.3, now + idx * 0.15 + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.15 + 0.35);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + idx * 0.15);
          osc.stop(now + idx * 0.15 + 0.36);
        });
      } else {
        // 2-tone melodic chime for "Leave now" & "Almost" (D5 -> A5)
        const notes = [587.33, 880.00];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.16);

          gain.gain.setValueAtTime(0.001, now + idx * 0.16);
          gain.gain.exponentialRampToValueAtTime(0.25, now + idx * 0.16 + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.38);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + idx * 0.16);
          osc.stop(now + idx * 0.16 + 0.39);
        });
      }
    } catch (e) {
      console.warn('[Notify] Audio chime failed:', e);
    }
  }

  // Device vibration
  function triggerVibration(level) {
    if ('vibrate' in navigator) {
      try {
        if (level === 'called') {
          navigator.vibrate([400, 150, 400, 150, 600]);
        } else if (level === 'leaveNow') {
          navigator.vibrate([250, 120, 250]);
        } else {
          navigator.vibrate([300, 100, 300]);
        }
      } catch (e) {}
    }
  }

  // In-page Banner Display
  function ensureBannerContainer() {
    let container = document.getElementById('notifyBannerContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notifyBannerContainer';
      container.style.cssText = `
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        width: calc(100% - 32px);
        max-width: 440px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }
    return container;
  }

  function showBanner(level, title, message) {
    const container = ensureBannerContainer();

    const banner = document.createElement('div');
    banner.style.cssText = `
      pointer-events: auto;
      border-radius: 12px;
      padding: 14px 16px;
      box-shadow: 0 8px 24px rgba(20, 33, 61, 0.2);
      display: flex;
      align-items: flex-start;
      gap: 12px;
      animation: bannerSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      transition: opacity 0.25s ease, transform 0.25s ease;
      font-family: inherit;
    `;

    // Colors matching theme
    let bg = '#FFFFFF';
    let text = '#14213D';
    let border = '#D5DCEA';
    let icon = '🔔';

    if (level === 'leaveNow') {
      bg = '#FEF3C7';
      text = '#92400E';
      border = '#FDE68A';
      icon = '🚗';
    } else if (level === 'almost') {
      bg = '#EFF6FF';
      text = '#1E3A8A';
      border = '#BFDBFE';
      icon = '⏳';
    } else if (level === 'called') {
      bg = '#DCFCE7';
      text = '#15803D';
      border = '#BBF7D0';
      icon = '📣';
    }

    banner.style.background = bg;
    banner.style.color = text;
    banner.style.border = `1.5px solid ${border}`;

    banner.innerHTML = `
      <div style="font-size: 24px; line-height: 1; flex-shrink: 0;">${icon}</div>
      <div style="flex: 1;">
        <div style="font-weight: 800; font-size: 15px; margin-bottom: 2px;">${title}</div>
        <div style="font-size: 14px; line-height: 1.4;">${message}</div>
      </div>
      <button type="button" style="background: none; border: none; font-size: 18px; line-height: 1; cursor: pointer; color: inherit; padding: 0 4px; opacity: 0.7;" aria-label="Close">✕</button>
    `;

    const closeBtn = banner.querySelector('button');
    closeBtn.onclick = () => {
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(-10px)';
      setTimeout(() => banner.remove(), 250);
    };

    container.appendChild(banner);

    // Auto-remove after 8 seconds
    setTimeout(() => {
      if (banner.parentElement) {
        banner.style.opacity = '0';
        banner.style.transform = 'translateY(-10px)';
        setTimeout(() => banner.remove(), 250);
      }
    }, 8000);
  }

  // Browser Notification API
  async function requestPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    try {
      const result = await Notification.requestPermission();
      return result;
    } catch (e) {
      return 'denied';
    }
  }

  function sendBrowserNotification(title, body, tag) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          tag: tag || 'baari-alert',
          renotify: true
        });
      } catch (e) {
        console.warn('[Notify] Browser Notification creation failed:', e);
      }
    }
  }

  // Master trigger function
  function trigger(level, message, meta = {}) {
    let title = 'Baari Queue Alert';
    if (level === 'leaveNow') title = 'Time to head over!';
    if (level === 'almost') title = 'Almost your turn!';
    if (level === 'called') title = "It's your turn now!";

    // 1. Play sound
    playChime(level);

    // 2. Vibrate
    triggerVibration(level);

    // 3. In-page floating banner
    showBanner(level, title, message);

    // 4. Browser Notification
    sendBrowserNotification(title, message, level);
  }

  // Initialize and attach to Socket.IO
  function init(publicId, socket) {
    // Inject keyframes style once
    if (!document.getElementById('notifyKeyframes')) {
      const style = document.createElement('style');
      style.id = 'notifyKeyframes';
      style.textContent = `
        @keyframes bannerSlideIn {
          from { opacity: 0; transform: translateY(-16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    // Unlock AudioContext on first user click
    const unlockAudio = () => {
      getAudioContext();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);

    // Socket listener for alerts
    if (socket) {
      socket.on('notify:alert', (data) => {
        if (!data) return;
        if (!data.publicId || data.publicId === publicId) {
          trigger(data.level, data.message, data);
        }
      });
    }
  }

  window.NotifyManager = {
    init,
    trigger,
    playChime,
    requestPermission,
    showBanner,
    getAudioContext
  };

})(window);
