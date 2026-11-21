<p align="center">
  <img src="resources/icons/app.png" width="112" alt="Visual Novel Editor 应用图标">
</p>

<h1 align="center">Visual Novel Editor</h1>

<p align="center">
  梳理故事分支，编排每一幕，让笔下的世界成为可交互的体验。
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <a href="https://github.com/D4eee/Visual-Novel-Editor/releases/latest">下载编辑器</a> ·
  <a href="docs/user-guide/README.zh-CN.md">使用指南</a> ·
  <a href="docs/release-notes/v1.0.0.md#简体中文">更新说明</a> ·
  <a href="docs/modding/getting-started.zh-CN.md">模块开发入门</a>
</p>

---

Visual Novel Editor 是一款独立运行的视觉小说与互动叙事创作工具。你可以在同一工作区中规划剧情路线、用图层编排场景、通过时间轴制作动画，再用可视化积木实现交互逻辑。

编辑器支持 **macOS、Windows 和 Linux**，提供**简体中文与英文界面**。作品可导出为**网页版、macOS 应用或 Windows 程序**，玩家无需安装编辑器即可游玩。

## 从故事构思到可玩的作品

| 工作区 | 你可以完成的创作 |
| --- | --- |
| **故事流程图** | 按章节组织剧情，连接场景与选项，设置条件判断、事件、加权随机分支、等待、跨章节跳转和结局；可查看单个章节或完整故事。 |
| **场景编排** | 自由组合背景、角色立绘、图片、文字、对白、形状、按钮、交互热区、音频和视频；通过分组与可复用组合管理场景。 |
| **对白设计** | 自由放置对白框，制作对话气泡与思考气泡，调整文字和外观，导入字体，并加入逐字显示效果。 |
| **时间轴动画** | 类似 After Effects 的时间轴：图层条与入点/出点、带秒表的属性分组、带贝塞尔手柄的图表编辑器、标记、工作区、父级链接，以及画布上的运动路径；动作还能与音频、视频和特效配合。 |
| **预设** | 在属性面板的“预设”标签中一键添加入场、强调、退场动画，套用文字、形状、按钮和对白框的外观，使用效果预设，并保存自己的预设。 |
| **程序化特效** | 用节点图组合模糊、色彩调整、扭曲、噪声和自定义 GLSL 着色器；将效果保存为预设，并通过 `.vnefx` 文件复用和分享。 |
| **可视化脚本** | 用类似 Scratch 的拼图积木组合触发器、动作、数值和条件，积木形状对应实际的连接方式；设置点击区域、控制元素与媒体、创建可复用行为，并在测试时查看执行过程。 |
| **游戏系统** | 让音乐、循环动画和脚本跨页面延续；用全局元素构建状态界面与背包，播放精灵逐帧动画，管理参数与列表，并用收集物解锁选项和路线。 |
| **AI 助手** | 用你自己的 API Key 连接 Claude 或任意 OpenAI 兼容模型；助手通过 MCP 格式的编辑器工具写场景、加元素和动画、搭建交互，每次回复都能撤销。 |
| **预览与导出** | 从当前场景、章节或完整故事开始预览，查看变量与执行日志；预览和导出作品共用运行时，导出时仅包含作品使用的素材与运行时模块。 |

项目还支持**自动保存、异常恢复、备份、撤销与重做，以及版本化数据迁移**。编辑过程中的校验会提示断开的剧情路线、缺失素材等问题，帮助你在导出前定位并修复。

## 下载与启动

