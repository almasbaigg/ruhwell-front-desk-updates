!include "FileFunc.nsh"
; Ruhwell Front Desk installer extras (Windows, electron-builder NSIS).
; customCheckAppRunning replaces electron-builder's "is the app running?" step, which runs before the old
; version is removed. Here we: 1) close the app (and any older Ruhwell app) gently, then for sure,
; 2) copy the saved data to a dated safety folder and check the copy; if copying existing data fails, stop.
; customInstall (after the new files are in) removes old/duplicate Ruhwell startup entries for this user.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /IM "Ruhwell Front Desk.exe" /T'
  nsExec::Exec 'taskkill /IM "Ruhwell Messenger.exe" /T'
  Sleep 1500
  nsExec::Exec 'taskkill /F /IM "Ruhwell Front Desk.exe" /T'
  nsExec::Exec 'taskkill /F /IM "Ruhwell Messenger.exe" /T'
  Sleep 800
  IfFileExists "$APPDATA\Ruhwell Front Desk\Data\*.*" 0 rfd_nodata
    ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
    StrCpy $R9 "$APPDATA\Ruhwell Front Desk Backups\before update $2-$1-$0 $4$5$6"
    CreateDirectory "$R9"
    ClearErrors
    CopyFiles /SILENT "$APPDATA\Ruhwell Front Desk\Data\*.bin" "$R9"
    CopyFiles /SILENT "$APPDATA\Ruhwell Front Desk\Data\*.json" "$R9"
    IfFileExists "$APPDATA\Ruhwell Front Desk\Data\History\*.*" 0 +2
      CopyFiles /SILENT "$APPDATA\Ruhwell Front Desk\Data\History" "$R9"
    IfFileExists "$APPDATA\Ruhwell Front Desk\Data\Activity\*.*" 0 +2
      CopyFiles /SILENT "$APPDATA\Ruhwell Front Desk\Data\Activity" "$R9"
    IfFileExists "$APPDATA\Ruhwell Front Desk\Data\Faxes\*.*" 0 +2
      CopyFiles /SILENT "$APPDATA\Ruhwell Front Desk\Data\Faxes" "$R9"
    IfFileExists "$APPDATA\Ruhwell Front Desk\Data\Backups\*.*" 0 +2
      CopyFiles /SILENT "$APPDATA\Ruhwell Front Desk\Data\Backups" "$R9"
    IfErrors 0 rfd_copied
      MessageBox MB_OK|MB_ICONSTOP "Ruhwell Front Desk couldn't make a safety copy of your data, so the update was stopped. Nothing was changed. Please try again, or restart the computer first."
      Quit
    rfd_copied:
  rfd_nodata:
!macroend

!macro customInstall
  nsExec::Exec 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$k=\"HKCU:\Software\Microsoft\Windows\CurrentVersion\Run\"; $$a=\"HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run\"; $$p=Get-ItemProperty -Path $$k -ErrorAction SilentlyContinue; if($$p){ foreach($$n in $$p.PSObject.Properties){ if($$n.Name -notlike \"PS*\" -and $$n.Name -ne \"Ruhwell Front Desk\" -and ($$n.Name -match \"ruhwell\" -or [string]$$n.Value -match \"ruhwell\")){ Remove-ItemProperty -Path $$k -Name $$n.Name -ErrorAction SilentlyContinue; Remove-ItemProperty -Path $$a -Name $$n.Name -ErrorAction SilentlyContinue } } }"'
!macroend
