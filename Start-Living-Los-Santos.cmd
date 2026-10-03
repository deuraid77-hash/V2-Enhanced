@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Living-Los-Santos.ps1"
if errorlevel 1 pause

