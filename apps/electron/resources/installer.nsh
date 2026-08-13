!include "LogicLib.nsh"
!include "MUI2.nsh"
!include "nsDialogs.nsh"

!ifdef BUILD_UNINSTALLER

Var /GLOBAL OpcAgentDeleteData
Var /GLOBAL OpcAgentDeleteDataCheckbox
Var /GLOBAL OpcAgentIsUpdated

!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.OpcAgentDataPageCreate un.OpcAgentDataPageLeave
!macroend

Function un.OpcAgentDataPageCreate
  ${If} ${Silent}
    Abort
  ${EndIf}
  ${If} $OpcAgentIsUpdated == "1"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0u 0u 100% 24u "Keep your OPC Agent data?"
  Pop $0
  ${NSD_CreateLabel} 0u 26u 100% 42u "Your configuration, encrypted credentials, workspaces, conversation history, drafts, logs, and messaging state are stored in your .opcagent folder."
  Pop $0
  ${NSD_CreateCheckbox} 0u 72u 100% 12u "Delete all OPC Agent data and configuration"
  Pop $OpcAgentDeleteDataCheckbox
  ${NSD_Uncheck} $OpcAgentDeleteDataCheckbox

  nsDialogs::Show
FunctionEnd

Function un.OpcAgentDataPageLeave
  ${NSD_GetState} $OpcAgentDeleteDataCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $OpcAgentDeleteData "1"
  ${Else}
    StrCpy $OpcAgentDeleteData "0"
  ${EndIf}
FunctionEnd

!macro customUnInit
  StrCpy $OpcAgentDeleteData "0"
  StrCpy $OpcAgentIsUpdated "0"
  ${GetParameters} $0

  ClearErrors
  ${GetOptions} $0 "--updated" $1
  ${IfNot} ${Errors}
    StrCpy $OpcAgentIsUpdated "1"
  ${EndIf}

  ClearErrors
  ${GetOptions} $0 "--delete-opcagent-data" $1
  ${IfNot} ${Errors}
    StrCpy $OpcAgentDeleteData "1"
  ${EndIf}
!macroend

!macro customUnInstall
  ; Avoid electron-builder's runtime update macro here: its uninstaller build
  ; expands through StdUtils before that plugin is available. The builder
  ; upgrade path always passes --updated to the prior uninstaller.
  ${If} $OpcAgentIsUpdated == "0"
    ${If} $OpcAgentDeleteData == "1"
      ReadEnvStr $0 "USERPROFILE"
      ${If} $0 != ""
        StrCpy $1 "$0\.opcagent"
        ${If} $1 == "$0\.opcagent"
          RMDir /r "$1"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!endif
