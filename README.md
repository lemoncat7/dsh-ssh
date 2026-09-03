# dsh-ssh

A remote-work plugin for DeepSeek Harness. It brings SSH session management, a browser terminal, FTP/FTPS/SFTP file transfer, proxies, port forwarding, and AI session authorization into a single DSH workspace.

For the responsibility breakdown of the browser UI, server-side runtime, session authorization boundary, and terminal lifecycle, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Installation

```bash
dsh plugin --profile web add @lemoncat7/dsh-ssh@latest
```

Restart the corresponding DSH Profile after installing or upgrading. Desktop and Docker deployments use the same plugin package.

## 1.2.0 Updates

- The browser side is now layered into the activity sidebar, connection editing, host tree, SFTP, terminal, and shared UI; dialogs uniformly support focus trapping, closing with Escape, and focus restoration.
- SSH activity and port-forwarding status are now scheduled after completion; background pages automatically reduce polling frequency to avoid overlapping polls caused by slow requests.
- The new-connection and edit-connection forms are grouped into "Connection Info / Authentication / Connection Path", with unified buttons, focus handling, press feedback, and reduced-motion support.
- The SSH panel is now a "Host / Pinned Project Directory" tree, and the main workspace shows the terminal on the left and SFTP on the right at the same time.
- The authorization selector in front of each host, together with the "Current Session Permissions" control at the bottom, jointly determines the AI-visible scope; the standalone session injection inspector is gone.
- Each host can store multiple pinned remote directories; the current session explicitly binds at most one of them, and the terminal, SFTP, and AI commands share that working directory. Once selected, the directory item clearly shows that the current session is pinned to that path.
- When creating a session from a pinned remote directory, you first choose which DSH local project the session belongs to; it defaults to the current project, then the most recent project, and clearly distinguishes the local project path from the SSH remote working directory.
- The add button after a pinned directory creates and directly opens a new session through the official DSH Workspace API, writing the corresponding host, directory, and permission bindings at the same time; on success the SSH management panel closes automatically, and no historical session list is shown under the directory.
- Revoking host access closes that session's AI terminals on the corresponding host; downgrading to commands-only closes all interactive terminals.

## Capabilities

- SSH password, private key, and SSH Agent authentication
- HTTP CONNECT, SOCKS5, and SSH jump-host proxying
- Local forwarding (`-L`), remote forwarding (`-R`), and dynamic SOCKS5 forwarding (`-D`)
- Interactive browser terminal with input, incremental output, window-size synchronization, and active disconnect
- The current session's right sidebar supports switching among multiple AI terminals with keyboard input
- The SSH activity right column keeps its expanded state, tab, and selected host per session; switching to a session that was never expanded does not open it automatically, and switching back restores it
- When the AI calls `ssh_terminal_open` to create a terminal, the current session automatically expands the SSH right column and switches to the new terminal
- SFTP file browsing, text/image/PDF preview, and streaming download; supports drag-and-drop upload, moving within a directory, per-row delete, and opening an independent enlarged window from the embedded preview
- Standalone "File Transfer" workspace with 2–4 FTP, FTPS, or SFTP panes and multiple task tabs
- FTP, explicit FTPS, and implicit FTPS; the FTP control connection and every passive data connection support HTTP CONNECT and SOCKS5 proxies
- Cross-protocol streaming transfer among FTP/FTPS/SFTP without staging complete files on DSH disk; supports multiple files, recursive directories, conflict policies, progress, cancellation, and failure states
- Ordered multi-host jump chain, compatible with existing single-jump configurations
- A dedicated credential vault centrally stores common usernames, passwords, and private keys; SSH connections store references only
- A dedicated proxy library centrally stores HTTP CONNECT and SOCKS5 proxies; multiple hosts can reuse the same connection path
- Connections are authorized per DSH session; unchecked hosts are completely invisible to the AI
- Ordinary forked sessions inherit the source session's SSH connections, file endpoints, permissions, and pinned directories; running terminals and transfer tasks still belong to the original session, and subagents never implicitly inherit user authorization
- Store pinned remote project directories and create and open new DSH sessions directly from a directory
- The AI can run one-off commands, or open, read, operate, and close independent interactive terminals
- The left remote area provides a right-sidebar toggle; the directory page uses real SFTP to browse remote files, and the terminal page uses a single terminal view to observe and operate AI terminals
- The plugin service and web client are compatible with Windows, macOS, and Linux, with no dependency on local `ssh` or `sftp` commands
- First-connection host fingerprint confirmation, output caps, command timeouts, and public port bind protection
- GitHub Gist cross-device configuration sync with smart, local-first, and cloud-first policies; hosts, FTP/FTPS connections, project directories, the proxy library, the credential vault, and their credentials are all end-to-end encrypted

## Interface

