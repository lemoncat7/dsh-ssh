# DSH SSH architecture

This plugin is split into four boundaries. UI code never reaches the SSH transport directly, and server code never depends on the DSH client runtime.

## Runtime boundaries

### DSH integration

- `src/index.ts` registers the plugin and its server capabilities.
- `src/client.tsx` is the browser composition root. It only owns DSH slot registration, top-level workspace selection, and cross-feature navigation.
- `src/workspace-ownership.ts` keeps the conversation and details slots mutually exclusive without modifying DSH itself.

### Server application

- `src/api.ts` translates HTTP routes into explicit store, terminal, SFTP, forwarding, and credential operations.
- `src/store.ts` owns persistent SSH configuration.
- `src/session-access.ts` and `src/tools.ts` define the session authorization boundary used by AI tools.
- `src/connector.ts`, `src/terminal.ts`, `src/sftp.ts`, and `src/forwards.ts` own long-lived resources and their cleanup.

### Browser features

- `src/activity-panel.tsx` owns the session-scoped details panel and terminal observation lifecycle.
- `src/profile-editor.tsx` owns connection editing, validation, jump chains, and deletion safeguards.
- `src/remote-workspace-tree.tsx` owns host mounting, fixed directories, and remote-session creation.
- `src/sftp-client.tsx` owns directory browsing, upload, preview, and download.
- `src/resizable-split.tsx` owns the terminal/SFTP split and persisted sizing.
- `src/ui-components.tsx` provides shared dialog, field, segment, and empty-state behavior.

### Transport

- `src/terminal-transport.ts` is the browser stream client.
- `src/terminal-stream.ts` and `src/terminal-io.ts` provide ordered server-side output and input.
- `src/activity-events.ts` announces session terminal lifecycle changes.

## State ownership

| State | Owner | Persistence |
| --- | --- | --- |
| SSH profiles, proxies, credentials, forwards | server store | profile data + DSH credential service |
| Mounted hosts, permission, fixed directories | session access store | per DSH session |
| Browser terminal process | terminal manager | process lifetime |
| Active panel, selected host, open dialog | React feature component | browser lifetime |
| Terminal/SFTP split width | `ResizableSplit` | browser local storage |

## Invariants

- The plugin uses only public DSH slots and injected client services; it does not patch DSH source code.
- A tool call must pass the session access boundary before reaching SSH resources.
- Secrets are write-only from the browser and are never returned by profile APIs.
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
