; douyin-dl Windows 安装包脚本（Inno Setup 6）
; 编译：ISCC.exe installer\installer.iss  →  dist\douyin-dl-setup-<版本>.exe

#define MyAppName "douyin-dl"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "douyin-dl"
#define MyAppExeName "douyin-dl.exe"

[Setup]
AppId={{D6A5C1E2-4B3F-9A87-8C21-5E9F0A7B3D44}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; 无需管理员权限，装到用户目录，朋友双击即可安装
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=douyin-dl-setup-{#MyAppVersion}
SetupIconFile=app.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#MyAppName}
LicenseFile=LICENSE.txt

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式(&D)"; GroupDescription: "附加任务:"

[Files]
Source: "..\dist\douyin-dl.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "立即启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Messages]
; 中文界面由 ChineseSimplified.isl 提供；以下补充安装向导关键文案
SetupAppTitle=安装 - {#MyAppName}
SetupWindowTitle=安装 - {#MyAppName}
SelectDirDesc=douyin-dl 安装位置
SelectDirLabel3=安装程序将把 [name] 安装到下列文件夹。
