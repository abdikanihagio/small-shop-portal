# Creates a certificate so the Shop Portal uses HTTPS (encrypted connections).
# Run from the "Small shop" folder:   powershell -ExecutionPolicy Bypass -File scripts\create-https-cert.ps1
# Then restart the portal. It will start on https://localhost:3000 (or https://<this PC's IP>:3000).
#
# The certificate is "self-signed": browsers show a warning until each device trusts it.
#   - On this PC, add -TrustOnThisPc (Windows asks you to confirm).
#   - On tablets/phones, open data\tls\portal.cer on the device and install it as a trusted certificate.
param(
  [switch]$TrustOnThisPc,
  [int]$Years = 3
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$tlsDir = Join-Path $root 'data\tls'
New-Item -ItemType Directory -Force -Path $tlsDir | Out-Null

# Names the devices will use to reach this PC: localhost, the computer name and its network addresses.
$names = @('localhost', $env:COMPUTERNAME) | Where-Object { $_ } | Select-Object -Unique
$ips = @('127.0.0.1') + @(
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } |
    ForEach-Object { $_.IPAddress }
) | Select-Object -Unique
$san = (@($names | ForEach-Object { "DNS=$_" }) + @($ips | ForEach-Object { "IPAddress=$_" })) -join '&'

$cert = New-SelfSignedCertificate `
  -Subject 'CN=Small Shop Portal' `
  -FriendlyName 'Small Shop Portal' `
  -TextExtension @("2.5.29.17={text}$san", '2.5.29.37={text}1.3.6.1.5.5.7.3.1') `
  -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears($Years) `
  -CertStoreLocation 'Cert:\CurrentUser\My'

# Random password protecting the exported key file; the portal reads it from portal-pass.txt.
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pass = [Convert]::ToBase64String($bytes)
$secure = ConvertTo-SecureString -String $pass -AsPlainText -Force

Export-PfxCertificate -Cert $cert -FilePath (Join-Path $tlsDir 'portal.pfx') -Password $secure | Out-Null
Set-Content -Path (Join-Path $tlsDir 'portal-pass.txt') -Value $pass -Encoding ASCII -NoNewline
Export-Certificate -Cert $cert -FilePath (Join-Path $tlsDir 'portal.cer') | Out-Null

if ($TrustOnThisPc) {
  Import-Certificate -FilePath (Join-Path $tlsDir 'portal.cer') -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
}

# The portal uses the exported files; the copy in the personal store is no longer needed.
Remove-Item -Path ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -Confirm:$false

Write-Host ''
Write-Host 'HTTPS certificate created in data\tls\' -ForegroundColor Green
Write-Host ('  Valid for: ' + (($names + $ips) -join ', '))
Write-Host ('  Expires:   ' + $cert.NotAfter.ToString('yyyy-MM-dd'))
Write-Host ''
Write-Host 'Restart the portal (npm start). It will now use https://'
Write-Host 'Install data\tls\portal.cer on each tablet/phone so the browser trusts it.'
Write-Host 'If this PC gets a new IP address, run this script again.'
