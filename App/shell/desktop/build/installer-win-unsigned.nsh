!include "FileFunc.nsh"
!include "getProcessInfo.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef CUBY_WM_SETTINGCHANGE
  !define CUBY_WM_SETTINGCHANGE 0x001A
!endif

!ifndef CUBY_LANG_SIMPCHINESE
  !define CUBY_LANG_SIMPCHINESE 2052
!endif

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    ; Keep unsigned QA uninstallers usable if Windows or transfer tools touch the NSIS stub.
    CRCCheck off
  !endif
!macroend

; Force per-user installation by skipping the all-users versus current-user choice and using
; %LOCALAPPDATA%\Programs\Cuby, which remains writable by the current user.
; 1) Program Files requires elevation, and a locked uninstaller can make overwrite installation fail.
; 2) Silent background upgrades use NSIS /currentuser and must match the original installation scope.
; 3) A writable per-user directory enables zero-click silent upgrades without elevation.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; electron-builder omits its own $pid declaration whenever customCheckAppRunning exists, so this
; declaration must be visible while compiling both the installer and the generated uninstaller.
Var pid

; Keep electron-builder's localized running-app prompt and its normal-then-forced termination
; retries. Force the exact-image/current-user cmd fallback instead of the default $INSTDIR prefix
; check: a custom-drive uninstaller can otherwise resolve a stale/default install directory, miss
; the live Cuby process, and delete resources underneath the tray process. _CHECK_APP_RUNNING
; aborts before file or shortcut cleanup if the process still exists after the forced retry.
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  StrCpy $IsPowerShellAvailable "1"
  !insertmacro _CHECK_APP_RUNNING
!macroend

!ifndef BUILD_UNINSTALLER
  Var MemmyTargetUserDataPath
  Var MemmyTargetRuntimeHomePath

  !macro customInit
    ${If} ${Silent}
      Call MemmyValidateSelectedDirectories
      Pop $0
      StrCmp $0 "1" memmy_custom_init_done
      SetErrorLevel 5
      Quit

      memmy_custom_init_done:
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    Page custom MemmyValidateInstallPage
  !macroend

  !macro customFinishPage
    Function MemmyStartAppAfterInstall
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION MemmyStartAppAfterInstall
    !insertmacro MUI_PAGE_FINISH
  !macroend

  !macro customInstall
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
    Call MemmyAddCliToUserPath
    Call MemmyInstallLaunchProxy
    !insertmacro MemmyPointShortcutsToLaunchProxy
  !macroend
!endif
!ifdef BUILD_UNINSTALLER
  !macro customUnInstall
    Call un.MemmyRemoveCliFromUserPath
    Call un.MemmyRemoveLaunchProxy
  !macroend
!endif

!ifndef BUILD_UNINSTALLER
Function MemmyNormalizeInstallDirectory
  ${GetFileName} "$INSTDIR" $R4
  StrCmp $R4 "${APP_FILENAME}" memmy_normalize_install_done
  StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"

  memmy_normalize_install_done:
FunctionEnd

Function MemmyResolveDataPaths
  ${GetRoot} "$INSTDIR" $0
  StrCmp $0 "" memmy_resolve_use_profile
  StrCpy $1 $0 1
  StrCmp $1 "C" memmy_resolve_use_profile
  StrCmp $1 "c" memmy_resolve_use_profile
  StrCpy $MemmyTargetRuntimeHomePath "$0\CubyData\.cuby"
  Goto memmy_resolve_runtime_done

  memmy_resolve_use_profile:
    StrCpy $MemmyTargetRuntimeHomePath "$PROFILE\.cuby"

  memmy_resolve_runtime_done:
    StrCpy $MemmyTargetUserDataPath "$APPDATA\Cuby"
FunctionEnd

