/** 棋子音效：优先播放 Freesound CC0 实录，失败时回退到 Web Audio 合成 */

const MOVE_SRC = '/sounds/move.mp3';
const CAPTURE_SRC = '/sounds/capture.mp3';

type SoundKind = 'move' | 'capture';

const players: Partial<Record<SoundKind, HTMLAudioElement>> = {};
let failed: Partial<Record<SoundKind, boolean>> = {};

function filePlayer(kind: SoundKind): HTMLAudioElement | null {
  if (typeof window === 'undefined' || failed[kind]) return null;
  let audio = players[kind];
  if (!audio) {
    audio = new Audio(kind === 'move' ? MOVE_SRC : CAPTURE_SRC);
    audio.preload = 'auto';
    audio.volume = kind === 'capture' ? 1 : 0.8;
    audio.addEventListener('error', () => {
      failed[kind] = true;
    });
    players[kind] = audio;
  }
  return audio;
}

function playFile(kind: SoundKind): boolean {
  const audio = filePlayer(kind);
  if (!audio) return false;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    // 自动播放被拦截或文件不可用时，交给合成音效兜底
    failed[kind] = true;
  });
  return true;
}

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

function noise(context: AudioContext, duration: number): AudioBuffer {
  const length = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** 落子：清脆的木质「嗒」 */
function synthMove(): void {
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime;

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
function synthCapture(): void {
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime;

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

export function playMoveSound(): void {
  if (!playFile('move')) synthMove();
}

export function playCaptureSound(): void {
  if (!playFile('capture')) synthCapture();
}

/**
 * 预加载音效文件，全部就绪后 resolve。
 * 单个文件失败或超时都当作「已结束」——音效有合成兜底，不能让它阻塞页面显示。
 */
export function preloadSounds(timeoutMs = 2500): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  const waitFor = (kind: SoundKind) =>
    new Promise<void>((resolve) => {
      const audio = filePlayer(kind);
      if (!audio) return resolve();

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        audio.removeEventListener('canplaythrough', finish);
        audio.removeEventListener('error', finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      audio.addEventListener('canplaythrough', finish);
      audio.addEventListener('error', finish);

      // 缓存命中时事件可能已经错过
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) finish();
      audio.load();
    });

  return Promise.all([waitFor('move'), waitFor('capture')]).then(() => undefined);
}
