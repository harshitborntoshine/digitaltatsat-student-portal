@echo off
title FeedbackHub - Student Feedback System
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies for the first run...
  call npm install
)
start "FeedbackHub Server" cmd /k "npm start"
timeout /t 2 /nobreak >nul
start "FeedbackHub" http://localhost:3000
