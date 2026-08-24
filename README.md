# dsh-ssh

面向 DeepSeek Harness 的 SSH 会话管理插件。它把连接管理、浏览器终端、代理、端口转发和 AI 会话授权放在同一个 DSH 工作区里。

## 能力

- SSH 密码、私钥和 SSH Agent 认证
- HTTP CONNECT、SOCKS5 和 SSH 跳板代理
- 本地转发（`-L`）、远程转发（`-R`）和动态 SOCKS5 转发（`-D`）
- 浏览器交互终端，支持输入、增量输出、窗口尺寸同步和主动断开
- 当前会话右侧栏支持多个 AI 终端切换与键盘输入
- SFTP 文件浏览、文本/图片/PDF 预览和流式下载
- 有序多主机跳板链，兼容已有单跳板配置
- 独立密钥库集中保存常用用户名、密码和私钥，SSH 连接仅保存引用
- 按 DSH 会话注入连接；未注入的主机对 AI 完全不可见
- AI 可执行一次性命令，或打开、读取、操作和关闭独立的交互终端
- 左侧远端区域提供右侧栏开关；目录页使用真实 SFTP 浏览远端文件，终端页使用单一终端画面观察并操作 AI 终端
- 插件服务与 Web 客户端兼容 Windows、macOS 和 Linux，不依赖本机 `ssh` 或 `sftp` 命令
- 首次连接主机指纹确认、输出上限、命令超时和公开端口绑定保护

## 界面

侧栏入口名为「远端」，通过官方 `sidebar.footer.action` 注册。浏览器兼容层只把这个入口锚定到官方 Workspace 区域上方；它不会替换 `sidebar.workspaces`，锚点失效时会自动留在官方 Footer。远端标题右侧按钮与折叠栏图标负责开关 SSH 右侧栏；展开后的第一项「SSH 面板」进入完整管理工作区，它下面只显示当前 DSH 会话已授权的 SSH 连接。点击其中一台主机会打开右侧栏并直接切换到该远端。切换到其他会话会自动退出管理工作区，也可以使用工作区左上角的返回按钮。

管理工作区分成三部分：

1. 左侧主机目录：按 Profile 的可选分组以文件夹展示，支持展开、收起、搜索、选择和凭据状态；未填写分组的主机归入「未分组」。
2. 中间工作区：终端、SFTP、端口转发、密钥库和全局设置。SFTP 直接使用左侧选中的主机，可浏览、预览、下载和流式上传文件；同名文件覆盖前会再次确认，单文件上限为 512 MB。
3. 右侧会话注入检查器：选择当前对话可用的主机、权限级别，以及是否自动允许权限范围内的 SSH 操作。

工作区通过共享的 `@lemoncat7/dsh-plugin-ui` 自适应壳布局。宽容器使用三栏；窄于 820px 时主机目录与会话授权切换为左右抽屉，窄于 520px 时进一步压缩 SFTP 次要信息和操作密度。响应式判断使用容器查询，因此手机、桌面分屏和 DSH 窄面板采用同一套行为。

SSH 插件不会向聊天标题栏添加按钮。右侧栏统一从左侧「远端」区域打开；当前会话尚未注入主机时会显示授权引导。仅执行命令权限显示 SFTP 目录；终端控制权限同时显示 SFTP 目录和 AI 终端。多个终端通过紧凑标签切换，运行中的终端支持键盘输入。进入 SFTP 子目录时，该目录会同步成为后续 `ssh_exec` 与新终端的工作目录。

新建和编辑连接的表单内提供「测试连接」。测试直接使用尚未保存的表单内容，可验证密钥库凭据、HTTP/SOCKS5 代理和有序跳板链；首次连接的主机指纹也在表单内确认。测试过程不会临时创建 Profile，也不会把凭据写入配置文件。

## AI 工具

| 工具 | 用途 |
| --- | --- |
| `ssh_list` | 只列出当前 DSH 会话已注入的连接 |
| `ssh_set_cwd` | 设置并验证当前会话在指定主机上的工作目录 |
| `ssh_exec` | 执行一次性远端命令 |
| `ssh_terminal_open` | 打开当前 Agent 独占的 SSH 终端 |
| `ssh_terminal_send` | 向终端发送文本并等待输出稳定 |
| `ssh_terminal_read` | 分页读取终端回滚缓冲区 |
| `ssh_terminal_signal` | 发送允许的 POSIX 信号 |
| `ssh_terminal_close` | 关闭终端 |
| `ssh_forward_list` | 列出已注入连接的转发规则 |
| `ssh_forward_start` | 启动已有转发规则 |
| `ssh_forward_stop` | 停止已有转发规则 |

工具始终从 `exec.agent.session.id` 解析注入关系。模型不能通过参数绕过授权，也不能枚举其他 DSH 会话的主机或终端。

## 凭据与安全

普通连接资料保存在 `statePath` 指定的原子 JSON 文件中。以下敏感字段只写入 DSH `ctx.credentials` 的 `dsh-ssh/<profile-id>` Grant Record：

- SSH 密码
- 私钥
- 私钥口令
- 代理密码

密钥库条目使用独立的 `dsh-ssh-vault/<credential-id>` Grant Record。SSH Profile 只保存 `credentialId`，不会复制或读回密钥库中的明文。仍被连接引用的密钥库条目不能删除。

管理 API 和 Web UI只返回是否配置以及字段名，不返回任何凭据值。默认拒绝非回环地址的端口监听；若确实需要监听 `0.0.0.0`，必须在「远端 → 设置」中显式开启。

首次连接会拒绝未知主机密钥并展示 SHA-256 指纹。用户确认后才把指纹写入 Profile，后续连接严格比对。

## DSH 配置

安装包后，bundle 会插入默认配置：

```yaml
- id: ssh
  name: '@lemoncat7/dsh-ssh'
  config:
    statePath: !!js dshHomePath('ssh/state.json')
    exposeWeb: true
    apiPrefix: /ssh-local/v1
    defaultCommandTimeoutMs: 30000
    maxOutputChars: 32000
    allowPublicBind: false
```

插件依赖当前 DSH 的 `credentials` 和 `tools` 服务。浏览器管理还需要 Web Profile 的 `webServer`；浏览器终端和 AI 终端由插件内部按所有者隔离管理，不依赖 Host Root 中不存在的 `terminals` 服务。

## 开发与打包

```bash
npm install
npm test
npm pack --pack-destination dist
```

运行时要求 Node.js 22.19+ 或 Node.js 24+，并与 DSH `0.1.1-rc.2` 接口对齐。

## 终端隔离说明

浏览器终端和 AI 终端共享同一个连接 Profile 与凭据，但不是同一个终端实例：

- 浏览器终端由插件的同源管理 API 持有，页面关闭或空闲超时后清理。
- AI 终端由插件按 `sessionId` 分区持有。Web Profile 的官方 Terminal 服务位于每个 Agent Preset 的私有 Realm，主机插件不能跨 Realm 注册 Backend，因此插件使用相同的 owner-scoped 规则实现 SSH 终端隔离，并在插件卸载或进程退出时统一清理。

这种边界避免浏览器用户和模型同时争用同一个 TTY，也遵守 DSH 不允许跨 Agent 共享终端的所有权规则。
