# DSH SSH

面向 DeepSeek Harness 的远端工作插件，将主机管理、浏览器终端、文件传输、代理和 AI 会话授权放在同一工作区。

[![npm](https://img.shields.io/npm/v/%40lemoncat7%2Fdsh-ssh)](https://www.npmjs.com/package/@lemoncat7/dsh-ssh)

## 功能

- SSH 主机与分组、固定目录、密码 / 私钥 / SSH Agent 认证，以及分组代理。
- 多标签与分屏终端，SFTP 目录浏览，FTP / FTPS / SFTP 跨端点文件传输。
- 可配置连接超时与主机覆盖值；可选终端 SSH 连接复用（默认关闭），新标签共享认证但保持独立 shell。
- AI 只加载一个 `ssh` 工具，通过 `list / describe / call` 按需发现、查询和执行操作，减少常驻工具上下文。
- 文本、SQL、配置、图片、PDF 与静态 HTML 预览；无法安全预览或超限时提供下载。
- 按会话保留右栏标签、主机、目录、预览和滚动位置；打开面板定位当前挂载主机。
- 按会话授权的远端命令、AI 终端与文件工具，支持核验聊天授意后的临时 SSH 授权及指定看板任务授权。
- HTTP CONNECT、SOCKS5、SSH 跳板与端口转发，凭据库及加密 Gist 配置同步。
- 设置中导入、导出密码加密的配置备份，导入前预览数量并作为新副本添加。

## 安装

适配 DeepSeek Harness **0.2.1-rc.2**（宿主仍为 RC），需要 Node.js **^22.19.0 或 >=24.0.0**。其他宿主版本请先查阅[兼容说明](docs/dsh-021-compatibility.md)和对应版本的发布说明。

```bash
dsh plugin --profile web add @lemoncat7/dsh-ssh@latest
```

安装或升级后重启对应的 DSH Profile；`web` 请按实际使用的 Profile 调整。

打开「远端 → SSH 面板」添加主机，测试连接并确认主机指纹。浏览主机不会自动授予 AI 访问权限；为当前会话挂载主机或文件端点，再选择命令、终端和传输权限。

## 使用边界

凭据由 DSH 凭据服务保存，管理界面不返回明文。SSH 与文件端点授权独立，文件下载到 DSH 会话目录不等于浏览器电脑。会话浏览状态仅在当前页面生命周期保留，不跨刷新。首次连接需确认指纹，公开端口监听默认拒绝。

## 文档

- [使用、工具与配置](docs/usage.md)
- [会话与文件浏览状态](docs/session-browser-state.md)
- [聊天临时授权与任务委派](docs/temporary-access.md)
- [架构与终端生命周期](ARCHITECTURE.md)
- [版本与发布说明](https://github.com/lemoncat7/dsh-ssh/releases)
- [发布维护约定](docs/releases/README.md)
