<script lang="ts">
  import { cubicOut } from 'svelte/easing';
  import type { TransitionConfig } from 'svelte/transition';
  import { pieceLabel } from '#lib/chess/board';
  import { ELEPHANT, KNIGHT, sideOf, typeOf, xOf, yOf, type Move, type Side } from '#lib/chess/types';
  import { cn } from '#lib/utils';

  interface Props {
    board: ArrayLike<number>;
    pieceIds: ArrayLike<number>;
    playerSide: Side;
    selected: number | null;
    targets: number[];
    lastMove: Move | null;
    hint: Move | null;
    checkKing: number;
    disabled?: boolean;
    onsquare: (index: number) => void;
  }

  let {
    board,
    pieceIds,
    playerSide,
    selected,
    targets,
    lastMove,
    hint,
    checkKing,
    disabled = false,
    onsquare
  }: Props = $props();

  const BOARD_W = 810;
  const BOARD_H = 900;
  const MARGIN = 45;
  const SPACING = 90;

  // 棋子层尺寸正好是一格，所以 transform: translate(x%, y%) 移动一格就是 100%
  const squares = Array.from({ length: 90 }, (_, i) => ({
    index: i,
    left: ((MARGIN + xOf(i) * SPACING - SPACING / 2) / BOARD_W) * 100,
    top: ((MARGIN + yOf(i) * SPACING - SPACING / 2) / BOARD_H) * 100,
    tx: xOf(i) * 100,
    ty: yOf(i) * 100
  }));

  const rows = Array.from({ length: 10 }, (_, r) => MARGIN + r * SPACING);
  const cols = Array.from({ length: 9 }, (_, c) => MARGIN + c * SPACING);

  const markerPoints = [
    [1, 2], [7, 2], [1, 7], [7, 7],
    [0, 3], [2, 3], [4, 3], [6, 3], [8, 3],
    [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]
  ];

  // 九宫米字格：两端 3×3 区域各画两条对角线
  const palaceDiagonals = [
    [3, 0, 5, 2], [5, 0, 3, 2],
    [3, 7, 5, 9], [5, 7, 3, 9]
  ] as const;

  function markerPath(col: number, row: number): string {
    const cx = MARGIN + col * SPACING;
    const cy = MARGIN + row * SPACING;
    const gap = 7;
    const len = 13;
    const parts: string[] = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const ax = cx + sx * gap;
        const ay = cy + sy * gap;
        const bx = ax + sx * len;
        const by = ay + sy * len;
        if (bx < MARGIN || bx > MARGIN + 8 * SPACING) continue;
        if (by < MARGIN || by > MARGIN + 9 * SPACING) continue;
        parts.push(`M ${bx} ${ay} L ${ax} ${ay} L ${ax} ${by}`);
      }
    }
    return parts.join(' ');
  }

  function labelFor(index: number) {
    return pieceLabel(board[index]);
  }

  /** 棋子按固定身份渲染，位置由坐标数据决定；这样走子时是同一节点在移动 */
  let pieces = $derived.by(() => {
    const result: {
      id: number;
      index: number;
      tx: number;
      ty: number;
      capturing: boolean;
      moving: boolean;
    }[] = [];
    for (let i = 0; i < 90; i++) {
      const id = pieceIds[i];
      if (id === 0 || board[i] === 0) continue;
      result.push({
        id,
        index: i,
        tx: squares[i].tx,
        ty: squares[i].ty,
        capturing: lastMove !== null && lastMove.captured !== 0 && lastMove.to === i,
        moving: lastMove !== null && lastMove.to === i
      });
    }
    return result;
  });

  let hoveredIndex = $state<number | null>(null);
  let boardFrame: HTMLDivElement;
  let impact = $state<{ key: number; x: number; y: number } | null>(null);
  let impactKey = 0;

  /** 被吃棋子：等吃子方砸下来的瞬间再炸开 */
  function captureOut(
    node: Element,
    { duration = 240, delay = 420 }: { duration?: number; delay?: number } = {}
  ): TransitionConfig {
    const computed = getComputedStyle(node).transform;
    const baseTransform = computed === 'none' ? '' : computed;
    return {
      duration,
      delay,
      easing: cubicOut,
      css: (t: number, u: number) => `
        transform: ${baseTransform} translateY(${-u * 64}px) translateX(${u * 18}px) rotate(${u * 42}deg) scale(${1 - u * 0.65});
        opacity: ${t};
      `
    };
  }

  // 吃子落地的瞬间：棋盘震动 + 落点冲击环
  $effect(() => {
    const move = lastMove;
    if (!move || move.captured === 0 || !boardFrame) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;

    boardFrame.animate(
      [
        { transform: 'translate3d(0, 0, 0)' },
        { transform: 'translate3d(-6px, 5px, 0) rotate(-0.45deg)' },
        { transform: 'translate3d(7px, -4px, 0) rotate(0.4deg)' },
        { transform: 'translate3d(-5px, 3px, 0) rotate(-0.25deg)' },
        { transform: 'translate3d(3px, -2px, 0) rotate(0.12deg)' },
        { transform: 'translate3d(0, 0, 0)' }
      ],
      { duration: 340, delay: 430, easing: 'ease-out' }
    );

    const key = ++impactKey;
    const x = MARGIN + xOf(move.to) * SPACING;
    const y = MARGIN + yOf(move.to) * SPACING;
    impact = { key, x, y };
    const timer = setTimeout(() => {
      if (impact?.key === key) impact = null;
    }, 900);
    return () => clearTimeout(timer);
  });

  // 马走「日」、象走「田」，都是跳跃式，直线补间会像滑行。给它们播一段抛物线模拟跳跃。
  // CSS transition 也在驱动 transform，但 WAAPI 动画期间优先级更高；播完回落到已更新的 inline 坐标，衔接自然。
  let jumpedKey = '';
  $effect(() => {
    const move = lastMove;
    if (!move || !boardFrame) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;

    // 走子后 to 位上的棋子就是刚落的那个；只处理马和象
    const pieceType = typeOf(board[move.to]);
    if (pieceType !== KNIGHT && pieceType !== ELEPHANT) return;
    const id = pieceIds[move.to];
    const key = `${id}:${move.from}:${move.to}`;
    if (key === jumpedKey) return; // 同一走子不重复播（悔棋/重渲染时）
    jumpedKey = key;

    const node = boardFrame.querySelector<HTMLElement>(`[data-piece-id="${id}"]`);
    if (!node) return;

    const from = squares[move.from];
    const to = squares[move.to];
    // 二次贝塞尔：控制点在起终点中点上方，曲线不过控制点，所以偏移取 lift 两倍
    const lift = pieceType === ELEPHANT ? 50 : 40;
    const cx = (from.tx + to.tx) / 2;
    const cy = (from.ty + to.ty) / 2 - lift;

    // 多帧采样成平滑弧线；三段关键帧会在中点硬拐方向，看着歪歪扭扭
    const frames = Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      const u = 1 - t;
      const x = u * u * from.tx + 2 * u * t * cx + t * t * to.tx;
      const y = u * u * from.ty + 2 * u * t * cy + t * t * to.ty;
      return { transform: `translate(${x}%, ${y}%)`, offset: t };
    });

    node.animate(frames, {
      duration: 550,
      easing: 'cubic-bezier(0.35, 0.05, 0.5, 1)',
      composite: 'replace'
    });
  });

  // 视角固定为玩家执子方：执黑时旋转棋盘，使己方始终在下方
  let flipped = $derived(playerSide === -1);
