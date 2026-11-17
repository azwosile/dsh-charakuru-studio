# 0.1.0 验证记录

验证日期：2026-11-16。目标运行时：DeepSeek Harness 0.2.2-rc.3，Node 22+，Windows。

## 已完成

- 14 项核心、图像驱动、真实 loopback HTTP 和 Blender 回执测试通过。
- 生命周期测试发现并修正内置技能资源路径后，定向复核通过；合计 15 项测试通过。
- 16 个运行时 JavaScript 文件通过语法检查。
- 5 个生成的 Blender Python 脚本及 2 个 Qwen Python 脚本通过 AST 语法检查，包含中文、引号、换行和 Windows 路径输入。
- 覆盖人工关卡顺序、状态版本冲突、并行写入、输出互斥、真实 HTTP 的项目隔离和请求边界、积分幂等记账、PNG / ZIP / GLB 损坏输入、超时和密钥隔离。
- Blender 回执测试覆盖结构化结果载体、心跳 NDJSON、后台任务晋升、产物指纹及草稿阶段保持 degraded。
- Host 生命周期测试覆盖六个工具、技能正文读取和注销。

测试中的网络响应与成功导出产物使用夹具；这证明协议处理和错误行为，不证明真实模型生成质量或角色动作质量。

## 环境与实际限制

- 实际无头 Blender 探测版本为 5.3.0；该运行环境未发现 VRM Add-on。因此完整角色导出成功路径尚未实测。
- 生图云端接口、计费及各本地模型组合尚未逐项实测。执行云端请求须填写供应商实际模型 ID。
- Tripo Studio 为手动计划与下载归档；200 / 95 / 145 是可编辑规划假设，Studio 与 OpenAPI 余额分开。
- Blender 比例、权重、裙摆骨架和表情属于启发式草稿。裙摆阶段尚需配置 SpringBone joints、碰撞体与服装权重。
- VRM 产物检查仅覆盖 GLB 2 容器、VRM 1 扩展及文件指纹。网格语义、动作、表情、外观和查看器兼容性需人工与伴随插件验收。
- 当前会话没有已连接页面的浏览器操作工具；实际亮暗主题、窄屏、键盘和图标显示尚待页面验收。未使用模拟 React 或独立预览替代实际界面证据。
- 用户指定的 gpt-6.1-sol 子智能体路由未出现在当前可用目录，本次交付审阅由主智能体完成。

## 发布与安装

包通过白名单纳入运行时代码、资源、技能、说明、必要测试及检查脚本；一次性修复脚本、临时工程与凭据文件不纳入安装包。

实际调用插件管理器安装后，包管理步骤因配置中已有的 `dsh-purge@file:../../local-plugins/dsh-purge-1.1.84` 待批准安装脚本返回 `ERR_PNPM_IGNORED_BUILDS`。Charakuru 包自身没有安装脚本。插件管理器报告 `application: failed`；随后 live Config 查询返回零条 Charakuru 配置，Client 顶栏 Slot 也没有 Charakuru 入口。故当前状态为：安装包已准备，运行时尚未激活。后续须明确批准该外部包安装脚本或先处理该包的待构建状态，再通过插件管理器重试；本文不将依赖写入等同于启用成功。

## 入口改造（2026-11-17）

上一节记录的「Client 顶栏 Slot 没有 Charakuru 入口」属于历史状态，入口模型已更换：

