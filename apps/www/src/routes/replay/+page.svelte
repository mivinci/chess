<script lang="ts">
  import { onMount } from 'svelte';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ChevronsLeft from 'lucide-svelte/icons/chevrons-left';
  import ChevronsRight from 'lucide-svelte/icons/chevrons-right';
  import Pause from 'lucide-svelte/icons/pause';
  import Play from 'lucide-svelte/icons/play';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import ChessBoard from '#lib/components/chess-board.svelte';
  import Badge from '#lib/components/ui/badge.svelte';
  import Button from '#lib/components/ui/button.svelte';
  import Card from '#lib/components/ui/card.svelte';
  import { ChessGame } from '#lib/chess/game';
  import { clearRecords, deleteRecord, loadRecords, type GameRecord } from '#lib/chess/records';
  import { RED, type Move, type Side } from '#lib/chess/types';

  const STEP_INTERVAL = 900;

  let records = $state<GameRecord[]>([]);
  let selectedId = $state<string | null>(null);
  let step = $state(0);
  let playing = $state(false);
  let timer: ReturnType<typeof setInterval> | null = null;

  let selected = $derived(records.find((r) => r.id === selectedId) ?? null);
  let totalSteps = $derived(selected?.moves.length ?? 0);

  /** 从头重放到当前步，棋盘与棋谱完全由记录驱动 */
  let view = $derived.by(() => {
    const game = new ChessGame();
    if (selected) {
      for (let i = 0; i < step && i < selected.moves.length; i++) {
        const m = selected.moves[i];
        game.move(m.from, m.to);
      }
    }
    return {
      board: Array.from(game.board),
      pieceIds: Array.from(game.pieceIds),
      lastMove: game.lastMove,
      status: game.status
    };
  });

  let resultText = $derived.by(() => {
    if (!selected) return '';
    if (selected.result === 'playing') return '未结束';
    const winner = selected.result === 'red-win' ? RED : -1;
    return winner === selected.playerSide ? '你赢了' : '电脑获胜';
  });

  function formatTime(ts: number) {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function selectRecord(record: GameRecord) {
    stopPlaying();
    selectedId = record.id;
    step = 0;
  }

  function goto(next: number) {
    step = Math.max(0, Math.min(totalSteps, next));
  }

  function stopPlaying() {
    playing = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function togglePlay() {
    if (playing) {
      stopPlaying();
      return;
    }
    if (totalSteps === 0) return;
    if (step >= totalSteps) step = 0;
    playing = true;
    timer = setInterval(() => {
      if (step >= totalSteps) {
        stopPlaying();
        return;
      }
      step += 1;
    }, STEP_INTERVAL);
  }

  function removeCurrent() {
    if (!selectedId) return;
    stopPlaying();
    deleteRecord(selectedId);
    records = loadRecords();
    selectedId = null;
    step = 0;
  }

  function removeAll() {
    stopPlaying();
    clearRecords();
    records = loadRecords();
    selectedId = null;
    step = 0;
  }

  onMount(() => {
    records = loadRecords();
    return () => stopPlaying();
  });
</script>

<svelte:head>
  <title>复盘 · 中国象棋</title>
</svelte:head>

<main class="min-h-screen bg-background">
  <div class="mx-auto max-w-5xl px-4 py-5 sm:py-6">
    <header class="mb-4 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <a href="/ai" class="text-muted-foreground hover:text-foreground" aria-label="返回对局">
          <ArrowLeft class="size-5" />
        </a>
        <h1 class="text-2xl font-semibold tracking-tight">复盘</h1>
      </div>
      {#if records.length > 0}
        <Button variant="ghost" size="sm" onclick={removeAll}>
          <Trash2 class="size-4" />清空记录
        </Button>
      {/if}
    </header>

    {#if records.length === 0}
      <Card class="p-10 text-center">
        <p class="text-sm text-muted-foreground">还没有对局记录。回去下一盘，结束后会自动存到这里。</p>
        <a href="/ai" class="mt-4 inline-block">
          <Button><ArrowLeft class="size-4" />去对局</Button>
        </a>
      </Card>
    {:else}
      <div class="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card class="p-3">
          <h2 class="mb-2 px-1 text-sm font-semibold">历史对局 · {records.length}</h2>
          <div class="max-h-[70vh] space-y-1 overflow-y-auto">
            {#each records as record (record.id)}
              <button
                type="button"
                class="w-full rounded-md px-3 py-2 text-left text-sm transition-colors cursor-pointer {selectedId ===
                record.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted'}"
                onclick={() => selectRecord(record)}
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="font-medium">{formatTime(record.playedAt)}</span>
                  <Badge variant={record.result === 'playing' ? 'outline' : 'secondary'}>
                    {record.result === 'playing'
                      ? '未完'
                      : record.result === 'red-win'
                        ? '红胜'
                        : '黑胜'}
                  </Badge>
                </div>
                <div class="mt-1 text-xs text-muted-foreground">
                  执{record.playerSide === RED ? '红' : '黑'} · {record.moves.length} 步 · {record.difficulty}
                </div>
              </button>
            {/each}
          </div>
        </Card>

        <section>
          {#if selected}
            <ChessBoard
              board={view.board}
              pieceIds={view.pieceIds}
              playerSide={selected.playerSide}
              selected={null}
              targets={[]}
              lastMove={view.lastMove}
              hint={null}
              checkKing={-1}
              disabled={true}
              onsquare={() => {}}
            />

            <div class="mx-auto mt-4 flex max-w-[600px] flex-wrap items-center justify-center gap-2">
              <Button variant="outline" size="icon" onclick={() => goto(0)} aria-label="第一步">
                <ChevronsLeft class="size-4" />
              </Button>
              <Button variant="outline" size="icon" onclick={() => goto(step - 1)} aria-label="上一步">
                <ChevronLeft class="size-4" />
              </Button>
              <Button onclick={togglePlay} disabled={totalSteps === 0}>
                {#if playing}
                  <Pause class="size-4" />暂停
                {:else}
                  <Play class="size-4" />播放
                {/if}
              </Button>
              <Button variant="outline" size="icon" onclick={() => goto(step + 1)} aria-label="下一步">
                <ChevronRight class="size-4" />
              </Button>
              <Button variant="outline" size="icon" onclick={() => goto(totalSteps)} aria-label="最后一步">
                <ChevronsRight class="size-4" />
              </Button>
              <span class="ml-2 text-sm tabular-nums text-muted-foreground">
                {step} / {totalSteps}
              </span>
            </div>

            <div class="mx-auto mt-4 grid max-w-[600px] gap-4 sm:grid-cols-2">
              <Card class="p-3.5">
                <h2 class="mb-3 text-sm font-semibold">本局信息</h2>
                <div class="space-y-2 text-sm">
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">你的身份</span>
                    <span>执{selected.playerSide === RED ? '红' : '黑'}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">结果</span>
                    <span>{resultText}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">难度 / 节奏</span>
                    <span class="text-xs">{selected.difficulty} / {selected.pace}</span>
                  </div>
                </div>
                <Button variant="ghost" size="sm" class="mt-3 w-full" onclick={removeCurrent}>
                  <Trash2 class="size-4" />删除这局
                </Button>
              </Card>
              <Card class="p-3.5">
                <h2 class="mb-3 text-sm font-semibold">棋谱</h2>
                <div class="max-h-52 space-y-0.5 overflow-y-auto pr-1 text-sm">
                  {#each selected.notations as notation, i}
                    <div
                      class="grid grid-cols-[2rem_1fr] gap-2 rounded px-2 py-1 {i < step
                        ? ''
                        : 'opacity-40'}"
                    >
                      <span class="tabular-nums text-muted-foreground">{Math.floor(i / 2) + 1}.</span>
                      <span class={i % 2 === 0 ? 'font-medium text-[#d9534f]' : ''}>{notation}</span>
                    </div>
                  {/each}
                </div>
              </Card>
            </div>
          {:else}
            <Card class="p-10 text-center">
              <p class="text-sm text-muted-foreground">从左边选一局开始复盘</p>
            </Card>
          {/if}
        </section>
      </div>
    {/if}
  </div>
</main>
