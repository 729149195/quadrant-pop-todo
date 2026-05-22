# 中文发布文案

## V2EX「分享创造」

标题：

```text
做了一个 Windows 快捷键弹出的四象限待办小工具，开源 + 本地存储
```

正文：

```text
大家好，我做了一个 Windows 桌面待办小工具：Quadrant Pop Todo。

它解决的是一个很小但高频的问题：突然想到一件事时，不想打开完整待办软件，只想按一个快捷键，在鼠标位置快速记下来。

主要功能：
- Ctrl + Alt + Space 在鼠标位置呼出
- 四象限：重要/紧急
- 每条待办可以设置提醒，到点弹窗
- 同一个象限里可以拖动排序
- 标题自动换行，不会因为太长被截断
- 本地 JSON 存储，不需要账号，也不会上传数据
- 开源，提供 Windows 便携版 exe

GitHub：
https://github.com/729149195/quadrant-pop-todo

下载：
https://github.com/729149195/quadrant-pop-todo/releases/latest

这是个人开发者应用，exe 目前没有商业代码签名，所以 Windows SmartScreen 可能会提示风险；源码、构建方式和 SHA256 都放在仓库里。

欢迎反馈，尤其是快捷键、弹窗位置、提醒体验、窗口交互这些细节。
```

## 小众软件论坛

标题：

```text
[自荐] Quadrant Pop Todo：快捷键弹出的 Windows 四象限待办
```

正文：

```text
自荐一个自己做的 Windows 小工具：Quadrant Pop Todo。

它不是完整项目管理软件，而是一个更轻量的“随手记待办”弹窗。按快捷键后，窗口会出现在鼠标附近，可以快速记录一件事，并按重要/紧急放入四象限。

功能：
- 全局快捷键呼出：Ctrl + Alt + Space
- 四象限待办：重要且紧急、重要不紧急、不重要但紧急、不重要不紧急
- 待办提醒：到时间自动弹窗
- 同象限拖动排序
- 托盘常驻、窗口固定、失焦隐藏
- 本地 JSON 存储，无账号、无同步、无遥测

项目地址：
https://github.com/729149195/quadrant-pop-todo

下载地址：
https://github.com/729149195/quadrant-pop-todo/releases/latest

目前是个人开发者应用，exe 未签名，Windows 可能会出现 SmartScreen 提示。源码已开源，可以自行检查或构建。
```

## 掘金 / 知乎文章大纲

标题：

```text
我做了一个按快捷键弹出的四象限待办小工具
```

结构：

```text
1. 为什么做它
   - 临时想起一件事时，完整待办软件太重
   - 需要一个“按快捷键立刻记下”的入口

2. 产品思路
   - 窗口出现在鼠标位置
   - 默认用四象限做优先级判断
   - 不做账号、不做云同步，先把本地体验做好

3. 当前功能
   - 快捷键唤起
   - 四象限
   - 提醒
   - 拖动排序
   - 本地 JSON

4. 技术实现
   - Electron
   - globalShortcut
   - tray
   - 本地 JSON 持久化
   - GitHub Release 分发 exe

5. 下载和反馈
   - GitHub 链接
   - Release 链接
   - 希望大家反馈哪些体验问题
```

## 短社媒文案

```text
做了一个 Windows 小工具：Quadrant Pop Todo。

按 Ctrl + Alt + Space，它会在鼠标位置弹出，可以快速记录待办，并按重要/紧急放进四象限。支持提醒、拖动排序、本地存储，开源。

GitHub / 下载：
https://github.com/729149195/quadrant-pop-todo
```

## 常见回复模板

SmartScreen 提示：

```text
这是个人开发者应用，目前没有购买商业代码签名证书，所以 Windows SmartScreen 可能会提示风险。源码、构建方式和 SHA256 校验都在 GitHub 上，可以自行检查或从源码构建。
```

快捷键冲突：

```text
现在默认是 Ctrl + Alt + Space，如果被占用会尝试 Ctrl + Shift + Space。后续我会考虑加自定义快捷键设置。
```

打不开 / 闪退：

```text
麻烦在 GitHub Issues 里反馈一下 Windows 版本、应用版本、复现步骤和截图。我会优先处理启动和提醒相关的问题。
```

数据保存在哪里：

```text
数据只保存在本机 Electron userData 目录，应用内文件夹按钮可以直接打开数据目录。主要是 todos.json 和 window-state.json。
```
