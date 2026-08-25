# 在 Mac / iPhone 上安装原生 Shield

## 前提

- macOS、最新版 Xcode、一台真机 iPhone。
- Apple Developer 账号。开发调试可添加 Family Controls capability；要通过 TestFlight/App Store 分发，还需为主 App 和三个 Screen Time 扩展分别申请 Family Controls distribution entitlement。
- 安装 [XcodeGen](https://github.com/yonaskolb/XcodeGen)。

## 生成工程

在 `ios` 目录运行：

```sh
xcodegen generate
open SleepGuard.xcodeproj
```

然后在 Xcode 中：

1. 给主 App 和三个扩展 target 选择同一个 Team。
2. 确认四个 target 都有 **Family Controls** 与 **App Groups** capability。
3. App Group 必须完全一致：`group.com.bellaandc.sleepguard`。
4. 若 bundle ID 已被占用，同时改 `project.yml` 中三个 ID 与 App Group，再重新生成工程。
5. 选中真机运行；模拟器不作为 Shield 行为验收依据。
6. 首次启动按“允许系统拦截”，通过 Face ID/Touch ID 授权，再选择 App。

## 真机验收

1. 选择一个无关紧要的测试 App。
2. 启动守卫。
3. 打开测试 App，应看到“被老公抓到了”的系统 Shield，而不是 App 内容。
4. 点“回去睡觉”，当前 App 应关闭。
5. 在 iOS 26 及以后点“申请临时解锁”，应打开睡眠守卫主 App 并增加记录；旧系统会保留 Shield 并刷新文案。
6. 第三次操作后，Shield 不再展示解锁入口。
7. 把测试结束时间临时改近，验证 Device Activity Monitor 能在区间结束时清除 Shield。

## 还没有伪装成已完成的部分

- 5 分钟等待后开放 3 分钟，需要 Device Activity Monitor 扩展做系统调度，不能用普通 `Timer` 冒充后台可靠性。
- Shield Configuration 扩展不能联网，所以它不直接发 Bark。
- 设备所有者用 individual authorization 时，最终仍可在系统设置撤销授权或删除 App；这不是 MDM。
