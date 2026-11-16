<p align="center">
  <img src="apps/www/static/logo.svg" alt="中国象棋" width="88" />
</p>

<h1 align="center">中国象棋</h1>

<p align="center">在浏览器里下象棋。支持人机对战和在线双人对战，手机电脑都能玩。</p>

## 在线试玩

**https://chess.le0.me**

## 功能

- 完整象棋规则：蹩马腿、塞象眼、炮翻山、过河兵横走、将死与困毙判定
- 三档 AI 难度，可执红执黑、悔棋、提示一步、中文记谱、被将军高亮
- 对局记录与复盘回放
- 房间对战：创建房间、输入房间号、快速匹配，实时同步、每步 60 秒倒计时、断线重连
- 四套配色可切换：朱砂、竹青、月白、檀木
- 棋子音效与走子动画，手机端适配

## 实现

- `www` 是 SvelteKit 主站，`api` 是 Hono Worker；房间与匹配跑在 Durable Objects 上，盘面榜存 D1
- AI 在浏览器 Web Worker 里运算；房间邀请 AI 时由房主页面兼职，服务端只转发消息
- 每局棋是树上的一个节点，记下父局 id 与分支步数；从复盘任意步能派生新局，引用次数汇成热门盘面
- 终局 30 天后清理棋谱存储，保留胜负与分支信息；旧局被分支时从 D1 取回完整历史

## 本地运行

需要 Node.js。把 `apps/www/.dev.vars.example` 和 `apps/api/.dev.vars.example` 各复制为 `.dev.vars`（两边密钥相同）。

```sh
npm install
npm run api:dev    # 端口 8787
npm run www:dev    # 端口 5173
```

打开 http://localhost:5173 。人机对战只需 `www:dev`。

## 许可证

MIT