</script>

<div class="board-frame" bind:this={boardFrame}>
  <div class="board-surface" class:flipped>
    <svg class="lines" viewBox="0 0 {BOARD_W} {BOARD_H}" aria-hidden="true">
      <g stroke="#5a3a1c" stroke-width="1.8" fill="none" stroke-linecap="square">
        {#each rows as y}
          <line x1={MARGIN} y1={y} x2={MARGIN + 8 * SPACING} y2={y} />
        {/each}
        {#each cols as x, c}
          {#if c === 0 || c === 8}
            <line x1={x} y1={MARGIN} x2={x} y2={MARGIN + 9 * SPACING} />
          {:else}
            <line x1={x} y1={MARGIN} x2={x} y2={MARGIN + 4 * SPACING} />
            <line x1={x} y1={MARGIN + 5 * SPACING} x2={x} y2={MARGIN + 9 * SPACING} />
          {/if}
        {/each}
        <rect
          x={MARGIN}
          y={MARGIN}
          width={8 * SPACING}
          height={9 * SPACING}
          stroke-width="3"
        />
        {#each palaceDiagonals as [c1, r1, c2, r2]}
          <line
            x1={MARGIN + c1 * SPACING}
            y1={MARGIN + r1 * SPACING}
            x2={MARGIN + c2 * SPACING}
            y2={MARGIN + r2 * SPACING}
          />
        {/each}
        {#each markerPoints as [c, r]}
          <path d={markerPath(c, r)} stroke-width="1.5" />
        {/each}
      </g>
      <g
        fill="#6b4423"
        font-family="ChessKai, STKaiti, Kaiti SC, KaiTi, Songti SC, serif"
        font-size="46"
        text-anchor="middle"
        opacity="0.85"
      >
        <text x="235" y="466" letter-spacing="12">楚 河</text>
        <text x="575" y="466" letter-spacing="12">汉 界</text>
      </g>
      {#if lastMove}
        <circle
          cx={MARGIN + xOf(lastMove.from) * SPACING}
          cy={MARGIN + yOf(lastMove.from) * SPACING}
          r="9"
          fill="rgba(214, 150, 55, 0.55)"
        />
        <circle
          cx={MARGIN + xOf(lastMove.to) * SPACING}
          cy={MARGIN + yOf(lastMove.to) * SPACING}
          r="9"
          fill="rgba(214, 150, 55, 0.55)"
        />
      {/if}
      {#if impact}
        {#key impact.key}
          <circle
            class="impact-ring"
            cx={impact.x}
            cy={impact.y}
            r="18"
            fill="none"
            stroke="#fff3d0"
            stroke-width="7"
          />
          <circle
            class="impact-ring impact-ring-inner"
            cx={impact.x}
            cy={impact.y}
            r="8"
            fill="#fff3d0"
          />
        {/key}
      {/if}
      {#if hint}
        {@const hx1 = MARGIN + xOf(hint.from) * SPACING}
        {@const hy1 = MARGIN + yOf(hint.from) * SPACING}
        {@const hx2 = MARGIN + xOf(hint.to) * SPACING}
        {@const hy2 = MARGIN + yOf(hint.to) * SPACING}
        {@const hlen = Math.hypot(hx2 - hx1, hy2 - hy1) || 1}
        {@const hux = (hx2 - hx1) / hlen}
        {@const huy = (hy2 - hy1) / hlen}
        <g class="hint-layer">
          <line
            x1={hx1 + hux * 34}
            y1={hy1 + huy * 34}
            x2={hx2 - hux * 34}
            y2={hy2 - huy * 34}
            stroke="#f0b13d"
            stroke-width="3"
            stroke-dasharray="7 7"
            opacity="0.85"
          />
          <circle cx={hx1} cy={hy1} r="34" fill="none" stroke="#f0b13d" stroke-width="2.5" opacity="0.8" />
          <circle cx={hx2} cy={hy2} r="38" fill="none" stroke="#f0b13d" stroke-width="3.5" opacity="0.95" />
          <circle cx={hx2} cy={hy2} r="44" fill="none" stroke="#f0b13d" stroke-width="1.5" opacity="0.4" />
        </g>
      {/if}
    </svg>

    {#each squares as sq (sq.index)}
      {@const piece = board[sq.index]}
      <button
        type="button"
        class="square"
        class:disabled
        style:left="{sq.left}%"
        style:top="{sq.top}%"
        onclick={() => onsquare(sq.index)}
        onmouseenter={() => (hoveredIndex = sq.index)}
        onmouseleave={() => (hoveredIndex = null)}
        disabled={disabled}
        aria-label={labelFor(sq.index) || `第 ${sq.index + 1} 个交叉点`}
      >
        {#if targets.includes(sq.index)}
          <span class="target" class:capture={piece !== 0}></span>
        {/if}
      </button>
    {/each}

    <!-- 棋子是独立的一层：走子时 id 不变、只有坐标变，浏览器据此补出位移 -->
    {#each pieces as item (item.id)}
      <div
        class="piece-position"
        class:capturing={item.capturing}
        class:moving={item.moving}
        data-piece-id={item.id}
        style:transform="translate({item.tx}%, {item.ty}%)"
        out:captureOut
      >
        {#if item.capturing}
          <span class="flight-shadow"></span>
        {/if}
        <span
          class={cn('piece', sideOf(board[item.index]) === 1 ? 'red' : 'black')}
          class:selected={selected === item.index}
          class:checked={checkKing === item.index}
          class:hovered={hoveredIndex === item.index && !disabled}
        >
          {labelFor(item.index)}
        </span>
      </div>
    {/each}
  </div>
</div>

<style>
  .board-frame {
    width: 100%;
    max-width: 600px;
    margin-inline: auto;
    padding: 6px;
    border-radius: 8px;
    background: linear-gradient(150deg, #6b4524 0%, #4a2f16 45%, #33200e 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 220, 160, 0.2),
      0 8px 20px rgba(0, 0, 0, 0.35);
  }

  .board-surface {
    position: relative;
    width: 100%;
    aspect-ratio: 810 / 900;
    container-type: inline-size;
    border-radius: 3px;
    overflow: hidden;
    background:
      repeating-linear-gradient(
        93deg,
        rgba(105, 65, 25, 0.055) 0 1px,
        transparent 1px 7px
      ),
      repeating-linear-gradient(
        3deg,
        rgba(120, 78, 32, 0.04) 0 2px,
        transparent 2px 11px
      ),
      linear-gradient(145deg, #e7ca9a 0%, #d9b47c 42%, #c79b61 100%);
    transition: transform 0.45s cubic-bezier(0.22, 0.61, 0.36, 1);
  }

  .board-surface.flipped {
    transform: rotate(180deg);
  }

  .lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .square {
    position: absolute;
    width: 11.111%;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    z-index: 2;
  }

  .square:focus-visible {
    outline: 2px solid #e2a23c;
    outline-offset: -2px;
    border-radius: 50%;
  }

  .piece-position {
    position: absolute;
    left: 0;
    top: 0;
    width: 11.111%;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 3;
    /* transform 走合成层，不触发布局重排；同一个节点坐标改变时补出位移 */
    transition: transform 0.55s cubic-bezier(0.45, 0.05, 0.55, 1);
    will-change: transform;
  }

  .piece {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 90%;
    height: 90%;
    border-radius: 50%;
    border: 2px solid #8b6236;
    font-family: 'ChessKai', 'STKaiti', 'Kaiti SC', 'KaiTi', 'Songti SC', 'STSong', serif;
    font-size: 5.6cqw;
    font-weight: 700;
    line-height: 1;
    background: radial-gradient(
      circle at 36% 28%,
      #f8e6c0 0%,
      #ecd0a0 38%,
      #d6af77 72%,
      #ae8049 100%
    );
    box-shadow:
      inset 0 2px 3px rgba(255, 248, 225, 0.7),
      inset 0 -4px 7px rgba(90, 48, 14, 0.38),
      0 4px 6px rgba(40, 20, 5, 0.5),
      0 1px 2px rgba(40, 20, 5, 0.4);
    text-shadow: 0 1px 0 rgba(255, 250, 230, 0.5);
    transition: transform 0.14s ease;
  }

  .piece::after {
    content: '';
    position: absolute;
    inset: 5%;
    border-radius: 50%;
    border: 1px solid rgba(95, 58, 24, 0.32);
    pointer-events: none;
  }

  .red {
    color: #b42318;
  }

  .black {
    color: #2a231c;
  }

  /* 落子瞬间让选中放大立即归位，避免 140ms 回弹叠在位移上看着像偏一下 */
  .piece-position.moving .piece {
    transition: none;
  }

  /* 吃子方：只动 transform / opacity，走合成层，避免逐帧重绘阴影 */
  .piece-position.capturing {
    z-index: 6;
  }

  .piece-position.capturing .piece {
    animation: pounce 0.55s cubic-bezier(0.33, 0.7, 0.3, 1);
    will-change: transform;
  }

  @keyframes pounce {
    0% {
      transform: translateY(0) scale(1);
    }
    18% {
      transform: translateY(-38%) scale(1.34);
    }
    70% {
      transform: translateY(-34%) scale(1.28);
    }
    82% {
      transform: translateY(10%) scale(0.9);
    }
    92% {
      transform: translateY(-7%) scale(1.07);
    }
    100% {
      transform: translateY(0) scale(1);
    }
  }

  .board-surface.flipped .piece-position.capturing .piece {
    animation-name: pounce-flipped;
  }

  @keyframes pounce-flipped {
    0% {
      transform: rotate(180deg) translateY(0) scale(1);
    }
    18% {
      transform: rotate(180deg) translateY(-38%) scale(1.34);
    }
    70% {
      transform: rotate(180deg) translateY(-34%) scale(1.28);
    }
    82% {
      transform: rotate(180deg) translateY(10%) scale(0.9);
    }
    92% {
      transform: rotate(180deg) translateY(-7%) scale(1.07);
    }
    100% {
      transform: rotate(180deg) translateY(0) scale(1);
    }
  }

  /* 影子是静态模糊的椭圆，只靠缩放和透明度表现离地高度 */
  .flight-shadow {
    position: absolute;
    left: 12%;
    bottom: 6%;
    width: 76%;
    height: 22%;
    border-radius: 50%;
    background: rgba(35, 18, 4, 0.5);
    filter: blur(5px);
    pointer-events: none;
    transform-origin: center;
    animation: flight-shadow 0.55s ease-out forwards;
    will-change: transform, opacity;
  }

  @keyframes flight-shadow {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.16;
    }
    16%,
    84% {
      transform: scale(1.25) translateY(14%);
      opacity: 0.42;
    }
  }

  .piece.hovered {
    transform: translateY(-2px);
    box-shadow:
      inset 0 2px 3px rgba(255, 248, 225, 0.7),
      inset 0 -4px 7px rgba(90, 48, 14, 0.38),
      0 7px 12px rgba(40, 20, 5, 0.5);
  }

  .piece.selected {
    transform: scale(1.09);
    box-shadow:
      inset 0 2px 3px rgba(255, 248, 225, 0.7),
      0 0 0 3px #e6a63f,
      0 0 20px 5px rgba(230, 166, 63, 0.6),
      0 6px 10px rgba(40, 20, 5, 0.5);
  }

  /* 被将军：静态描边 + 只动 transform/opacity 的光环，避免无限重绘阴影 */
  .piece.checked::before {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 3px solid #d92d20;
    box-shadow: 0 0 12px 3px rgba(217, 45, 32, 0.5);
    pointer-events: none;
    animation: alert 1s ease-in-out infinite;
    will-change: transform, opacity;
  }

  @keyframes alert {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.7;
    }
    50% {
      transform: scale(1.12);
      opacity: 1;
    }
  }

  /* 棋盘整体翻转后，让棋子文字保持正向 */
  .board-surface.flipped .piece {
    transform: rotate(180deg);
  }
  .board-surface.flipped .piece.hovered {
    transform: rotate(180deg) translateY(-2px);
  }
  .board-surface.flipped .piece.selected {
    transform: rotate(180deg) scale(1.09);
  }

  .impact-ring {
    transform-box: fill-box;
    transform-origin: center;
    animation: impact-burst 0.5s cubic-bezier(0.2, 0.8, 0.3, 1) 0.43s both;
    will-change: transform, opacity;
  }

  .impact-ring-inner {
    animation-duration: 0.36s;
  }

  @keyframes impact-burst {
    0% {
      transform: scale(0.3);
      opacity: 0;
    }
    12% {
      opacity: 0.95;
    }
    100% {
      transform: scale(2.8);
      opacity: 0;
    }
  }

  .hint-layer {
    animation: hint-pulse 1.4s ease-in-out infinite;
    will-change: opacity;
  }

  @keyframes hint-pulse {
    0%,
    100% {
      opacity: 0.65;
    }
    50% {
      opacity: 1;
    }
  }

  .target {
    position: absolute;
    width: 26%;
    height: 26%;
    border-radius: 50%;
    background: rgba(70, 120, 70, 0.42);
    border: 1px solid rgba(45, 90, 45, 0.55);
    pointer-events: none;
  }

  .target.capture {
    width: 96%;
    height: 96%;
    background: transparent;
    border: 3px solid rgba(196, 60, 42, 0.8);
    box-shadow: 0 0 10px rgba(196, 60, 42, 0.45);
  }

  @media (prefers-reduced-motion: reduce) {
    .board-surface,
    .piece,
    .piece-position {
      transition: none;
    }
    .piece.checked::before,
    .piece-position.capturing .piece,
    .flight-shadow,
    .hint-layer,
    .impact-ring {
      animation: none;
    }
  }
</style>
