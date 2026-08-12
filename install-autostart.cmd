@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set LNK=%STARTUP%\Corral.lnk

if /i "%1"=="uninstall" (
  if exist "%LNK%" (
    del "%LNK%"
    echo 自動起動を解除しました。
  ) else (
    echo 自動起動は設定されていません。
  )
  pause
  exit /b 0
)

rem Windows ログイン時に最小化で自動起動するショートカットを作成
powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%');" ^
  "$s.TargetPath='%~dp0start-corral.cmd';" ^
  "$s.WorkingDirectory='%~dp0';" ^
  "$s.WindowStyle=7;" ^
  "$s.Description='Corral エージェント司令塔（本番）';" ^
  "$s.Save()"

if exist "%LNK%" (
  echo.
  echo ✅ 自動起動を設定しました。
  echo    Windows にログインすると Corral（本番）が自動で起動します。
  echo    ダッシュボード: http://127.0.0.1:4319
  echo.
  echo    解除する場合: install-autostart.cmd uninstall
) else (
  echo [エラー] 自動起動の設定に失敗しました。
)
echo.
pause
