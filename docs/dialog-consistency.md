# Dialog consistency

`Dialog` owns the shared accessible title/description and closing behavior.
`dialog.css`, loaded after feature styles, owns common chrome: surface tokens,
14px radius, title typography, header/content insets and action sizes. Feature
styles retain only content layout and purpose-specific dimensions.

- Confirmation (440px): host, FTP connection, credential, proxy, pinned directory,
  saved command, file/directory deletion; terminal close, unsaved-draft decisions,
  transfer conflict and file download.
- Forms: host, credential, proxy, forwarding, group proxy, pinned directory,
  saved command and GitHub device authorization retain their content requirements.
- Larger work surfaces: FTP manager, session access, command picker, session
  workspace picker and directory/file preview retain browsing space but share chrome.

Do not introduce browser `confirm()` dialogs. `useConfirmationDialog` provides
target capture, in-flight protection and visible retryable failures for simple
asynchronous destructive actions. Complex deletion dialogs retain dependency
checks and use the same confirmation variant. Set `dismissible={false}` while
busy to prevent close animations from hiding a request that is still running.

`scripts/verify-i18n.mjs` checks light/dark confirmations and host forms at phone
and desktop widths, landscape scrolling, long names, cancellation and retries.
`scripts/verify-preview-refresh.mjs` covers preview/edit/refresh state retention.
Browser fixtures stub host primitives; icons and host focus/portal behavior
must also be checked in the installed DSH application.
