/** 棋子音效：优先播放 Freesound CC0 实录，失败时回退到 Web Audio 合成 */

const MOVE_SRC = '/sounds/move.mp3';
const CAPTURE_SRC = '/sounds/capture.mp3';

type SoundKind = 'move' | 'capture';

/** 预解码的音频，用 AudioBufferSource.start(when) 精确调度，避免手机上 HTMLAudio.play() 的启动抖动 */
const buffers: Partial<Record<SoundKind, AudioBuffer>> = {};
/** fetch 到的原始字节；解码交给 OfflineAudioContext（不需要手势），见 decodeAll */
const rawData: Partial<Record<SoundKind, ArrayBuffer>> = {};

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
 * 兜底播放层：不依赖 AudioContext。
 * Web Audio 的 ctx 可能被自动播放策略挂起、或因 HMR/后台标签被回收，
 * 一旦 resume 被拒就彻底静音。<audio> 元素在手势里 play 过一次后最稳。
 */
const els: Partial<Record<SoundKind, HTMLAudioElement>> = {};

function audioEl(kind: SoundKind): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  let el = els[kind];
  if (!el) {
    el = new Audio(kind === 'move' ? MOVE_SRC : CAPTURE_SRC);
    el.preload = 'auto';
    el.volume = kind === 'capture' ? 1 : 0.9;
    els[kind] = el;
  }
  return el;
}

/** 用 <audio> 播放；delayMs > 0 时延迟触发（吃子对齐砸落） */
function playViaElement(kind: SoundKind, delayMs: number): void {
  const el = audioEl(kind);
  if (!el) {
    // 极端兜底：连 <audio> 都建不出来时才用合成音
    if (kind === 'move') synthMove(delayMs);
    else synthCapture(delayMs);
    return;
  }
  const fire = () => {
    try {
      el.muted = false;
      el.currentTime = 0;
      void el.play().catch(() => {
        /* 仍未解锁：静默失败 */
      });
    } catch {
      /* ignore */
    }
  };
  if (delayMs > 0) setTimeout(fire, delayMs);
  else fire();
}

/**
 * 在用户手势的同步调用栈里唤醒音频。
 * iOS Safari 要求 audio.play()/AudioContext 在手势中启动过一次，之后 setTimeout 里播放才不会被拦。
 */
let unlocked = false;
export function unlockAudio(): void {
  if (typeof window === 'undefined') return;

  // 注意：这里不再预热 <audio> 元素。
  // muted=true 后 play() 的静音要过一帧才到音频线程，capture.mp3 开头是峰值 −1dB 的「砰」，
  // 一帧就够漏出声——表现就是「点棋子时听到吃子音」。
  // 主路径是已预解码的 Web Audio，不需要给 <audio> 解锁；
  // 兜底路径的 play() 发生在玩家真实点击（有手势）里，浏览器允许。

  // AudioContext 只在首次手势里创建；失败可重试（不再用 flag 永久锁死）
  const ac = audio();
  if (!ac) return;

  if (unlocked) return;
  unlocked = true;

  // 播一个无声 buffer 完成解锁（不播真实音效，避免首次点击出声）
  const buf = ac.createBuffer(1, 1, ac.sampleRate);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.start(0);

  // 加载屏已用离线上下文解过码；这里只兜底 fetch 比加载屏更慢的情况（幂等）
  void decodeAll();
}

/**
 * 离线解码器：OfflineAudioContext 只做解码不播放，不需要用户手势，
 * 所以可以在加载屏里就把 mp3 解成 AudioBuffer，开局时零等待。
 * AudioBuffer 是独立数据容器，解出来的 buffer 可直接给播放用的 AudioContext 使用
 * （采样率不同时浏览器会重采样）。
 */
let offline: OfflineAudioContext | null = null;

function decoder(): BaseAudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (Ctor) {
    if (!offline) offline = new Ctor(1, 1, 48000);
    return offline;
  }
  // 极老浏览器没有 OfflineAudioContext：退回用手势里建的 ctx
  return ctx;
}

async function decodeAll(): Promise<void> {
  const ac = decoder();
  if (!ac) return;
  await Promise.all(
    (['move', 'capture'] as const).map(async (kind) => {
      const data = rawData[kind];
      if (!data || buffers[kind]) return;
      try {
        buffers[kind] = await ac.decodeAudioData(data.slice(0));
      } catch {
        // 解码失败：播放时回退 <audio> / 合成音
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

function startBuffer(ac: AudioContext, kind: SoundKind, delayMs: number): void {
  const buffer = buffers[kind];
  if (!buffer) return;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const gain = ac.createGain();
  gain.gain.value = kind === 'capture' ? 1 : 0.8;
  src.connect(gain).connect(ac.destination);
  src.start(ac.currentTime + delayMs / 1000);
}

/** 能被 Web Audio 精确调度就用它；否则一律走 <audio> 兜底，保证任何状态下都有声。 */
function playScheduled(kind: SoundKind, delayMs: number): void {
  const ac = audio();
  const buffer = buffers[kind];
  if (ac && buffer) {
    if (ac.state === 'running') {
      startBuffer(ac, kind, delayMs);
      return;
    }
    // ctx 不是 running：试着 resume，失败立刻降级到 <audio>，不要静默吞掉
    ac.resume()
      .then(() => startBuffer(ac, kind, delayMs))
      .catch(() => playViaElement(kind, delayMs));
    return;
  }
  // 没解码好 / ctx 不可用：<audio> 元素自带解码，不依赖 AudioContext 状态
  playViaElement(kind, delayMs);
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
    // 用 OfflineAudioContext 在加载屏里就解码完，开局时 buffer 已就绪，
    // 不再依赖「首次点击」这个时机。
    await decodeAll();
  });
}
