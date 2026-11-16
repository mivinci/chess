<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import LoaderCircle from 'lucide-svelte/icons/loader-circle';
  import Plus from 'lucide-svelte/icons/plus';
  import Search from 'lucide-svelte/icons/search';
  import X from 'lucide-svelte/icons/x';
  import Button from '#lib/components/ui/button.svelte';
  import Card from '#lib/components/ui/card.svelte';
  import { generateRoomId, isValidRoomId, matchSocketUrl, normalizeRoomId } from '#lib/room/config';

  type MatchState = 'idle' | 'connecting' | 'matching' | 'matched';

  let roomInput = $state('');
  let error = $state('');

  let matchState = $state<MatchState>('idle');
  let matchError = $state('');
  let matchPosition = $state(1);
  let matchSeconds = $state(0);
  let matchStartedAt = 0;
  let matchWs: WebSocket | null = null;
  let matchTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionalClose = false;

  function createRoom() {
    const id = generateRoomId();
    goto(`/room/${id}`);
  }

  function joinRoom() {
    const id = normalizeRoomId(roomInput);
    if (!isValidRoomId(id)) {
      error = '房间号 4–12 位，只含字母和数字';
      return;
    }
    goto(`/room/${id}`);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') joinRoom();
  }

  function clearTimers() {
    if (matchTimer) clearInterval(matchTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    matchTimer = null;
    reconnectTimer = null;
  }

  function closeMatch() {
    intentionalClose = true;
    clearTimers();
    if (matchWs && matchWs.readyState <= WebSocket.OPEN) matchWs.close();
    matchWs = null;
  }

  function cancelMatch() {
    closeMatch();
    matchState = 'idle';
    matchError = '';
    matchSeconds = 0;
  }

  function startMatch() {
    if (matchState !== 'idle') return;
    matchError = '';
    intentionalClose = false;
    matchState = 'connecting';
    connectMatch();
  }

  function connectMatch() {
    if (intentionalClose) return;
    matchWs = new WebSocket(matchSocketUrl((page.data.roomToken as string | undefined) ?? ''));

    matchWs.onopen = () => {
      if (intentionalClose) return;
      matchState = 'matching';
      matchStartedAt = Date.now();
      matchSeconds = 0;
      matchWs?.send(JSON.stringify({ type: 'queue' }));
      if (matchTimer) clearInterval(matchTimer);
      matchTimer = setInterval(() => {
        matchSeconds = Math.floor((Date.now() - matchStartedAt) / 1000);
      }, 1000);
    };

    matchWs.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = msg.type;
      if (type === 'queued') {
        matchPosition = msg.position as number;
      } else if (type === 'matched') {
        matchState = 'matched';
        closeMatch();
        goto(`/room/${normalizeRoomId(msg.roomId as string)}`);
      } else if (type === 'cancelled') {
        cancelMatch();
      } else if (type === 'timeout') {
        matchError = '排队超时，没找到对手，可以再试一次';
        cancelMatch();
      } else if (type === 'error') {
        matchError = String(msg.message ?? '匹配出错');
        cancelMatch();
      }
    };

    matchWs.onclose = () => {
      if (intentionalClose || matchState === 'matched') return;
      matchState = 'connecting';
      if (matchTimer) clearInterval(matchTimer);
      reconnectTimer = setTimeout(connectMatch, 1500);
    };
  }

  onMount(() => {
    return () => {
      intentionalClose = true;
      clearTimers();
      matchWs?.close();
    };
  });
</script>

<svelte:head>
  <title>房间 · 中国象棋</title>
</svelte:head>

<main class="mx-auto max-w-5xl px-4 py-8">
  <div class="mx-auto max-w-lg space-y-5">
    {#if matchState === 'idle'}
      <Card class="p-6">
        <div class="flex items-start gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Search class="size-5" />
          </div>
          <div class="flex-1">
            <h2 class="text-lg font-semibold">快速匹配</h2>
            <p class="mt-1 text-sm text-muted-foreground">自动找一个对手，配到就直接开局</p>
          </div>
        </div>
        <Button class="mt-4 w-full" onclick={startMatch}>
          <Search class="size-4" />开始匹配
        </Button>
        {#if matchError}
          <p class="mt-3 text-xs text-destructive">{matchError}</p>
        {/if}
      </Card>
    {:else}
      <Card class="p-6">
        <div class="flex items-center gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <LoaderCircle class="size-5 animate-spin" />
          </div>
          <div class="flex-1">
            <h2 class="text-lg font-semibold">
              {matchState === 'connecting' ? '连接匹配服务…' : '正在寻找对手'}
            </h2>
            <p class="mt-1 text-sm text-muted-foreground">
              {#if matchState === 'connecting'}
                正在连接…
              {:else}
                队列第 {matchPosition} 位 · 已等 {matchSeconds} 秒
              {/if}
            </p>
          </div>
        </div>
        <div class="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full bg-primary transition-all"
            style:width="{Math.min(100, (matchSeconds / 60) * 100)}%"
          ></div>
        </div>
        <Button variant="outline" class="mt-4 w-full" onclick={cancelMatch}>
          <X class="size-4" />取消匹配
        </Button>
      </Card>
    {/if}

    <div class="flex items-center gap-3">
      <div class="h-px flex-1 bg-border"></div>
      <span class="text-xs text-muted-foreground">或者</span>
      <div class="h-px flex-1 bg-border"></div>
    </div>

    <Card class="p-6">
      <h2 class="text-lg font-semibold">加入房间</h2>
      <p class="mt-1 text-sm text-muted-foreground">输入朋友发你的房间号</p>
      <div class="mt-4 flex gap-2">
        <input
          type="text"
          bind:value={roomInput}
          onkeydown={onKeydown}
          oninput={() => (error = '')}
          placeholder="例如 AB3K9D"
          maxlength="12"
          class="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm uppercase tracking-widest outline-none focus:ring-2 focus:ring-ring"
        />
        <Button onclick={joinRoom}>
          加入<ArrowRight class="size-4" />
        </Button>
      </div>
      {#if error}
        <p class="mt-2 text-xs text-destructive">{error}</p>
      {/if}
    </Card>

    <Card class="p-6">
      <h2 class="text-lg font-semibold">创建房间</h2>
      <p class="mt-1 text-sm text-muted-foreground">生成房间号，发给朋友就能一起下</p>
      <Button class="mt-4 w-full" onclick={createRoom}>
        <Plus class="size-4" />创建新房间
      </Button>
    </Card>
  </div>
</main>
