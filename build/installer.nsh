; Custom NSIS installer script for AdventShow.
; The app + installer are signed with a real Azure Trusted Signing certificate, so
; there is NOTHING to import into the Windows trust store — Windows already trusts
; the publisher. (Older builds imported a self-signed cert here; that is obsolete and
; the Root-store fallback needed admin rights, which would break the silent per-user
; auto-update. Removed.)
;
; Kept minimal: electron-builder's one-click NSIS already creates Start Menu +
; Desktop shortcuts (createDesktopShortcut/createStartMenuShortcut in
; electron-builder.json5), so we don't duplicate them here.

!macro customInstall
!macroend

!macro customUnInstall
!macroend
