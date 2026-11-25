# Figma 中文汉化助手（Chrome / Edge 扩展）

一个轻量、零网络请求、纯本地运行的 **Figma 简体中文汉化扩展（Manifest V3）**，支持 Chrome / Edge / Arc / Brave，并可配合浏览器的「安装为桌面应用（PWA）」获得和原生客户端一致的独立窗口、Dock 图标与本地字体体验。

---

## 核心功能

- **全面覆盖 Figma 现代界面（UI3）**：工作台、账户与设置弹窗、顶部菜单栏、工具栏、左侧图层/资源栏、右侧 Design / Prototype / Dev Mode 面板、自动布局、变量、导出、FigJam、Slides 及动态时间/计数短语。
- **实时无刷新中英切换**：点击扩展弹窗开关即可在中英文之间瞬间切换，无需刷新画布。
- **长按 `Option`（Alt）速查英文原文**：对照英文教程或寻找快捷键时，按住 `Option` 键临时显示英文，松开恢复中文。
- **保护用户内容不被误翻**：默认跳过图层树名称、页面名、文件标题、评论正文、代码区域与输入中内容。

---

## 安装步骤（1 分钟完成）

### 第一步：获取扩展文件

- **普通用户推荐（直接下载压缩包）**：前往本仓库 [Releases 页面](https://github.com/AulusCaelius/figma-cn-helper/releases/latest) 下载最新的 `figma-cn-helper-v*.zip`，并**解压**到本地固定文件夹（例如「文稿」目录，后续不要删除该文件夹）。
- **开发者方式**：执行 `git clone https://github.com/AulusCaelius/figma-cn-helper.git`。

### 第二步：在 Chrome / Edge 中加载扩展

1. 打开 Chrome 地址栏输入 `chrome://extensions` 并回车（Edge 输入 `edge://extensions`）。
2. 打开右上角的 **「开发者模式」** 开关。
3. 点击左上角 **「加载已解压的扩展程序」**（Edge 为「加载解压缩的扩展」）。
4. 选择刚才解压出来的文件夹（包含 `manifest.json` 的那一层目录）。
5. 打开或刷新 [https://www.figma.com](https://www.figma.com)，即可自动生效。

### 第三步（推荐）：将 Figma 安装为 macOS / Windows 独立桌面 App

这样你可以像使用原生客户端一样从程序坞（Dock）独立启动 Figma，且**完整保留本汉化插件**：

1. 在 Chrome / Edge 的**普通窗口**（非无痕模式）打开 [https://www.figma.com](https://www.figma.com)。
2. 通过浏览器右上角菜单安装为独立应用：
   - **Chrome**：点击右上角 `⋮` → **「投放、保存和分享」** → **「将页面作为应用安装…」**（英文版：`Cast, save, and share` → `Install page as app…`）。
   - **Edge**：点击右上角 `…` → **「应用」** → **「将此站点作为应用安装」**（英文版：`Apps` → `Install this site as an app`）。
3. 弹窗中输入名称（例如 `Figma 中文版`）并点击 **「安装」**，即可获得无地址栏的独立 macOS 窗口，并在「应用程序 / Chrome 应用」与程序坞（Dock）中直接启动。
4. **本地字体支持**：因为你本机已安装官方 `Figma.app`，其后台本地字体服务（FigmaAgent）会继续为浏览器 / PWA 提供你电脑里的所有中文字体。

---

## 目录结构

```text
figma plugin/
├── manifest.json           # Manifest V3 扩展清单（仅申请 storage 权限）
├── dict/
│   ├── base-dict.js        # 内置 1100+ 条 Figma 界面中文字典
│   └── regex-rules.js      # 动态时间/数量/操作短语正则规则
├── content/
│   └── translator.js       # React 安全 DOM 翻译引擎 + Option 速查 + Shadow DOM 取词
├── popup/
│   ├── popup.html          # 扩展弹窗结构
│   ├── popup.css           # 深浅色自适应样式
│   └── popup.js            # 开关控制、页面状态同步与自定义词库管理
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```