; Input: $R0 is the exact directory to validate. Output: pushes "1" when
; that directory supports create/write/delete operations, else "0".
Function MemmyProbeWritableDirectory
  StrCpy $R1 ""
  StrCpy $R2 ""
  StrCpy $R3 ""
  StrCpy $R5 "0"

  IfFileExists "$R0\*.*" memmy_writable_probe_target_ready
  ClearErrors
  CreateDirectory "$R0"
  IfErrors memmy_writable_probe_failed
  StrCpy $R5 "1"

  memmy_writable_probe_target_ready:
    ClearErrors
    GetTempFileName $R1 "$R0"
    IfErrors memmy_writable_probe_failed
    Delete "$R1"
    IfErrors memmy_writable_probe_cleanup_failed
    CreateDirectory "$R1"
    IfErrors memmy_writable_probe_cleanup_failed
    StrCpy $R2 "$R1\write-test.tmp"
    FileOpen $R3 "$R2" w
    IfErrors memmy_writable_probe_cleanup_failed
    FileWrite $R3 "Cuby"
    IfErrors memmy_writable_probe_close_failed
    FileClose $R3
    StrCpy $R3 ""
    ClearErrors
    Delete "$R2"
    IfErrors memmy_writable_probe_cleanup_failed
    StrCpy $R2 ""
    ClearErrors
    RMDir "$R1"
    IfErrors memmy_writable_probe_cleanup_failed
    StrCpy $R1 ""
    ${If} $R5 == "1"
      ClearErrors
      RMDir "$R0"
      IfErrors memmy_writable_probe_failed
      StrCpy $R5 "0"
    ${EndIf}
    Push "1"
    Return

  memmy_writable_probe_close_failed:
    FileClose $R3
    StrCpy $R3 ""

  memmy_writable_probe_cleanup_failed:
    ClearErrors
    ${If} $R2 != ""
      Delete "$R2"
    ${EndIf}
    ${If} $R1 != ""
      Delete "$R1"
      RMDir "$R1"
    ${EndIf}
    ClearErrors

  memmy_writable_probe_failed:
    ${If} $R5 == "1"
      ClearErrors
      RMDir "$R0"
    ${EndIf}
    Push "0"
FunctionEnd

; Resolves and probes the selected install folder, roaming user-data folder, and
; installation-drive runtime folder. Output: pushes "1" on success, else "0".
Function MemmyValidateSelectedDirectories
  Call MemmyNormalizeInstallDirectory
  Call MemmyResolveDataPaths

  StrCpy $R0 "$INSTDIR"
  Call MemmyProbeWritableDirectory
  Pop $0
  StrCmp $0 "1" memmy_validate_user_data
  StrCpy $R8 "The selected installation folder $\"$INSTDIR$\" does not have permission. Choose another folder."
  StrCmp $LANGUAGE ${CUBY_LANG_SIMPCHINESE} 0 memmy_validate_failed
  StrCpy $R8 "当前选择的安装文件夹“$INSTDIR”没有权限，请选择其它目录。"
  Goto memmy_validate_failed

  memmy_validate_user_data:
    StrCpy $R0 "$MemmyTargetUserDataPath"
    Call MemmyProbeWritableDirectory
    Pop $0
    StrCmp $0 "1" memmy_validate_runtime
    StrCpy $R8 "The Cuby account data folder $\"$MemmyTargetUserDataPath$\" is not writable."
    StrCmp $LANGUAGE ${CUBY_LANG_SIMPCHINESE} 0 memmy_validate_failed
    StrCpy $R8 "Cuby 登录数据目录“$MemmyTargetUserDataPath”没有写入权限，无法继续安装。"
    Goto memmy_validate_failed

  memmy_validate_runtime:
    StrCpy $R0 "$MemmyTargetRuntimeHomePath"
    Call MemmyProbeWritableDirectory
    Pop $0
    StrCmp $0 "1" memmy_validate_succeeded
    StrCpy $R8 "The Cuby data folder $\"$MemmyTargetRuntimeHomePath$\" does not have permission. Choose another installation folder."
    StrCmp $LANGUAGE ${CUBY_LANG_SIMPCHINESE} 0 memmy_validate_failed
    StrCpy $R8 "当前安装位置对应的数据文件夹“$MemmyTargetRuntimeHomePath”没有权限，请选择其它安装目录。"
    Goto memmy_validate_failed

  memmy_validate_succeeded:
    Push "1"
    Return

  memmy_validate_failed:
    Push "0"
FunctionEnd

Function MemmyValidateInstallPage
  Call MemmyValidateSelectedDirectories
  Pop $0
  StrCmp $0 "1" memmy_validate_page_done
  MessageBox MB_OK|MB_ICONSTOP "$R8"
  Abort

  memmy_validate_page_done:
FunctionEnd

Function MemmyPathContains
  Exch $R1
  Exch
  Exch $R0
  StrCpy $R5 "0"
  StrLen $R2 $R1
  StrLen $R3 $R0
  StrCpy $R4 0

  memmy_path_contains_loop:
    StrCpy $R5 $R0 $R2 $R4
    StrCmp $R5 $R1 memmy_path_contains_found
    IntOp $R4 $R4 + 1
    IntCmp $R4 $R3 memmy_path_contains_not_found memmy_path_contains_loop memmy_path_contains_not_found

  memmy_path_contains_found:
    StrCpy $R5 "1"
    Goto memmy_path_contains_done

  memmy_path_contains_not_found:
    StrCpy $R5 "0"

  memmy_path_contains_done:
    Pop $R1
    Exch $R5
FunctionEnd

