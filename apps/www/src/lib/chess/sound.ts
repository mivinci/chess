/** 棋子音效：优先播放 Freesound CC0 实录，失败时回退到 Web Audio 合成 */

const MOVE_SRC = '/sounds/move.mp3';
const CAPTURE_SRC = '/sounds/capture.mp3';

type SoundKind = 'move' | 'capture';

/** 预解码的音频，用 AudioBufferSource.start(when) 精确调度，避免手机上 HTMLAudio.play() 的启动抖动 */
const buffers: Partial<Record<SoundKind, AudioBuffer>> = {};
/** fetch 到的原始数据；不在这里解码，等手势里创建 ctx 后再解，避免无手势时创建 AudioContext */
const rawData: Partial<Record<SoundKind, ArrayBuffer>> = {};
let decodeWhenReady: Promise<void> = Promise.resolve();

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Constructor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return null;
    ctx = new Constructor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/**
 * 在用户手势的同步调用栈里唤醒音频。
 * iOS Safari 要求 audio.play()/AudioContext 在手势中启动过一次，之后 setTimeout 里播放才不会被拦。
 */
let unlocked = false;
export function unlockAudio(): void {
  if (unlocked || typeof window === 'undefined') return;
  unlocked = true;

  // 关键：AudioContext 必须在用户手势的同步调用栈里创建并 resume，
  // iOS Safari 才允许后续播放。绝不能在 onMount 等无手势时机提前创建它。
  const ac = audio();
  if (!ac) return;

  // 播一个无声 buffer 完成解锁（不播真实音效，避免首次点击出声）
  const buf = ac.createBuffer(1, 1, ac.sampleRate);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.start(0);

  // 手势里解码已 fetch 到的音频；若 fetch 还没完成，decodeWhenReady 会在数据到达后补上
  decodeWhenReady = decodeAll();
}

async function decodeAll(): Promise<void> {
  const ac = ctx;
  if (!ac) return;
  await Promise.all(
    (['move', 'capture'] as const).map(async (kind) => {
      const data = rawData[kind];
      if (!data || buffers[kind]) return;
      try {
        buffers[kind] = await ac.decodeAudioData(data.slice(0));
      } catch {
        // 解码失败：播放时回退合成音效
      }
    })
  );
}

function noise(context: AudioContext, duration: number): AudioBuffer {
  const length = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** 落子：清脆的木质「嗒」 */
function synthMove(delayMs = 0): void {
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime + delayMs / 1000;

  const thump = ac.createOscillator();
  const thumpGain = ac.createGain();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(420, now);
  thump.frequency.exponentialRampToValueAtTime(150, now + 0.09);
  thumpGain.gain.setValueAtTime(0.0001, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.35, now + 0.004);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  thump.connect(thumpGain).connect(ac.destination);
  thump.start(now);
  thump.stop(now + 0.12);

  const click = ac.createBufferSource();
  click.buffer = noise(ac, 0.06);
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2100;
  filter.Q.value = 1.1;
  const clickGain = ac.createGain();
  clickGain.gain.setValueAtTime(0.22, now);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
  click.connect(filter).connect(clickGain).connect(ac.destination);
  click.start(now);
}

/** 吃子：更沉更重的「砰」，带一点碎裂感 */
function synthCapture(delayMs = 0): void {
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime + delayMs / 1000;

  const boom = ac.createOscillator();
  const boomGain = ac.createGain();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(260, now);
  boom.frequency.exponentialRampToValueAtTime(70, now + 0.22);
  boomGain.gain.setValueAtTime(0.0001, now);
  boomGain.gain.exponentialRampToValueAtTime(0.6, now + 0.006);
  boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  boom.connect(boomGain).connect(ac.destination);
  boom.start(now);
  boom.stop(now + 0.3);

  const crack = ac.createBufferSource();
  crack.buffer = noise(ac, 0.16);
  const crackFilter = ac.createBiquadFilter();
  crackFilter.type = 'bandpass';
  crackFilter.frequency.value = 950;
  crackFilter.Q.value = 0.8;
  const crackGain = ac.createGain();
  crackGain.gain.setValueAtTime(0.4, now);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  crack.connect(crackFilter).connect(crackGain).connect(ac.destination);
  crack.start(now);
}

/** 精确调度：有解码好的 buffer 就用它（采样级准），否则回退合成音效。delayMs 是相对现在 */
function playScheduled(kind: SoundKind, delayMs: number): void {
  const ac = audio();
  const buffer = buffers[kind];
  if (ac && buffer) {
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const gain = ac.createGain();
    gain.gain.value = kind === 'capture' ? 1 : 0.8;
    src.connect(gain).connect(ac.destination);
    src.start(ac.currentTime + delayMs / 1000);
    return;
  }
  // 没解码好（网络慢或失败）——合成音效也走 AudioContext，同样能按 delay 精确调度
  if (kind === 'move') synthMove(delayMs);
  else synthCapture(delayMs);
}

export function playMoveSound(delayMs = 0): void {
  playScheduled('move', delayMs);
}

export function playCaptureSound(delayMs = 0): void {
  playScheduled('capture', delayMs);
}

/**
 * 只 fetch 音频数据，不创建 AudioContext（那必须等用户手势）。
 * 数据到了就存着；若已解锁则顺便解码。首屏等它完成再显示，保证点棋时数据已在本地。
 */
export function preloadSounds(timeoutMs = 2500): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  const load = async (kind: SoundKind) => {
    const src = kind === 'move' ? MOVE_SRC : CAPTURE_SRC;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(src, { signal: controller.signal });
      if (!res.ok) return;
      rawData[kind] = await res.arrayBuffer();
    } catch {
      // 网络失败：留空，播放时走合成兜底
    } finally {
      clearTimeout(timer);
    }
  };

  return Promise.all([load('move'), load('capture')]).then(async () => {
    // 若用户已手势解锁过（fetch 比手势慢的情况），补一次解码
    if (unlocked) await decodeAll();
  });
}
