/**
 * POS Sound Effects using Web Audio API
 *
 * Generates standard POS terminal sounds without requiring external audio files.
 * All sounds are synthesized in the browser using oscillators and gain nodes.
 */

type POSSoundType = "addToCart" | "orderComplete" | "payment" | "error";

interface POSSoundSettings {
  enabled: boolean;
  volume: number; // 0-100
  addToCart: boolean;
  orderComplete: boolean;
  payment: boolean;
  error: boolean;
}

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  // Resume if suspended (browsers require user interaction)
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
  return audioContext;
}

function playTone(
  frequency: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
  startDelay = 0
) {
  const ctx = getAudioContext();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + startDelay);

  const normalizedVolume = (volume / 100) * 0.3; // cap at 0.3 max
  gainNode.gain.setValueAtTime(normalizedVolume, ctx.currentTime + startDelay);
  // Fade out to prevent click
  gainNode.gain.exponentialRampToValueAtTime(
    0.001,
    ctx.currentTime + startDelay + duration
  );

  oscillator.start(ctx.currentTime + startDelay);
  oscillator.stop(ctx.currentTime + startDelay + duration);
}

/**
 * Short cheerful beep - product scanned / added to cart
 */
function playAddToCart(volume: number) {
  playTone(880, 0.08, volume, "sine", 0);
  playTone(1100, 0.08, volume, "sine", 0.06);
}

/**
 * Success chime - order complete
 */
function playOrderComplete(volume: number) {
  playTone(523, 0.15, volume, "sine", 0); // C5
  playTone(659, 0.15, volume, "sine", 0.12); // E5
  playTone(784, 0.15, volume, "sine", 0.24); // G5
  playTone(1047, 0.25, volume, "sine", 0.36); // C6
}

/**
 * Processing beep - payment accepted
 */
function playPayment(volume: number) {
  playTone(660, 0.1, volume, "sine", 0);
  playTone(880, 0.15, volume, "sine", 0.1);
}

/**
 * Error buzz - low double beep
 */
function playError(volume: number) {
  playTone(300, 0.15, volume, "square", 0);
  playTone(250, 0.2, volume, "square", 0.18);
}

// ============================================
// Public API
// ============================================

const soundPlayers: Record<POSSoundType, (volume: number) => void> = {
  addToCart: playAddToCart,
  orderComplete: playOrderComplete,
  payment: playPayment,
  error: playError,
};

let currentSettings: POSSoundSettings = {
  enabled: true,
  volume: 50,
  addToCart: true,
  orderComplete: true,
  payment: true,
  error: true,
};

/**
 * Configure POS sound settings. Call this when settings are loaded.
 */
export function configurePOSSounds(settings: POSSoundSettings) {
  currentSettings = { ...settings };
}

/**
 * Play a POS sound effect if enabled in settings.
 */
export function playPOSSound(type: POSSoundType) {
  if (!currentSettings.enabled) return;
  if (!currentSettings[type]) return;
  if (currentSettings.volume <= 0) return;
  if (typeof window === "undefined") return;

  try {
    soundPlayers[type](currentSettings.volume);
  } catch {
    // Web Audio API not available - silently fail
  }
}

/**
 * Preview a sound at a specific volume (for settings page).
 */
export function previewPOSSound(type: POSSoundType, volume: number) {
  if (typeof window === "undefined") return;
  try {
    soundPlayers[type](volume);
  } catch {
    // silently fail
  }
}
