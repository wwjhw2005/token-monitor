# English

**Open-source build, not paid-signed.** macOS and Windows will ask you to confirm on first launch — instructions below.

## What's changed

### Added
- **GitHub Copilot limits support:** sign in from Settings and show Copilot limit windows alongside the other AI Tool Limits providers.
- **Grok and Minimax limits support:** show Grok billing/credits and Minimax Token Plan limits from the Limits views, tray, and provider account cards. (#32)
- Usage tracking for **MiMo Code** and **ZCode**, with matching app icons and WSL discovery markers.
- **Windows WSL controls:** Settings -> Collection now includes a **Scan tools inside WSL** toggle and a **WSL detection** panel that shows which running distro/home paths contribute usage.
- **Display currency auto-update:** costs can use daily refreshed exchange rates, with manual overrides still available in Settings. (#33)

### Improved
- Full collector scans now publish progressive results sooner, reducing the wait during heavier scans. (#27)
- The collector now preserves its full-scan anchor across restarts and refreshes WSL snapshots on interval ticks, reducing unnecessary full rescans. (#29)
- Tokscale is bundled at **4.0.4**, including the Codex fork/replay accounting fix.

### Fixed
- Stale devices no longer keep old today/month totals alive in Hub aggregates. (#37)
- Collector period windows now share one capture time, avoiding mismatched boundary timestamps. (#37)
- Hermes Agent watches are limited to the `state.db` file family so unrelated file changes do not retrigger collection. (#38)
- WSL usage remains included correctly during warm progressive previews.

## Which file should I download?

- **macOS (Apple Silicon, M1 and later)** — the `.dmg` file
- **Windows 10/11** — `Token Monitor Setup ….exe` (installer, recommended)
- **Windows portable** — `Token Monitor ….exe` (runs without installing)

Intel Macs and Linux are not pre-built — run from source per the [README](https://github.com/Javis603/token-monitor#readme). The macOS `.zip` is the same app repackaged; ignore it unless you specifically need it.

## First-launch unlock

**macOS:** right-click `Token Monitor.app` → Open (once). If you see "Token Monitor" can't be opened or is damaged:

```bash
xattr -dr com.apple.quarantine "/Applications/Token Monitor.app"
```

**Windows:** SmartScreen → More info → Run anyway.

## tokscale dependency

Tokscale is bundled with this app. See **Settings → Tokscale** for the exact version
and the option to download a newer version directly from npm. Tokscale is MIT,
open-source: https://github.com/junhoyeo/tokscale

---

# 中文

**这是开源构建，不是付费签名版本。** macOS 和 Windows 首次启动时会要求你手动确认，操作说明见下方。

## 更新内容

### 新增
- **GitHub Copilot 额度支持：** 可在设置中登录，并与其他 AI 工具用量上限提供方一起显示 Copilot 的额度窗口。
- **Grok 和 Minimax 额度支持：** 在额度视图、托盘和提供方账号卡片中显示 Grok billing/credits 与 Minimax Token Plan 额度。(#32)
- 新增 **MiMo Code** 和 **ZCode** 用量追踪，并补齐对应应用图标与 WSL 发现标记。
- **Windows WSL 控制：** 设置 -> 采集 现在包含 **扫描 WSL 里的工具** 开关，以及显示哪些运行中的发行版/home 路径贡献用量的 **WSL 检测** 面板。
- **显示币别自动汇率：** 成本可使用每日自动刷新的汇率，仍可在设置中手动覆写。(#33)

### 改进
- 完整采集扫描现在会更早推送渐进结果，降低重型扫描时的等待感。(#27)
- 采集器会跨重启保留 full-scan anchor，并在定期扫描时刷新 WSL 快照，减少不必要的完整重扫。(#29)
- Tokscale 已内置升级到 **4.0.4**，包含 Codex fork/replay 统计修复。

### 修复
- Hub 聚合时，过期设备不再让旧的今日/本月总量继续保留。(#37)
- 采集器的 period windows 现在共用同一个捕获时间，避免边界时间戳不一致。(#37)
- Hermes Agent 监听范围已限制在 `state.db` 文件族，避免无关文件变化重新触发采集。(#38)
- WSL 用量在 warm progressive preview 期间会继续正确并入。

## 应该下载哪个文件？

- **macOS（苹果芯片，M1 及之后机型）** — 下载 `.dmg` 安装包
- **Windows 10/11** — 下载 `Token Monitor Setup ….exe`（安装版，推荐）
- **Windows 便携版** — 下载 `Token Monitor ….exe`（无需安装，直接运行）

Intel Mac 和 Linux 暂不提供预构建版本，请参考 [README](https://github.com/Javis603/token-monitor#readme) 从源码运行。macOS 的 `.zip` 只是同一个 app 的重新打包版本，除非你明确需要，否则可以忽略。

## 首次启动放行

**macOS：** 右键 `Token Monitor.app` → 打开（只需要一次）。如果看到「Token Monitor」未开启 或 已损坏：

```bash
xattr -dr com.apple.quarantine "/Applications/Token Monitor.app"
```

**Windows：** SmartScreen → 更多信息 → 仍要运行。

## tokscale 依赖

Tokscale 已随应用内置。你可以在 **设置 → Tokscale** 查看确切版本，
也可以直接从 npm 下载更新版本。Tokscale 是 MIT 开源项目：
https://github.com/junhoyeo/tokscale
