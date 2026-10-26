!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; electron-builder compiles this include twice: once for the uninstaller
; (BUILD_UNINSTALLER defined) and once for the regular installer.
; Declarations and page callbacks belong ONLY to the installer pass.
; Otherwise makensis emits warnings 6001/6010, which electron-builder
; treats as fatal.
!ifndef BUILD_UNINSTALLER
Var MirlumeDesktopCheckbox
Var MirlumeDesktopShortcutChoice

!macro customInit
  ; Existing installations remember the user's choice for silent updates.
  StrCpy $MirlumeDesktopShortcutChoice ${BST_CHECKED}
  ClearErrors
  ReadRegStr $0 HKCU "Software\Mirlume" "DesktopShortcut"
  ${IfNot} ${Errors}
    ${If} $0 == "0"
      StrCpy $MirlumeDesktopShortcutChoice ${BST_UNCHECKED}
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom MirlumeShortcutPageCreate MirlumeShortcutPageLeave
!macroend

Function MirlumeShortcutPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0u 0u 100% 20u "Choose whether Mirlume should place a shortcut on your desktop."
  Pop $0
  ${NSD_CreateCheckbox} 0u 26u 100% 14u "Create a desktop shortcut"
  Pop $MirlumeDesktopCheckbox
  ${If} $MirlumeDesktopShortcutChoice == ${BST_CHECKED}
    ${NSD_Check} $MirlumeDesktopCheckbox
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function MirlumeShortcutPageLeave
  ${NSD_GetState} $MirlumeDesktopCheckbox $MirlumeDesktopShortcutChoice
FunctionEnd

!macro customInstall
  ; Standard Start Menu shortcut is provided by electron-builder.
  ; Save the desktop choice so silent auto-updates respect opt-out.
  ${If} $MirlumeDesktopShortcutChoice == ${BST_CHECKED}
    WriteRegStr HKCU "Software\Mirlume" "DesktopShortcut" "1"
    CreateShortCut "$DESKTOP\Mirlume.lnk" "$INSTDIR\Mirlume.exe"
  ${Else}
    WriteRegStr HKCU "Software\Mirlume" "DesktopShortcut" "0"
    Delete "$DESKTOP\Mirlume.lnk"
  ${EndIf}
!macroend
!endif

!macro customUnInstall
  Delete "$DESKTOP\Mirlume.lnk"
  DeleteRegValue HKCU "Software\Mirlume" "DesktopShortcut"
  DeleteRegKey /ifempty HKCU "Software\Mirlume"
!macroend
