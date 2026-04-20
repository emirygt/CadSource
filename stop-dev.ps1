$ports = 8000, 8080

foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
        try {
            Stop-Process -Id $connection.OwningProcess -Force -ErrorAction Stop
            Write-Host "Port $port sureci durduruldu: PID $($connection.OwningProcess)"
        } catch {
        }
    }
}

Write-Host "Backend ve frontend surecleri durduruldu."
