@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title ML-Scratch
set "STAMP=.venv\.installed-1.0.0"

echo ==================================================
echo   ML-Scratch 一鍵啟動
echo ==================================================

rem ---------- 檢查 Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js，請先安裝 LTS 版本：https://nodejs.org/
  pause
  exit /b 1
)

rem ---------- 尋找 Python（建議 3.12 / 3.11）----------
set "PY="
for %%V in (3.12 3.11 3.10) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>nul && set "PY=py -%%V"
  )
)
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo [錯誤] 找不到 Python，請安裝 Python 3.12：https://www.python.org/downloads/
  echo        安裝時請勾選 "Add python.exe to PATH"
  pause
  exit /b 1
)

rem ---------- 第一次執行：建立虛擬環境並安裝 AI 套件 ----------
if not exist ".venv\Scripts\python.exe" (
  echo [1/4] 建立 Python 虛擬環境...
  %PY% -m venv .venv || goto :fail
)
set "VPY=.venv\Scripts\python.exe"

if not exist "%STAMP%" (
  echo [2/4] 安裝 AI 套件（第一次約需 5-15 分鐘，視網路速度而定）...
  "%VPY%" -m pip install --upgrade pip || goto :fail
  where nvidia-smi >nul 2>nul
  if errorlevel 1 (
    echo       未偵測到 NVIDIA 顯示卡，安裝 CPU 版 PyTorch
    "%VPY%" -m pip install torch torchvision || goto :fail
  ) else (
    echo       偵測到 NVIDIA 顯示卡，安裝 CUDA 版 PyTorch
    "%VPY%" -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126 || goto :fail
  )
  "%VPY%" -m pip install -r backend\requirements.txt || goto :fail
  echo       安裝本機 LLM 執行環境 llama.cpp...
  "%VPY%" -m pip install llama-cpp-python --only-binary llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
  if errorlevel 1 echo [警告] llama.cpp 安裝失敗，「LLM 對話」節點將無法使用，其餘功能不受影響
  echo done> "%STAMP%"
)

rem ---------- 前端 ----------
if not exist "node_modules\electron" (
  echo [3/4] 安裝介面套件...
  call npm install || goto :fail
)
echo [4/4] 建置介面並啟動...
call npm run build || goto :fail
call npx electron .
exit /b 0

:fail
echo.
echo [錯誤] 安裝或啟動失敗，請把上方訊息截圖回報。
pause
exit /b 1
