# Free Galatea Code - avvio automatico con Windows / start with Windows
# Uso / usage (dalla cartella dell'app / from the app folder):
#   .\avvio-automatico.ps1           -> installa / installs
#   .\avvio-automatico.ps1 -Rimuovi  -> disinstalla / uninstalls
#
# Crea un'attivita' pianificata che lancia il server (nascosto) al tuo accesso a
# Windows, cosi' le attivita' schedulate di Galatea girano anche senza aprire nulla.
# Creates a logon scheduled task running the server hidden, so Galatea's
# scheduled tasks run without opening anything.

param([switch]$Rimuovi)

$nome = "FreeGalateaCode"
$qui = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Rimuovi) {
  schtasks /delete /tn $nome /f | Out-Null
  Write-Host "Avvio automatico rimosso. / Autostart removed."
  return
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host "Serve Node.js. / Node.js required."; return }

$comando = "`"$node`" `"$qui\server.mjs`""
schtasks /create /f /tn $nome /sc onlogon /rl limited /tr "cmd /c start /min `"`" $comando" | Out-Null
Write-Host "Fatto: Galatea partira' (nascosta) a ogni accesso a Windows, su http://localhost:4318"
Write-Host "Done: Galatea will start hidden at every Windows logon, on http://localhost:4318"
Write-Host "Per toglierla / to remove:  .\avvio-automatico.ps1 -Rimuovi"
