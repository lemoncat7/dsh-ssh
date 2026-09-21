/** UI-only catalog. Selected English translations adapted from knownasmobin/dsh-ssh PR #2 (MIT).
 * Semantic keys and explicit parameters must never be used for protocol or persisted data. */
export const messages = {
  "host-key.changed": { "zh": "主机指纹已变化", "en": "Host fingerprint changed" },
  "host-key.warning": { "zh": "重装系统可能导致密钥变化，也可能是连接被冒用。请通过服务器控制台核实新指纹后再确认。", "en": "Reinstallation can change the key, but this may also indicate impersonation. Verify the new fingerprint through the server console before confirming." },
  "host-key.previous": { "zh": "原指纹", "en": "Previous fingerprint" },
  "host-key.current": { "zh": "新指纹", "en": "New fingerprint" },
  "host-key.confirm": { "zh": "已核实，确认并重试", "en": "Verified, confirm and retry" },
  "host-key.retest": { "zh": "连接配置已修改，请重新测试并核对指纹。", "en": "Connection settings changed. Test again and verify the fingerprint." },
  "host-key.saveHint": { "zh": "当前主机测试成功后请保存；跳板机确认成功后会单独更新其指纹。", "en": "Save this host after a successful test. Confirming a jump host updates its fingerprint separately." },
  "local-transfer.uploadAction": { "zh": "从本机上传文件", "en": "Upload files from this computer" },
  "local-transfer.uploading": { "zh": "上传中", "en": "Uploading" },
  "local-transfer.allowUpload": { "zh": "允许 Agent 本地上传", "en": "Allow agent local uploads" },
  "local-transfer.allowDownload": { "zh": "允许 Agent 本地下载", "en": "Allow agent local downloads" },
  "local-transfer.uploadScope": { "zh": "从 DSH 会话目录上传到已授权连接；需同时开启允许传输，不代表访问浏览器电脑。", "en": "Upload from the DSH session directory to authorized connections. Requires transfer permission; does not grant access to the browser computer." },
  "local-transfer.downloadScope": { "zh": "从已授权连接下载到 DSH 会话目录；需同时开启允许传输，不代表访问浏览器电脑。", "en": "Download from authorized connections to the DSH session directory. Requires transfer permission; does not grant access to the browser computer." },
  "browser-transfer.title": { "zh": "本地上传与下载", "en": "Local uploads and downloads" },
  "browser-transfer.preparing": { "zh": "准备传输…", "en": "Preparing transfer…" },
  "browser-transfer.waiting": { "zh": "已发送，等待远端保存完成…", "en": "Sent; waiting for remote save…" },
  "browser-transfer.unavailable": { "zh": "已发起下载，当前环境无法确认进度或保存结果；无响应时请在浏览器中重试", "en": "Download requested; this environment cannot confirm progress or saving. If nothing happens, retry in a browser." },
  "browser-transfer.savingLocal": { "zh": "正在完成本地保存…", "en": "Finalizing local save…" },
  "browser-transfer.savedLocal": { "zh": "已保存到所选文件", "en": "Saved to the selected file" },
  "browser-transfer.failed": { "zh": "传输失败", "en": "Transfer failed" },
  "browser-transfer.delivered": { "zh": "传输完成，保存结果请查看浏览器下载列表", "en": "Transferred; check browser downloads for save status" },
  "browser-transfer.saved": { "zh": "已保存到远端", "en": "Saved remotely" },
  "browser-transfer.finishedAt": { "zh": "结束于 {0}", "en": "Finished at {0}" },
  "browser-transfer.upload": { "zh": "上传", "en": "Upload" },
  "browser-transfer.download": { "zh": "下载", "en": "Download" },
  "group-proxy.title": { "zh": "分组代理 · {0}", "en": "Group proxy · {0}" },
  "group-proxy.selection": { "zh": "默认代理", "en": "Default proxy" },
  "group-proxy.hint": { "zh": "主机自身代理优先；未设置代理的主机使用本分组代理。", "en": "A host's own proxy takes priority. Hosts without one use this group proxy." },
  "group-proxy.reconnect": { "zh": "仅影响本分组 SSH 主机的新连接，不会打断现有终端。", "en": "Applies to new SSH connections in this group. Existing terminals stay connected." },
  "group-proxy.none": { "zh": "不设置（默认直连）", "en": "None (direct by default)" },
  "group-proxy.automatic": { "zh": "默认（分组代理 / 直连）", "en": "Default (group proxy / direct)" },
  "sftp-client.followTerminal": { "zh": "跟随终端目录", "en": "Follow terminal directory" },
  "sftp-client.followWaiting": { "zh": "尚未收到终端目录。请重连终端；支持 Bash/Zsh/sh，其他 Shell 需支持 OSC 7 或 CurrentDir", "en": "No terminal directory received. Reconnect the terminal; Bash/Zsh/sh are supported. Other shells need OSC 7 or CurrentDir." },
  "sftp-client.followHint": { "zh": "跟随当前选中的终端；预览、上传或操作文件时暂停", "en": "Follow the focused terminal; pause while previewing, uploading or managing files" },
  "sftp-client.downloadEntry": { "zh": "下载 {0}", "en": "Download {0}" },
  "client.deviceCodeExpiry": { "zh": "代码将在 {0} 失效", "en": "Code expires at {0}" },
  "file-entry-delete-dialog.deleteFromLocation": { "zh": "将直接从{0}删除所选内容。", "en": "The selected items will be deleted directly from {0}. " },
  "activity-panel.sshActivity": {
    "zh": "SSH 活动",
    "en": "SSH Activity"
  },
  "activity-panel.currentSession": {
    "zh": "当前会话 ·",
    "en": "Current session ·"
  },
  "activity-panel.closeSshActivity": {
    "zh": "关闭 SSH 活动",
    "en": "Close SSH Activity"
  },
  "activity-panel.sshActivityView": {
    "zh": "SSH 活动视图",
    "en": "SSH activity view"
  },
  "activity-panel.sessionDirectory": {
    "zh": "会话目录",
    "en": "Session directory"
  },
  "activity-panel.remoteDirectory": {
    "zh": "远端目录",
    "en": "Remote directory"
  },
  "activity-panel.terminal": {
    "zh": "终端",
    "en": "Terminal"
  },
  "activity-panel.readingSshSessions": {
    "zh": "正在读取 SSH 会话…",
    "en": "Reading SSH sessions…"
  },
  "activity-panel.noRemoteToBrowse": {
    "zh": "没有可浏览的远端",
    "en": "No remote to browse"
  },
  "activity-panel.allowTheCurrentSessionToAccessAHostIn": {
    "zh": "请先在 SSH 面板中允许当前会话访问一台主机。",
    "en": "Allow the current session to access a host in the SSH panel first."
  },
  "activity-panel.noTerminalsOpenYet": {
    "zh": "还没有打开的终端",
    "en": "No terminals open yet"
  },
  "activity-panel.terminalsOpenedByTheAiAppearRightHere": {
    "zh": "AI 打开交互终端后，会直接显示在这里。",
    "en": "Terminals opened by the AI appear right here."
  },
  "activity-panel.end": {
    "zh": "结束",
    "en": "End"
  },
  "activity-panel.remove": {
    "zh": "移除",
    "en": "Remove"
  },
  "activity-panel.sshTerminal": {
    "zh": "SSH 终端",
    "en": "SSH terminal"
  },
  "activity-panel.terminal2": {
    "zh": "终端 {0}",
    "en": "Terminal {0}"
  },
  "activity-panel.running": {
    "zh": "运行中",
    "en": "Running"
  },
  "activity-panel.exited": {
    "zh": "已退出",
    "en": "Exited"
  },
  "activity-panel.terminal3": {
    "zh": "{0}终端 {1}",
    "en": "{0}Terminal {1}"
  },
  "activity-panel.endAndCloseThisTerminal": {
    "zh": "结束并关闭这个终端",
    "en": "End and close this terminal"
  },
  "activity-panel.removeThisTerminalFromTheActivityPanel": {
    "zh": "从活动面板移除这个终端",
    "en": "Remove this terminal from the activity panel"
  },
  "activity-panel.processing": {
    "zh": "处理中",
    "en": "Processing"
  },
  "activity-panel.interactiveSshTerminal": {
    "zh": "交互式 SSH 终端",
    "en": "Interactive SSH terminal"
  },
  "adaptive-workspace.details": {
    "zh": "详情",
    "en": "Details"
  },
  "adaptive-workspace.workspacePanel": {
    "zh": "工作区面板",
    "en": "Workspace panel"
  },
  "adaptive-workspace.closePanel": {
    "zh": "关闭面板",
    "en": "Close panel"
  },
  "client.openASessionToSeeTheSshSidebar": {
    "zh": "打开会话后可查看 SSH 侧栏",
    "en": "Open a session to see the SSH sidebar"
  },
  "client.collapseSshSidebar": {
    "zh": "收起 SSH 侧栏",
    "en": "Collapse SSH sidebar"
  },
  "client.expandSshSidebar": {
    "zh": "展开 SSH 侧栏",
    "en": "Expand SSH sidebar"
  },
  "client.theRemote": {
    "zh": "远端",
    "en": "Remote"
  },
  "client.sshPanel": {
    "zh": "SSH 面板",
    "en": "SSH panel"
  },
  "client.availableRemotesAppearOnceASessionIsOpen": {
    "zh": "打开会话后显示可用远端",
    "en": "Available remotes appear once a session is open"
  },
  "client.noRemotesGrantedToThisSession": {
    "zh": "当前会话未授权远端",
    "en": "No remotes granted to this session"
  },
  "client.mounted": {
    "zh": "已挂载",
    "en": "Mounted"
  },
  "client.another": {
    "zh": "还有",
    "en": "Another"
  },
  "client.availableHosts": {
    "zh": "台可用远端",
    "en": "available hosts"
  },
  "client.backToSession": {
    "zh": "返回会话",
    "en": "Back to session"
  },
  "client.sshWorkbench": {
    "zh": "SSH 工作台",
    "en": "SSH workbench"
  },
  "client.selectAHost": {
    "zh": "选择一台主机",
    "en": "Select a host"
  },
  "client.sshWorkbenchView": {
    "zh": "SSH 工作台视图",
    "en": "SSH workbench view"
  },
  "client.terminalsFiles": {
    "zh": "终端与文件",
    "en": "Terminals & files"
  },
  "client.fileTransfer": {
    "zh": "文件传输",
    "en": "File Transfer"
  },
  "client.savedCommands": {
    "zh": "常用命令",
    "en": "Saved commands"
  },
  "client.portForwarding": {
    "zh": "端口转发",
    "en": "Port forwarding"
  },
  "client.credentialVault": {
    "zh": "密钥库",
    "en": "Credential vault"
  },
  "client.proxyVault": {
    "zh": "代理库",
    "en": "Proxy vault"
  },
  "client.settings": {
    "zh": "设置",
    "en": "Settings"
  },
  "client.close": {
    "zh": "关闭",
    "en": "Close"
  },
  "client.host": {
    "zh": "主机",
    "en": "Host"
  },
  "client.closeTerminalsOnAllHosts": {
    "zh": "关闭所有主机的终端？",
    "en": "Close terminals on all hosts?"
  },
  "client.thisClosesAllTerminalTabsInThisWorkspaceIncluding": {
    "zh": "将关闭本工作台所有主机的 {0} 个终端标签，包括隐藏标签及连接中的终端，可能中断正在运行的命令。不会删除主机配置，也不会关闭其他浏览器窗口的终端。",
    "en": "This closes all {0} terminal tabs in this workspace, including hidden and connecting tabs, and may interrupt running commands. Host configurations and terminals in other browser windows are not affected."
  },
  "client.cancel": {
    "zh": "取消",
    "en": "Cancel"
  },
  "client.closeAll": {
    "zh": "确认关闭全部",
    "en": "Close all"
  },
  "client.hostActions": {
    "zh": "主机操作",
    "en": "Host actions"
  },
  "client.showSftp": {
    "zh": "展开 SFTP",
    "en": "Show SFTP"
  },
  "client.hideSftp": {
    "zh": "收起 SFTP",
    "en": "Hide SFTP"
  },
  "client.editHost": {
    "zh": "编辑主机",
    "en": "Edit host"
  },
  "client.closeAllTerminals": {
    "zh": "关闭全部终端",
    "en": "Close all terminals"
  },
  "client.closeTerminalsOnAllHosts2": {
    "zh": "关闭所有主机的终端",
    "en": "Close terminals on all hosts"
  },
  "client.deleteHost": {
    "zh": "删除主机 {0}",
    "en": "Delete host {0}"
  },
  "client.deleteHost2": {
    "zh": "删除主机",
    "en": "Delete host"
  },
  "client.adjustTheTerminalAndSftpWidths": {
    "zh": "调整终端与 SFTP 的宽度",
    "en": "Adjust the terminal and SFTP widths"
  },
  "client.terminal": {
    "zh": "{0} 终端",
    "en": "{0} Terminal"
  },
  "client.waitingForTerminalConnection": {
    "zh": "等待终端连接",
    "en": "Waiting for terminal connection"
  },
  "client.theRemoteDirectoryLoadsOnceATerminalIsOpen": {
    "zh": "打开终端后再读取远端目录。",
    "en": "The remote directory loads once a terminal is open."
  },
  "client.localRemoteAndDynamicSocks5": {
    "zh": "· 本地、远程与动态 SOCKS5",
    "en": "· Local, remote and dynamic SOCKS5"
  },
  "client.newRule": {
    "zh": "新建规则",
    "en": "New rule"
  },
  "client.thisHostHasNoPortForwardingRulesYet": {
    "zh": "这台主机还没有端口转发规则。",
    "en": "This host has no port forwarding rules yet."
  },
  "client.edit": {
    "zh": "编辑",
    "en": "Edit"
  },
  "client.stop": {
    "zh": "停止",
    "en": "Stop"
  },
  "client.start": {
    "zh": "启动",
    "en": "Start"
  },
  "client.delete": {
    "zh": "删除",
    "en": "Delete"
  },
  "client.deleteTheCredentialVaultEntryThisActionCannotBe": {
    "zh": "删除密钥库条目“{0}”？此操作无法撤销。",
    "en": "Delete the credential vault entry “{0}”? This action cannot be undone."
  },
  "client.keepCommonAccountsInOnePlaceConnectionConfigsOnly": {
    "zh": "集中保存常用账号，连接配置只引用凭据。",
    "en": "Keep common accounts in one place; connection configs only reference credentials."
  },
  "client.newCredential": {
    "zh": "新建凭据",
    "en": "New credential"
  },
  "client.noSavedCredentialsYet": {
    "zh": "还没有常用凭据",
    "en": "No saved credentials yet"
  },
  "client.passwordsAndPrivateKeysAreStoredOnlyInThe": {
    "zh": "密码和私钥只保存在 DSH 凭据服务中，不写入 SSH 配置文件。",
    "en": "Passwords and private keys are stored only in the DSH credential service, never written to SSH config files."
  },
  "client.addCredential": {
    "zh": "添加凭据",
    "en": "Add credential"
  },
  "client.password": {
    "zh": "密码",
    "en": "Password"
  },
  "client.privateKey": {
    "zh": "私钥",
    "en": "Private key"
  },
  "client.available": {
    "zh": "可用",
    "en": "Available"
  },
  "client.missingCredentials": {
    "zh": "缺少凭据",
    "en": "Missing credentials"
  },
  "client.connections": {
    "zh": "个连接",
    "en": "connections"
  },
  "client.edit2": {
    "zh": "编辑 {0}",
    "en": "Edit {0}"
  },
  "client.delete2": {
    "zh": "删除 {0}",
    "en": "Delete {0}"
  },
  "client.stillInUseByConnections": {
    "zh": "仍有连接正在使用",
    "en": "Still in use by connections"
  },
  "client.deleteCredential": {
    "zh": "删除凭据",
    "en": "Delete credential"
  },
  "client.createCredential": {
    "zh": "新建常用凭据",
    "en": "Create credential"
  },
  "client.passwordsAndPrivateKeysAreNotShownAgainAfter": {
    "zh": "密码和私钥保存后不会回显",
    "en": "Passwords and private keys are not shown again after saving"
  },
  "client.name": {
    "zh": "名称",
    "en": "Name"
  },
  "client.productionOps": {
    "zh": "生产环境运维",
    "en": "Production ops"
  },
  "client.username": {
    "zh": "用户名",
    "en": "Username"
  },
  "client.authMethod": {
    "zh": "认证方式",
    "en": "Auth method"
  },
  "client.savedLeaveBlankToKeepUnchanged": {
    "zh": "已保存；留空保持不变",
    "en": "Saved; leave blank to keep unchanged"
  },
  "client.requiredCannotBeReadBackAfterSaving": {
    "zh": "必填，保存后不可读回",
    "en": "Required. Cannot be read back after saving."
  },
  "client.pasteAnOpensshOrPemPrivateKey": {
    "zh": "粘贴 OpenSSH 或 PEM 私钥",
    "en": "Paste an OpenSSH or PEM private key"
  },
  "client.keyPassphrase": {
    "zh": "私钥口令",
    "en": "Key passphrase"
  },
  "client.saving": {
    "zh": "正在保存…",
    "en": "Saving…"
  },
  "client.saveCredential": {
    "zh": "保存凭据",
    "en": "Save credential"
  },
  "client.deleteTheProxyThisActionCannotBeUndone": {
    "zh": "删除代理“{0}”？此操作无法撤销。",
    "en": "Delete the proxy “{0}”? This action cannot be undone."
  },
  "client.keepCommonHttpAndSocks5ProxiesInOnePlace": {
    "zh": "集中保存常用 HTTP 与 SOCKS5 代理，主机配置只保留引用。",
    "en": "Keep common HTTP and SOCKS5 proxies in one place; host configs only reference them."
  },
  "client.newProxy": {
    "zh": "新建代理",
    "en": "New proxy"
  },
  "client.noSavedProxiesYet": {
    "zh": "还没有常用代理",
    "en": "No saved proxies yet"
  },
  "client.saveOnceAndMultipleSshHostsCanShareThe": {
    "zh": "保存一次后，多台 SSH 主机可以共用同一条连接路径。",
    "en": "Save once and multiple SSH hosts can share the same connection path."
  },
  "client.addProxy": {
    "zh": "添加代理",
    "en": "Add proxy"
  },
  "client.deleteProxy": {
    "zh": "删除代理",
    "en": "Delete proxy"
  },
  "client.createProxy": {
    "zh": "新建常用代理",
    "en": "Create proxy"
  },
  "client.theProxyPasswordIsNotShownAgainAfterSaving": {
    "zh": "代理密码保存后不会回显",
    "en": "The proxy password is not shown again after saving"
  },
  "client.officeSocks5": {
    "zh": "办公室 SOCKS5",
    "en": "Office SOCKS5"
  },
  "client.proxyType": {
    "zh": "代理类型",
    "en": "Proxy type"
  },
  "client.proxyHost": {
    "zh": "代理主机",
    "en": "Proxy host"
  },
  "client.proxyPort": {
    "zh": "代理端口",
    "en": "Proxy port"
  },
  "client.proxyUsername": {
    "zh": "代理用户名",
    "en": "Proxy username"
  },
  "client.proxyPassword": {
    "zh": "代理密码",
    "en": "Proxy password"
  },
  "client.optionalCannotBeReadBackAfterSaving": {
    "zh": "可选，保存后不可读回",
    "en": "Optional. Cannot be read back after saving."
  },
  "client.saveProxy": {
    "zh": "保存代理",
    "en": "Save proxy"
  },
  "client.githubAuthorizationExpired": {
    "zh": "GitHub 授权已失效",
    "en": "GitHub authorization expired"
  },
  "client.githubConnected": {
    "zh": "GitHub 已连接 · {0}",
    "en": "GitHub connected · {0}"
  },
  "client.githubReachable": {
    "zh": "GitHub 网络连接成功 · {0}",
    "en": "GitHub reachable · {0}"
  },
  "client.viaProxy": {
    "zh": "通过代理",
    "en": "Via proxy"
  },
  "client.direct": {
    "zh": "直连",
    "en": "Direct"
  },
  "client.gistSyncSettingsAreNotLoadedYet": {
    "zh": "Gist 同步设置尚未加载",
    "en": "Gist sync settings are not loaded yet"
  },
  "client.gistSyncSettingsSaved": {
    "zh": "Gist 同步设置已保存",
    "en": "Gist sync settings saved"
  },
  "client.connected": {
    "zh": "连接成功 · {0}",
    "en": "Connected · {0}"
  },
  "client.deviceCodeGeneratedCopyItInTheAuthorizationWindow": {
    "zh": "设备代码已生成，请在授权窗口中复制后前往 GitHub",
    "en": "Device code generated. Copy it in the authorization window, then go to GitHub."
  },
  "client.githubAccountDisconnectedTheSyncEncryptionPasswordIsStill": {
    "zh": "GitHub 账号已断开，同步加密密码仍保留在本机",
    "en": "GitHub account disconnected. The sync encryption password is still kept on this device."
  },
  "client.sshSettings": {
    "zh": "SSH 设置",
    "en": "SSH settings"
  },
  "client.securityBoundariesCommandLimitsAndCrossDeviceConfigSync": {
    "zh": "安全边界、命令限制与跨设备配置同步",
    "en": "Security boundaries, command limits, and cross-device config sync"
  },
  "client.githubGistSync": {
    "zh": "GitHub Gist 同步",
    "en": "GitHub Gist sync"
  },
  "client.endToEndEncryptedSyncOfHostsFtpFtps": {
    "zh": "同步主机、FTP、目录、分组代理、密钥库与常用命令；密码和私钥单独加密",
    "en": "Sync hosts, FTP, directories, group proxies, credentials and saved commands; passwords and private keys are encrypted separately"
  },
  "client.checkGithubAuthorization": {
    "zh": "GitHub 授权需检查",
    "en": "Check GitHub authorization"
  },
  "client.connected2": {
    "zh": "已连接 {0}",
    "en": "Connected {0}"
  },
  "client.connectGithub": {
    "zh": "连接 GitHub",
    "en": "Connect GitHub"
  },
  "client.authorizationCredentialsAreStoredSecurelyInThisDsh": {
    "zh": "授权凭据安全保存在当前 DSH",
    "en": "Authorization credentials are stored securely in this DSH"
  },
  "client.getGistAccessThroughGithubDeviceAuthorization": {
    "zh": "通过 GitHub 设备授权获取 Gist 访问权限",
    "en": "Get Gist access through GitHub device authorization"
  },
  "client.connecting": {
    "zh": "连接中…",
    "en": "Connecting…"
  },
  "client.waitingForAuthorization": {
    "zh": "等待授权…",
    "en": "Waiting for authorization…"
  },
  "client.reconnect": {
    "zh": "重新连接",
    "en": "Reconnect"
  },
  "client.disconnecting": {
    "zh": "断开中…",
    "en": "Disconnecting…"
  },
  "client.disconnect": {
    "zh": "断开",
    "en": "Disconnect"
  },
  "client.onFirstUseEnterYourGithubOauthClientId": {
    "zh": "首次使用需在下方“高级授权设置”中填写 GitHub OAuth Client ID。它不是密钥，只用于标识授权应用。",
    "en": "On first use, enter your GitHub OAuth Client ID under “Advanced authorization settings” below. It is not a secret; it only identifies the authorization app."
  },
  "client.leaveEmptyToCreateAPrivateGistAutomaticallyOn": {
    "zh": "留空后首次同步会自动创建私有 Gist",
    "en": "Leave empty to create a private Gist automatically on the first sync"
  },
  "client.autoCreate": {
    "zh": "自动创建",
    "en": "Auto-create"
  },
  "client.syncEncryptionPassword": {
    "zh": "同步加密密码",
    "en": "Sync encryption password"
  },
  "client.savedSecurelyEnterTheSamePasswordOnANew": {
    "zh": "已安全保存；新设备需输入相同密码",
    "en": "Saved securely. Enter the same password on a new device."
  },
  "client.atLeast6CharactersALongerPasswordIsRecommended": {
    "zh": "至少 6 个字符，建议使用更长密码",
    "en": "At least 6 characters. A longer password is recommended."
  },
  "client.configured": {
    "zh": "已配置",
    "en": "Configured"
  },
  "client.setASeparateEncryptionPassword": {
    "zh": "设置独立加密密码",
    "en": "Set a separate encryption password"
  },
  "client.syncVersionInfo": {
    "zh": "同步版本信息",
    "en": "Sync version info"
  },
  "client.cloudVersion": {
    "zh": "云端版本",
    "en": "Cloud version"
  },
  "client.notReadYet": {
    "zh": "尚未读取",
    "en": "Not read yet"
  },
  "client.lastSync": {
    "zh": "上次同步",
    "en": "Last sync"
  },
  "client.neverSynced": {
    "zh": "尚未同步",
    "en": "Never synced"
  },
  "client.syncPolicy": {
    "zh": "同步策略",
    "en": "Sync policy"
  },
  "client.gistSyncPolicy": {
    "zh": "Gist 同步策略",
    "en": "Gist sync policy"
  },
  "client.smart": {
    "zh": "智能",
    "en": "Smart"
  },
  "client.detectChangesOnBothSidesAutomaticallyAndMergePer": {
    "zh": "自动判断两端变化并按条目合并",
    "en": "Detect changes on both sides automatically and merge per item"
  },
  "client.localFirst": {
    "zh": "本地优先",
    "en": "Local first"
  },
  "client.keepThisDeviceSConfigWhenBothSidesChanged": {
    "zh": "双方同时修改时保留本机配置",
    "en": "Keep this device's config when both sides changed"
  },
  "client.cloudFirst": {
    "zh": "云端优先",
    "en": "Cloud first"
  },
  "client.useTheGistConfigWhenBothSidesChanged": {
    "zh": "双方同时修改时采用 Gist 配置",
    "en": "Use the Gist config when both sides changed"
  },
  "client.autoSync": {
    "zh": "自动同步",
    "en": "Auto sync"
  },
  "client.checksAfterStartupAfterConfigChangesAndEveryFive": {
    "zh": "启动后、配置变化后和后台每五分钟检查一次",
    "en": "Checks after startup, after config changes, and every five minutes in the background"
  },
  "client.backupsToKeep": {
    "zh": "备份保留数量",
    "en": "Backups to keep"
  },
  "client.explicitHistorySnapshotsKeptInTheMainGistGithub": {
    "zh": "主 Gist 内保留的显式历史快照；GitHub 自身修订历史不受影响",
    "en": "Explicit history snapshots kept in the main Gist; GitHub's own revision history is unaffected"
  },
  "client.copies": {
    "zh": "份",
    "en": "copies"
  },
  "client.advancedAuthorizationSettings": {
    "zh": "高级授权设置",
    "en": "Advanced authorization settings"
  },
  "client.enableDeviceFlowInTheGithubOauthAppNo": {
    "zh": "在 GitHub OAuth App 中启用 Device Flow；不需要 Client Secret",
    "en": "Enable Device Flow in the GitHub OAuth App; no Client Secret needed"
  },
  "client.personalAccessTokenFallback": {
    "zh": "Personal Access Token（备用）",
    "en": "Personal Access Token (fallback)"
  },
  "client.alreadyAuthorizedEnteringATokenReplacesTheCurrentAuthorization": {
    "zh": "已有授权；填写后会替换当前授权",
    "en": "Already authorized. Entering a token replaces the current authorization."
  },
  "client.fillInOnlyWhenOauthIsUnavailableRequiresThe": {
    "zh": "仅在无法使用 OAuth 时填写，需要 gist 权限",
    "en": "Fill in only when OAuth is unavailable. Requires the gist scope."
  },
  "client.noOauthApp": {
    "zh": "没有 OAuth App？",
    "en": "No OAuth App?"
  },
  "client.goToGithubToCreateOne": {
    "zh": "前往 GitHub 创建",
    "en": "Go to GitHub to create one"
  },
  "client.thenEnableDeviceFlowInTheAppSettings": {
    "zh": "，创建后在应用设置中启用 Device Flow。",
    "en": ", then enable Device Flow in the app settings."
  },
  "client.syncedContent": {
    "zh": "同步内容：",
    "en": "Synced content: "
  },
  "client.hostsFtpFtpsPinnedProjectDirectoriesTheProxyVault": {
    "zh": "主机、FTP/FTPS、固定项目目录、代理库、密钥库，以及其中的密码和私钥。敏感字段上传前会加密。",
    "en": "Hosts, FTP/FTPS, pinned project directories, the proxy vault, the credential vault, and their passwords and private keys. Sensitive fields are encrypted before upload."
  },
  "client.keptLocalOnly": {
    "zh": "仅保留本机：",
    "en": "Kept local only: "
  },
  "client.sessionGrantsPortForwardingPublicBindsAndCommandLimits": {
    "zh": "当前会话授权、端口转发、公开绑定与命令限制。GitHub Token 和同步加密密码也始终只保存在本机 DSH 凭据服务。",
    "en": "Session grants, port forwarding, public binds, and command limits. The GitHub Token and sync encryption passphrase are also always stored only in the local DSH credential service."
  },
  "client.lastSyncFailed": {
    "zh": "上次同步失败：",
    "en": "Last sync failed: "
  },
  "client.openGist": {
    "zh": "打开 Gist",
    "en": "Open Gist"
  },
  "client.testing": {
    "zh": "测试中…",
    "en": "Testing…"
  },
  "client.testConnection": {
    "zh": "测试连接",
    "en": "Test connection"
  },
  "client.syncing": {
    "zh": "同步中…",
    "en": "Syncing…"
  },
  "client.syncNow": {
    "zh": "立即同步",
    "en": "Sync now"
  },
  "client.saving2": {
    "zh": "保存中…",
    "en": "Saving…"
  },
  "client.saveSyncSettings": {
    "zh": "保存同步设置",
    "en": "Save sync settings"
  },
  "client.localRuntimeSettings": {
    "zh": "本机运行设置",
    "en": "Local runtime settings"
  },
  "client.affectsThisDshInstanceOnlyNotSyncedViaGist": {
    "zh": "只影响当前 DSH，不参与 Gist 同步",
    "en": "Affects this DSH instance only; not synced via Gist"
  },
  "client.githubOutboundProxy": {
    "zh": "GitHub 出站代理",
    "en": "GitHub outbound proxy"
  },
  "client.usedOnlyForOauthAndTheGistApiE": {
    "zh": "仅用于 OAuth 与 Gist API；例如 http://host.docker.internal:7893，留空时使用系统 HTTPS_PROXY",
    "en": "Used only for OAuth and the Gist API; e.g. http://host.docker.internal:7893. Falls back to the system HTTPS_PROXY when left empty."
  },
  "client.connectToGithubDirectly": {
    "zh": "直连 GitHub",
    "en": "Connect to GitHub directly"
  },
  "client.testGithubNetwork": {
    "zh": "测试 GitHub 网络",
    "en": "Test GitHub network"
  },
  "client.allowPublicPortBinding": {
    "zh": "允许公开端口绑定",
    "en": "Allow public port binding"
  },
  "client.allowsForwardsToListenOn0000": {
    "zh": "允许转发监听 0.0.0.0 或其他非回环地址。仅在明确配置防火墙后开启。",
    "en": "Allows forwards to listen on 0.0.0.0 or other non-loopback addresses. Enable only with a properly configured firewall."
  },
  "client.defaultCommandTimeout": {
    "zh": "默认命令超时",
    "en": "Default command timeout"
  },
  "client.maximumWaitTimeForTheAiSSshExec": {
    "zh": "AI 的 ssh_exec 最长等待时间",
    "en": "Maximum wait time for the AI's ssh_exec"
  },
  "client.ms": {
    "zh": "毫秒",
    "en": "ms"
  },
  "client.maxCommandOutput": {
    "zh": "最大命令输出",
    "en": "Max command output"
  },
  "client.keepsTheNewestOutputBeyondThisLimitSoContext": {
    "zh": "超出后保留最新输出，避免挤占上下文",
    "en": "Keeps the newest output beyond this limit so context is not crowded out"
  },
  "client.chars": {
    "zh": "字符",
    "en": "chars"
  },
  "client.copyTheDeviceCodeThenGoToGithubTo": {
    "zh": "复制设备代码，再前往 GitHub 完成本次授权",
    "en": "Copy the device code, then go to GitHub to finish authorizing"
  },
  "client.oneTimeDeviceCode": {
    "zh": "一次性设备代码",
    "en": "One-time device code"
  },
  "client.copied": {
    "zh": "已复制",
    "en": "Copied"
  },
  "client.copyCode": {
    "zh": "复制代码",
    "en": "Copy code"
  },
  "client.copyTheCodeAbove": {
    "zh": "复制上方代码",
    "en": "Copy the code above"
  },
  "client.theDeviceCodeIsUsedForThisAuthorizationOnly": {
    "zh": "设备代码只用于这一次授权",
    "en": "The device code is used for this authorization only"
  },
  "client.openTheGithubAuthorizationPage": {
    "zh": "打开 GitHub 授权页",
    "en": "Open the GitHub authorization page"
  },
  "client.pasteTheCodeAndConfirmAuthorizationForTheCurrent": {
    "zh": "粘贴代码并确认授权给当前 OAuth App",
    "en": "Paste the code and confirm authorization for the current OAuth App"
  },
  "client.backToDsh": {
    "zh": "返回 DSH",
    "en": "Back to DSH"
  },
  "client.theConnectionCompletesAutomaticallyOnceAuthorized": {
    "zh": "授权成功后会自动完成连接",
    "en": "The connection completes automatically once authorized"
  },
  "client.theBrowserBlockedAutomaticCopyingSelectTheDeviceCode": {
    "zh": "浏览器未允许自动复制，请选中设备代码手动复制。",
    "en": "The browser blocked automatic copying. Select the device code and copy it manually."
  },
  "client.later": {
    "zh": "稍后再说",
    "en": "Later"
  },
  "client.goToGithubToAuthorize": {
    "zh": "前往 GitHub 授权",
    "en": "Go to GitHub to authorize"
  },
  "client.syncing2": {
    "zh": "同步中",
    "en": "Syncing"
  },
  "client.actionNeeded": {
    "zh": "需要处理",
    "en": "Action needed"
  },
  "client.waitingForFirstSync": {
    "zh": "等待首次同步",
    "en": "Waiting for first sync"
  },
  "client.notConfigured": {
    "zh": "尚未配置",
    "en": "Not configured"
  },
  "client.lastSynced": {
    "zh": "上次同步 {0}",
    "en": "Last synced {0}"
  },
  "client.localConfigUploaded": {
    "zh": "本地配置已上传",
    "en": "Local config uploaded"
  },
  "client.cloudConfigApplied": {
    "zh": "云端配置已应用",
    "en": "Cloud config applied"
  },
  "client.configsFromBothSidesMergedIntelligently": {
    "zh": "两端配置已智能合并",
    "en": "Configs from both sides merged intelligently"
  },
  "client.configIsAlreadyUpToDate": {
    "zh": "配置已经是最新状态",
    "en": "Config is already up to date"
  },
  "client.justNow": {
    "zh": "刚刚",
    "en": "Just now"
  },
  "client.minutesAgo": {
    "zh": "{0} 分钟前",
    "en": "{0} minutes ago"
  },
  "client.hoursAgo": {
    "zh": "{0} 小时前",
    "en": "{0} hours ago"
  },
  "client.newPortForward": {
    "zh": "新建端口转发",
    "en": "New port forward"
  },
  "client.type": {
    "zh": "类型",
    "en": "Type"
  },
  "client.localForwardL": {
    "zh": "本地转发（L）",
    "en": "Local forward (L)"
  },
  "client.remoteForwardR": {
    "zh": "远程转发（R）",
    "en": "Remote forward (R)"
  },
  "client.dynamicSocks5D": {
    "zh": "动态 SOCKS5（D）",
    "en": "Dynamic SOCKS5 (D)"
  },
  "client.listenAddress": {
    "zh": "监听地址",
    "en": "Listen address"
  },
  "client.listenPort": {
    "zh": "监听端口",
    "en": "Listen port"
  },
  "client.automaticPortHint": {
    "zh": "0 表示自动选择",
    "en": "0 means choose automatically"
  },
  "client.targetHost": {
    "zh": "目标主机",
    "en": "Target host"
  },
  "client.targetPort": {
    "zh": "目标端口",
    "en": "Target port"
  },
  "client.autoStart": {
    "zh": "自动启动",
    "en": "Auto-start"
  },
  "client.restoreThisForwardWhenDshStarts": {
    "zh": "DSH 启动时恢复此转发",
    "en": "Restore this forward when DSH starts"
  },
  "client.saveRule": {
    "zh": "保存规则",
    "en": "Save rule"
  },
  "client.commonProxies": {
    "zh": "常用代理",
    "en": "Common proxies"
  },
  "client.sshJumpHost": {
    "zh": "SSH 跳板",
    "en": "SSH jump host"
  },
  "client.httpProxy": {
    "zh": "HTTP 代理",
    "en": "HTTP proxy"
  },
  "client.socks5Proxy": {
    "zh": "SOCKS5 代理",
    "en": "SOCKS5 proxy"
  },
  "client.running": {
    "zh": "运行中 · {0}",
    "en": "Running · {0}"
  },
  "client.starting": {
    "zh": "启动中",
    "en": "Starting"
  },
  "client.failed": {
    "zh": "失败",
    "en": "Failed"
  },
  "client.stopped": {
    "zh": "已停止",
    "en": "Stopped"
  },
  "commands-panel.saveCommandsManuallyThenSelectAndConfirmExecutionIn": {
    "zh": "手动记录，在终端中选择并确认执行。请勿保存密码或 Token。",
    "en": "Save commands manually, then select and confirm execution in a terminal. Do not store passwords or tokens."
  },
  "commands-panel.newCommand": {
    "zh": "新建命令",
    "en": "New command"
  },
  "commands-panel.searchCommands": {
    "zh": "搜索命令",
    "en": "Search commands"
  },
  "commands-panel.searchNamesOrCommands": {
    "zh": "搜索名称或命令…",
    "en": "Search names or commands…"
  },
  "commands-panel.retry": {
    "zh": "重试",
    "en": "Retry"
  },
  "commands-panel.loadingCommands": {
    "zh": "正在读取命令…",
    "en": "Loading commands…"
  },
  "commands-panel.noMatchingCommands": {
    "zh": "没有匹配的命令",
    "en": "No matching commands"
  },
  "commands-panel.noSavedCommandsYetCreateOneOnTheWorkspace": {
    "zh": "还没有常用命令，请先到工作台的常用命令页面新建。",
    "en": "No saved commands yet. Create one on the workspace’s Saved commands page."
  },
  "commands-panel.noSavedCommandsYetClickNewCommandToGet": {
    "zh": "还没有常用命令，点击新建开始记录。",
    "en": "No saved commands yet. Click New command to get started."
  },
  "commands-panel.select": {
    "zh": "选用",
    "en": "Select"
  },
  "commands-panel.editCommand": {
    "zh": "编辑命令",
    "en": "Edit command"
  },
  "commands-panel.deleteCommand": {
    "zh": "删除命令",
    "en": "Delete command"
  },
  "commands-panel.commandPages": {
    "zh": "命令分页",
    "en": "Command pages"
  },
  "commands-panel.pages": {
    "zh": "页 ·",
    "en": "pages ·"
  },
  "commands-panel.items": {
    "zh": "条",
    "en": "items"
  },
  "commands-panel.previousPage": {
    "zh": "上一页",
    "en": "Previous page"
  },
  "commands-panel.nextPage": {
    "zh": "下一页",
    "en": "Next page"
  },
  "commands-panel.deleteSavedCommand": {
    "zh": "删除常用命令",
    "en": "Delete saved command"
  },
  "commands-panel.onlyThisRecordIsDeletedRunningTerminalsAreNot": {
    "zh": "仅删除记录，不影响已经运行的终端。",
    "en": "Only this record is deleted. Running terminals are not affected."
  },
  "commands-panel.deleting": {
    "zh": "删除中…",
    "en": "Deleting…"
  },
  "commands-panel.command": {
    "zh": "命令",
    "en": "Command"
  },
  "commands-panel.multiLineScriptsAreSupportedRecordsStayInThis": {
    "zh": "支持多行脚本；记录保存在当前 DSH 实例，不会自动执行或上传到 Gist。",
    "en": "Multi-line scripts are supported. Records stay in this DSH instance and are not executed automatically or uploaded to Gist."
  },
  "commands-panel.save": {
    "zh": "保存",
    "en": "Save"
  },
  "file-entry-delete-dialog.deleteItems": {
    "zh": "删除 {0} 项？",
    "en": "Delete {0} items?"
  },
  "file-entry-delete-dialog.thisCannotBeUndone": {
    "zh": "{0} · 此操作无法撤销",
    "en": "{0} · this cannot be undone"
  },
  "file-entry-delete-dialog.theCurrentSessionDirectory": {
    "zh": "当前会话目录",
    "en": "the current session directory"
  },
  "file-entry-delete-dialog.ofTheseDirectoriesAndAllTheirContentsWillBe": {
    "zh": "其中 {0} 个目录及其全部内容会被递归删除。",
    "en": "Of these, {0} directories and all their contents will be recursively deleted."
  },
  "file-entry-delete-dialog.andAnother": {
    "zh": "以及其他",
    "en": "and another"
  },
  "file-entry-delete-dialog.items": {
    "zh": "项",
    "en": "items"
  },
  "file-entry-delete-dialog.deleting": {
    "zh": "正在删除…",
    "en": "Deleting…"
  },
  "file-entry-delete-dialog.confirmDelete": {
    "zh": "确认删除",
    "en": "Confirm delete"
  },
  "file-transfer-workspace.directStreamingTransfersBetweenFtpFtpsAndSftp": {
    "zh": "FTP、FTPS 与 SFTP 之间直接流式互传",
    "en": "Direct streaming transfers between FTP, FTPS, and SFTP"
  },
  "file-transfer-workspace.sessionAccess": {
    "zh": "会话访问 ·",
    "en": "Session access ·"
  },
  "file-transfer-workspace.ftpManager": {
    "zh": "FTP 管理",
    "en": "FTP manager"
  },
  "file-transfer-workspace.fileTransferTasksPage": {
    "zh": "文件传输任务页",
    "en": "File transfer tasks page"
  },
  "file-transfer-workspace.close": {
    "zh": "关闭 {0}",
    "en": "Close {0}"
  },
  "file-transfer-workspace.newTransferTasksPage": {
    "zh": "新建传输任务页",
    "en": "New transfer tasks page"
  },
  "file-transfer-workspace.panes": {
    "zh": "窗格数量",
    "en": "Panes"
  },
  "file-transfer-workspace.panes2": {
    "zh": "栏",
    "en": "panes"
  },
  "file-transfer-workspace.noFileConnectionsAvailableYet": {
    "zh": "还没有可用文件连接",
    "en": "No file connections available yet"
  },
  "file-transfer-workspace.createAnFtpFtpsConnectionOrAddAnSsh": {
    "zh": "新建 FTP/FTPS 连接，或先添加一台 SSH 主机使用 SFTP。",
    "en": "Create an FTP/FTPS connection, or add an SSH host first to use SFTP."
  },
  "file-transfer-workspace.newFtpConnection": {
    "zh": "新建 FTP 连接",
    "en": "New FTP connection"
  },
  "file-transfer-workspace.connectionList": {
    "zh": "连接列表",
    "en": "Connection list"
  },
  "file-transfer-workspace.clickAConnectionToBrowseRemoteFiles": {
    "zh": "单击连接后浏览远端文件",
    "en": "Click a connection to browse remote files"
  },
  "file-transfer-workspace.sshHosts": {
    "zh": "SSH 主机",
    "en": "SSH hosts"
  },
  "file-transfer-workspace.fileConnections": {
    "zh": "文件连接",
    "en": "File connections"
  },
  "file-transfer-workspace.availableConnections": {
    "zh": "个可用连接",
    "en": "available connections"
  },
  "file-transfer-workspace.sftpReusesSshHostConfiguration": {
    "zh": "SFTP 复用 SSH 主机配置",
    "en": "SFTP reuses SSH host configuration"
  },
  "file-transfer-workspace.backToConnectionList": {
    "zh": "返回连接列表",
    "en": "Back to connection list"
  },
  "file-transfer-workspace.parentDirectory": {
    "zh": "上一级目录",
    "en": "Parent directory"
  },
  "file-transfer-workspace.refreshDirectory": {
    "zh": "刷新目录",
    "en": "Refresh directory"
  },
  "file-transfer-workspace.remotePath": {
    "zh": "远端路径",
    "en": "Remote path"
  },
  "file-transfer-workspace.goTo": {
    "zh": "前往",
    "en": "Go to"
  },
  "file-transfer-workspace.size": {
    "zh": "大小",
    "en": "Size"
  },
  "file-transfer-workspace.modified": {
    "zh": "修改时间",
    "en": "Modified"
  },
  "file-transfer-workspace.actions": {
    "zh": "操作",
    "en": "Actions"
  },
  "file-transfer-workspace.readingDirectory": {
    "zh": "正在读取目录…",
    "en": "Reading directory…"
  },
  "file-transfer-workspace.thisDirectoryIsEmpty": {
    "zh": "这个目录是空的。",
    "en": "This directory is empty."
  },
  "file-transfer-workspace.selectedItems": {
    "zh": "已选择 {0} 项",
    "en": "Selected {0} items"
  },
  "file-transfer-workspace.items": {
    "zh": "{0} 项",
    "en": "{0} items"
  },
  "file-transfer-workspace.sendToNextPane": {
    "zh": "传送到下一栏",
    "en": "Send to next pane"
  },
  "file-transfer-workspace.moveToThisDirectory": {
    "zh": "移动到此目录",
    "en": "Move to this directory"
  },
  "file-transfer-workspace.copyToThisDirectory": {
    "zh": "复制到此目录",
    "en": "Copy to this directory"
  },
  "file-transfer-workspace.download": {
    "zh": "下载到本地",
    "en": "Download"
  },
  "file-transfer-workspace.directoryClickToEnterAcceptsDragDrop": {
    "zh": "，目录，单击进入；可接收拖放",
    "en": ", directory, click to enter; accepts drag & drop"
  },
  "file-transfer-workspace.clickToView": {
    "zh": "，单击查看",
    "en": ", click to view"
  },
  "file-transfer-workspace.downloadLocally": {
    "zh": "下载 {0} 到本地",
    "en": "Download {0} locally"
  },
  "file-transfer-workspace.packageAndDownloadLocally": {
    "zh": "将 {0} 打包下载到本地",
    "en": "Package {0} and download locally"
  },
  "file-transfer-workspace.collapseTransferTasks": {
    "zh": "收起传输任务",
    "en": "Collapse transfer tasks"
  },
  "file-transfer-workspace.expandTransferTasks": {
    "zh": "展开传输任务",
    "en": "Expand transfer tasks"
  },
  "file-transfer-workspace.transferTasks": {
    "zh": "传输任务",
    "en": "Transfer tasks"
  },
  "file-transfer-workspace.inProgress": {
    "zh": "{0} 个进行中",
    "en": "{0} in progress"
  },
  "file-transfer-workspace.recentTasks": {
    "zh": "最近任务",
    "en": "Recent tasks"
  },
  "file-transfer-workspace.noTasksYet": {
    "zh": "暂无任务",
    "en": "No tasks yet"
  },
  "file-transfer-workspace.dragFromOnePaneToAnotherOrSelectFiles": {
    "zh": "从一个窗格拖到另一个窗格，或选中文件后点击“传送到下一栏”。",
    "en": "Drag from one pane to another, or select files and click “Send to next pane”."
  },
  "file-transfer-workspace.cancelTransfer": {
    "zh": "取消传输",
    "en": "Cancel transfer"
  },
  "file-transfer-workspace.handle": {
    "zh": "处理",
    "en": "Handle"
  },
  "file-transfer-workspace.aFileWithTheSameNameExistsAtThe": {
    "zh": "目标中存在同名文件",
    "en": "A file with the same name exists at the destination"
  },
  "file-transfer-workspace.chooseHowToHandleThisBatchOfTransfers": {
    "zh": "为本批传输选择处理方式",
    "en": "Choose how to handle this batch of transfers"
  },
  "file-transfer-workspace.autoRename": {
    "zh": "自动重命名",
    "en": "Auto rename"
  },
  "file-transfer-workspace.keepBothFilesAppendANumberToTheName": {
    "zh": "保留两份文件，在名称后添加序号",
    "en": "Keep both files; append a number to the name"
  },
  "file-transfer-workspace.skipFilesWithTheSameName": {
    "zh": "跳过同名文件",
    "en": "Skip files with the same name"
  },
  "file-transfer-workspace.continueTransferringTheRemainingItems": {
    "zh": "继续传输其他内容",
    "en": "Continue transferring the remaining items"
  },
  "file-transfer-workspace.overwriteTheTargetFiles": {
    "zh": "覆盖目标文件",
    "en": "Overwrite the target files"
  },
  "file-transfer-workspace.replaceTheDestinationContentWithTheSourceContent": {
    "zh": "使用来源内容替换目标内容",
    "en": "Replace the destination content with the source content"
  },
  "file-transfer-workspace.reQueuing": {
    "zh": "正在重新加入队列…",
    "en": "Re-queuing…"
  },
  "file-transfer-workspace.continueTransfer": {
    "zh": "继续传输",
    "en": "Continue transfer"
  },
  "file-transfer-workspace.sessionAccess2": {
    "zh": "会话访问",
    "en": "Session access"
  },
  "file-transfer-workspace.manageTheRemoteFileConnectionsAvailableToThisSession": {
    "zh": "单独管理当前会话可使用的远端文件连接",
    "en": "Manage the remote file connections available to this session"
  },
  "file-transfer-workspace.letTheCurrentSessionBrowseSelectedFtpFtpsOr": {
    "zh": "允许当前会话浏览指定的 FTP、FTPS 或 SFTP",
    "en": "Let the current session browse selected FTP, FTPS, or SFTP"
  },
  "file-transfer-workspace.noConnectionsAvailable": {
    "zh": "没有可用连接",
    "en": "No connections available"
  },
  "file-transfer-workspace.addAnFtpInFileTransferFirstOrAdd": {
    "zh": "请先在文件传输中添加 FTP，或在主机面板中添加 SSH 主机。",
    "en": "Add an FTP in File Transfer first, or add an SSH host in the hosts panel."
  },
  "file-transfer-workspace.accessPolicy": {
    "zh": "访问策略",
    "en": "Access policy"
  },
  "file-transfer-workspace.filePermissionsAreSeparateFromSshCommandAndTerminal": {
    "zh": "文件权限与 SSH 命令、终端权限相互独立",
    "en": "File permissions are separate from SSH command and terminal permissions"
  },
  "file-transfer-workspace.fileOperationPermissions": {
    "zh": "文件操作权限",
    "en": "File operation permissions"
  },
  "file-transfer-workspace.browseModeDoesNotExposeCrossEndpointTransferTools": {
    "zh": "浏览模式不会向 AI 暴露跨端传输工具",
    "en": "Browse mode does not expose cross-endpoint transfer tools to the AI"
  },
  "file-transfer-workspace.confirmBeforeTransfer": {
    "zh": "传输前确认",
    "en": "Confirm before transfer"
  },
  "file-transfer-workspace.requireDshApprovalWhenTheAiStartsATransfer": {
    "zh": "AI 发起传输时请求 DSH 授权",
    "en": "Require DSH approval when the AI starts a transfer"
  },
  "file-transfer-workspace.savingChanges": {
    "zh": "正在保存更改",
    "en": "Saving changes"
  },
  "file-transfer-workspace.autosaves": {
    "zh": "{0} · 自动保存",
    "en": "{0} · autosaves"
  },
  "file-transfer-workspace.authorizedConnections": {
    "zh": "已授权 {0} 个连接",
    "en": "Authorized {0} connections"
  },
  "file-transfer-workspace.noAuthorizedConnections": {
    "zh": "未授权连接",
    "en": "No authorized connections"
  },
  "file-transfer-workspace.done": {
    "zh": "完成",
    "en": "Done"
  },
  "file-transfer-workspace.authorized": {
    "zh": "已授权",
    "en": "Authorized"
  },
  "file-transfer-workspace.notAuthorized": {
    "zh": "未授权",
    "en": "Not authorized"
  },
  "file-transfer-workspace.readingSessionPermissions": {
    "zh": "正在读取会话权限",
    "en": "Reading session permissions"
  },
  "file-transfer-workspace.browseOnly": {
    "zh": "仅浏览",
    "en": "Browse only"
  },
  "file-transfer-workspace.allowTransfer": {
    "zh": "允许传输",
    "en": "Allow transfer"
  },
  "file-transfer-workspace.confirmationRequired": {
    "zh": "需要确认",
    "en": "Confirmation required"
  },
  "file-transfer-workspace.runDirectly": {
    "zh": "直接执行",
    "en": "Run directly"
  },
  "file-transfer-workspace.tasks": {
    "zh": "任务 {0}",
    "en": "Tasks {0}"
  },
  "file-transfer-workspace.files": {
    "zh": "文件",
    "en": "Files"
  },
  "file-transfer-workspace.andMore": {
    "zh": "{0} 等 {1} 项",
    "en": "{0} and {1} more"
  },
  "file-transfer-workspace.waitingToTransfer": {
    "zh": "等待传输",
    "en": "Waiting to transfer"
  },
  "file-transfer-workspace.scanningDirectories": {
    "zh": "正在扫描目录",
    "en": "Scanning directories"
  },
  "file-transfer-workspace.expirySuffix": {
    "zh": " · 约 {0}",
    "en": " · ~ {0}"
  },
  "file-transfer-workspace.completedFiles": {
    "zh": "已完成 {0} 个文件{1}",
    "en": "Completed {0} files{1}"
  },
  "file-transfer-workspace.skipped": {
    "zh": "，跳过 {0}",
    "en": ", skipped {0}"
  },
  "file-transfer-workspace.cancelled": {
    "zh": "已取消",
    "en": "Cancelled"
  },
  "file-transfer-workspace.transferFailed": {
    "zh": "传输失败",
    "en": "Transfer failed"
  },
  "file-transfer-workspace.created": {
    "zh": "创建于 {0}",
    "en": "Created {0}"
  },
  "file-transfer-workspace.executed": {
    "zh": "已执行 {0}",
    "en": "Executed {0}"
  },
  "file-transfer-workspace.tookCompleted": {
    "zh": "耗时 {0} · 完成于 {1}",
    "en": "Took {0} · completed {1}"
  },
  "file-transfer-workspace.seconds": {
    "zh": "{0} 秒",
    "en": "{0} seconds"
  },
  "file-transfer-workspace.minutesSeconds": {
    "zh": "{0} 分 {1} 秒",
    "en": "{0} minutes {1} seconds"
  },
  "file-transfer-workspace.hoursMinutes": {
    "zh": "{0} 小时 {1} 分",
    "en": "{0} hours {1} minutes"
  },
  "file-transfer-workspace.minutes": {
    "zh": "{0} 分钟",
    "en": "{0} minutes"
  },
  "file-transfer-workspace.hMin": {
    "zh": "{0} 小时 {1} 分钟",
    "en": "{0} h {1} min"
  },
  "ftp-profile-editor.manageFtpAndFtpsSftpReusesExistingSshHosts": {
    "zh": "管理 FTP 与 FTPS；SFTP 直接复用已有 SSH 主机",
    "en": "Manage FTP and FTPS; SFTP reuses existing SSH hosts directly"
  },
  "ftp-profile-editor.new": {
    "zh": "新建",
    "en": "New"
  },
  "ftp-profile-editor.noStandaloneFileConnectionsYet": {
    "zh": "还没有独立文件连接",
    "en": "No standalone file connections yet"
  },
  "ftp-profile-editor.sftpAppearsInTheFilePaneSConnectionList": {
    "zh": "SFTP 会显示在文件窗格的连接列表中；这里只管理 FTP 与 FTPS。",
    "en": "SFTP appears in the file pane's connection list; only FTP and FTPS are managed here."
  },
  "ftp-profile-editor.newFtpsConnection": {
    "zh": "新建 FTPS 连接",
    "en": "New FTPS connection"
  },
  "ftp-profile-editor.anonymous": {
    "zh": "匿名登录",
    "en": "Anonymous"
  },
  "ftp-profile-editor.missingPassword": {
    "zh": "缺少密码",
    "en": "Missing password"
  },
  "ftp-profile-editor.selectAConnectionToEdit": {
    "zh": "选择一个连接进行编辑",
    "en": "Select a connection to edit"
  },
  "ftp-profile-editor.theFilePaneCombinesFtpFtpsAndSftpFrom": {
    "zh": "文件窗格会把这里保存的 FTP、FTPS 与 SSH 主机提供的 SFTP 汇总成连接列表。",
    "en": "The file pane combines FTP, FTPS, and SFTP from SSH hosts saved here into one connection list."
  },
  "ftp-profile-editor.encryptsControlAndFileDataCertificatesStrictlyValidatedBy": {
    "zh": "加密控制与文件数据，默认严格校验证书",
    "en": "Encrypts control and file data; certificates strictly validated by default"
  },
  "ftp-profile-editor.compatibleWithLegacyServersButCredentialsAndFileContent": {
    "zh": "兼容旧服务器，但账号和文件内容不加密",
    "en": "Compatible with legacy servers, but credentials and file content are unencrypted"
  },
  "ftp-profile-editor.managedBySshHostsNoNeedToConfigureIt": {
    "zh": "由 SSH 主机管理，不在这里重复配置",
    "en": "Managed by SSH hosts; no need to configure it again here"
  },
  "ftp-profile-editor.delete": {
    "zh": "删除“",
    "en": "Delete “"
  },
  "ftp-profile-editor.thisRemovesTheFtpFtpsConnectionAndItsSeparately": {
    "zh": "将移除该 FTP/FTPS 连接及其独立保存的密码，不会删除远端服务器上的任何文件。",
    "en": "This removes the FTP/FTPS connection and its separately saved password. No files on the remote server will be deleted."
  },
  "ftp-profile-editor.deleteConnection": {
    "zh": "删除连接",
    "en": "Delete connection"
  },
  "ftp-profile-editor.connectedInitialDirectoryIsReadable": {
    "zh": "连接成功，初始目录可读取",
    "en": "Connected; initial directory is readable"
  },
  "ftp-profile-editor.newFileConnection": {
    "zh": "新建文件连接",
    "en": "New file connection"
  },
  "ftp-profile-editor.enterServerAndAuthenticationDetails": {
    "zh": "填写服务器和认证信息",
    "en": "Enter server and authentication details"
  },
  "ftp-profile-editor.afterEditsTestBeforeSaving": {
    "zh": "修改后可先测试再保存",
    "en": "After edits, test before saving"
  },
  "ftp-profile-editor.connectionType": {
    "zh": "连接类型",
    "en": "Connection type"
  },
  "ftp-profile-editor.preferFtpsChooseFtpOnlyWhenTheServerLacks": {
    "zh": "优先使用 FTPS；仅在服务器不支持 TLS 时选择 FTP",
    "en": "Prefer FTPS; choose FTP only when the server lacks TLS support"
  },
  "ftp-profile-editor.connectionProtocol": {
    "zh": "连接协议",
    "en": "Connection protocol"
  },
  "ftp-profile-editor.explicitTlsRecommended": {
    "zh": "显式 TLS · 推荐",
    "en": "Explicit TLS · recommended"
  },
  "ftp-profile-editor.implicitTls": {
    "zh": "隐式 TLS",
    "en": "Implicit TLS"
  },
  "ftp-profile-editor.unencrypted": {
    "zh": "未加密",
    "en": "Unencrypted"
  },
  "ftp-profile-editor.plainFtpSendsYourAccountPasswordAndFileContent": {
    "zh": "普通 FTP 的账号、密码和文件内容均不加密。",
    "en": "Plain FTP sends your account, password, and file content unencrypted."
  },
  "ftp-profile-editor.server": {
    "zh": "服务器",
    "en": "Server"
  },
  "ftp-profile-editor.theNameAppearsInTheConnectionListGroupsAnd": {
    "zh": "名称用于连接列表，分组与标签可复用已有选项",
    "en": "The name appears in the connection list; groups and tags can reuse existing options"
  },
  "ftp-profile-editor.connectionName": {
    "zh": "连接名称",
    "en": "Connection name"
  },
  "ftp-profile-editor.groupOptional": {
    "zh": "分组（可选）",
    "en": "Group (optional)"
  },
  "ftp-profile-editor.ftpGroups": {
    "zh": "FTP 分组",
    "en": "FTP groups"
  },
  "ftp-profile-editor.selectAnExistingGroupOrEnterANewOne": {
    "zh": "选择已有分组或输入新分组",
    "en": "Select an existing group or enter a new one"
  },
  "ftp-profile-editor.serverAddress": {
    "zh": "服务器地址",
    "en": "Server address"
  },
  "ftp-profile-editor.port": {
    "zh": "端口",
    "en": "Port"
  },
  "ftp-profile-editor.tagsOptional": {
    "zh": "标签（可选）",
    "en": "Tags (optional)"
  },
  "ftp-profile-editor.pickExistingTagsOrTypeNewOnesSeparateMultiple": {
    "zh": "可选择已有标签或直接输入；多个标签使用逗号分隔。",
    "en": "Pick existing tags or type new ones; separate multiple tags with commas."
  },
  "ftp-profile-editor.ftpTags": {
    "zh": "FTP 标签",
    "en": "FTP tags"
  },
  "ftp-profile-editor.selectOrEnterTags": {
    "zh": "选择或输入标签",
    "en": "Select or enter tags"
  },
  "ftp-profile-editor.authentication": {
    "zh": "身份认证",
    "en": "Authentication"
  },
  "ftp-profile-editor.thePasswordIsWrittenOnlyToTheDshCredential": {
    "zh": "密码只写入 DSH 凭据服务，不会在界面回显",
    "en": "The password is written only to the DSH credential service and never echoed in the UI"
  },
  "ftp-profile-editor.signInMethod": {
    "zh": "登录方式",
    "en": "Sign-in method"
  },
  "ftp-profile-editor.usernameAndPassword": {
    "zh": "账号密码",
    "en": "Username and password"
  },
  "ftp-profile-editor.signInAsAnonymousWithoutEnteringCredentialsTheServer": {
    "zh": "使用 anonymous 登录，无需填写账号密码；服务器必须开放匿名访问。",
    "en": "Sign in as anonymous without entering credentials. The server must allow anonymous access."
  },
  "ftp-profile-editor.credentialSource": {
    "zh": "凭据来源",
    "en": "Credential source"
  },
  "ftp-profile-editor.saveThePasswordWithThisConnectionOnly": {
    "zh": "此连接单独保存密码",
    "en": "Save the password with this connection only"
  },
  "ftp-profile-editor.notEchoedAfterSaving": {
    "zh": "保存后不会回显",
    "en": "Not echoed after saving"
  },
  "ftp-profile-editor.pathAndNetwork": {
    "zh": "路径与网络",
    "en": "Path and network"
  },
  "ftp-profile-editor.proxyReusesTheSshPluginSProxyLibraryControl": {
    "zh": "代理复用 SSH 插件的代理库，控制和数据连接使用同一路径",
    "en": "Proxy reuses the SSH plugin's proxy library; control and data connections take the same path"
  },
  "ftp-profile-editor.initialDirectory": {
    "zh": "初始目录",
    "en": "Initial directory"
  },
  "ftp-profile-editor.connectionProxy": {
    "zh": "连接代理",
    "en": "Connection proxy"
  },
  "ftp-profile-editor.advancedConnectionSettings": {
    "zh": "高级连接设置",
    "en": "Advanced connection settings"
  },
  "ftp-profile-editor.connectionTimeoutMs": {
    "zh": "连接超时（毫秒）",
    "en": "Connection timeout (ms)"
  },
  "ftp-profile-editor.tlsServerName": {
    "zh": "TLS 服务器名称",
    "en": "TLS server name"
  },
  "ftp-profile-editor.fillInWhenTheCertificateNameDiffersFromThe": {
    "zh": "证书名称与主机不同时填写",
    "en": "Fill in when the certificate name differs from the host"
  },
  "ftp-profile-editor.testing": {
    "zh": "正在测试…",
    "en": "Testing…"
  },
  "ftp-profile-editor.saveConnection": {
    "zh": "保存连接",
    "en": "Save connection"
  },
  "html-file-preview.isolatedStaticPreviewScriptsAndExternalOrRelativeResources": {
    "zh": "静态隔离预览：不执行脚本，不加载外部或相对路径资源",
    "en": "Isolated static preview: scripts and external or relative resources are disabled"
  },
  "html-file-preview.contentTruncated": {
    "zh": "内容已截断",
    "en": "Content truncated"
  },
  "html-file-preview.staticPreview": {
    "zh": "静态预览",
    "en": "Static preview"
  },
  "html-file-preview.viewHtmlSource": {
    "zh": "查看 HTML 源码",
    "en": "View HTML source"
  },
  "html-file-preview.page": {
    "zh": "页面",
    "en": "Page"
  },
  "html-file-preview.source": {
    "zh": "源码",
    "en": "Source"
  },
  "html-file-preview.htmlPreview": {
    "zh": "HTML 预览：{0}",
    "en": "HTML preview: {0}"
  },
  "markdown-preview-editor.markdownBody": {
    "zh": "Markdown 正文",
    "en": "Markdown body"
  },
  "native-directory-button.theDshEnvironmentHasNoSupportedFileManagerUse": {
    "zh": "DSH 运行环境不支持系统文件管理器，请使用目录弹窗或下载",
    "en": "The DSH environment has no supported file manager. Use the directory dialog or download instead."
  },
  "native-directory-button.requestedTheFileManagerOnTheComputerRunningDsh": {
    "zh": "已请求在 DSH 所在电脑打开文件管理器",
    "en": "Requested the file manager on the computer running DSH"
  },
  "native-directory-button.openFileManager": {
    "zh": "打开文件管理器",
    "en": "Open file manager"
  },
  "native-directory-button.checkingFileManagerSupport": {
    "zh": "正在检测文件管理器支持",
    "en": "Checking file manager support"
  },
  "native-directory-button.openThisDirectoryInTheFileManagerOnThe": {
    "zh": "在 DSH 所在电脑的文件管理器中打开当前目录",
    "en": "Open this directory in the file manager on the computer running DSH"
  },
  "preview-refresh-control.previewRefresh": {
    "zh": "预览刷新",
    "en": "Preview refresh"
  },
  "preview-refresh-control.refreshPreview": {
    "zh": "刷新预览",
    "en": "Refresh preview"
  },
  "preview-refresh-control.saveYourChangesFirst": {
    "zh": "请先保存正文修改",
    "en": "Save your changes first"
  },
  "preview-refresh-control.refreshing": {
    "zh": "正在刷新…",
    "en": "Refreshing…"
  },
  "preview-refresh-control.refreshPreviewAndKeepReadingPosition": {
    "zh": "刷新预览，保留阅读位置",
    "en": "Refresh preview and keep reading position"
  },
  "preview-refresh-control.autoRefresh": {
    "zh": "自动刷新",
    "en": "Auto-refresh"
  },
  "preview-refresh-control.autoRefreshIsUnavailableForThisPreview": {
    "zh": "此预览暂不支持自动刷新",
    "en": "Auto-refresh is unavailable for this preview"
  },
  "preview-refresh-control.checkForChangesEvery5SecondsClickForManual": {
    "zh": "每 5 秒检查变化，点击切换为手动",
    "en": "Check for changes every 5 seconds; click for manual refresh"
  },
  "preview-refresh-control.manualRefreshClickToEnableAutoRefresh": {
    "zh": "当前手动刷新，点击开启自动刷新",
    "en": "Manual refresh; click to enable auto-refresh"
  },
  "preview-refresh-control.auto": {
    "zh": "自动",
    "en": "Auto"
  },
  "preview-refresh-control.manual": {
    "zh": "手动",
    "en": "Manual"
  },
  "profile-editor.thisActionCannotBeUndone": {
    "zh": "这个操作无法撤销",
    "en": "This action cannot be undone"
  },
  "profile-editor.theConnectionConfigThisHostSStandaloneCredentialsAnd": {
    "zh": "连接配置、该主机的独立凭据和关联端口转发会一并删除；它也会从所有会话授权中移除。密钥库中的共享凭据不会删除。",
    "en": "The connection config, this host's standalone credentials, and its port forwards are all deleted; it is also removed from every session grant. Shared credentials in the vault are not deleted."
  },
  "profile-editor.cannotDeleteYet": {
    "zh": "暂时不能删除",
    "en": "Cannot delete yet"
  },
  "profile-editor.theseConnectionsStillUseItAsAnSshJump": {
    "zh": "以下连接仍将它作为 SSH 跳板：",
    "en": "These connections still use it as an SSH jump host: "
  },
  "profile-editor.editTheirJumpChainsFirst": {
    "zh": "。请先修改这些连接的跳板链。",
    "en": ". Edit their jump chains first."
  },
  "profile-editor.thisAddressAndPortAreAlreadyUsedByChange": {
    "zh": "该地址和端口已由“{0}”使用，请修改主机或端口。",
    "en": "This address and port are already used by “{0}” — change the host or port."
  },
  "profile-editor.newSshConnection": {
    "zh": "新建 SSH 连接",
    "en": "New SSH connection"
  },
  "profile-editor.credentialsAreNotShownAgainAfterSaving": {
    "zh": "凭据保存后不会回显",
    "en": "Credentials are not shown again after saving"
  },
  "profile-editor.connectionInfo": {
    "zh": "连接信息",
    "en": "Connection info"
  },
  "profile-editor.hostAddressAndDisplay": {
    "zh": "主机地址与显示方式",
    "en": "Host address and display"
  },
  "profile-editor.devServer": {
    "zh": "开发服务器",
    "en": "Dev server"
  },
  "profile-editor.group": {
    "zh": "分组",
    "en": "Group"
  },
  "profile-editor.hostGroup": {
    "zh": "主机分组",
    "en": "Host group"
  },
  "profile-editor.tags": {
    "zh": "标签",
    "en": "Tags"
  },
  "profile-editor.hostTags": {
    "zh": "主机标签",
    "en": "Host tags"
  },
  "profile-editor.chooseSharedCredentialsOrSaveSeparately": {
    "zh": "选择共享凭据或单独保存",
    "en": "Choose shared credentials or save separately"
  },
  "profile-editor.useThisConnectionSOwnCredentialsOrReferenceA": {
    "zh": "可使用此连接自己的凭据，或引用密钥库中的常用账号。",
    "en": "Use this connection's own credentials, or reference a common account from the key store."
  },
  "profile-editor.savedWithThisConnectionOnly": {
    "zh": "此连接独立保存",
    "en": "Saved with this connection only"
  },
  "profile-editor.ready": {
    "zh": "已就绪",
    "en": "Ready"
  },
  "profile-editor.cannotBeReadBackAfterSaving": {
    "zh": "保存后不可读回",
    "en": "Cannot be read back after saving"
  },
  "profile-editor.pasteOpensshPemPrivateKey": {
    "zh": "粘贴 OpenSSH/PEM 私钥",
    "en": "Paste OpenSSH/PEM private key"
  },
  "profile-editor.connectionPath": {
    "zh": "连接路径",
    "en": "Connection path"
  },
  "profile-editor.directProxyOrJumpChain": {
    "zh": "直连、代理或跳板链",
    "en": "Direct, proxy, or jump chain"
  },
  "profile-editor.connectionMode": {
    "zh": "连接方式",
    "en": "Connection mode"
  },
  "profile-editor.customHttpConnect": {
    "zh": "自定义 HTTP CONNECT",
    "en": "Custom HTTP CONNECT"
  },
  "profile-editor.customSocks5": {
    "zh": "自定义 SOCKS5",
    "en": "Custom SOCKS5"
  },
  "profile-editor.addAnHttpOrSocks5ProxyToTheProxy": {
    "zh": "请先在代理库中添加 HTTP 或 SOCKS5 代理。",
    "en": "Add an HTTP or SOCKS5 proxy to the proxy library first."
  },
  "profile-editor.multipleHostsCanShareTheSameProxyConfiguration": {
    "zh": "多台主机可引用同一条代理配置。",
    "en": "Multiple hosts can share the same proxy configuration."
  },
  "profile-editor.selectProxy": {
    "zh": "选择代理",
    "en": "Select proxy"
  },
  "profile-editor.firstConnectionVerifyTheHostFingerprint": {
    "zh": "首次连接，请核对主机指纹",
    "en": "First connection: verify the host fingerprint"
  },
  "profile-editor.confirmAndRetry": {
    "zh": "确认并重试",
    "en": "Confirm and retry"
  },
  "profile-editor.connectionTestSucceeded": {
    "zh": "连接测试成功",
    "en": "Connection test succeeded"
  },
  "profile-editor.jumpChain": {
    "zh": "跳板链",
    "en": "Jump chain"
  },
  "profile-editor.connectionsAreEstablishedHopByHopTopToBottom": {
    "zh": "连接会按从上到下的顺序逐级建立。",
    "en": "Connections are established hop by hop, top to bottom."
  },
  "profile-editor.selectAnExistingConnection": {
    "zh": "选择已有连接",
    "en": "Select an existing connection"
  },
  "profile-editor.moveJumpHostUp": {
    "zh": "上移跳板",
    "en": "Move jump host up"
  },
  "profile-editor.moveJumpHostDown": {
    "zh": "下移跳板",
    "en": "Move jump host down"
  },
  "profile-editor.removeJumpHost": {
    "zh": "移除跳板",
    "en": "Remove jump host"
  },
  "profile-editor.addAtLeastOneJumpHost": {
    "zh": "至少添加一台跳板主机。",
    "en": "Add at least one jump host."
  },
  "profile-editor.addJumpHost": {
    "zh": "添加跳板",
    "en": "Add jump host"
  },
  "project-session-dialog.selectSessionWorkspace": {
    "zh": "选择会话归属空间",
    "en": "Select session workspace"
  },
  "project-session-dialog.newRemoteSession": {
    "zh": "新建远端会话",
    "en": "New remote session"
  },
  "project-session-dialog.chooseTheLocalProjectThisSessionBelongsToIn": {
    "zh": "选择这个会话在 DSH 中归属的本地项目",
    "en": "Choose the local project this session belongs to in DSH"
  },
  "project-session-dialog.remoteHost": {
    "zh": "远端主机",
    "en": "Remote host"
  },
  "project-session-dialog.remoteWorkingDirectory": {
    "zh": "远端工作目录",
    "en": "Remote working directory"
  },
  "project-session-dialog.sessionWorkspace": {
    "zh": "会话归属空间",
    "en": "Session workspace"
  },
  "project-session-dialog.sessionRecordsAreStoredInTheSelectedDshProject": {
    "zh": "会话记录保存在所选 DSH 项目中，SSH 命令与终端固定使用上面的远端目录。",
    "en": "Session records are stored in the selected DSH project. SSH commands and terminals always use the remote directory above."
  },
  "project-session-dialog.noDshProjectsAvailableYet": {
    "zh": "还没有可用的 DSH 项目",
    "en": "No DSH projects available yet"
  },
  "project-session-dialog.closeThisWindowFirstThenCreateOrAddA": {
    "zh": "请先关闭此窗口，在 DSH 左侧空间中新建或添加项目。",
    "en": "Close this window first, then create or add a project in the DSH workspace on the left."
  },
  "project-session-dialog.selectDshProject": {
    "zh": "选择 DSH 项目",
    "en": "Select DSH project"
  },
  "project-session-dialog.currentProject": {
    "zh": "当前项目",
    "en": "Current project"
  },
  "project-session-dialog.recentlyUsed": {
    "zh": "最近使用",
    "en": "Recently used"
  },
  "project-session-dialog.creating": {
    "zh": "正在新建…",
    "en": "Creating…"
  },
  "project-session-dialog.createAndOpen": {
    "zh": "新建并打开",
    "en": "Create and open"
  },
  "remote-path-input.typeDirectlyTheRemotePathIsCheckedAutomaticallyAfter": {
    "zh": "可直接输入；停止输入后会自动检查远端路径。",
    "en": "Type directly; the remote path is checked automatically after you stop typing."
  },
  "remote-path-input.checkingTheRemotePath": {
    "zh": "正在检查远端路径…",
    "en": "Checking the remote path…"
  },
  "remote-path-input.thePathDoesNotExistOrCannotBeAccessed": {
    "zh": "路径不存在或无法访问：{0}。仍可按当前输入保存。",
    "en": "The path does not exist or cannot be accessed: {0}. You can still save with the current input."
  },
  "remote-path-input.thePathIsAccessibleNoSubdirectoriesYet": {
    "zh": "路径可访问，当前没有子目录。",
    "en": "The path is accessible; no subdirectories yet."
  },
  "remote-path-input.thePathIsAccessibleFoundSubdirectories": {
    "zh": "路径可访问，找到 {0} 个子目录。",
    "en": "The path is accessible; found {0} subdirectories."
  },
  "remote-path-input.selectableRemoteSubdirectories": {
    "zh": "可选择的远端子目录",
    "en": "Selectable remote subdirectories"
  },
  "remote-path-input.select": {
    "zh": "选择 {0}",
    "en": "Select {0}"
  },
  "remote-workspace-tree.hostsProjects": {
    "zh": "主机与项目",
    "en": "Hosts & Projects"
  },
  "remote-workspace-tree.hosts": {
    "zh": "台主机",
    "en": "hosts"
  },
  "remote-workspace-tree.newConnection": {
    "zh": "新建连接",
    "en": "New connection"
  },
  "remote-workspace-tree.searchHosts": {
    "zh": "搜索主机",
    "en": "Search hosts"
  },
  "remote-workspace-tree.searchHostsGroupsTags": {
    "zh": "搜索主机、分组、标签…",
    "en": "Search hosts, groups, tags…"
  },
  "remote-workspace-tree.selectAndExpand": {
    "zh": "选择并展开 {0}",
    "en": "Select and expand {0}"
  },
  "remote-workspace-tree.unmount": {
    "zh": "卸载",
    "en": "Unmount"
  },
  "remote-workspace-tree.mount": {
    "zh": "挂载",
    "en": "Mount"
  },
  "remote-workspace-tree.openADshSessionBeforeMountingHosts": {
    "zh": "打开一个 DSH 会话后才能挂载主机",
    "en": "Open a DSH session before mounting hosts"
  },
  "remote-workspace-tree.unmountFromCurrentSession": {
    "zh": "从当前会话卸载",
    "en": "Unmount from current session"
  },
  "remote-workspace-tree.mountToCurrentSession": {
    "zh": "挂载到当前会话",
    "en": "Mount to current session"
  },
  "remote-workspace-tree.addPinnedDirectoryFor": {
    "zh": "为 {0} 添加固定目录",
    "en": "Add pinned directory for {0}"
  },
  "remote-workspace-tree.addPinnedDirectory": {
    "zh": "添加固定目录",
    "en": "Add pinned directory"
  },
  "remote-workspace-tree.readingPinnedDirectories": {
    "zh": "正在读取固定目录…",
    "en": "Reading pinned directories…"
  },
  "remote-workspace-tree.addProjectDirectory": {
    "zh": "添加项目目录",
    "en": "Add project directory"
  },
  "remote-workspace-tree.noDshSessionIsAvailableToMountADirectory": {
    "zh": "当前没有可挂载目录的 DSH 会话",
    "en": "No DSH session is available to mount a directory"
  },
  "remote-workspace-tree.mountThisHostFirst": {
    "zh": "请先挂载该主机",
    "en": "Mount this host first"
  },
  "remote-workspace-tree.unmountThisDirectoryFromTheCurrentSession": {
    "zh": "从当前会话卸载此目录",
    "en": "Unmount this directory from the current session"
  },
  "remote-workspace-tree.mountDirectoryMultipleSelectionsAreAllowed": {
    "zh": "挂载目录，可同时选择多个",
    "en": "Mount directory; multiple selections are allowed"
  },
  "remote-workspace-tree.mountedDefaultWorkingDirectory": {
    "zh": "已挂载 · 默认工作目录",
    "en": "Mounted · Default working directory"
  },
  "remote-workspace-tree.setAsDefaultWorkingDirectory": {
    "zh": "设为默认工作目录",
    "en": "Set as default working directory"
  },
  "remote-workspace-tree.setAsTheDefaultDirectory": {
    "zh": "将 {0} 设为默认目录",
    "en": "Set {0} as the default directory"
  },
  "remote-workspace-tree.newSessionIn": {
    "zh": "在 {0} 新建会话",
    "en": "New session in {0}"
  },
  "remote-workspace-tree.newSession": {
    "zh": "新建会话",
    "en": "New session"
  },
  "remote-workspace-tree.editPinnedDirectory": {
    "zh": "编辑固定目录",
    "en": "Edit pinned directory"
  },
  "remote-workspace-tree.noSshHostsYet": {
    "zh": "还没有 SSH 主机",
    "en": "No SSH hosts yet"
  },
  "remote-workspace-tree.noMatchingHosts": {
    "zh": "没有匹配的主机",
    "en": "No matching hosts"
  },
  "remote-workspace-tree.currentSessionPermissions": {
    "zh": "当前会话权限",
    "en": "Current session permissions"
  },
  "remote-workspace-tree.availableHosts": {
    "zh": "台主机可用",
    "en": "available hosts"
  },
  "remote-workspace-tree.loading": {
    "zh": "读取中",
    "en": "Loading"
  },
  "remote-workspace-tree.saving": {
    "zh": "保存中",
    "en": "Saving"
  },
  "remote-workspace-tree.notSynced": {
    "zh": "未同步",
    "en": "Not synced"
  },
  "remote-workspace-tree.synced": {
    "zh": "已同步",
    "en": "Synced"
  },
  "remote-workspace-tree.sshPermissions": {
    "zh": "SSH 权限",
    "en": "SSH permissions"
  },
  "remote-workspace-tree.commandsOnly": {
    "zh": "仅命令",
    "en": "Commands only"
  },
  "remote-workspace-tree.terminalControl": {
    "zh": "终端控制",
    "en": "Terminal control"
  },
  "remote-workspace-tree.confirmBeforeRunning": {
    "zh": "执行前确认",
    "en": "Confirm before running"
  },
  "remote-workspace-tree.whenOffRunsDirectlyUnderCurrentSessionPermissions": {
    "zh": "关闭后按当前会话权限直接执行",
    "en": "When off, runs directly under current session permissions"
  },
  "remote-workspace-tree.requiresDshAskModeFullAccessIsRejectedOutright": {
    "zh": "需 DSH 使用 Ask；Full Access 会直接拒绝",
    "en": "Requires DSH Ask mode; Full Access is rejected outright"
  },
  "remote-workspace-tree.deletePinnedDirectoryRelatedDshSessionsWillNotBe": {
    "zh": "删除固定目录“{0}”？相关 DSH 会话不会删除。",
    "en": "Delete pinned directory '{0}'? Related DSH sessions will not be deleted."
  },
  "remote-workspace-tree.defaultRemotePathForTheTerminalAndSftp": {
    "zh": "{0} · 终端与 SFTP 的默认远端路径",
    "en": "{0} · default remote path for the terminal and SFTP"
  },
  "remote-workspace-tree.websiteProject": {
    "zh": "网站项目",
    "en": "Website project"
  },
  "remote-workspace-tree.saveDirectory": {
    "zh": "保存目录",
    "en": "Save directory"
  },
  "remote-workspace-tree.ungrouped": {
    "zh": "未分组",
    "en": "Ungrouped"
  },
  "resizable-split.dragToResizeDoubleClickToReset": {
    "zh": "拖动调整宽度，双击恢复默认",
    "en": "Drag to resize, double-click to reset"
  },
  "sftp-client.localSession": {
    "zh": "本地会话",
    "en": "Local session"
  },
  "sftp-client.selectRemoteHost": {
    "zh": "选择远端主机",
    "en": "Select remote host"
  },
  "sftp-client.thisPathIsNotARegularFileOrDirectory": {
    "zh": "此路径不是普通文件或目录，请检查路径后重试",
    "en": "This path is not a regular file or directory. Check it and try again."
  },
  "sftp-client.aSingleFileCannotExceed512Mb": {
    "zh": "单个文件不能超过 512 MB",
    "en": "A single file cannot exceed 512 MB."
  },
  "sftp-client.skippedFilesLargerThan512Mb": {
    "zh": "已跳过 {0} 个超过 512 MB 的文件",
    "en": "Skipped {0} files larger than 512 MB"
  },
  "sftp-client.waitForTheDirectoryToLoadOrTheCurrent": {
    "zh": "当前无法上传，请等待目录加载或当前上传完成后重试",
    "en": "Wait for the directory to load or the current upload to finish, then try again."
  },
  "sftp-client.moved": {
    "zh": "已移动",
    "en": "Moved"
  },
  "sftp-client.addedToTheTransferQueueSeeProgressInFile": {
    "zh": "已加入传输任务，可在文件传输中查看进度",
    "en": "Added to the transfer queue. See progress in File Transfers."
  },
  "sftp-client.mountedDirectories": {
    "zh": "已挂载目录",
    "en": "Mounted directories"
  },
  "sftp-client.goToParentDirectory": {
    "zh": "返回上级目录",
    "en": "Go to parent directory"
  },
  "sftp-client.directoryOrFilePath": {
    "zh": "目录或文件路径",
    "en": "Directory or file path"
  },
  "sftp-client.enterADirectoryToBrowseOrAFileTo": {
    "zh": "输入目录进入，输入文件路径打开预览；按 Enter 确认",
    "en": "Enter a directory to browse or a file to preview; press Enter to open"
  },
  "sftp-client.directoryOrFilePathPressEnterToOpen": {
    "zh": "目录或文件路径，按 Enter 打开",
    "en": "Directory or file path; press Enter to open"
  },
  "sftp-client.closeDirectoryDialog": {
    "zh": "收起目录弹窗",
    "en": "Close directory dialog"
  },
  "sftp-client.expandDirectory": {
    "zh": "展开目录",
    "en": "Expand directory"
  },
  "sftp-client.openDirectoryInADialog": {
    "zh": "在弹窗中打开目录",
    "en": "Open directory in a dialog"
  },
  "sftp-client.upload": {
    "zh": "上传",
    "en": "Upload"
  },
  "sftp-client.uploading": {
    "zh": "上传中",
    "en": "Uploading"
  },
  "sftp-client.aFileWithTheSameNameExists": {
    "zh": "同名文件已存在",
    "en": "A file with the same name exists"
  },
  "sftp-client.skip": {
    "zh": "跳过",
    "en": "Skip"
  },
  "sftp-client.overwriteAndUpload": {
    "zh": "覆盖上传",
    "en": "Overwrite and upload"
  },
  "sftp-client.dismissNotice": {
    "zh": "关闭提示",
    "en": "Dismiss notice"
  },
  "sftp-client.readingRemoteDirectory": {
    "zh": "正在读取远端目录…",
    "en": "Reading remote directory…"
  },
  "sftp-client.thisDirectoryIsEmpty": {
    "zh": "此目录为空",
    "en": "This directory is empty"
  },
  "sftp-client.fileClickToPreview": {
    "zh": "，文件，单击预览",
    "en": ", file, click to preview"
  },
  "sftp-client.releaseToUpload": {
    "zh": "松开以上传",
    "en": "Release to upload"
  },
  "sftp-client.uploadTo": {
    "zh": "上传到",
    "en": "Upload to"
  },
  "sftp-client.browseDirectory": {
    "zh": "目录浏览",
    "en": "Browse directory"
  },
  "sftp-client.closeDirectoryDialog2": {
    "zh": "关闭目录弹窗",
    "en": "Close directory dialog"
  },
  "sftp-client.thisDocumentIsReadOnlyItMayExceed256": {
    "zh": "此文档暂为只读：可能超过 256 KB、被截断，或包含前置元数据、HTML、引用定义等暂不支持安全回写的内容。",
    "en": "This document is read-only: it may exceed 256 KB, be truncated, or contain frontmatter, HTML or reference definitions that cannot yet be safely saved."
  },
  "sftp-client.saveMarkdown": {
    "zh": "保存 Markdown",
    "en": "Save Markdown"
  },
  "sftp-client.saveBodyCtrlCmdS": {
    "zh": "保存正文（Ctrl/Cmd + S）",
    "en": "Save body (Ctrl/Cmd + S)"
  },
  "sftp-client.saved": {
    "zh": "已保存",
    "en": "Saved"
  },
  "sftp-client.downloadDraft": {
    "zh": "下载草稿",
    "en": "Download draft"
  },
  "sftp-client.discardDraft": {
    "zh": "放弃草稿",
    "en": "Discard draft"
  },
  "sftp-client.unsavedChanges": {
    "zh": "正文尚未保存",
    "en": "Unsaved changes"
  },
  "sftp-client.discardUnsavedChanges": {
    "zh": "放弃未保存的更改？",
    "en": "Discard unsaved changes?"
  },
  "sftp-client.theDraftStaysInThisBrowserTabSoYou": {
    "zh": "草稿会保留在当前浏览器标签页，下次打开此文件可继续。",
    "en": "The draft stays in this browser tab so you can continue when you reopen this file."
  },
  "sftp-client.thisClearsTheDraftAndReloadsTheFileConsider": {
    "zh": "这会清除当前草稿并重新读取文件，建议先下载草稿。",
    "en": "This clears the draft and reloads the file. Consider downloading the draft first."
  },
  "sftp-client.keepEditing": {
    "zh": "继续编辑",
    "en": "Keep editing"
  },
  "sftp-client.keepDraftAndGoBack": {
    "zh": "保留草稿并返回",
    "en": "Keep draft and go back"
  },
  "sftp-client.discardAndRefresh": {
    "zh": "放弃并刷新",
    "en": "Discard and refresh"
  },
  "sftp-client.backToDirectory": {
    "zh": "返回目录",
    "en": "Back to directory"
  },
  "sftp-client.downloadFile": {
    "zh": "下载文件",
    "en": "Download file"
  },
  "sftp-client.zoomPreview": {
    "zh": "放大预览",
    "en": "Zoom preview"
  },
  "sftp-client.unsavedDraftKeptInThisBrowserTab": {
    "zh": "未保存 · 草稿已保留在当前浏览器标签页",
    "en": "Unsaved · Draft kept in this browser tab"
  },
  "sftp-client.autoRefreshReadOnly": {
    "zh": "自动刷新 · 正文只读",
    "en": "Auto-refresh · Read-only"
  },
  "sftp-client.editDirectlyCtrlCmdSToSave": {
    "zh": "可直接修改正文 · Ctrl/Cmd + S 保存",
    "en": "Edit directly · Ctrl/Cmd + S to save"
  },
  "sftp-client.refreshFailedPreviousContentKept": {
    "zh": "刷新失败，保留上次内容：",
    "en": "Refresh failed; previous content kept:"
  },
  "sftp-client.preview": {
    "zh": "预览 {0}",
    "en": "Preview {0}"
  },
  "sftp-client.closePreview": {
    "zh": "关闭预览",
    "en": "Close preview"
  },
  "sftp-client.openingFile": {
    "zh": "正在打开文件…",
    "en": "Opening file…"
  },
  "sftp-client.largeFileShowingTheFirst1MbOnlyDownload": {
    "zh": "文件较大，仅显示前 1 MB。下载可查看完整内容。",
    "en": "Large file; showing the first 1 MB only. Download it to see the full content."
  },
  "sftp-client.thisFileCannotBePreviewedDirectly": {
    "zh": "此文件无法直接预览",
    "en": "This file cannot be previewed directly"
  },
  "terminal-session.connectionEndedYouCanReconnect": {
    "zh": "\r\n[连接已结束，可以重新连接]\r\n",
    "en": "\r\n[Connection ended; you can reconnect]\r\n"
  },
  "terminal-session.earlierOutputTruncated": {
    "zh": "\r\n[较早输出已截断]\r\n",
    "en": "\r\n[Earlier output truncated]\r\n"
  },
  "terminal-session.savedCommands": {
    "zh": "常用命令 · {0}",
    "en": "Saved commands · {0}"
  },
  "terminal-session.disconnect": {
    "zh": "断开 {0}",
    "en": "Disconnect {0}"
  },
  "terminal-session.connect": {
    "zh": "连接 {0}",
    "en": "Connect {0}"
  },
  "terminal-session.connect2": {
    "zh": "连接",
    "en": "Connect"
  },
  "terminal-session.connected": {
    "zh": "已连接",
    "en": "Connected"
  },
  "terminal-session.disconnected": {
    "zh": "未连接",
    "en": "Disconnected"
  },
  "terminal-session.initialDirectory": {
    "zh": "初始目录：{0}\n{1}",
    "en": "Initial directory: {0}\n{1}"
  },
  "terminal-session.target": {
    "zh": "发送目标：",
    "en": "Target:"
  },
  "terminal-session.makeSureTheTerminalIsAtACommandPrompt": {
    "zh": "· 请先确认终端处于命令提示符",
    "en": "· Make sure the terminal is at a command prompt"
  },
  "terminal-session.commandToSend": {
    "zh": "待发送命令",
    "en": "Command to send"
  },
  "terminal-session.runCommand": {
    "zh": "确认执行",
    "en": "Run command"
  },
  "terminal-session.multiLineCommand": {
    "zh": "多行命令",
    "en": "Multi-line command"
  },
  "terminal-session.selectSavedCommand": {
    "zh": "选择常用命令",
    "en": "Select saved command"
  },
  "terminal-session.previewBeforeRunningSelectingDoesNotExecuteTheCommand": {
    "zh": "选用后先预览，不会立即执行",
    "en": "Preview before running; selecting does not execute the command"
  },
  "terminal-workspace.terminalTabs": {
    "zh": "{0} 终端标签",
    "en": "{0} terminal tabs"
  },
  "terminal-workspace.pane": {
    "zh": " · 窗格 {0}",
    "en": " · Pane {0}"
  },
  "terminal-workspace.openInCurrentPane": {
    "zh": " · 在当前窗格打开",
    "en": " · Open in current pane"
  },
  "terminal-workspace.close": {
    "zh": "关闭{0}",
    "en": "Close {0}"
  },
  "terminal-workspace.closeTerminal": {
    "zh": "关闭终端",
    "en": "Close terminal"
  },
  "terminal-workspace.upTo8TabsPerHost": {
    "zh": "每台主机最多 8 个标签",
    "en": "Up to 8 tabs per host"
  },
  "terminal-workspace.newTerminalTab": {
    "zh": "新建终端标签",
    "en": "New terminal tab"
  },
  "terminal-workspace.terminalLayout": {
    "zh": "终端布局",
    "en": "Terminal layout"
  },
  "terminal-workspace.splitHorizontally": {
    "zh": "左右分屏",
    "en": "Split horizontally"
  },
  "terminal-workspace.splitVertically": {
    "zh": "上下分屏",
    "en": "Split vertically"
  },
  "terminal-workspace.addPane": {
    "zh": "增加分屏",
    "en": "Add pane"
  },
  "terminal-workspace.upTo4Panes": {
    "zh": "最多 4 个分屏",
    "en": "Up to 4 panes"
  },
  "terminal-workspace.addPaneUpTo4": {
    "zh": "增加分屏，最多 4 个",
    "en": "Add pane, up to 4"
  },
  "terminal-workspace.singlePane": {
    "zh": "单屏",
    "en": "Single pane"
  },
  "terminal-workspace.showOnlyTheCurrentTerminalKeepOtherConnections": {
    "zh": "仅显示当前终端，其他连接保留",
    "en": "Show only the current terminal; keep other connections"
  },
  "terminal-workspace.actions": {
    "zh": "{0} 操作",
    "en": "{0} actions"
  },
  "terminal-workspace.allTerminalsAreClosed": {
    "zh": "所有终端均已关闭。",
    "en": "All terminals are closed."
  },
  "terminal-workspace.newTerminal": {
    "zh": "新建终端",
    "en": "New terminal"
  },
  "terminal-workspace.close2": {
    "zh": "关闭{0}？",
    "en": "Close {0}?"
  },
  "terminal-workspace.closingDisconnectsThisTabSSshConnectionAndMay": {
    "zh": "关闭将断开此标签的 SSH 连接，可能中断正在运行的命令。",
    "en": "Closing disconnects this tab’s SSH connection and may interrupt running commands."
  },
  "terminal-workspace.closeConnection": {
    "zh": "关闭连接",
    "en": "Close connection"
  },
  "ui-components.existingOptions": {
    "zh": "{0}{1}已有选项",
    "en": "{0} existing options for {1}"
  },
  "ui-components.collapse": {
    "zh": "收起",
    "en": "Collapse"
  },
  "ui-components.expand": {
    "zh": "展开",
    "en": "Expand"
  },
  "ui-components.existingOptions2": {
    "zh": "{0}已有选项",
    "en": "Existing options for {0}"
  },
  "ui-components.noExistingOptionsYetTypeDirectly": {
    "zh": "暂无已有选项，可直接输入",
    "en": "No existing options yet. Type directly."
  },
  "ui-components.noMatchesTypeANewValue": {
    "zh": "没有匹配项，可直接输入新内容",
    "en": "No matches. Type a new value."
  },
  "ui-components.hidePassword": {
    "zh": "隐藏密码",
    "en": "Hide password"
  },
  "ui-components.showPassword": {
    "zh": "显示密码",
    "en": "Show password"
  },
  "ui-components.hide": {
    "zh": "隐藏",
    "en": "Hide"
  },
  "ui-components.show": {
    "zh": "显示",
    "en": "Show"
  },
  "ui-components.connectYourFirstRemoteHost": {
    "zh": "连接你的第一台远端主机",
    "en": "Connect your first remote host"
  },
  "ui-components.useTheAddButtonNextToHostsProjectsTo": {
    "zh": "使用“主机与项目”旁的添加按钮保存 SSH 配置，随后即可打开终端、建立端口转发，并按会话授权给 AI。",
    "en": "Use the Add button next to Hosts & Projects to save an SSH config. Then you can open terminals, set up port forwarding, and grant AI access per session."
  },
  "use-file-preview.thisFileIsNowADirectoryGoBackAnd": {
    "zh": "文件已变为目录，请返回目录重新打开",
    "en": "This file is now a directory. Go back and reopen it."
  },
  "use-markdown-draft.unsavedDraftRestored": {
    "zh": "已恢复未保存草稿",
    "en": "Unsaved draft restored"
  },
  "use-markdown-draft.theFileHasChangedYourDraftIsKeptSaving": {
    "zh": "文件版本已变化，草稿已保留；保存时会检查冲突",
    "en": "The file has changed. Your draft is kept; saving will check for conflicts."
  },
  "use-markdown-draft.theBrowserCannotPersistThisDraftKeepThisPage": {
    "zh": "浏览器无法持久保存草稿，请保持此页面打开并及时保存",
    "en": "The browser cannot persist this draft. Keep this page open and save soon."
  },
  "use-markdown-draft.saveFailedDraftKept": {
    "zh": "保存失败，草稿仍保留：{0}",
    "en": "Save failed; draft kept: {0}"
  }
} as const

export type MessageKey = keyof typeof messages