Function MemmyAddCliToUserPath
  StrCpy $0 "$INSTDIR\resources\cli"
  IfFileExists "$0\cuby.cmd" 0 memmy_add_cli_done
  IfFileExists "$0\cuby-memory.cmd" 0 memmy_add_cli_done

  ReadRegStr $1 HKCU "Environment" "Path"
  StrCmp $1 "" memmy_add_cli_empty

  Push ";$1;"
  Push ";$0;"
  Call MemmyPathContains
  Pop $2
  StrCmp $2 "1" memmy_add_cli_done
  WriteRegExpandStr HKCU "Environment" "Path" "$1;$0"
  Goto memmy_add_cli_broadcast

  memmy_add_cli_empty:
    WriteRegExpandStr HKCU "Environment" "Path" "$0"

  memmy_add_cli_broadcast:
    System::Call 'user32::SendMessageTimeout(i 0xffff, i ${CUBY_WM_SETTINGCHANGE}, i 0, t "Environment", i 0x0002, i 5000, *i .r0)'

  memmy_add_cli_done:
FunctionEnd

Function MemmyInstallLaunchProxy
  StrCpy $0 "$LOCALAPPDATA\Cuby\launcher"
  CreateDirectory "$0"
  SetOutPath "$0"
  File /oname=Cuby.ico "${BUILD_RESOURCES_DIR}\icon.ico"
  File /oname=CubyUpdatePrompt.ps1 "${BUILD_RESOURCES_DIR}\CubyUpdatePrompt.ps1"

  FileOpen $1 "$0\CubyLauncher.vbs" w
  FileWrite $1 "Set shell = CreateObject($\"WScript.Shell$\")$\r$\n"
  FileWrite $1 "Set fso = CreateObject($\"Scripting.FileSystemObject$\")$\r$\n"
  FileWrite $1 "appExe = $\"$INSTDIR\${PRODUCT_FILENAME}.exe$\"$\r$\n"
  FileWrite $1 "userDataRoot = shell.ExpandEnvironmentStrings($\"%APPDATA%$\") & $\"\Cuby$\"$\r$\n"
  FileWrite $1 "powerShellPath = shell.ExpandEnvironmentStrings($\"%SystemRoot%$\") & $\"\System32\WindowsPowerShell\v1.0\powershell.exe$\"$\r$\n"
  FileWrite $1 "promptPath = $\"$0\CubyUpdatePrompt.ps1$\"$\r$\n"
  FileWrite $1 "languagePath = userDataRoot & $\"\update-prompt-language.txt$\"$\r$\n"
  FileWrite $1 "markerPath = userDataRoot & $\"\prepared-required-update.json$\"$\r$\n"
  FileWrite $1 "lockPath = markerPath & $\".lock$\"$\r$\n"
  FileWrite $1 "promptMarkerPath = markerPath & $\".prompt$\"$\r$\n"
  FileWrite $1 "If fso.FolderExists(lockPath) And fso.FileExists(promptMarkerPath) Then$\r$\n"
  FileWrite $1 "  If fso.FileExists(powerShellPath) And fso.FileExists(promptPath) Then$\r$\n"
  FileWrite $1 "    shell.Run Chr(34) & powerShellPath & Chr(34) & $\" -STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $\" & Chr(34) & promptPath & Chr(34) & $\" -LockPath $\" & Chr(34) & lockPath & Chr(34) & $\" -AppExe $\" & Chr(34) & appExe & Chr(34) & $\" -LanguagePath $\" & Chr(34) & languagePath & Chr(34), 0, True$\r$\n"
  FileWrite $1 "  End If$\r$\n"
  FileWrite $1 "  WScript.Quit 0$\r$\n"
  FileWrite $1 "End If$\r$\n"
  FileWrite $1 "If fso.FolderExists(lockPath) Or Not fso.FileExists(appExe) Then$\r$\n"
  FileWrite $1 "  WScript.Quit 0$\r$\n"
  FileWrite $1 "End If$\r$\n"
  FileWrite $1 "shell.CurrentDirectory = fso.GetParentFolderName(appExe)$\r$\n"
  FileWrite $1 "shell.Run Chr(34) & appExe & Chr(34), 1, False$\r$\n"
  FileClose $1

  SetOutPath "$INSTDIR"
FunctionEnd