The sidebar entry is named "Remote" and is registered through the official `sidebar.footer.action`. The browser compatibility layer only anchors this entry above the official Workspace area; it does not replace `sidebar.workspaces`, and automatically stays in the official Footer when the anchor is unavailable. The button to the right of the Remote title and the collapse-bar icon toggle the SSH right sidebar; the first item after expanding, "SSH Panel", opens the full management workspace, and beneath it only the SSH connections already authorized for the current DSH session are shown. Clicking a host opens the right sidebar and switches directly to that remote. Switching to another session automatically exits the management workspace; you can also use the back button at the top-left of the workspace.

The management workspace is split into two parts:

1. Left remote tree: clicking a host only selects it and expands its pinned directories while automatically collapsing other hosts; a separate "Mount / Unmount" button on the right decides whether the current DSH session can access that host, so browsing the terminal never accidentally changes AI permissions. Click a directory row anywhere to pin it; click an already-pinned directory again to unpin it; each host can pin at most one directory. The add button after a directory creates and opens a new session directly. The bottom uniformly sets "Commands Only / Terminal Control" and pre-execution confirmation.
2. Right workspace: by default the terminal and the SFTP of the current host or project directory are shown side by side, with no need to switch between two pages; SFTP waits until the terminal's first successful connection before reading the remote directory. Drag the divider between the two columns to adjust the SFTP width, double-click to restore the default, and the ratio is saved in the current browser. You can also enter port forwarding, the credential vault, the proxy library, and settings. SFTP supports browsing, preview, download, per-row delete, and multi-file sequential upload triggered by drag-and-drop or the file picker; dragging a file into a directory on the same host completes the move via native rename, only cross-endpoint drag-and-drop creates a copy task, and dragging back into the original directory creates no task. Same-name files are confirmed one by one for skip or overwrite, with a 512 MB limit per file. The embedded file preview can open a standalone preview window via the enlarge button next to the download button.

"File Transfer" is a standalone workspace tab. Each task page defaults to two panes and can switch to 2–4 columns. Each pane first shows the unified SFTP, FTP, and FTPS connection list; the remote directory is read only after you click a connection, and you can return to the connection list at any time. The name, size, and modified-time headers all toggle between ascending and descending, and directories always stay on top. Each file or directory row shows two quick buttons — "Download to Local" and delete — on hover or keyboard focus; files download directly as a stream, directories are archived to `.tar` in real time, and both use independent protocol connections that neither occupy the current directory's browsing session nor stage full content on DSH disk. Files can also be dragged to another pane or a specific directory, or selected and sent with "Transfer to Next Pane", so keyboard and touch environments do not depend on dragging. Dragging into a directory within the same endpoint is a move; cross-endpoint drag-and-drop is a copy; directories cannot be moved into themselves or their own subdirectories. Browsing panes reuse their own protocol sessions while transfer tasks use independent connections, keeping large files off the directory-browsing control channel; task cards show accumulated elapsed time while running, then pin the total duration and completion time afterwards. After a task completes, fails, or is cancelled, only the corresponding target directory is refreshed, promptly presenting the complete or partially written result. A delete confirmation can be opened directly from the end of any file or directory row; directories use recursive deletion with depth and count caps that never follows symbolic links. Closing the page does not interrupt server-side tasks; when the DSH process stops, tasks are cancelled uniformly and both ends' connections are released.

The workspace uses a single-responsibility adaptive shell layout within the plugin. Wide containers use two columns; below 820px the remote tree switches to a left drawer, and below 520px SFTP secondary information and action density are further compressed. Responsive decisions use container queries, so phones, desktop split-screen, and narrow DSH panels share one set of behavior.

The SSH plugin does not add buttons to the chat title bar. The right sidebar is opened uniformly from the left "Remote" area; when the current session has no authorized hosts yet, guidance is shown. The commands-only permission shows the SFTP directory; the terminal-control permission shows both the SFTP directory and AI terminals. Multiple terminals are switched via compact tabs, and running terminals accept keyboard input. When you enter an SFTP subdirectory, that directory synchronously becomes the working directory for subsequent `ssh_exec` calls and new terminals.

The new-connection and edit-connection forms provide "Test Connection". The test uses the not-yet-saved form content directly and can validate credential-vault credentials, HTTP/SOCKS5 proxies, and the ordered jump chain; the host fingerprint on first connection is also confirmed inside the form. Testing never temporarily creates a Profile and never writes credentials into the configuration file.

## AI Tools

