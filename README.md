# Bomb It · 好友联机

原版 **Bomb It 1 HTML5** 的非官方好友联机版。每个人在自己的浏览器加载游戏和素材，通过 WebSocket 同步操作。无需 Flash、账号或视频串流。

- **原版闯关：1–2 位真人**，保留原版电脑、道具、生命、计分与关卡继续流程。
- **混战：1–4 位真人**，四个角色各自为战，空位由原版电脑补齐。最后存活者获胜；时间到还有多人存活则平局。
- 邀请链接、选角色、准备、房主暂停、断线后回放恢复、状态校验。
- 方向键或 WASD 移动，空格放炸弹；也提供触屏按钮。

## 本地运行

需要 Node.js 22 或更新版本。

```sh
npm ci
npm start
```

打开 http://localhost:3000 。创建房间后把邀请链接发给朋友。**localhost 链接只能在本机使用**；跨网络玩需要下面的部署。

原版文件保存在 `original/`，构建生成 `public/game/`。正常安装和启动不需要再访问原站。

## Cloudflare 免费部署

使用 Workers 静态资源 + 每个房间一个 SQLite 类型的 Durable Object，位置提示为美国东部。没有数据库写入，也不需要付费服务器。

```sh
npm ci
npm run build
npx wrangler login
npx wrangler deploy
```

首次部署前确认账号使用 **Workers Free**。`wrangler.jsonc` 的 `name` 可改成自己的项目名称。分享部署命令输出的 `https://…workers.dev` 地址。更新代码后重新 build、deploy 即可。

免费额度并非无限：截至 2026-10-22，Durable Objects Free 包含每天 100,000 次计费请求及 13,000 GB-s 运行时间，WebSocket 入站消息按 20:1 折算，出站消息不计请求费用。Free 超额会拒绝服务，不自动转成付费。额度由同一账号内的项目共享。本项目每个房间的连接存续期间都会占用运行时间，适合几个朋友少量房间；玩完请离开房间。[Cloudflare 官方说明](https://developers.cloudflare.com/durable-objects/platform/pricing/)

部署或平台重启会清空内存中的房间。断线恢复针对同一服务器实例仍然存在的对局；页面保存的身份在当前标签页 sessionStorage 内。房间不是公开大厅，但任何获得邀请链接的人都能加入。

## Render 备用部署

在 Render 创建 Blueprint，选择 [mli55/bombit-online](https://github.com/mli55/bombit-online)，使用仓库中的 `render.yaml`。配置为 **Free / Virginia**，构建 `npm ci && npm run build`，启动 `node server/index.js`。

Render Free 空闲 15 分钟后休眠，再次访问通常需要约一分钟唤醒；每月有 750 小时免费实例时长，服务可能被平台重启。带宽、构建额度另计，绑定付款方式的账号应检查支出上限。[Render 官方说明](https://render.com/docs/free)

## 验证

```sh
npm run build
npm run check
npm test
```

`npm test` 包含房间协议和真实四连接 WebSocket 集成测试。检查 Worker 本地运行环境：

```sh
npx wrangler dev --port 8787
# 在另一个终端运行
TEST_BASE_URL=http://localhost:8787 node --test test/network.test.js
```

原版引擎确定性测试：启动 Node 服务，打开 http://localhost:3000/qa.html 并点击 Run。每种人数配置会载入四个独立引擎副本，每局运行 6,000 个网络帧（200 秒模拟时间），每 30 帧比较状态。该页面不发布到 Cloudflare。

浏览器实测使用当前桌面 Chromium 环境；尚未在四台跨地域设备、Safari、Firefox 或手机上完成实测。网络输入需经过服务器，不承诺零延迟；右上角显示往返时延。长时间切后台会触发暂停，回到页面后由房主继续。

源码结构与原版文件来源见 [ARCHITECTURE.md](ARCHITECTURE.md) 和 [THIRD_PARTY.md](THIRD_PARTY.md)。
