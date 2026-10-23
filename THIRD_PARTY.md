# 上游来源

本项目是个人好友联机适配，非原发行方作品。

- 用户指定参考：[7k7k 泡泡堂页面](https://www.7k7k.com/flash/13076.htm)、[Bomb It 1](https://bombitgame.com/#play-bomb-it-1)。
- 使用参考页面所提供的 Bomb It 1 HTML5 发行版，而非 SWF/Flash 模拟。
- HTML5 资源来源：`https://html5.gamedistribution.com/rvvASMiM/bf359863a59f41c7b7e06ab637d009e4/`。
- 原版代码、图像、音频、字体、商标及内嵌依赖均属于各自权利人；保留原文件内已有版权和许可声明。本仓库不对这些文件重新授予开源许可。
- `original/manifest.json` 记录下载来源、文件大小和 SHA-256，用于验证原版资源。`scripts/fetch-original.mjs` 是资源获取脚本。
- 新增大厅、联机适配和服务器代码与上游资源分开存放。

`ws` 通过 npm 安装，许可信息随该包提供。Cloudflare Wrangler 是部署工具，不包含在发布给玩家的客户端中。
