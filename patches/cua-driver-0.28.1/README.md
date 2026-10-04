# Cua Driver 0.28.1：单窗口录制与动作信息补丁

基线：`cua-driver-rs-v0.28.1`，commit `d8028a7943087ee258dc1b4d19dc12a7cd27669c`。这是本地构建补丁，不是 Cua 官方签名版本。

## 当前交付

- `start_recording` 增加可选 `video_target: {pid, window_id}`。macOS 使用 ScreenCaptureKit 的 desktop-independent window filter，校验准确的窗口 ID 和所属进程。不存在、归属不符或平台不支持时明确失败，不退回整屏录制。
- 原生窗口录制保持 30fps H.264 MP4 输出，不录系统音频或麦克风；尺寸按窗口 point/pixel scale 计算并调整为编码所需偶数。
- `get_window_state` 的文本结果附带真实 `snapshot_id` 和截图/窗口尺寸。只消费 MCP text/image 的客户端也能使用 `snapshot_id + element_index`，不再因为只拿到裸 index 而无法调用 AX 动作。
- `list_windows` 的文本结果列出窗口 ID、PID、名称、bounds，不再只给窗口数量。
- 共享接口保留原整屏录制行为；Windows/Linux 没有单窗口后端时明确报不支持。

调用示例（PID/window ID 必须取自当前窗口列表）：

```json
{
  "output_dir": "/absolute/path/to/recording",
  "record_video": true,
  "video_target": {"pid": 1234, "window_id": 5678}
}
```

调用 `stop_recording` 后检查 `video_active`、`last_error`、`last_video_path` 和文件最终状态。请求了单窗口视频但启动失败时，工具返回错误；可能仍有轨迹记录开启，错误会明确说明，需要 `stop_recording` 收尾。

## 构建

要求 macOS、Xcode、Rust/Cargo。脚本锁定上游版本与 Cargo.lock，不升级依赖。

```sh
bash patches/cua-driver-0.28.1/build-local.sh
```

也可传入位于准确基线上的独立 checkout。脚本校验并应用补丁、运行针对性测试、编译 release binary，产物在：

```text
patches/cua-driver-0.28.1/build/CuaDriverLocal.app
```

脚本仅构建和 ad-hoc 签名 staging 包，不安装、不启动 daemon、不修改 DSH provider 配置、不重置 TCC。已有同名构建包时会拒绝覆盖。

## 签名与实际安装

本机正式版由 `Cua AI, Inc. (YCK386LBJ7)` 签名；本机可用代码签名身份为 0。补丁无法保留官方签名身份，所以不能承诺继承已授权的录屏权限。

Local 包使用：

- bundle ID：`com.trycua.driver.local`
- executable：`cua-driver-local`
- 独立 socket/state namespace，避免误连正式版 daemon。

进行原生实测前，需要将该包安装为 `/Applications/CuaDriverLocal.app`，由用户为 **Cua Driver Local** 授予屏幕录制和辅助功能权限，再让测试 MCP provider 指向它的 `Contents/MacOS/cua-driver-local`。不要重新签名或覆盖正式版 `CuaDriver.app`；不要运行任何针对正式版的 TCC reset。Ad-hoc 包后续重新构建时可能需要再次授权。

DSH PiP 目前仍使用正式驱动的只读抓帧，这个补丁没有自动切换其驱动或 MCP 配置。切换前必须核验实际加载版本及驱动路径，不能只看磁盘上的构建产物。

## 已知边界

1. **单窗口录制不等于 PiP 视频流接入。** 当前增加的是单窗口 MP4 录制；没有实现 WebRTC、实时分片视频端点或把 SCStream 的视频帧接到 DSH PiP。不能据此宣称已实现 30fps PiP。
2. **尚未完成用户 Clock case 的原生验收。** 编译与函数测试不能证明后台 Clock 会持续重绘，也不能证明不会抢焦点。授权 Local 包后才能做这项测试。
3. 视频编码画布在录制开始时固定；应用 resize 后按比例放入初始画布。
4. 沿用上游单一 recording session，重复 start 会替换旧录制；后端启动失败可能已结束先前录制，只保留新的轨迹会话及错误。语法/范围错误在替换前拒绝。不要拿它直接代替多个会话各自的 PiP 流。
5. 手动 `stop_recording` 沿用上游全局停止语义；它只停止捕获，不点击、停止或复位 Clock。

## Clock 验收标准

先核验 PiP `/cua-pip/health` 的运行版本，再明确选定 Local driver；只观测用户允许的 Clock 窗口。

- 使用 fresh `snapshot_id + element_index` 或 `element_token` 操作；不能猜固定 640 宽坐标，也不能通过反复试点校准。
- 已在运行时不为了演示而停止、复位或改变窗口大小。用户要求保持后台时，不使用 `bring_to_front`、foreground delivery 或需要窗口前置的菜单工具。
- 使用连续录制的帧时间线和两次间隔读数验证递增。AX 与像素矛盾时结果为未知，不能直接宣布“App Nap”或“计时始终在运行”。
- 设置 30 秒关闭后，记录期限、实际 PiP 关闭时间和关闭后 Clock 状态。结果必须能对应同一轮采样，而非十几分钟后倒推。
- 相同动作连续两次没有明确效果时停止试错并报告缺失能力，不允许再用数十次点击完成一个 30 秒示例。
