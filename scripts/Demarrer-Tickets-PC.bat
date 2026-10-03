@echo off
chcp 65001 >nul
title Tickets 2.0 — PC
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est requis pour la version PC.
  echo Installez-le depuis https://nodejs.org puis relancez.
  pause
  exit /b 1
)

if not exist "node_modules\@capacitor\core" (
  echo Installation des dependances...
  call npm install
  if errorlevel 1 (
    echo Echec de npm install.
    pause
    exit /b 1
  )
)

echo.
echo  Tickets 2.0 — version PC
echo  Ouvrez : http://127.0.0.1:4173
echo  Laissez cette fenetre ouverte pendant l'utilisation.
echo.

start "" "http://127.0.0.1:4173"
node scripts/preview.mjs
pause
