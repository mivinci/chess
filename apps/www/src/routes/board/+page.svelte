<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Eye from 'lucide-svelte/icons/eye';
  import LayoutGrid from 'lucide-svelte/icons/layout-grid';
  import Swords from 'lucide-svelte/icons/swords';
  import BoardThumb from '#lib/components/board-thumb.svelte';
  import Button from '#lib/components/ui/button.svelte';
  import Card from '#lib/components/ui/card.svelte';
  import { ChessGame } from '#lib/chess/game';
  import { generateRoomId, ROOM_HTTP_BASE } from '#lib/room/config';

  interface BoardEntry {
    parentId: string;
    step: number;
    count: number;
    history: string;
    notations: string;
  }

  let boards = $state<BoardEntry[]>([]);
  let loading = $state(true);
  let error = $state('');

  // 每条盘面重放前 step 步，得到局面快照和末步棋谱
  let items = $derived(
    boards
      .map((b) => {
        let moves: { from: number; to: number; captured: number }[] = [];
        let notations: string[] = [];
        try {
          moves = JSON.parse(b.history);
          notations = JSON.parse(b.notations);
        } catch {
          // 数据损坏时跳过该条
        }
        const game = new ChessGame();
        for (const m of moves.slice(0, b.step)) game.move(m.from, m.to);
        return {
          ...b,
          board: Array.from(game.board),
          lastNotation: notations[b.step - 1] ?? '',
          valid: moves.length >= b.step
        };
      })
      .filter((x) => x.valid)
  );

  function openRoom(b: BoardEntry) {
    const id = generateRoomId();
    void goto(`/play/${id}?from=${b.parentId}&step=${b.step}`);
  }

  function watch(b: BoardEntry) {
    void goto(`/replay?board=${b.parentId}&step=${b.step}`);
  }

  onMount(() => {
    const token = (page.data.roomToken as string | undefined) ?? '';
    fetch(`${ROOM_HTTP_BASE}/boards?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ boards?: BoardEntry[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((data: { boards?: BoardEntry[] }) => {
        boards = data.boards ?? [];
      })
      .catch(() => {
        error = '盘面列表加载失败';
      })
      .finally(() => {
        loading = false;
      });
  });
</script>

<svelte:head>
  <title>盘面 · 中国象棋</title>
</svelte:head>

<main class="mx-auto max-w-5xl px-4 py-8">
  <div class="mb-6 flex items-center gap-3">
    <div class="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
      <LayoutGrid class="size-5" />
    </div>
    <div>
      <h1 class="text-xl font-semibold tracking-tight">热门盘面</h1>
      <p class="text-xs text-muted-foreground">大家最常从这里开新局的局面</p>
    </div>
  </div>

  {#if loading}
    <p class="py-16 text-center text-sm text-muted-foreground">加载中…</p>
  {:else if error}
    <Card class="mx-auto max-w-lg p-10 text-center">
      <p class="text-sm text-destructive">{error}</p>
    </Card>
  {:else if items.length === 0}
    <Card class="mx-auto max-w-lg p-10 text-center">
      <LayoutGrid class="mx-auto size-8 text-muted-foreground" />
      <p class="mt-3 text-sm text-muted-foreground">
        还没有盘面。从复盘任意一步「从这里开新局」，这里就会出现。
      </p>
    </Card>
  {:else}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each items as b (b.parentId + ':' + b.step)}
        <Card class="p-4">
          <div class="flex gap-4">
            <div class="shrink-0 rounded-lg border border-border bg-[#e8d3a9] p-1.5">
              <BoardThumb board={b.board} class="h-24 w-auto" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-semibold">第 {b.step} 步</span>
                <span class="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                  {b.count} 次引用
                </span>
              </div>
              <p class="mt-1 truncate text-xs text-muted-foreground">{b.lastNotation || '开局'}</p>
              <p class="mt-0.5 text-xs text-muted-foreground">源自 {b.parentId}</p>
            </div>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-2">
            <Button size="sm" onclick={() => openRoom(b)}>
              <Swords class="size-3.5" />开房间
            </Button>
            <Button size="sm" variant="outline" onclick={() => watch(b)}>
              <Eye class="size-3.5" />看这步
            </Button>
          </div>
        </Card>
      {/each}
    </div>
  {/if}
</main>