!macro MemmyPointShortcutsToLaunchProxy
  StrCpy $0 "$LOCALAPPDATA\Cuby\launcher"
  StrCpy $1 "$0\CubyLauncher.vbs"
  StrCpy $2 "$0\Cuby.ico"
  StrCpy $4 "0"
  IfFileExists "$1" 0 memmy_point_shortcuts_done

  StrCpy $3 "$newStartMenuLink"
  IfFileExists "$3" 0 memmy_point_desktop_shortcut
  CreateShortCut "$3" "$SYSDIR\wscript.exe" "$\"$1$\"" "$2" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  StrCpy $4 "1"

  memmy_point_desktop_shortcut:
    Push "$CMDLINE"
    Push "no-desktop-shortcut"
    Call MemmyPathContains
    Pop $5
    StrCmp $5 "1" memmy_point_shortcuts_done

    StrCmp $keepShortcuts "false" memmy_point_new_desktop_shortcut
    StrCmp $oldDesktopLink $newDesktopLink memmy_point_existing_new_desktop_shortcut
    IfFileExists "$oldDesktopLink" 0 memmy_point_existing_new_desktop_shortcut
    Rename "$oldDesktopLink" "$newDesktopLink"
    ClearErrors
    Goto memmy_point_new_desktop_shortcut

  memmy_point_existing_new_desktop_shortcut:
    IfFileExists "$newDesktopLink" 0 memmy_point_shortcuts_done

  memmy_point_new_desktop_shortcut:
    StrCpy $3 "$newDesktopLink"
    CreateShortCut "$3" "$SYSDIR\wscript.exe" "$\"$1$\"" "$2" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    StrCpy $4 "1"

  memmy_point_shortcuts_done:
    StrCmp $4 "1" 0 memmy_point_no_shortcut_refresh
    System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'

  memmy_point_no_shortcut_refresh:
!macroend
!endif

!ifdef BUILD_UNINSTALLER
Function un.MemmyRemoveCliFromUserPath
  StrCpy $0 "$INSTDIR\resources\cli"
  ReadRegStr $1 HKCU "Environment" "Path"
  StrCmp $1 "" memmy_remove_cli_done

  Push "$1"
  Push "$0;"
  Push ""
  Call un.MemmyRemovePathSegment
  Pop $1
  Push "$1"
  Push ";$0"
  Push ""
  Call un.MemmyRemovePathSegment
  Pop $1
  Push "$1"
  Push "$0"
  Push ""
  Call un.MemmyRemovePathSegment
  Pop $1
  WriteRegExpandStr HKCU "Environment" "Path" "$1"
  System::Call 'user32::SendMessageTimeout(i 0xffff, i ${CUBY_WM_SETTINGCHANGE}, i 0, t "Environment", i 0x0002, i 5000, *i .r0)'

  memmy_remove_cli_done:
FunctionEnd

Function un.MemmyRemovePathSegment
  Exch $R2
  Exch
  Exch $R1
  Exch
  Exch 2
  Exch $R0
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  StrCpy $R3 ""
  StrLen $R4 $R0
  StrLen $R5 $R1
  StrCpy $R6 0

  un_memmy_remove_path_loop:
    StrCpy $R7 $R0 $R5 $R6
    StrCmp $R7 $R1 un_memmy_remove_path_match
    StrCpy $R7 $R0 1 $R6
    StrCpy $R3 "$R3$R7"
    IntOp $R6 $R6 + 1
    IntCmp $R6 $R4 un_memmy_remove_path_done un_memmy_remove_path_loop un_memmy_remove_path_done

  un_memmy_remove_path_match:
    StrCpy $R3 "$R3$R2"
    IntOp $R6 $R6 + $R5
    IntCmp $R6 $R4 un_memmy_remove_path_done un_memmy_remove_path_loop un_memmy_remove_path_done

  un_memmy_remove_path_done:
    StrCpy $R0 $R3
    Pop $R7
    Pop $R6
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
FunctionEnd

Function un.MemmyRemoveLaunchProxy
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5

  StrCpy $R0 "$CMDLINE"
  StrCpy $R1 "keep-shortcuts"
  StrLen $R2 $R1
  StrLen $R3 $R0
  StrCpy $R4 0

  un_memmy_keep_shortcuts_loop:
    StrCpy $R5 $R0 $R2 $R4
    StrCmp $R5 $R1 un_memmy_keep_launch_proxy
    IntOp $R4 $R4 + 1
    IntCmp $R4 $R3 un_memmy_remove_launch_proxy un_memmy_keep_shortcuts_loop un_memmy_remove_launch_proxy

  un_memmy_keep_launch_proxy:
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
    Return

  un_memmy_remove_launch_proxy:
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
    ; Electron registers app.setLoginItemSettings under this per-user Run value.
    ; The keep-shortcuts upgrade branch returns above so the user's preference survives updates.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    ClearErrors
    ReadRegStr $0 SHELL_CONTEXT "Software\${APP_GUID}" "ShortcutName"
    StrCmp $0 "" 0 un_memmy_delete_old_desktop_shortcut
    StrCpy $0 "${PRODUCT_FILENAME}"

  un_memmy_delete_old_desktop_shortcut:
    Delete "$DESKTOP\$0.lnk"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ClearErrors
    RMDir /r "$LOCALAPPDATA\Cuby\launcher"
FunctionEnd
!endif
