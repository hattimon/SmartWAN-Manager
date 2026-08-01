<#
.SYNOPSIS
Fixes the ASUS OpenVPN DNS conflict in OpenVPN Connect on Windows.

.DESCRIPTION
OpenVPN Connect adds a host route outside the tunnel for the VPN endpoint.
When an ASUS router also pushes that same address as the VPN DNS server,
OpenVPN Connect's DNS leak protection can block all name resolution.

This script makes timestamped backups and updates selected .ovpn profiles to:
  1. ignore DNS servers pushed by the VPN server;
  2. use the DNS servers supplied with -DnsServers.

The operation is idempotent. Certificates, keys, credentials and other
profile settings are left unchanged.

.PARAMETER ProfilePath
One or more .ovpn files. When omitted, all OpenVPN Connect user profiles
from the current Windows account are used.

.PARAMETER DnsServers
IPv4 DNS servers used while connected. Defaults to Cloudflare.

.PARAMETER FixRadminDefaultRoute
Also removes the known invalid persistent Radmin default route through
26.0.0.1. This optional operation requires an elevated PowerShell window.

.EXAMPLE
powershell.exe -ExecutionPolicy Bypass -File .\fix-openvpn-connect-windows.ps1

.EXAMPLE
.\fix-openvpn-connect-windows.ps1 -DnsServers 9.9.9.9,149.112.112.112

.EXAMPLE
.\fix-openvpn-connect-windows.ps1 -FixRadminDefaultRoute
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(ValueFromPipeline = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string[]] $ProfilePath,

    [ValidateNotNullOrEmpty()]
    [string[]] $DnsServers = @('1.1.1.1', '1.0.0.1'),

    [switch] $FixRadminDefaultRoute
)

$ErrorActionPreference = 'Stop'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-IPv4Address {
    param([string] $Address)

    $parsed = $null
    return [Net.IPAddress]::TryParse($Address, [ref] $parsed) -and
        $parsed.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork
}

foreach ($dnsServer in $DnsServers) {
    if (-not (Test-IPv4Address $dnsServer)) {
        throw "Invalid IPv4 DNS server: $dnsServer"
    }
}

if (-not $ProfilePath -or $ProfilePath.Count -eq 0) {
    $profileDirectory = Join-Path $env:APPDATA 'OpenVPN Connect\profiles'
    if (-not (Test-Path -LiteralPath $profileDirectory -PathType Container)) {
        throw "OpenVPN Connect profile directory was not found: $profileDirectory"
    }

    $ProfilePath = @(
        Get-ChildItem -LiteralPath $profileDirectory -Filter '*.ovpn' -File |
            Select-Object -ExpandProperty FullName
    )
}

if ($ProfilePath.Count -eq 0) {
    throw 'No OpenVPN profiles were found.'
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$changedProfiles = 0

foreach ($path in $ProfilePath) {
    $resolvedPath = (Resolve-Path -LiteralPath $path).Path
    $content = [IO.File]::ReadAllText($resolvedPath)

    if ($content -notmatch '(?m)^[^\S\r\n]*proto[^\S\r\n]+\S+') {
        Write-Warning "Skipped profile without a proto directive: $resolvedPath"
        continue
    }

    $lineEnding = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }
    $lines = [regex]::Split($content, '\r?\n')
    $cleanLines = @(
        foreach ($line in $lines) {
            if ($line -match '^[^\S\r\n]*pull-filter[^\S\r\n]+ignore[^\S\r\n]+"dhcp-option DNS"[^\S\r\n]*$') {
                continue
            }
            if ($line -match '^[^\S\r\n]*dhcp-option[^\S\r\n]+DNS[^\S\r\n]+\S+[^\S\r\n]*$') {
                continue
            }
            $line
        }
    )

    $dnsDirectives = @(
        'pull-filter ignore "dhcp-option DNS"'
        foreach ($dnsServer in $DnsServers) {
            "dhcp-option DNS $dnsServer"
        }
    )

    $protoIndex = -1
    for ($index = 0; $index -lt $cleanLines.Count; $index++) {
        if ($cleanLines[$index] -match '^[^\S\r\n]*proto[^\S\r\n]+\S+[^\S\r\n]*$') {
            $protoIndex = $index
            break
        }
    }

    $updatedLines = @($cleanLines[0..$protoIndex]) + $dnsDirectives
    if ($protoIndex + 1 -lt $cleanLines.Count) {
        $updatedLines += @($cleanLines[($protoIndex + 1)..($cleanLines.Count - 1)])
    }
    $updated = $updatedLines -join $lineEnding

    if ($updated -eq $content) {
        Write-Host "Already configured: $resolvedPath"
        continue
    }

    $backupPath = "$resolvedPath.backup-$timestamp"
    if ($PSCmdlet.ShouldProcess($resolvedPath, "Back up to $backupPath and apply DNS fix")) {
        Copy-Item -LiteralPath $resolvedPath -Destination $backupPath
        [IO.File]::WriteAllText(
            $resolvedPath,
            $updated,
            (New-Object Text.UTF8Encoding($false))
        )
        $changedProfiles++
        Write-Host "Fixed:  $resolvedPath"
        Write-Host "Backup: $backupPath"
    }
}

if ($FixRadminDefaultRoute) {
    if (-not (Test-Administrator)) {
        throw 'FixRadminDefaultRoute requires PowerShell to be run as Administrator.'
    }

    $routeOutput = & route.exe print -4 | Out-String
    $radminRoutePattern = '(?m)^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+26\.0\.0\.1\s+'
    if ($routeOutput -match $radminRoutePattern) {
        if ($PSCmdlet.ShouldProcess('0.0.0.0/0 via 26.0.0.1', 'Delete Radmin default route')) {
            & route.exe delete 0.0.0.0 mask 0.0.0.0 26.0.0.1
            if ($LASTEXITCODE -ne 0) {
                throw "route.exe failed with exit code $LASTEXITCODE"
            }
            Write-Host 'Removed the Radmin default route through 26.0.0.1.'
        }
    } else {
        Write-Host 'No Radmin default route through 26.0.0.1 was found.'
    }
}

Write-Host ""
Write-Host "Done. Changed profiles: $changedProfiles"
Write-Host 'Fully exit and restart OpenVPN Connect before testing.'
