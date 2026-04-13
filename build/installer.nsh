; Custom NSIS installer script for AdventShow
; Imports the self-signed certificate into Windows Trusted Root CA store on install
; Removes it on uninstall

!include "MUI2.nsh"

!macro customInstall
  ; Import the self-signed certificate into Trusted Root Certification Authorities
  DetailPrint "Importing AdventShow certificate into Trusted Root store..."
  nsExec::ExecToLog 'certutil -addstore "TrustedPublisher" "$INSTDIR\resources\adventshow.crt"'
  Pop $0
  ${If} $0 != 0
    ; Try Root store as fallback (requires admin)
    nsExec::ExecToLog 'certutil -addstore "Root" "$INSTDIR\resources\adventshow.crt"'
    Pop $0
  ${EndIf}
  DetailPrint "Certificate import completed (exit code: $0)"
!macroend

!macro customUnInstall
  ; Remove the certificate from trusted stores on uninstall
  DetailPrint "Removing AdventShow certificate from trusted stores..."
  nsExec::ExecToLog 'certutil -delstore "TrustedPublisher" "AdventShow"'
  nsExec::ExecToLog 'certutil -delstore "Root" "AdventShow"'
!macroend
