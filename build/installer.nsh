!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var MirlumeDesktopCheckbox
Var MirlumeDesktopShortcutChoice

!macro customInit
  ; Default to creating a shortcut, including for silent installations.
  StrCpy $MirlumeDesktopShortcutChoice ${BST_CHECKED}
!macroend

!macro customPageAfterChangeDir
  ; Display this optional choice in the assisted installer.
  Page custom MirlumeShortcutPageCreate MirlumeShortcutPageLeave
!macroend

; The uninstaller is compiled in a separate NSIS pass with BUILD_UNINSTALLER.
; Its pages never call these installer-only functions, which otherwise trigger
; NSIS warning 6010 (fatal under electron-builder).
!ifndef BUILD_UNINSTALLER
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
  ${NSD_Check} $MirlumeDesktopCheckbox
  nsDialogs::Show
FunctionEnd

Function MirlumeShortcutPageLeave
  ${NSD_GetState} $MirlumeDesktopCheckbox $MirlumeDesktopShortcutChoice
FunctionEnd
!endif

!macro customInstall
  ; electron-builder still creates the Start Menu entry by itself.
  ; Handle desktop choice here instead of its unconditional shortcut setting.
  ${If} $MirlumeDesktopShortcutChoice == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\Mirlume.lnk" "$INSTDIR\Mirlume.exe"
  ${Else}
    Delete "$DESKTOP\Mirlume.lnk"
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Mirlume.lnk"
!macroend
