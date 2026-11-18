# Windows / Electron：安装、升级、回退、卸载

版本：Avatar Studio 0.4.0（实验）。包名保持 `dsh-charakuru-studio`。目标 DSH 0.2.2-rc.3 / Node 22+。

## 安装与升级

1. 备份自己的工程目录、已用旧包和 `%USERPROFILE%/.dsh/profiles/desktop` 中已有配置/锁文件。备份可能包含敏感信息，只在本机保留。
2. 打开官方 DSH Electron 应用，侧栏「插件 → 添加插件」。输入本地 `dsh-charakuru-studio-0.4.0.tgz` 的完整路径。
3. 点击「安装」，核对包名与版本，点击「立即启用」。不要批准无关插件安装脚本。
4. 进入 **Avatar Studio 工作台**，核对七标签、连接状态、工程版本；`/health` 应报告 0.4.0。
5. 必要时用应用菜单重启。不要同时运行两个监听同一工作台端口的实例。

**desktop profile 由 Electron 独占管理。** CLI 会拒绝该 profile；不要给 EXE 追加 `plugin` 命令，不要手工修改 profile 的 package.json/锁文件绕过。0.2.1 起允许真实 `dsh-app://app` 来源；0.2.0 的工作台连接问题已修复。

仓库代码变更不会自动更新通过 tgz 安装的插件。安装包内已有离线前端，不需 npm install / CDN / 模型下载。

## 同机网页端

在对应 DSH Host 的独立网页 profile 通过其插件管理入口安装同一 tgz。打开该 Host 的同机网页，点击同名侧栏；不要把远程浏览器访问自身的 `127.0.0.1` 当成连接了 DSH 主机。需要比对 Web 与 Electron 时，分别记录两个 profile 和服务端口，避免旧包在 9886 冒充新版。0.4.0 的真实安装和 Renderer 点击验收尚未完成；HTTP / 模拟测试只验证契约。

## Blender / VRM Add-on

companion 独立安装；本插件不会自动升级它。3.0.6 默认 9877，3.1 Gateway 默认 39877。检测到多个实例时显式选择，不要同时启用两个 agent bridge。

官方 VRM Add-on 4.10.5 在 Blender 5.3.0 的项目级 headless 执行中实测；可在自己的私有工程 `.runtime` 中解压官方 legacy ZIP。三维编辑参数 `vrmAddonPath` 指向模块所在父目录，默认模块名 `VRM_Addon_for_Blender-release`。此路线只设置进程内 preferences，不保存全局用户设置。**不是已完成 GUI 全局安装的声明。** 更换 add-on 版本后重新验证。

## 回退

在 Electron 插件管理器停用本插件，再用「添加插件」安装保留的旧 tgz，启用并核对版本。不要用 CLI 操作 desktop。旧版未理解的新工程字段可能丢失；回退包时恢复安装前的工程副本，或另用新目录，避免让旧版改写新工程。

## 卸载与数据保留

在 Electron 插件管理器停用并移除本插件。工程目录、输出、手工账户账本与凭据不会自动删除。需要彻底清理时：

- 先在面板「密钥」明确删除相应凭据；不要在聊天中粘贴密钥。
- 备份后自行删除不再需要的工程。账本默认在 `%USERPROFILE%/.dsh/charakuru-studio/accounts`。
- companion / VRM Add-on 独立管理，不随本插件卸载。

本轮不会为了演示卸载而删除用户工程或凭据。安装回退/卸载指南不是全新用户全流程验收回执。

## 连接故障

- 9886 被占用：检查本插件实例；在插件配置与面板设置中使用同一新端口。
- `Failed to fetch`：核对版本、工作台端口与来源；不要放开任意 CORS Origin。
- GUI doctor 不通过：不能声称 GUI 连接正常；可独立检查 headless 能力和真实回执。
- `Input changed` / `artifact changed`：保留证据，不手改 hash；重新导入或从未修改的版本恢复。
- `in-flight / uncertain`：先核对供应商或 companion 任务，不要直接换 request ID 重试。
