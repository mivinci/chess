<script lang="ts">
  import { pieceLabel } from '#lib/chess/board';
  import { sideOf } from '#lib/chess/types';

  interface Props {
    board: ArrayLike<number>;
    class?: string;
  }

  let { board, class: className = '' }: Props = $props();

  // 缩略棋盘：9 列 10 行，格子边长 10，外边距 6
  const CELL = 10;
  const PAD = 6;
  const W = PAD * 2 + 8 * CELL;
  const H = PAD * 2 + 9 * CELL;

  const pieces = $derived.by(() => {
    const out: { x: number; y: number; label: string; red: boolean }[] = [];
    for (let i = 0; i < 90; i++) {
      const p = board[i];
      if (p === 0) continue;
      out.push({
        x: PAD + (i % 9) * CELL,
        y: PAD + Math.floor(i / 9) * CELL,
        label: pieceLabel(p),
        red: sideOf(p) === 1
      });
    }
    return out;
  });
</script>

<svg viewBox="0 0 {W} {H}" class={className} aria-hidden="true">
  <g stroke="#8a6238" stroke-width="0.6" fill="none">
    {#each Array(10) as _, r}
      <line x1={PAD} y1={PAD + r * CELL} x2={PAD + 8 * CELL} y2={PAD + r * CELL} />
    {/each}
    {#each Array(9) as _, c}
      {#if c === 0 || c === 8}
        <line x1={PAD + c * CELL} y1={PAD} x2={PAD + c * CELL} y2={PAD + 9 * CELL} />
      {:else}
        <line x1={PAD + c * CELL} y1={PAD} x2={PAD + c * CELL} y2={PAD + 4 * CELL} />
        <line x1={PAD + c * CELL} y1={PAD + 5 * CELL} x2={PAD + c * CELL} y2={PAD + 9 * CELL} />
      {/if}
    {/each}
  </g>
  {#each pieces as p}
    <circle cx={p.x} cy={p.y} r="3.6" fill="#f2e2bd" stroke="#8a6238" stroke-width="0.5" />
    <text
      x={p.x}
      y={p.y + 1.5}
      font-size="5"
      font-family="ChessKai, STKaiti, Kaiti SC, KaiTi, serif"
      text-anchor="middle"
      fill={p.red ? '#b42318' : '#2a231c'}
    >{p.label}</text>
  {/each}
</svg>
