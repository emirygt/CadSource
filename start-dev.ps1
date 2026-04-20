$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"
$pythonExe = Join-Path $backendDir "venv\Scripts\python.exe"
$frontendPython = "C:\Users\emirygt\AppData\Local\Programs\Python\Python311\python.exe"
$backendOut = Join-Path $backendDir "backend.out.log"
$backendErr = Join-Path $backendDir "backend.err.log"
$frontendOut = Join-Path $frontendDir "frontend.out.log"
$frontendErr = Join-Path $frontendDir "frontend.err.log"

if (-not (Test-Path $pythonExe)) {
    throw "Backend Python bulunamadi: $pythonExe"
}

$env:DATABASE_URL = "postgresql://postgres:password@127.0.0.1:5432/cad_search"
$env:JWT_SECRET = "local-dev-secret-change-in-production"
$env:ENVIRONMENT = "development"

try {
    Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health | Out-Null
    Write-Host "Backend zaten calisiyor: http://127.0.0.1:8000"
} catch {
    Start-Process -FilePath $pythonExe `
        -ArgumentList "-m","uvicorn","main:app","--host","127.0.0.1","--port","8000" `
        -WorkingDirectory $backendDir `
        -RedirectStandardOutput $backendOut `
        -RedirectStandardError $backendErr | Out-Null
    Start-Sleep -Seconds 3
}

try {
    Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8080/login.html | Out-Null
    Write-Host "Frontend zaten calisiyor: http://127.0.0.1:8080/login.html"
} catch {
    Start-Process -FilePath $frontendPython `
        -ArgumentList "-m","http.server","8080" `
        -WorkingDirectory $frontendDir `
        -RedirectStandardOutput $frontendOut `
        -RedirectStandardError $frontendErr | Out-Null
    Start-Sleep -Seconds 2
}

Write-Host "Backend:  http://127.0.0.1:8000"
Write-Host "Frontend: http://127.0.0.1:8080/login.html"