- 客户端不再注册 `conversation.session.header.utilities`，改为 `sidebar.panellist`（左侧栏行，id `charakuru-studio`，order 20，图标 `StudioIcon`）+ `main` 面板（key 同 id）。点击侧栏行经 `ctx.layout.selectPanel('charakuru-studio')` 在主区域渲染整页工作台，代码中已无 `<dialog>`/`showModal`/`createPortal`。
- 「插入指令」不再使用会话作用域的 `inputActions`（全局面板拿不到），改走 `ctx.get('conversation').input.requestDraftInitialization(binding, { prompt, whenDraftExists: 'append' })`，binding 由 `sessions.binding(currentSessionId)` 取得，currentSessionId 取 `retainedBy.mainView > 0` 的会话；成功后调用 `layout.selectPanel(null)` 回到会话。缺失 `sessions`/`conversation`/`layout` 服务时降级：提示无会话或改为复制指令。
- `package.json` 的 `dsh.client.inject` 增列 `@deepseek-ai/dsh-client-ui-sidebar` 与 `@deepseek-ai/dsh-client-ui-layout`。
- 测试：`tests/client-panel.test.mjs`（9 例，VM + 假 React + 假 Cordis ctx）锁定侧栏行 + 主面板契约、图标尺寸、标签页键盘导航、语言切换、草稿插入、loopback 白名单与卸载中止；`tests/verify-plugin.mjs` 已按当前实现重写第 2–7 步并跑到 7/7 PASS（该脚本此前长期陈旧）。
- 仍未由页面验收的部分同上：实际主题、窄屏、真实鼠标点击与 SSR/HMR 下的挂载顺序需在浏览器中确认。

### 运行时验证（2026-11-17）

- 桌面 profile 的 `node_modules\dsh-charakuru-studio` 是安装副本（非链接），已从本仓库镜像同步，原件备份在 `C:\Users\Kurami_Utaho\.dsh\plugin-backups\dsh-charakuru-studio-20261117-001205`。
- 客户端 bundle 由宿主按 `/plugins/??<pkg>/client.js&rev=<12位>` 提供，`rev` = `framedHash('plugin-artifact',[mtimeMs,ctimeMs,size])`；`dsh-client-hmr` 每 500ms 轮询该三元组并热替换条目（实测：改文件后 rev 由旧值变为 `8cb522dc4567`）。
- 实测 `GET /plugins/??dsh-charakuru-studio/client.js&rev=8cb522dc4567` 返回 200，正文含 `sidebar.panellist`、不含 `showModal` 与 `conversation.session.header.utilities`，与本仓库 `lib/client.js` 一致（末尾仅有 sourceMappingURL 尾注）。故运行中的实例已在提供新版客户端；浏览器若仍显示旧入口，刷新一次页面即可。

### 侧栏行不显示的根因（2026-11-17，已修复）

- 现象：boot graph（`GET /plugins/events` 的首个 `graph` 事件）里有本插件条目、bundle 用 `?rev=` 精确取到 200、宿主侧 `include:dsh-charakuru-studio` 为 `fiberPhase: active`，但左侧栏没有出现行。
- 定位手段：临时在客户端 bundle 里插入 beacon，向本机 `127.0.0.1:9931` 收集器 POST 阶段标记（模块工厂入口、`react` 解析、css 构建、`apply` 入口、locale 注册、两个 `slots.inject` 回调、图标渲染）。
- 实测序列：`factory-enter` → `react-ok` → `css-ok` → `factory-tail` 全部到达，**`apply` 从未被调用**，即因子系统在创建条目时就判定该模块未激活。
- 根因：`inject` 写成了对象形式 `{ required: ['slots','locale'], optional: [...] }`。Web 客户端 realm 只接受数组形式；对象形式被静默拒绝，条目保持 inactive，`apply` 不执行，侧栏行自然不出现（宿主与页面均无提示）。
- 修复：`inject: ['slots', 'locale']`（数组），其余服务一律经 `ctx.get('layout' | 'sessions' | 'conversation')` 惰性取用，缺失时降级。改回数组后同一进程内 beacon 立刻出现 `apply-start` → `locale-registered` → `panellist-slot-declared` → `main-slot-declared`，随后 `icon-render`（`16/false`）证明侧栏行已真实渲染。
- 回归护栏：`tests/client-panel.test.mjs` 断言 `inject` 必须是数组且源码不得出现 `inject: { required`。beacon 与收集器为临时诊断物，未留在仓库代码中。
- 排查备忘：再遇到「条目在 boot graph 里但 UI 没反应」，先确认 `apply` 是否真的执行（注入 beacon 或对比 `inject` 形状），不要从 `sidebar.panellist` 的过滤/pin 逻辑入手——那一段对未 pin 的面板一律放行。

Git 作者：azwosile <azwosile@163.com>。远端：https://github.com/azwosile/dsh-charakuru-studio.git 。本轮未执行 commit 或 push。
