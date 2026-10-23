# 验证记录

2026-10-22，美国东部时间。

- `npm run check` 语法检查通过。
- `npm test`：10 项通过，包含房间协议及四个真实 WebSocket 连接。
- `TEST_BASE_URL=http://localhost:8787 node --test test/network.test.js`：Cloudflare 本地运行环境通过。
- `TEST_BASE_URL=https://bombit-online.mengninglihi.workers.dev node --test test/network.test.js`：公网 HTTP 资源、四连接操作广播、断线回放、暂停和离开房间通过。
- 原版 121 个文件与来源 manifest 的大小、SHA-256 全部匹配。
- 四副本确定性验证：1、2、3、4 位真人配置各 6,000 网络帧，均通过。详见 `browser-qa.txt`。双人配置使用闯关，其他配置使用混战。
- 四个浏览器实际进入 Cloudflare 本地四人混战；其中一位刷新，恢复后继续显示状态一致。
- 公网两个浏览器实际进入双人闯关，共同结算第一关并继续第二关，状态校验通过。截图 `gameplay.png` 显示第二关和 1,200 帧一致状态；此时本机到服务器往返约 60ms。

这些浏览器测试在同一台机器的 Chromium 环境运行，公网连接确实经过 Cloudflare。尚未覆盖四台异地设备、不同浏览器引擎组合、完整关卡通关和移动端实机。此记录不是对所有网络条件下时延的保证。