前往 [GitHub Releases](https://github.com/D4eee/Visual-Novel-Editor/releases/latest) 下载可直接运行的桌面版，无需另外安装 Node.js。

| 你的系统 | 下载文件 |
| --- | --- |
| macOS · Apple 芯片 | `Visual-Novel-Editor-<version>-mac-arm64.zip` |
| macOS · Intel 芯片 | `Visual-Novel-Editor-<version>-mac-x64.zip` |
| Windows · x64 | `Visual-Novel-Editor-<version>-win-x64.zip` |
| Linux · x64 | `Visual-Novel-Editor-<version>-linux-x64.zip` |
| 网页版编辑器 · Node.js 20+ | `Visual-Novel-Editor-<version>-web.zip`（1.0.0 起） |

**macOS：** 解压后，将 `Visual Novel Editor.app` 移入“应用程序”。分发版本尚未经过 Apple 公证；确认下载来源可信后，可按现有的首次启动流程在终端运行：

```bash
xattr -cr "/Applications/Visual Novel Editor.app"
codesign --force --deep --sign - "/Applications/Visual Novel Editor.app"
```

**Windows：** 解压后，运行 `Visual Novel Editor.exe`。

**Linux：** 解压后，运行 `visual-novel-editor`。

发布附件中的 `SHA256SUMS.txt` 可用于核对文件校验值。从 **v1.0.0** 起，发布附件还包含网页版编辑器压缩包，安装 Node.js 20 或更高版本即可在浏览器中使用；也可以[从源码启动](#开发与构建)。更早的 **v0.3.1** 只有桌面安装包。

> **编辑器运行平台与作品导出平台有所区别。** Linux 安装包用于运行编辑器；目前文档列出的作品导出目标为网页版、macOS 和 Windows。

## 开始你的第一个故事

1. **创建项目**，或复制一个内置示例进行尝试。
2. **编写并连接场景**，为每个选项连接独立的剧情出口。
3. **编排画面与声音**，加入图片、角色、对白和交互元素。
4. **添加动画与行为**，使用时间轴、特效节点和可视化脚本丰富表现。
5. **预览、修复校验错误并导出**，将作品交给玩家。

[快速上手教程](docs/user-guide/getting-started.zh-CN.md) 会带你完成一个拥有两条路线的小故事。

## 1.0.0 更新亮点

- **AI 助手：**
  - 在标签栏旁打开聊天面板（Ctrl/⌘+J）；
  - 用你自己的 Key 连接 Claude 或 OpenAI 兼容接口；
  - 通过 24 个 MCP 格式的编辑器工具直接修改项目；
  - 每次回复都能撤销，并可切换为只读。
- **设置窗口：**界面语言、主题、背景色与强调色、字体大小、界面缩放、自动保存、默认缓动、时间码与帧率，以及 AI 连接。
- **After Effects 风格时间轴：**
  - 图层条与入点/出点；
  - 带秒表、可拖动数值和关键帧导航的属性分组；
  - 带贝塞尔手柄的图表编辑器；
  - 框选与时间拉伸、吸附、标记和工作区；
  - 父级链接、画布上的运动路径，以及 AE 快捷键。
- **属性面板标签：**
  - 选项 / 效果 / 预设；
  - 18 个动画预设和现成外观；
  - 可保存自己的预设。
- **拼图积木：**
  - 积木像 Scratch 一样拼接；
  - 结束脚本的积木底部是平的，只能放在末尾。
- **新版应用图标**、网页版编辑器下载，以及项目格式 4 / 模组 API 1.3。

查看[完整更新说明](docs/release-notes/v1.0.0.md#简体中文)。首页介绍以当前源码为准；更新说明记录对应已发布版本的变化。之前的版本：[0.3.1](docs/release-notes/v0.3.1.md#简体中文)。

## 文档导航

| 你想要做什么 | 推荐入口 |
| --- | --- |
| 制作第一个故事 | [快速上手](docs/user-guide/getting-started.zh-CN.md) |
| 了解编辑器各个工作区 | [使用指南](docs/user-guide/README.zh-CN.md) |
| 让 AI 帮我编辑项目 | [AI 助手（英文）](docs/user-guide/ai-assistant.md) |
| 修改颜色、字体等设置 | [设置（英文）](docs/user-guide/settings.md) |
| 学习跨页继承、背包与收集物 | [游戏模块指南](docs/user-guide/game-module.zh-CN.md) |
| 导出可游玩的作品 | [导出指南（英文）](docs/user-guide/export.md) |
| 开发扩展模块 | [模块开发入门](docs/modding/getting-started.zh-CN.md) |
| 查询 SDK 接口 | [API 参考（英文）](docs/api/README.md) |
| 了解代码结构与设计 | [架构说明（英文）](docs/architecture/README.md) |
| 构建与打包编辑器 | [构建与发布（英文）](docs/architecture/build-and-release.md) |

完整入口见[文档目录](docs/README.zh-CN.md)。尚未提供中文版本的详细文档已标明为英文。

## 扩展与模块开发

模块可以添加故事节点、场景元素、属性、特效、转场、脚本积木、系统、面板、工作区、导入器和导出器，也可以同时扩展编辑器与游戏运行时。

仓库提供**模块 SDK、入门模板和七个示例模块**。当某个模块未安装时，项目仍会保留该模块的数据，避免仅因缺少扩展而丢失原有内容。

## 开发与构建

需要 **Node.js 20 或更高版本**。

```bash
npm install
npm start
```

`npm start` 会构建并打开 Electron 桌面编辑器。如需使用浏览器版，运行：

```bash
npm run serve
```

随后访问 `http://127.0.0.1:5199`。

<details>
<summary><strong>检查命令、打包方式与仓库结构</strong></summary>

### 项目检查

```bash
npm run typecheck
npm run check-i18n
npm test
```

### 打包方式

| 命令 | 输出内容 |
| --- | --- |
| `npm run app:mac` | 适用于当前 Mac 的桌面应用 |
| `npm run app:win` | Windows x64 桌面版压缩包 |
| `npm run app:web` | 浏览器版编辑器压缩包，需要本地 Node.js 服务 |
| `npm run dist:mac` | 通过 electron-builder 生成 macOS 安装包 |
| `npm run dist:win` | Windows 安装程序与 ZIP 压缩包 |

打包时会下载作品导出所需的 Electron 运行时模板，核对校验值后随编辑器一起分发。跨平台打包和签名细节请参阅[构建与发布（英文）](docs/architecture/build-and-release.md)。

### 仓库结构

| 路径 | 用途 |
| --- | --- |
| `packages/core` | 数据模型、故事图规则、校验、迁移、表达式与本地化 |
| `packages/runtime` | 预览与导出作品共用的游戏运行时 |
| `packages/host` | 文件读写、项目管理、素材、模块与导出 |
| `packages/desktop` | 编辑器与导出游戏的 Electron 外壳 |
| `packages/editor` | React 编辑器界面 |
| `sdk` | 模块 SDK 类型定义与辅助工具 |
| `examples/games` | 可作为模板使用的示例项目 |
| `examples/extensions` | 七个示例模块 |
| `templates/extension` | 扩展模块入门模板 |
| `docs` | 使用指南、更新说明、API 文档与架构说明 |

</details>

## 许可证

MIT