| Tool | Purpose |
| --- | --- |
| `ssh_list` | Lists only the connections authorized for the current DSH session |
| `ssh_set_cwd` | Sets and verifies the working directory on a given host for the current session |
| `ssh_exec` | Executes a one-off remote command |
| `ssh_terminal_open` | Opens an SSH terminal exclusive to the current Agent |
| `ssh_terminal_send` | Sends text to a terminal and waits for output to settle |
| `ssh_terminal_read` | Reads the terminal scrollback buffer page by page |
| `ssh_terminal_signal` | Sends an allowed POSIX signal |
| `ssh_terminal_close` | Closes a terminal |
| `ssh_forward_list` | Lists the forwarding rules of authorized connections |
| `ssh_forward_start` | Starts an existing forwarding rule |
| `ssh_forward_stop` | Stops an existing forwarding rule |
| `file_endpoint_list` | Lists only the FTP/FTPS/SFTP endpoints explicitly authorized for the current DSH session |
| `file_directory_list` | Browses remote directories on authorized endpoints |
| `file_transfer_start` | Starts an asynchronous streaming file or directory transfer between endpoints |
| `file_transfer_status` | Queries the progress of transfer tasks owned by the current session |
| `file_transfer_cancel` | Cancels transfer tasks owned by the current session |

Tools always resolve session authorization from `exec.agent.session.id`. SSH command permission and file permission are independent: file endpoints must be authorized separately, with a choice of "Browse Only" or "Allow Cross-Endpoint Transfer". The model cannot bypass authorization through parameters, nor enumerate the hosts, file endpoints, terminals, or transfer tasks of other DSH sessions. Overwriting a target file is never inferred by default; `file_transfer_start` uses the `fail` conflict policy by default. File browsing and cross-endpoint transfer must prefer the `file_*` tools; temporarily starting an HTTP service over SSH, opening ports, or encoding transfers through the terminal is not allowed. If the user asks to download to the local browser, the model directly prompts them to pick the file under "SSH → File Transfer" and click "Download to Local".

"Pre-execution Confirmation" depends on the approval policy of the current DSH session: the Ask policy of Workspace Write shows a confirmation; Full Access uses the Never policy, shows no confirmation, and rejects outright any operation the SSH plugin has flagged as requiring approval. To execute SSH directly under Full Access, turn this switch off.

## Credentials & Security

Ordinary connection profiles are stored in the atomic JSON file specified by `statePath`. The following sensitive fields are written only to the `dsh-ssh/<profile-id>` Grant Record in DSH `ctx.credentials`:

- SSH passwords
- Private keys
- Private key passphrases
- Proxy passwords
- FTP passwords

Credential-vault entries use their own `dsh-ssh-vault/<credential-id>` Grant Record. SSH Profiles store only a `credentialId` and never copy or read back plaintext from the vault. Vault entries still referenced by connections cannot be deleted.

Proxy-library entries are stored in the state file, with proxy passwords kept in their own `dsh-ssh-proxy/<proxy-id>` Grant Record. After an SSH Profile selects a common proxy it stores only a `proxyId`; proxies still referenced by hosts cannot be deleted. Existing inline HTTP/SOCKS5 configurations remain compatible.

FTP Profiles are stored separately from SSH Profiles. An FTP Profile's own password uses the `dsh-ftp/<profile-id>` Grant Record, and it may also reference an existing password-type credential-vault entry. Plain FTP is clearly marked as unencrypted in the UI; FTPS validates certificates by default. FTP uses passive mode only and ignores addresses in PASV responses that would change the target host, avoiding FTP Bounce/SSRF.

The management API and Web UI return only whether a field is configured and its field name — never any credential value. Port listening on non-loopback addresses is denied by default; if listening on `0.0.0.0` is genuinely required, it must be explicitly enabled under "Remote → Settings".

The first connection rejects unknown host keys and displays the SHA-256 fingerprint. Only after the user confirms is the fingerprint written into the Profile, and subsequent connections compare it strictly.

## GitHub Gist Configuration Sync

All sync options live under "Remote → SSH Panel → Settings". GitHub OAuth Device Flow is used by default: after clicking "Connect GitHub", the plugin first shows a one-time device code and a copy button inside DSH, then the user opens GitHub's official device authorization page from the same authorization window and pastes the code; the access token is written directly into the DSH credential service by the server, never passing through the browser and never appearing in the sync state file. A Personal Access Token is kept only in "Advanced Authorization Settings" as a fallback.

Device Flow requires a GitHub OAuth App Client ID belonging to the plugin publisher. The Client ID itself is not a secret and may be distributed publicly; the Client Secret must not be written into the plugin, and this flow does not need a Client Secret. On first setup:

1. Create an OAuth App in GitHub Developer Settings.
2. Enable Device Flow in the OAuth App settings.
3. Fill the Client ID into "Advanced Authorization Settings"; after saving, "Connect GitHub" is ready to use.

