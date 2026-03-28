// ============================================
// DFF! – Alarm Utilities
// Handles sound playback, vibration, and wake lock
// ============================================

let audioContext = null;
let alarmOscillator = null;
let alarmGain = null;
let isPlaying = false;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

export function playAlarmSound() {
  if (isPlaying) return;
  isPlaying = true;

  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    // Create alarm sound pattern: alternating tones
    const now = ctx.currentTime;
    
    alarmGain = ctx.createGain();
    alarmGain.connect(ctx.destination);
    alarmGain.gain.setValueAtTime(0.3, now);

    function playTone() {
      if (!isPlaying) return;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      gainNode.connect(ctx.destination);
      osc1.connect(gainNode);
      osc2.connect(gainNode);

      osc1.type = 'sine';
      osc2.type = 'sine';

      const t = ctx.currentTime;
      
      // Two-tone alarm pattern
      osc1.frequency.setValueAtTime(880, t);
      osc1.frequency.setValueAtTime(660, t + 0.15);
      osc1.frequency.setValueAtTime(880, t + 0.3);
      osc1.frequency.setValueAtTime(660, t + 0.45);

      osc2.frequency.setValueAtTime(440, t);
      osc2.frequency.setValueAtTime(330, t + 0.15);
      osc2.frequency.setValueAtTime(440, t + 0.3);
      osc2.frequency.setValueAtTime(330, t + 0.45);

      gainNode.gain.setValueAtTime(0.15, t);
      gainNode.gain.linearRampToValueAtTime(0.25, t + 0.05);
      gainNode.gain.setValueAtTime(0.05, t + 0.14);
      gainNode.gain.linearRampToValueAtTime(0.25, t + 0.16);
      gainNode.gain.setValueAtTime(0.05, t + 0.29);
      gainNode.gain.linearRampToValueAtTime(0.25, t + 0.31);
      gainNode.gain.setValueAtTime(0.05, t + 0.44);
      gainNode.gain.linearRampToValueAtTime(0, t + 0.6);

      osc1.start(t);
      osc1.stop(t + 0.6);
      osc2.start(t);
      osc2.stop(t + 0.6);

      // Repeat after pause
      if (isPlaying) {
        setTimeout(playTone, 900);
      }
    }

    playTone();
  } catch (e) {
    console.warn('Could not play alarm sound:', e);
  }
}

export function stopAlarmSound() {
  isPlaying = false;
  if (alarmOscillator) {
    try { alarmOscillator.stop(); } catch (e) { /* already stopped */ }
    alarmOscillator = null;
  }
  if (alarmGain) {
    try { alarmGain.disconnect(); } catch (e) { /* already disconnected */ }
    alarmGain = null;
  }
}

// --- Vibration ---
let vibrationInterval = null;

export function startVibration() {
  if (!navigator.vibrate) return;
  
  // Vibration pattern: vibrate-pause-vibrate
  function vibratePattern() {
    navigator.vibrate([200, 100, 200, 100, 400]);
  }
  
  vibratePattern();
  vibrationInterval = setInterval(vibratePattern, 1500);
}

export function stopVibration() {
  if (vibrationInterval) {
    clearInterval(vibrationInterval);
    vibrationInterval = null;
  }
  if (navigator.vibrate) {
    navigator.vibrate(0);
  }
}

// --- Wake Lock ---
let wakeLock = null;

export async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {
    console.warn('Wake lock not available:', e);
  }
}

export async function releaseWakeLock() {
  if (wakeLock) {
    try { await wakeLock.release(); } catch (e) { /* ok */ }
    wakeLock = null;
  }
}

// --- Combined alarm start/stop ---
export function startAlarm(settings = {}) {
  if (settings.soundEnabled !== false) playAlarmSound();
  if (settings.vibrationEnabled !== false) startVibration();
  requestWakeLock();
}

export function stopAlarm() {
  stopAlarmSound();
  stopVibration();
  releaseWakeLock();
}
