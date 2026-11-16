let sharedAudioCtx: AudioContext | null = null;
let pendingChimeAfterGesture = false;
let gestureListenerAttached = false;

function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

function attachGestureUnlock() {
  if (typeof window === 'undefined' || gestureListenerAttached) return;
  gestureListenerAttached = true;

  const onGesture = () => {
    gestureListenerAttached = false;
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
    const ctx = ensureAudioContext();
    if (!ctx) return;
    ctx
      .resume()
      .then(() => {
        if (pendingChimeAfterGesture) {
          pendingChimeAfterGesture = false;
          playBellNotes(ctx);
        }
      })
      .catch(() => {});
  };

  window.addEventListener('pointerdown', onGesture, { once: true });
  window.addEventListener('keydown', onGesture, { once: true });
}

function playBellNotes(ctx: AudioContext): void {
  const now = ctx.currentTime;

  const strikeTone = (freq: number, startOffset: number, duration: number, peakGain: number) => {
    const osc = ctx.createOscillator();
    const harmonic = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + startOffset);

    harmonic.type = 'triangle';
    harmonic.frequency.setValueAtTime(freq * 2, now + startOffset);

    gain.gain.setValueAtTime(0.0001, now + startOffset);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

    const harmonicGain = ctx.createGain();
    harmonicGain.gain.setValueAtTime(0.18, now + startOffset);

    osc.connect(gain);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + startOffset);
    harmonic.start(now + startOffset);
    osc.stop(now + startOffset + duration + 0.02);
    harmonic.stop(now + startOffset + duration + 0.02);
  };

  // Clear two-note chime bell (E5 -> B5)
  strikeTone(659.25, 0, 0.55, 0.22);
  strikeTone(987.77, 0.14, 0.75, 0.2);
}

export function unlockNotificationAudio(): void {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

export function playBellNotification(): void {
  const ctx = ensureAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    pendingChimeAfterGesture = true;
    attachGestureUnlock();
    ctx
      .resume()
      .then(() => {
        if (ctx.state === 'running' && pendingChimeAfterGesture) {
          pendingChimeAfterGesture = false;
          playBellNotes(ctx);
        }
      })
      .catch(() => {});
    return;
  }

  pendingChimeAfterGesture = false;
  playBellNotes(ctx);
}
