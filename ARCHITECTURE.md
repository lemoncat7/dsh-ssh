# DSH SSH architecture

This plugin is split into four boundaries. UI code never reaches SSH or file transports directly, and server code never depends on the DSH client runtime.

## Runtime boundaries

### DSH integration

- `src/index.ts` registers the plugin and its server capabilities.
- `src/client.tsx` is the browser composition root. It only owns DSH slot registration, top-level workspace selection, and cross-feature navigation.
- `src/workspace-ownership.ts` keeps the conversation and details slots mutually exclusive without modifying DSH itself.

### Server application

- `src/api.ts` translates HTTP routes into explicit store, terminal, file-transfer, forwarding, and credential operations.
- `src/store.ts` owns persistent SSH configuration.
- `src/gist-sync.ts` owns portable configuration snapshots, encrypted secret export/import, three-way conflict resolution, tombstones, explicit backups, and serialized background synchronization.
- `src/github-device-auth.ts` owns the bounded GitHub Device Flow state machine. Device codes remain server-side and completed access tokens are written directly to the credential service.
- `src/session-access.ts` and `src/tools.ts` define the session authorization boundary used by AI tools.
- `src/remote-files.ts` defines the protocol-neutral endpoint and remote filesystem contract.
- `src/sftp-adapter.ts` and `src/ftp-adapter.ts` implement that contract without leaking protocol details upward.
- `src/network-dialer.ts` owns routed TCP creation for FTP control and passive data connections.
- `src/endpoint-session-manager.ts` owns sequential, idle-reaped browser pane sessions.
- `src/file-transfer-manager.ts` owns bounded asynchronous jobs, recursive scans, stream backpressure, progress, cancellation, and cleanup.
- `src/connector.ts`, `src/terminal.ts`, `src/sftp.ts`, and `src/forwards.ts` retain SSH-specific resources and cleanup.

### Browser features

- `src/activity-panel.tsx` owns the session-scoped details panel and terminal observation lifecycle.
- `src/profile-editor.tsx` owns connection editing, validation, jump chains, and deletion safeguards.
- `src/remote-workspace-tree.tsx` owns host mounting, fixed directories, and remote-session creation.
- `src/sftp-client.tsx` owns directory browsing, upload, preview, and download.
- `src/file-transfer-workspace.tsx` owns transfer task tabs, 2–4 file panes, cross-pane actions, job feedback, and file authorization UI.
- `src/ftp-profile-editor.tsx` owns FTP/FTPS connection editing and validation.
- `src/resizable-split.tsx` owns the terminal/SFTP split and persisted sizing.
- `src/ui-components.tsx` provides shared dialog, field, segment, and empty-state behavior.

### Transport

- `src/terminal-transport.ts` is the browser stream client.
- `src/terminal-stream.ts` and `src/terminal-io.ts` provide ordered server-side output and input.
- `src/activity-events.ts` announces session terminal lifecycle changes.

## State ownership

| State | Owner | Persistence |
| --- | --- | --- |
| SSH profiles, proxy library, credential vault, remote projects | server store | profile data + DSH credential service; encrypted Gist snapshot when enabled |
| FTP/FTPS profiles | server store | profile data + DSH credential service; encrypted Gist snapshot when enabled |
| Gist ID, strategy, tombstones, last sync summary | Gist sync service | local metadata file |
| GitHub token and sync encryption passphrase | Gist token vault | local DSH credential service only |
| OAuth Client ID and last observed Gist revision | Gist sync service | local metadata file; neither is secret |
| Mounted hosts, permission, fixed directories | session access store | per DSH session |
| Authorized file endpoints and file permission | session access store | per DSH session |
| Browser file control sessions | endpoint session manager | process lifetime, 60-second idle reap |
| File transfer jobs | file transfer manager | process lifetime |
| Browser terminal process | terminal manager | process lifetime |
| Active panel, selected host, open dialog | React feature component | browser lifetime |
| Terminal/SFTP split width | `ResizableSplit` | browser local storage |

## Invariants

- The plugin uses only public DSH slots and injected client services; it does not patch DSH source code.
- A tool call must pass the session access boundary before reaching SSH resources.
- SSH command permission and remote-file permission are independent; authorizing one never implies the other.
- FTP control and passive data sockets use the same route policy. FTPS wraps both socket classes with verified TLS.
- Remote-to-remote transfers use backpressured streams and never stage a complete file on local disk.
- Browser browsing sessions and transfer job sessions are isolated so a long transfer cannot block pane navigation.
- Secrets are write-only from the browser and are never returned by profile APIs.
- Portable sync never exports session grants, forwarding rules, or local runtime settings. Passwords and private keys are encrypted with AES-256-GCM before network I/O; the token and encryption passphrase never enter the snapshot.
- GitHub authorization requests only the `gist` scope. The browser receives a one-time user code and flow identifier, never the OAuth access token or GitHub device code.
- OAuth、GitHub 身份校验、Gist API 与原始 Gist 下载共享同一个出站传输层。传输层按请求读取本机代理设置，因此修改代理无需重启；代理连接池在地址变化和插件卸载时会释放。
- Sync operations are serialized. A blank device bootstraps from an existing cloud snapshot, while subsequent divergent edits use a base digest and tombstone-aware deterministic merge.
- Terminal input is sequenced and terminal resources are explicitly disposed on close or unmount.
- Visual motion uses `transform` and `opacity`, remains interruptible, and is disabled by `prefers-reduced-motion`.
- Filesystem paths are treated as remote paths unless a value is explicitly named as a DSH local workspace.

## Review findings addressed in 1.2

- Split the former browser monolith into activity, profile editing, shared UI, remote tree, SFTP, and layout modules.
- Replaced overlapping polling intervals with completion-based, visibility-aware scheduling.
- Centralized modal focus trapping, Escape handling, unique accessible labels, and focus restoration.
- Grouped the long SSH connection form into connection, authentication, and route sections.
- Established shared motion tokens and reduced-motion fallbacks without adding an animation runtime dependency.

Future feature work should extend the closest feature module instead of adding unrelated state or styles to `client.tsx`.
