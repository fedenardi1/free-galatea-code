@echo off
title Kimi Code
cd /d "%~dp0"
start "" http://localhost:4318
node server.mjs
