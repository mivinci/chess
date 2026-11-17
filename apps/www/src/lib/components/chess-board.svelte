<script lang="ts">
  import { cubicOut } from 'svelte/easing';
  import type { TransitionConfig } from 'svelte/transition';
  import { pieceLabel } from '#lib/chess/board';
  import { sideOf, xOf, yOf, type Move, type Side } from '#lib/chess/types';
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

  // 走子位移的时长和缓动，落子抬升（见下方 LIFT_FRAMES）必须跟它共用同一组参数，
  // 否则会出现「已经走到位了，棋子又往下掉一下」。
  const MOVE_MS = 550;
  // ease-in-out：起步和收尾都平滑，中段接近匀速。
  // 之前用 cubic-bezier(0.45,0.05,0.55,1)，前 45% 时间只走 5% 距离，
  // 短距离走子就成了「先蹦起来、几乎不挪窝、再猛地闪过去」。
  const MOVE_EASE = 'ease-in-out';

  // 走子全程保持选中态的放大（1.09，已经抬起），到位那一帧才落回 1。
  // 不再中途重新起飞——选中时已经抬起了，再飞一次是重复的。
  // 用 scale 而非竖直位移：translateY 会把斜向走子的直线轨迹顶歪（往旁边偏）。
  // 和位移共用缓动/时长，offset=1（落回 1）恰好就是到位那一帧。
  function liftFrames(isFlipped: boolean): Keyframe[] {
    // 翻转棋盘下 .piece 靠 CSS `rotate(180deg)` 保持文字正向。
    // WAAPI 的 composite:'replace' 会整个替换 transform，漏掉这个 rotate
    // 就会在走子时把棋子转回倒的，动画结束再弹回正向——看起来像"先反转"。
    const r = isFlipped ? 'rotate(180deg) ' : '';
    return [
      { transform: `${r}scale(1.09)`, offset: 0 },
      { transform: `${r}scale(1.09)`, offset: 0.84 },
      { transform: `${r}scale(1)`, offset: 1 }
    ];
  }

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
    // 按身份排序，DOM 顺序与棋盘位置无关。否则走一步会改变数组顺序，keyed each 就要
    // 重新插入节点，正在跑的 transform 过渡被打断 —— 马、相这种跨过其他棋子的走法会直接瞬移。
    result.sort((a, b) => a.id - b.id);
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
      // 被吃方「向下沉」并缩小淡出，绝不向上飞：
      // 向上飞会飘到吃子方上方，而吃子方落定后已经缩回原尺寸，看着就像被吃方压在它上面（穿模）。
      // z-index: 1 兜底，保证退场期间永远压在吃子方（z-index 6）下面。
      css: (t: number, u: number) => `
        z-index: 1;
        transform: ${baseTransform} translateY(${u * 26}px) rotate(${u * 32}deg) scale(${1 - u * 0.7});
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

  // 全 WAAPI 位移：模板仍写 style:transform（SSR 首屏坐标正确、无闪），
  // 但坐标变化时的补间由 JS 用 WAAPI 完成，不再依赖 CSS transition。
  // 动画期间 WAAPI 的值优先于 inline style；结束后 cancel，落回 Svelte 已写入的新坐标。
  const lastPos = new Map<number, { tx: number; ty: number }>();

  $effect(() => {
    if (!boardFrame) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (const item of pieces) {
      const node = boardFrame.querySelector<HTMLElement>(`[data-piece-id="${item.id}"]`);
      if (!node) continue;
      const prev = lastPos.get(item.id);
      if (!prev) {
        // 首次出现只记录，不补间（否则开局所有棋子都会从 0,0 飞过来）
        lastPos.set(item.id, { tx: item.tx, ty: item.ty });
        continue;
      }
      if (prev.tx === item.tx && prev.ty === item.ty) continue;
      lastPos.set(item.id, { tx: item.tx, ty: item.ty });
      if (reduce) continue;

      const anim = node.animate(
        [
          { transform: `translate(${prev.tx}%, ${prev.ty}%)` },
          { transform: `translate(${item.tx}%, ${item.ty}%)` }
        ],
        { duration: MOVE_MS, easing: MOVE_EASE, fill: 'forwards' }
      );
      anim.finished.then(() => anim.cancel()).catch(() => {});
    }
  });

  // 走子动画：棋子被「拎着」平移过去再落下。
  // 选中态本来就是 scale(1.09)（已经抬起），所以走子不再中途重新起飞：
  // 从抬起态开始，全程保持放大平移，到位后落回 1。玩家/AI 走子统一。
  // 抬起用 scale 而非竖直位移——俯视 2D 棋盘上 translateY 会让斜向轨迹往旁边偏。
  let flownKey = '';
  $effect(() => {
    const move = lastMove;
    if (!move || !boardFrame) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;

    // 吃子已有 pounce 动画，不再叠加抬起
    if (move.captured !== 0) return;
    const id = pieceIds[move.to];
    if (!id) return;
    const key = `${id}:${move.from}:${move.to}`;
    if (key === flownKey) return; // 同一走子不重复播
    flownKey = key;

    const node = boardFrame.querySelector<HTMLElement>(`[data-piece-id="${id}"] .piece`);
    if (!node) return;
    // 前段维持选中时的 1.09，末段（到位）落回 1。
    // 结束后 cancel 交还 CSS，否则残留的 forwards 会盖住下次选中的 scale。
    const anim = node.animate(liftFrames(flipped), {
      duration: MOVE_MS,
      easing: MOVE_EASE,
      composite: 'replace',
      fill: 'forwards'
    });
    anim.finished.then(() => anim.cancel()).catch(() => {});
  });

  // 视角固定为玩家执子方：执黑时旋转棋盘，使己方始终在下方
  let flipped = $derived(playerSide === -1);
</script>

<div class="board-frame" bind:this={boardFrame}>
  <div
    class="board-surface"
    class:flipped
    style:--move-ms="{MOVE_MS}ms"
    style:--move-ease={MOVE_EASE}
  >
    <svg class="lines" viewBox="0 0 {BOARD_W} {BOARD_H}" aria-hidden="true">
      <g stroke="var(--chess-line)" stroke-width="1.8" fill="none" stroke-linecap="square">
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
        fill="var(--chess-river)"
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
          fill="var(--chess-lastmark)"
        />
        <circle
          cx={MARGIN + xOf(lastMove.to) * SPACING}
          cy={MARGIN + yOf(lastMove.to) * SPACING}
          r="9"
          fill="var(--chess-lastmark)"
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
            stroke="var(--chess-impact)"
            stroke-width="7"
          />
          <circle
            class="impact-ring impact-ring-inner"
            cx={impact.x}
            cy={impact.y}
            r="8"
            fill="var(--chess-impact)"
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
            stroke="var(--chess-hint)"
            stroke-width="3"
            stroke-dasharray="7 7"
            opacity="0.85"
          />
          <circle cx={hx1} cy={hy1} r="34" fill="none" stroke="var(--chess-hint)" stroke-width="2.5" opacity="0.8" />
          <circle cx={hx2} cy={hy2} r="38" fill="none" stroke="var(--chess-hint)" stroke-width="3.5" opacity="0.95" />
          <circle cx={hx2} cy={hy2} r="44" fill="none" stroke="var(--chess-hint)" stroke-width="1.5" opacity="0.4" />
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
        <span class="piece-lift">
          <span
            class={cn('piece', sideOf(board[item.index]) === 1 ? 'red' : 'black')}
            class:selected={selected === item.index}
            class:checked={checkKing === item.index}
            class:hovered={hoveredIndex === item.index && !disabled}
          >
            {labelFor(item.index)}
          </span>
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
    background: var(--chess-frame-bg);
    box-shadow:
      inset 0 1px 0 var(--chess-frame-glow),
      0 8px 20px rgba(0, 0, 0, 0.35);
  }

  .board-surface {
    position: relative;
    width: 100%;
    aspect-ratio: 810 / 900;
    container-type: inline-size;
    border-radius: 3px;
    overflow: hidden;
    background: var(--chess-board-bg);
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
    outline: 2px solid var(--chess-focus);
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
    /* 位移由 WAAPI 驱动（见上方 lastPos effect），CSS 不再补间 transform。
       style:transform 仍由 Svelte 写入：SSR 首屏坐标正确，动画结束也落回它。 */
    will-change: transform;
  }

  /* 独立一层：走子时只动 Y 做「飞起来」效果，水平位移交给外层 piece-position */
  .piece-lift {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .piece {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 90%;
    height: 90%;
    border-radius: 50%;
    border: 2px solid var(--piece-border, var(--chess-red-border));
    font-family: 'ChessKai', 'STKaiti', 'Kaiti SC', 'KaiTi', 'Songti SC', 'STSong', serif;
    font-size: 5.6cqw;
    font-weight: 700;
    line-height: 1;
    background: var(--piece-bg, var(--chess-red-bg));
    box-shadow: var(--chess-piece-shadow);
    text-shadow: var(--chess-piece-text-shadow);
    transition: transform 0.14s ease;
  }

  .piece::after {
    content: '';
    position: absolute;
    inset: 5%;
    border-radius: 50%;
    border: 1px solid var(--chess-piece-ring);
    pointer-events: none;
  }

  .red {
    --piece-bg: var(--chess-red-bg);
    --piece-border: var(--chess-red-border);
    color: var(--chess-red-fg);
  }

  .black {
    --piece-bg: var(--chess-black-bg);
    --piece-border: var(--chess-black-border);
    color: var(--chess-black-fg);
  }

  /* 落子瞬间让选中放大立即归位，避免 140ms 回弹叠在位移上看着像偏一下 */
  .piece-position.moving .piece {
    transition: none;
  }

  /* 吃子方：只动 transform / opacity，走合成层，避免逐帧重绘阴影。
     z-index 拉到 20，被吃方退场期间显式压到 1（见 captureOut），杜绝任何层序反转。 */
  .piece-position.capturing {
    z-index: 20;
  }

  .piece-position.capturing .piece {
    animation: pounce 0.55s cubic-bezier(0.33, 0.7, 0.3, 1);
    will-change: transform;
  }

  /* 吃子放大要始终盖住被吃方：抬升幅度必须小于放大带来的半径增量，
     否则被吃棋子会从底下露出来（穿模）。砸下帧也不缩到 1 以下。 */
  @keyframes pounce {
    0% {
      transform: translateY(0) scale(1);
    }
    18% {
      transform: translateY(-14%) scale(1.42);
    }
    70% {
      transform: translateY(-12%) scale(1.4);
    }
    82% {
      transform: translateY(6%) scale(1.12);
    }
    92% {
      transform: translateY(-3%) scale(1.08);
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
      transform: rotate(180deg) translateY(-14%) scale(1.42);
    }
    70% {
      transform: rotate(180deg) translateY(-12%) scale(1.4);
    }
    82% {
      transform: rotate(180deg) translateY(6%) scale(1.12);
    }
    92% {
      transform: rotate(180deg) translateY(-3%) scale(1.08);
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
    background: var(--chess-flight-shadow);
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
    box-shadow: var(--chess-piece-shadow-hover);
  }

  .piece.selected {
    transform: scale(1.09);
    box-shadow: var(--chess-piece-shadow-selected);
  }

  /* 被将军：静态描边 + 只动 transform/opacity 的光环，避免无限重绘阴影 */
  .piece.checked::before {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 3px solid var(--chess-checked);
    box-shadow: 0 0 12px 3px var(--chess-checked-glow);
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
    background: var(--chess-target);
    border: 1px solid var(--chess-target-border);
    pointer-events: none;
  }

  .target.capture {
    width: 96%;
    height: 96%;
    background: transparent;
    border: 3px solid var(--chess-capture);
    box-shadow: 0 0 10px var(--chess-capture-glow);
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
