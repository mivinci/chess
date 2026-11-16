<p align="center">
  <img src="apps/www/static/logo.svg" alt="中国象棋" width="88" />
</p>

<h1 align="center">中国象棋</h1>

<p align="center">在浏览器里下象棋。支持人机对战和在线双人对战，手机电脑都能玩。</p>

## 在线试玩

**https://chess.le0.me**

无需注册，打开就能玩。房间对战的服务器地址是 `wss://chess-room.le0.me`（程序自动连接，不用手动填）。

## 功能

- 完整象棋规则：蹩马腿、塞象眼、炮翻山、过河兵横走、将死与困毙判定
- 三档 AI 难度，可执红执黑、悔棋、提示一步、中文记谱、被将军高亮
- 对局记录与复盘回放
- 房间对战：创建房间、输入房间号、快速匹配，实时同步、每步 30 秒倒计时、断线重连
- 四套配色可切换：竹青、朱砂、月白、原棕
- 棋子音效与走子动画，手机端适配

## 本地运行

需要 Node.js。两个服务各开一个终端：

```sh
npm install
npm run room:dev   # 房间服务，端口 8787
npm run www:dev    # 网页，端口 5173
```

打开 http://localhost:5173 。只玩人机对战的话，只跑 `www:dev` 就行，不依赖房间服务。

## 许可证

MIT
