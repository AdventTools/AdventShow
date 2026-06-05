; Custom NSIS installer script for AdventShow.
; The app + installer are signed with a real Azure Trusted Signing certificate, so
; there is NOTHING to import into the Windows trust store — Windows already trusts
; the publisher. (Older builds imported a self-signed cert here; that is obsolete and
; the Root-store fallback needed admin rights, which would break the silent per-user
; auto-update. Removed.)
;
; Desktop shortcut: macro-ul standard al electron-builder NU recreează iconița la
; UPDATE (gardă `${ifNot} ${isUpdated}` în addDesktopLink — vezi
; app-builder-lib/templates/nsis/include/installer.nsh), nici măcar cu
; createDesktopShortcut: "always". După un update care a pierdut iconița, ea nu mai
; reapărea niciodată. O creăm noi aici, la FIECARE instalare (fresh sau update) —
; CreateShortCut suprascrie dacă există deja, deci e idempotent.
; $newDesktopLink și $appExe sunt deja setate (customInstall rulează după
; addDesktopLink în installSection.nsh).

!macro customInstall
  CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
!macroend