If the network where DSH runs cannot reach GitHub directly, fill in "GitHub Outbound Proxy" under "Local Runtime Settings" on the same page and run the network test first. That address is stored only in the local SSH state and does not participate in Gist sync; `http://` and `https://` proxies are supported. When left empty, the plugin reads `DSH_SSH_GITHUB_PROXY`, `HTTPS_PROXY`, and `https_proxy` in that order. The settings page does not save proxy URLs containing a username and password; configure authenticated proxies via the `DSH_SSH_GITHUB_PROXY` environment variable.

Authorization requests only the `gist` scope. The fallback classic personal access token also needs the `gist` scope; whether a fine-grained token works depends on GitHub's current permission support for Gists. The Gist ID may be left empty; on first sync the plugin automatically creates a private Gist. To keep configuration metadata such as host addresses from being exposed, the plugin rejects public Gists.

Sync scope:

- SSH hosts, FTP/FTPS connections, and pinned remote project directories
- The proxy library and proxy passwords
- Credential-vault metadata, plus passwords, private keys, and key passphrases
- SSH/FTP passwords stored on the connections themselves and inline proxy passwords

The following have a clear local-machine boundary and are never synced:

- The current DSH session's host/file authorizations, permissions, and working directory
- Local port-forwarding rules
- Public port binds, command timeouts, and maximum output limits
- The GitHub Token and the sync encryption password itself

Sensitive fields are encrypted before leaving DSH: a key is derived from the sync encryption password via scrypt, and data is sealed with AES-256-GCM; the Gist contains no plaintext passwords or private keys. The sync encryption password must be at least 6 characters; a dedicated password of 12 or more characters is still recommended. This password cannot be recovered from the Gist; a new device must enter the same password, and if it is lost you can only rebuild the sync configuration.

The three policies only decide the conflict direction when both sides have changed:

- `Smart`: merge by each entry's update time, using delete tombstones to prevent an old device from resurrecting deleted entries.
- `Local First`: when both sides modified, use the current device's configuration.
- `Cloud First`: when both sides modified, use the Gist configuration.

When a blank new device first connects to an existing Gist, it always safely pulls from the cloud first, and will not overwrite existing configuration just because "Local First" was chosen. Auto sync runs after plugin startup, about 3 seconds after locally syncable configuration changes, and in the background every 5 minutes; tasks execute serially to avoid concurrent overwrites.

Before overwriting the side that may lose data, the plugin creates an explicit backup file in the same Gist and keeps 0–50 copies according to settings. That count controls only the `dsh-ssh.backup.*.json` files; the Gist revision history maintained by GitHub itself cannot be pruned by the plugin.

The settings page shows the cloud Gist revision SHA most recently returned by GitHub (displayed in short form, with the full value kept in the tooltip). Creating, uploading, downloading, merging, or running a connection test all refresh this cloud revision; it is the real Gist revision, not a fixed data-schema version number.

## DSH Configuration

After installing the package, the bundle inserts the default configuration:

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

The plugin depends on the current DSH's `credentials` and `tools` services. Browser management additionally needs the Web Profile's `webServer`; browser terminals and AI terminals are managed internally by the plugin and isolated by owner, without depending on a `terminals` service that does not exist in the Host Root.

## Development & Packaging

```bash
npm install
npm test
npm pack --pack-destination dist
```

The runtime requires Node.js 22.19+ or Node.js 24+, and is aligned with the DSH `0.1.1-rc.2` interfaces.

## Terminal Isolation Notes

Browser terminals and AI terminals share the same connection Profile and credentials, but are not the same terminal instance:

- Browser terminals are held by the plugin's same-origin management API and cleaned up after the page closes or an idle timeout elapses.
- AI terminals are held by the plugin, partitioned by `sessionId`. The Web Profile's official Terminal service lives in each Agent Preset's private Realm, and host plugins cannot register a Backend across Realms, so the plugin implements SSH terminal isolation using the same owner-scoped rules, cleaning up uniformly on plugin uninstall or process exit.
- Browser terminals and the right-side "SSH Activity" share an independent terminal transport layer. Output prefers a resumable SSE long connection for real-time push, falling back to cursor-based incremental polling only when the browser or reverse proxy does not support streaming responses.
- Keyboard input is sent concurrently with sequence numbers, and the server writes to the TTY in order; transient network failures retry with the same sequence number, reducing queueing delay from HTTP round trips while avoiding out-of-order concurrent input.
- AI terminal creation events notify the Web client through a per-session isolated SSE event stream. The first subscription does not replay old terminals; reconnects resend missed events according to the event cursor.

This boundary keeps browser users and the model from contending for the same TTY, and also obeys DSH's ownership rule that terminals are not shared across Agents.

The session authorization mode directly constrains the tools visible to the model: choosing "Commands Only" hides the interactive terminal tools; choosing "Terminal Control" hides `ssh_exec`, and remote commands must go through `ssh_terminal_open` / `ssh_terminal_send`, so input and output appear in the right-side SSH Activity. The execution layer validates permissions again; direct calls cannot bypass it.
