# Free Galatea Code - installatore per Windows / Windows installer
# Uso / Usage:
#   irm https://raw.githubusercontent.com/fedenardi1/free-galatea-code/master/installa.ps1 | iex
#
# Cosa fa / What it does:
#   1. controlla che ci sia Node.js (>= 20) / checks for Node.js
#   2. scarica l'ultima versione del repo / downloads the latest repo zip
#   3. la mette in %LOCALAPPDATA%\FreeGalateaCode / extracts it there
#   4. crea un collegamento sul Desktop / creates a Desktop shortcut
#   5. la avvia / launches it

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  Free Galatea Code - installazione" -ForegroundColor Green
Write-Host ""

# 1. Node
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "  Serve Node.js (gratis, 2 minuti). Ti apro la pagina di download:" -ForegroundColor Yellow
  Write-Host "  Node.js is required. Opening the download page:" -ForegroundColor Yellow
  Start-Process "https://nodejs.org/it/download"
  Write-Host "  Installa Node e rilancia questo comando. / Install Node, then run this again."
  return
}
$vNode = (node --version) -replace 'v',''
if ([int]($vNode.Split('.')[0]) -lt 20) {
  Write-Host "  Il tuo Node e' la $vNode, serve almeno la 20. Aggiorna da https://nodejs.org" -ForegroundColor Yellow
  return
}
Write-Host "  Node $vNode trovato."

# 2. scarica / download
$dest = Join-Path $env:LOCALAPPDATA "FreeGalateaCode"
$zip = Join-Path $env:TEMP "free-galatea-code.zip"
Write-Host "  Scarico l'ultima versione... / Downloading..."
Invoke-WebRequest "https://github.com/fedenardi1/free-galatea-code/archive/refs/heads/master.zip" -OutFile $zip

# 3. estrai / extract
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
$tmp = Join-Path $env:TEMP ("galatea-" + [guid]::NewGuid().ToString("N"))
Expand-Archive $zip -DestinationPath $tmp
Move-Item (Join-Path $tmp "free-galatea-code-master") $dest
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Write-Host "  Installata in $dest"

# 4. collegamento sul Desktop / desktop shortcut
$desktop = [Environment]::GetFolderPath("Desktop")
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop "Free Galatea Code.lnk"))
$lnk.TargetPath = Join-Path $dest "avvia.cmd"
$lnk.WorkingDirectory = $dest
$lnk.Save()
Write-Host "  Collegamento creato sul Desktop. / Desktop shortcut created."

# 5. rizzo-pii (facoltativo / optional): il motore ML di anonimizzazione di Simone Rizzo.
#    Se lo installi e lo avvii, Galatea lo trova da sola su 127.0.0.1:5005 e lo usa
#    al posto delle regex interne. / If installed and running, Galatea auto-detects it.
$rizzo = Read-Host "  Vuoi anche rizzo-pii (anonimizzatore ML di Simone Rizzo)? Apro la pagina ufficiale [s/N]"
if ($rizzo -match '^[sSyY]') {
  Start-Process "https://github.com/Rizzo-AI-Academy/rizzo-pii/releases/latest"
  Write-Host "  Scarica l'installer dalla pagina che si e' aperta: e' il suo progetto, si installa da li'."
}

# 6. via / go
Write-Host ""
Write-Host "  Fatto! Si apre su http://localhost:4318" -ForegroundColor Green
Write-Host "  (le chiavi API si mettono dall'ingranaggio, in basso a sinistra)"
Write-Host ""
Start-Process (Join-Path $dest "avvia.cmd") -WorkingDirectory $dest
