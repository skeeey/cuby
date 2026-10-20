@echo off
rem Reset the packaged Cuby session state: onboarding progress, localStorage
rem (guidanceCompleted), the login session, and logs all live in %APPDATA%\Cuby
rem (the current era) or %APPDATA%\Memmy (the Memmy era).
rem Use this to re-run the first-run guidance (e.g. to verify onboarding changes).
rem
rem This is not a full reset, and the halves are not interchangeable. What it
rem leaves behind in %USERPROFILE%\.memmy or %USERPROFILE%\.cuby — the model
rem config and the workspace — is the half the app reads to choose its first
rem screen. So clearing this directory alone gives a signed-out machine with its
rem model config intact, while clearing the model config alone, or clearing the
rem two out of step, leaves a machine that still holds a session and boots to
rem the API-key page instead of the login form. To start from a state as new as
rem a fresh install, run scripts\clear-all-windows.ps1, which clears both.

choice /C YN /N /M "This closes Cuby (and legacy Memmy) and deletes their %APPDATA% state. Continue? (Y/N)"
if errorlevel 2 exit /b 0

taskkill /F /IM Cuby.exe >nul 2>&1
taskkill /F /IM Memmy.exe >nul 2>&1
rem Process teardown is asynchronous; give it a moment before deleting its files.
timeout /t 2 /nobreak >nul

for %%D in (Cuby Memmy) do (
  if exist "%APPDATA%\%%D" (
    rmdir /s /q "%APPDATA%\%%D"
    echo Deleted %APPDATA%\%%D
  ) else (
    echo Nothing to delete: %APPDATA%\%%D does not exist
  )
)

rem Keep the window open when double-clicked, so the outcome is visible.
pause
