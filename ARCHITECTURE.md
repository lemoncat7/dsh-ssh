# DSH SSH architecture

This plugin is split into four boundaries. UI code never reaches SSH or file transports directly, and server code never depends on the DSH client runtime.

Browser uploads use XHR byte progress and wait for the successful server response before marking the remote save complete. Downloads use `client-download.ts` when the client exposes File System Access in a secure context: the picker runs within user activation, the response is streamed to the selected writable file, progress counts acknowledged writes, and completion waits for `close()`. Unknown or encoded lengths do not produce guessed percentages. Cancellation, HTTP/auth failures, length mismatches, disk-write errors and close failures never report completion; partial writes are aborted. No full-file Blob buffering is used. Without a client save API (including Desktop hosts lacking that capability), native link downloads remain available but their result is explicitly unknown, with no progress bar or false completion. The legacy `download-progress.ts` server endpoint remains for older loaded clients only; current clients never poll it. These transient client transfers are not resumable jobs after page/server restart.

FTP LIST timestamps are retained as `modifiedAtText` when MLSD timestamps are unavailable; no timezone/year is guessed and no per-entry MDTM/CWD probes are added to directory listing. Regular file sizes remain the listing-provided byte counts; directory sizes are not recursively computed.

## Runtime boundaries

### DSH integration

- `src/index.ts` registers the plugin and its server capabilities.
- `src/client.tsx` is the browser composition root. It only owns DSH slot registration, top-level workspace selection, and cross-feature navigation.
- `src/workspace-ownership.ts` keeps the conversation and details slots mutually exclusive without modifying DSH itself.

### Server application

- `src/api.ts` translates HTTP routes into explicit store, terminal, file-transfer, forwarding, and credential operations.
- `src/store.ts` owns persistent SSH configuration.
- `src/group-proxy.ts` owns group configuration validation and host-over-group route precedence; `src/connector.ts` resolves the chosen shared proxy and its credentials for all new SSH connections. Group proxy references block unsafe deletion, and group records participate in portable sync without rewriting individual host routes.
- `src/workspace-refresh.ts` coordinates shared, non-overlapping revision checks and retryable list refreshes; `src/use-workspace-refresh.ts` owns browser visibility/focus scheduling. The revision endpoint reads an in-memory token, never credentials or cloud data. Editors retain their local draft state while collections refresh.
- `src/gist-sync.ts` owns portable configuration snapshots, encrypted secret export/import, three-way conflict resolution, tombstones, explicit backups, and serialized background synchronization.
- `src/github-device-auth.ts` owns the bounded GitHub Device Flow state machine. Device codes remain server-side and completed access tokens are written directly to the credential service.
- `src/session-access.ts` and `src/tools.ts` define the session authorization boundary used by AI tools.
- `src/remote-files.ts` defines the protocol-neutral endpoint and remote filesystem contract.
- `src/sftp-adapter.ts` and `src/ftp-adapter.ts` implement that contract without leaking protocol details upward.
- `src/network-dialer.ts` owns routed TCP creation for FTP control and passive data connections.
- `src/endpoint-session-manager.ts` owns sequential, idle-reaped browser pane sessions.
- FTP listing consumes LIST/MLSD metadata without per-entry CWD probes. Unknown/link navigability is resolved only on explicit navigation or single-entry stat; recursive transfers still skip links. Filename sorts share a reusable collator on each runtime, and browser panes retain virtualized rows for large directories. FTP must still receive the complete directory listing from the server; this is not wire-level pagination.
- `src/file-transfer-manager.ts` owns bounded asynchronous jobs, recursive scans, stream backpressure, progress, cancellation, and cleanup.
- `src/session-file-download.ts` owns bounded foreground downloads into the owning session directory. It reuses protocol adapters, validates local boundaries, streams into private staging files, and publishes with an exclusive hard link so existing targets are never overwritten. Tool visibility, approval and live session authorization stay in `src/file-transfer-tools.ts`; downloads are not background transfer jobs.
- `src/connector.ts`, `src/terminal.ts`, `src/sftp.ts`, and `src/forwards.ts` retain SSH-specific resources and cleanup.

