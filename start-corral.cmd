@echo off
chcp 65001 >nul
setlocal
title Corral - エージェント司令塔（本番）
cd /d "%~dp0"

echo ============================================
echo   Corral 起動中（本番モード）
echo ============================================
echo.

rem --- 設定を読み込む（corral.env を編集すれば変更できます） ---
if exist "corral.env" (
  for /f "usebackq delims=" %%L in ("corral.env") do (
    echo %%L | findstr /b /i "set " >nul && call %%L
  )
)
if "%CORRAL_DEMO%"=="" set CORRAL_DEMO=0
if "%CORRAL_REPO%"=="" set CORRAL_REPO=%~dp0
if "%CORRAL_MAX_CONCURRENT%"=="" set CORRAL_MAX_CONCURRENT=3
set CORRAL_PORT=4319

rem --- 依存関係（初回のみ） ---
if not exist "node_modules" (
  echo [1/3] 依存パッケージをインストールしています...
  call npm install || goto :err
) else (
  echo [1/3] 依存パッケージ: OK
)

rem --- ビルド（未ビルド時のみ。強制する場合は start-corral.cmd rebuild） ---
if /i "%1"=="rebuild" (
  echo [2/3] 再ビルドしています...
  call npm run build -w server || goto :err
  call npm run build -w web || goto :err
) else if not exist "server\dist\index.js" (
  echo [2/3] 初回ビルドをしています...
  call npm run build -w server || goto :err
  call npm run build -w web || goto :err
) else if not exist "web\dist\index.html" (
  echo [2/3] ダッシュボードをビルドしています...
  call npm run build -w web || goto :err
) else (
  echo [2/3] ビルド: OK
)

rem --- 既に起動していないか確認 ---
netstat -ano | findstr ":%CORRAL_PORT%" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo すでに起動しています。ブラウザを開きます。
  start "" "http://127.0.0.1:%CORRAL_PORT%"
  timeout /t 3 >nul
  exit /b 0
)

echo [3/3] デーモンを起動します...
echo.
if "%CORRAL_DEMO%"=="0" (
  echo   モード     : 本番（実エージェントが実際に動きます）
) else (
  echo   モード     : DEMO（疑似実行）
)
echo   対象リポジトリ: %CORRAL_REPO%
echo   同時実行上限 : %CORRAL_MAX_CONCURRENT%
echo   ダッシュボード: http://127.0.0.1:%CORRAL_PORT%
echo.
echo   ※このウィンドウを閉じると停止します
echo ============================================
echo.

rem 3秒後にブラウザを開く
start "" /min cmd /c "timeout /t 3 >nul & start "" http://127.0.0.1:%CORRAL_PORT%"

node server\dist\index.js
goto :eof

:err
echo.
echo [エラー] 起動に失敗しました。上のメッセージを確認してください。
pause
exit /b 1
