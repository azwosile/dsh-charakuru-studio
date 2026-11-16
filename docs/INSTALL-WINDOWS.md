# Windows 一键安装

使用 `Install-Charakuru-Studio.cmd`。插件 0.1.0 安装包已内嵌在脚本内，无需另放 tgz 文件。

1. 完全退出 DeepSeek Harness，包括托盘中的进程。
2. 双击安装器。默认识别本机桌面版安装位置；其他位置会弹出程序选择窗口，请选择 `DeepSeek Harness.exe`。
3. 等待官方 Desktop CLI 完成 `plugin --profile desktop add <本地包>`。安装器保留现有插件与配置，包括 dsh-purge，不自动批准依赖脚本。
4. 重新打开 DSH，在“插件”页确认 Charakuru Studio 的状态。命令成功表示包管理步骤完成，实际入口仍以重新打开后的页面为准。

内嵌包解码后保存在 `%LOCALAPPDATA%\CharakuruStudio\installers\0.1.0\<包指纹前缀>`，同目录保留安装日志。出现错误时，窗口显示日志路径与官方 CLI 输出，不自动删除其他插件或更改其脚本批准设置。

可从命令行执行 `Install-Charakuru-Studio.cmd /check`：只校验内嵌包，不解包、不安装、不操作 DSH 配置。本轮已执行此检查，通过 SHA-256 校验；实际安装按用户要求暂停。

此前插件管理器的一次安装返回 `ERR_PNPM_IGNORED_BUILDS`，待处理列表包含 dsh-purge。这只记录该次操作结果，不代表 dsh-purge 必然阻断其他安装方式；本轮保留它。今后 CLI 如再次报告依赖脚本待处理，请保留日志，在 DSH 插件管理界面查看具体原因。

本版本为实验版：云端生图接口与完整 VRM 成功导出路径尚待实际环境验收，Tripo Studio 使用手动计划与下载归档。详见验证记录。
