<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Check from 'lucide-svelte/icons/check';
  import Copy from 'lucide-svelte/icons/copy';
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
  import Users from 'lucide-svelte/icons/users';
  import Volume2 from 'lucide-svelte/icons/volume-2';
  import VolumeX from 'lucide-svelte/icons/volume-x';
  import ChessBoard from '#lib/components/chess-board.svelte';
  import Badge from '#lib/components/ui/badge.svelte';
  import Button from '#lib/components/ui/button.svelte';
  import Card from '#lib/components/ui/card.svelte';
  import { ChessGame, type GameStatus } from '#lib/chess/game';
  import { playCaptureSound, playMoveSound } from '#lib/chess/sound';
  import { RED, sideOf, type Move, type Side } from '#lib/chess/types';
  import { normalizeRoomId, roomSocketUrl } from '#lib/room/config';

  const roomId = normalizeRoomId(page.params.id ?? '');

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionalClose = false;

  let connected = $state(false);
  let errorMsg = $state('');
  let mySide = $state<Side | null>(null);
  let players = $state<{ side: Side; name: string }[]>([]);
  let turn = $state<Side>(RED);
  let status = $state<GameStatus>('playing');
  let history = $state<Move[]>([]);
  let notations = $state<string[]>([]);
  let selected = $state<number | null>(null);
  let targets = $state<number[]>([]);
  let copied = $state(false);
  let soundOn = $state(true);
  let deadline = $state<number | null>(null);
  let now = $state(Date.now());
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  let remaining = $derived(
    deadline === null || status !== 'playing' || players.length < 2
      ? null
      : Math.max(0, Math.ceil((deadline - now) / 1000))
  );

  /** 用走子历史重建棋盘，和服务端同一套规则代码 */
  let view = $derived.by(() => {
    const game = new ChessGame();
    for (const m of history) game.move(m.from, m.to);
    return {
      board: Array.from(game.board),
      pieceIds: Array.from(game.pieceIds),
      lastMove: game.lastMove
    };
  });

  let myTurn = $derived(
    connected && mySide !== null && turn === mySide && players.length === 2 && status === 'playing'
  );

  // 音效跟动画对齐：吃子在砸下瞬间响，普通落子在棋子落定时响
  function playMove(move: Move) {
    if (!soundOn) return;
    const isCapture = move.captured !== 0;
    const delay = isCapture ? 430 : 540;
    setTimeout(() => {
      if (!soundOn) return;
      if (isCapture) playCaptureSound();
      else playMoveSound();
    }, delay);
  }

  function send(payload: unknown) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function applySnapshot(snap: {
    board: number[];
    turn: Side;
    status: GameStatus;
    history: Move[];
    notations: string[];
    players: { side: Side; name: string }[];
    deadline?: number | null;
  }) {
    // 服务端用同一套规则，board 与重放结果一致；这里以 history 为唯一来源重建
    history = snap.history.map((m) => ({ ...m }));
    notations = [...snap.notations];
    turn = snap.turn;
    status = snap.status;
    players = snap.players;
    deadline = snap.deadline ?? null;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(roomSocketUrl(roomId, (page.data.roomToken as string | undefined) ?? ''));

    ws.onopen = () => {
      connected = true;
      errorMsg = '';
      send({ type: 'join', name: `玩家${Math.floor(Math.random() * 90 + 10)}` });
    };

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = msg.type;
      if (type === 'joined') {
        mySide = msg.side as Side;
        applySnapshot(msg as Parameters<typeof applySnapshot>[0]);
      } else if (type === 'opponent') {
        applySnapshot(msg as Parameters<typeof applySnapshot>[0]);
      } else if (type === 'move') {
        const move = msg.move as Move;
        playMove(move);
        history = [...history, { ...move }];
        notations = [...notations, msg.notation as string];
        turn = msg.turn as Side;
        status = msg.status as GameStatus;
        deadline = (msg.deadline as number | null | undefined) ?? null;
        selected = null;
        targets = [];
      } else if (type === 'clock') {
        deadline = msg.deadline as number;
        turn = msg.turn as Side;
      } else if (type === 'timeout') {
        status = msg.status as GameStatus;
        deadline = null;
        errorMsg = `${msg.loser === mySide ? '你' : '对手'}超时判负`;
      } else if (type === 'reset') {
        applySnapshot(msg as Parameters<typeof applySnapshot>[0]);
        selected = null;
        targets = [];
      } else if (type === 'leave') {
        players = players.filter((p) => p.side !== (msg.side as Side));
      } else if (type === 'error') {
        errorMsg = String(msg.message ?? '出错了');
      }
    };

    ws.onclose = () => {
      connected = false;
      players = [];
      mySide = null;
      if (intentionalClose) return;
      reconnectTimer = setTimeout(connect, 1500);
    };

    ws.onerror = () => {
      errorMsg = '连接失败，正在重试…';
    };
  }

  function handleSquare(index: number) {
    if (!myTurn) return;
    const piece = view.board[index];
    if (selected !== null && targets.includes(index)) {
      const from = selected;
      selected = null;
      targets = [];
      send({ type: 'move', from, to: index });
      return;
    }
    if (piece !== 0 && sideOf(piece) === mySide) {
      selected = index;
      // 用当前局面算这个棋子的合法落点
      const game = new ChessGame();
      for (const m of history) game.move(m.from, m.to);
      targets = game.legalMoves(index).map((m) => m.to);
    } else {
      selected = null;
      targets = [];
    }
  }

  function resetGame() {
    send({ type: 'reset' });
  }

  async function copyRoomId() {
    try {
      await navigator.clipboard.writeText(roomId);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // 剪贴板不可用时忽略
    }
  }

  onMount(() => {
    tickTimer = setInterval(() => (now = Date.now()), 250);
    connect();
    return () => {
      intentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (tickTimer) clearInterval(tickTimer);
      ws?.close();
    };
  });
