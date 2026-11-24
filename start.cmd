@echo off
rem Always run from the directory that contains this script, so that a shortcut
rem or a call from another working directory still finds package.json.
cd /d "%~dp0"
npm run dev
