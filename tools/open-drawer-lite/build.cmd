@echo off
rem Compila open-drawer-lite.exe con el compilador de C# que trae Windows (.NET Framework 4), sin SDK ni internet.
rem Resultado: assets\open-drawer-lite.exe (unos pocos KB). Se versiona en git: no hace falta recompilar salvo que cambie Program.cs.
setlocal
set CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe
"%CSC%" /nologo /target:exe /optimize+ /platform:anycpu /out:"%~dp0..\..\assets\open-drawer-lite.exe" "%~dp0Program.cs"
if errorlevel 1 exit /b 1
echo OK assets\open-drawer-lite.exe