### Browser features

- `src/locales/messages.ts` owns the UI-only Chinese/English catalog, with explicit namespaced keys and numbered interpolation parameters. Selected English copy is adapted from [knownasmobin's PR #2](https://github.com/lemoncat7/dsh-ssh/pull/2) (MIT); none of that PR's backend translations are included.
- `src/i18n.ts` owns pure formatting and the per-browser-module locale store. `src/ssh-locale-binding.ts` optionally consumes DSH's active locale and disposes subscriptions; absent/unsupported locale services fall back to Chinese without preventing plugin startup. `src/use-ssh-locale.ts` subscribes React components without replacing their keys or resource-owning effects. Locale-only changes never trigger terminal reconnection, preview reloading or writes to saved configuration.
- Translate presentation only: filesystem paths, protocol punctuation, state discriminants, group identities and user input never go through translation. Generated transfer-tab names keep their existing stored representation and are translated at render time. Backend errors and tool descriptions remain unchanged in this phase; a future error-code presentation layer must not infer codes from arbitrary error prose.
- `test/i18n.test.mjs` verifies keys, parameter parity and that the entire server import graph cannot reach translation modules. `scripts/verify-i18n.mjs` exercises live language switching with preserved forms, groups, tags, stored transfer tabs and connected terminals at mobile/desktop widths. The preview regression additionally verifies that language changes preserve editor identity, dirty drafts and scroll position.

- `src/activity-panel.tsx` owns the session-scoped details panel and terminal observation lifecycle.
- `src/profile-editor.tsx` owns connection editing, validation, jump chains, and deletion safeguards.
- `src/remote-workspace-tree.tsx` owns host mounting, fixed directories, and remote-session creation.
- `src/sftp-client.tsx` owns directory browsing, upload, preview, and download.
- `src/terminal-bootstrap-echo.ts` removes only exact per-connection tagged initialization echoes (including PTY/readline double echo). It stops on an explicit completion marker, flushes original bytes on mismatch/timeout/close, and caps pending data. It does not clear terminal output or filter execution errors; normal user input bypasses filtering after initialization.
- `src/terminal-shell-integration.ts` owns a bounded, read-only shell detection probe and session-only Bash/Zsh directory reporting hooks for browser terminals. It never edits remote startup files. `src/terminal-directory.ts` validates OSC directory metadata; `src/terminal-session.tsx` owns parser registration and cleanup. Terminal tabs retain independent directory state, and only the focused tab drives SFTP follow. Following is debounced, pauses during file/path interactions, and never persists navigation into host configuration.
- `src/use-file-preview.ts` owns preview request serialization, cancellation, metadata polling, stale-result protection and scroll restoration. Inline and expanded previews share one refresh state; content rendering is memoized independently of request status.
- `src/preview-refresh-control.tsx` renders the shared manual/automatic refresh control; `src/html-file-preview.tsx` isolates static HTML through script-disabled sandboxing and restrictive CSP, strips active/navigation elements, and owns HTML/source scroll state. No raw HTML is inserted into the host DOM.
- `src/markdown-preview-editor.tsx` owns rich Markdown editing; `src/use-markdown-draft.ts` owns drafts and save state. Readonly/refresh state never discards dirty content. `src/markdown-file.ts` handles validation, hashes and writer exclusion; local and SFTP adapters separately own boundary checks, staging, metadata preservation and atomic replacement. These routes are UI-only and do not register new agent tools.
- `src/file-transfer-workspace.tsx` owns transfer task tabs, 2–4 file panes, cross-pane actions, job feedback, and file authorization UI.
- `src/ftp-profile-editor.tsx` owns FTP/FTPS connection editing and validation.
- `src/resizable-split.tsx` owns the terminal/SFTP split and persisted sizing.
- `src/terminal-workspace.tsx` owns host-scoped tab identities and two-pane layout. Tabs stay mounted when switching pages/hosts within the open workbench; closing the workbench releases its browser terminals. Narrow panes stack vertically. Each host has at most 8 tabs, and the server limits active plus opening browser terminals to 32.
- `src/terminal-session.tsx` owns one browser terminal lifecycle. xterm is created only on connection, pending opens are cleaned up after unmount, hidden tabs slow their polling fallback, and commands are reviewed before explicit execution into that tab only.
- `src/commands.ts` owns command validation and serialized persistence (500 records, 16,000 characters each). `src/commands-panel.tsx` owns the editor/list reused by the command page and terminal picker. Commands are deliberately local to this DSH instance and excluded from Gist; terminal input is never automatically recorded.
- `src/project-mounts.ts` owns multi-project reference validation and the legacy single-project fallback. Mounted projects are separate from the one default cwd. References follow edits/deletions, regular session forks copy them, and host revocation removes them. Mounts are directory bookmarks/context, not a filesystem sandbox or a new authorization grant.
- `src/workbench-pages.css` aligns workspace headers, content surfaces, lists, and responsive terminal layouts to the file-transfer page's existing material tokens; it adds no animation runtime or font dependency.
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
| Activity-panel open state, view and selected host | per-session browser controller | plugin lifetime |
| Open dialog and transient pane state | React feature component | component lifetime |
| Terminal/SFTP split width | `ResizableSplit` | browser local storage |

## Invariants

- The plugin uses only public DSH slots and injected client services; it does not patch DSH source code.
- A tool call must pass the session access boundary before reaching SSH resources.
- SSH command permission and remote-file permission are independent; authorizing one never implies the other.
- A regular user fork copies the parent session grant once, before prompt assembly. Existing child grants win, live terminals/jobs are never copied, and `origin: subagent` lineage is excluded.
- FTP control and passive data sockets use the same route policy. FTPS wraps both socket classes with verified TLS.
- Passive data sockets are paused after dialling: proxy negotiation may leave them flowing, and listing/download bytes must remain buffered until the FTP preliminary response attaches the receiving pipeline. The regression test sends data before that control reply and checks repeated list/stat navigation.
- `ftp-listing-client.ts` handles servers returning empty/factless MLSD listings: verify through LIST in the requested working directory and reuse LIST for that connection. Listing never issues per-entry metadata probes. LIST dates retain their server text instead of guessing a timezone/year.
- File-transfer layout v3 defaults to one pane (including migration from v2). Explicit 1–4 pane choices persist; a single pane has no next-pane transfer action.
- Remote-to-remote transfers use backpressured streams and never stage a complete file on local disk.
- Browser browsing sessions and transfer job sessions are isolated so a long transfer cannot block pane navigation.
- `transfer-task-list.tsx` provides the shared transfer task container and browser-I/O rows. The file workspace merges remote and browser tasks into one active-first queue; compact SFTP views reuse the same container/styles. Client file writes are not passed to the remote-to-remote scheduler. Only an acknowledged local file close produces a completed download; native handoffs remain unconfirmed.
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
# Session-local and browser uploads

- `endpoint-upload.ts` owns bounded streaming, temporary remote names, size verification and commit for FTP/FTPS/SFTP uploads. Existing target names are rejected by the adapter; FTP rename cannot guarantee exclusive commit against unrelated concurrent writers.
- `session-file-upload.ts` restricts Agent reads to regular files within the current DSH session directory, checks permission throughout streaming, and cancels on disposal. Local upload and download are separate opt-in session grants, in addition to transfer and endpoint permissions. Existing sessions default to neither grant.
- Browser file uploads originate from the user's selected files, not the DSH host directory, and use the shared browser transfer task list. Sent bytes and remote-save acknowledgment are distinct states. Files are streamed without whole-file buffering; single files are capped at 512 MiB with a five-minute operation limit.