</script>

<svelte:head>
  <title>房间 {roomId} · 中国象棋</title>
</svelte:head>

<main class="mx-auto max-w-5xl px-4 py-5">
  <div class="mb-5 flex items-center gap-2">
    <a href="/room" class="text-muted-foreground hover:text-foreground" aria-label="返回房间列表">
      <ArrowLeft class="size-4" />
    </a>
    <button
      type="button"
      onclick={copyRoomId}
      class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      aria-label="复制房间号"
    >
      <span class="font-medium tracking-widest text-foreground">{roomId}</span>
      {#if copied}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
    </button>
    <span
      class="ml-auto size-2 rounded-full {connected ? 'bg-green-500' : 'bg-muted-foreground/50'}"
      title={connected ? '已连接' : '连接中…'}
    ></span>
  </div>

  {#if errorMsg}
    <div class="mx-auto mb-4 max-w-[600px] rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {errorMsg}
    </div>
  {/if}

  <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
    <section>
      <ChessBoard
        board={view.board}
        pieceIds={view.pieceIds}
        playerSide={mySide ?? RED}
        selected={selected}
        {targets}
        lastMove={view.lastMove}
        hint={null}
        checkKing={-1}
        disabled={!myTurn}
        onsquare={handleSquare}
      />
      <div class="mx-auto mt-4 flex max-w-[600px] items-center justify-between gap-3">
        <Badge variant={status === 'playing' ? 'secondary' : 'default'}>
          {#if players.length < 2}
            等待对手加入…
          {:else if status !== 'playing'}
            {status === 'red-win' ? '红方胜' : '黑方胜'}
          {:else if myTurn}
            轮到你走棋
          {:else}
            等待对手走棋
          {/if}
        </Badge>
        <div class="flex items-center gap-3">
          {#if remaining !== null}
            <span
              class="tabular-nums text-lg font-semibold {remaining <= 10
                ? 'text-destructive'
                : 'text-foreground'}"
            >
              {remaining}s
            </span>
          {/if}
          <span class="text-xs text-muted-foreground">{history.length} 步</span>
        </div>
      </div>
    </section>

    <aside class="space-y-3">
      <Card class="p-3.5">
        <h2 class="mb-3 text-sm font-semibold">对局信息</h2>
        <div class="space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">你的身份</span>
            <span>
              {#if mySide === null}
                —
              {:else}
                执{mySide === RED ? '红' : '黑'}
              {/if}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">玩家</span>
            <span class="flex items-center gap-1 text-muted-foreground">
              <Users class="size-3.5" />{players.length} / 2
            </span>
          </div>
        </div>
        <div class="mt-4 space-y-2">
          {#each [RED, -1] as side (side)}
            {@const player = players.find((p) => p.side === side)}
            <div class="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span
                class="size-2.5 rounded-full {side === RED
                  ? 'bg-[#b42318]'
                  : 'bg-[#2a231c] ring-1 ring-white/40'}"
              ></span>
              <span class="flex-1">{player?.name ?? '等待加入…'}</span>
              {#if side === mySide}
                <Badge variant="outline" class="text-[10px]">你</Badge>
              {/if}
            </div>
          {/each}
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onclick={resetGame} disabled={players.length < 2}>
            <RotateCcw class="size-4" />重新开局
          </Button>
          <Button
            variant="outline"
            onclick={() => (soundOn = !soundOn)}
            aria-label={soundOn ? '关闭音效' : '开启音效'}
          >
            {#if soundOn}
              <Volume2 class="size-4" />音效开
            {:else}
              <VolumeX class="size-4" />音效关
            {/if}
          </Button>
        </div>
      </Card>

      <Card class="p-3.5">
        <h2 class="mb-3 text-sm font-semibold">棋谱</h2>
        <div class="max-h-64 space-y-0.5 overflow-y-auto pr-1 text-sm">
          {#each notations as notation, i}
            <div class="grid grid-cols-[2rem_1fr] gap-2 rounded px-2 py-1 odd:bg-muted/50">
              <span class="tabular-nums text-muted-foreground">{Math.floor(i / 2) + 1}.</span>
              <span class={i % 2 === 0 ? 'font-medium text-[#d9534f]' : ''}>{notation}</span>
            </div>
          {:else}
            <p class="py-6 text-center text-xs text-muted-foreground">落子后显示棋谱</p>
          {/each}
        </div>
      </Card>
    </aside>
  </div>
</main>
