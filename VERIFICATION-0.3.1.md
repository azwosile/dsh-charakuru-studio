# Avatar Studio 0.3.1 — 最终安装与测试回执

日期：2026-11-18。**实验发布；原计划 P2～P5 未全部验收，不宣称生产完成。**

## 安装包

- 文件：`dsh-charakuru-studio-0.3.1.tgz`
- 大小：430,178 bytes；61 个包内文件
- SHA-256：`a590edf68924419177a9b5db13b00a95d9a18dd099443d32d889b7c9b023bb40`
- 通过官方 DSH Electron 0.2.2-rc.3 插件管理器安装并立即启用。
- 真实 renderer `/health` 成功，版本 0.3.1；工作台七标签。
- 真实 renderer reload 后，工程目录自动恢复；活跃版本为物理配置前的安全回退分支，保留 9 个编辑版本。
- 本文件为包构建后的独立验证记录，不在该 tgz 白名单内，避免包校验和循环依赖。

## 自动测试（与实机证据分开）

- Arena / Linux：58 tests，58 pass，0 fail。
- Windows / Node 24：58 tests，57 pass，1 平台相关 skip，0 fail。
- JavaScript 语法：24 文件；Python AST：8 脚本；资源路径检查通过。
- 账户锁、并发预算、报价过期、分账、未知扣费保留与幂等结算均有 fixture 测试。
- 断网/429/402 测试为故障注入，不是生产供应商调用。
- `git diff --check` 对内嵌 Three.js shader 字符串报告空白告警；未为了消除文本告警修改第三方 shader 语义。

## 真实本机验证

- companion 3.0.6 / Blender 5.3.0 / 官方 VRM Add-on 4.10.5 项目级加载。
- 输入 Blend 原 SHA-256 在流程后重新核对一致；未覆盖源文件。
- 导入、头/发联动缩放、新 Blend/GLB 版本、回滚均真实执行。
- 材质检查、显式源网格权重转移、归一化、humanoid 映射、弹簧/碰撞和 VRM 导出真实执行。
- 导出的私测 VRM 含 8 个 mesh、18 条 SpringBone、4 个 collider，107,553,436 bytes；Electron VRM loader 显示 151,217 三角形。
- **视觉检查失败：裙摆出现明显拉伸/尖刺。** 因此不批准该 VRM 为成品；已恢复到物理配置前版本，保留失败输出与本机视觉记录。
- 原创程序化网格 PNG 已通过真实 renderer 的 HTTP 接口导入并绑定参考叠图，保存右视角与 0.18 透明度；这是叠图功能 fixture，不是角色生图样例。
- GUI doctor 不通过；只证明 headless 能力，不宣称 GUI companion 连接验收。

## 零额度约束与尚缺证据

- 没有调用云端生图或 Tripo 生成，未消耗云额度；没有新增密钥。
- 本机默认 Qwen / ComfyUI 端口返回 ECONNREFUSED，没有真实本地模型样例。
- 账户账本为手工辅助，不是生产 API 的完整计费联动，也不限制外部网页消费。
- 完整 AI 修改视觉闭环、多种服装动作、独立 VRM 查看器、新用户完整项目、公开合法录屏及真实生产接口故障矩阵仍未完成。

## 隐私与发布

安装包与暂存变更做了常见密钥/私有主机/素材路径模式扫描，未发现匹配；包内不含用户 Blend/GLB/VRM、截图、官方 add-on ZIP 或本地配置。模式扫描不是全功能安全审计。角色及所有派生产物只保留在本机私有验收目录，不提交仓库。MIT/第三方依赖许可见 LICENSE 和 NOTICE。
