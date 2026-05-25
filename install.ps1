<#
.SYNOPSIS
StarDownload Installer for Windows
Installs the native host and registers it with Chrome / Edge
#>

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nativeDir = Join-Path $scriptDir "native"

Write-Host "======================================"
Write-Host "  StarDownload Installer (Windows)"
Write-Host "======================================"
Write-Host ""

# --------------- helper: create registry key recursively ---------------
function New-RegistryKey {
    param([string]$Path)
    $parts = $Path -split '\\'
    $current = ''
    foreach ($part in $parts) {
        if ($current -eq '') {
            $current = $part
        } else {
            $current = "$current\$part"
        }
        if (!(Test-Path $current)) {
            New-Item -Path $current -Force | Out-Null
        }
    }
}

# --------------- step 1: check Python ---------------
Write-Host "1/4 Checking Python..."

$pythonCmd = $null

# Try py launcher first (bypasses Microsoft Store redirect on Windows)
if (Get-Command py -ErrorAction SilentlyContinue) {
    $pythonCmd = "py"
}
# Fall back to finding real python.exe (not the Store stub)
if (-not $pythonCmd) {
    $possiblePaths = @()
    # Check common install locations
    foreach ($ver in @(313, 312, 311, 310, 39, 38)) {
        $possiblePaths += "C:\Python$ver\python.exe"
        $possiblePaths += "$env:LOCALAPPDATA\Programs\Python\Python$ver\python.exe"
    }
    foreach ($p in $possiblePaths) {
        if (Test-Path $p) { $pythonCmd = $p; break }
    }
}

# Still not found - try winget
if (-not $pythonCmd) {
    Write-Host "Python not found. Installing via winget..."
    winget install Python.Python.3 --accept-source-agreements --accept-package-agreements
    # Try py launcher again after winget install
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $pythonCmd = "py"
    } else {
        foreach ($p in $possiblePaths) {
            if (Test-Path $p) { $pythonCmd = $p; break }
        }
    }
}

if (-not $pythonCmd) {
    Write-Error "Failed to install Python. Please install manually: https://www.python.org/downloads/"
    exit 1
}
Write-Host "  Found: Python via $pythonCmd ($(& $pythonCmd --version))"

# --------------- step 2: install dependencies ---------------
Write-Host ""
Write-Host "2/4 Installing dependencies (yt-dlp, ffmpeg)..."

Write-Host "  Installing yt-dlp..."
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    & $pythonCmd -m pip install --upgrade yt-dlp *>$null
} catch {}
$ErrorActionPreference = $prevEAP
if ($LASTEXITCODE -ne 0) {
    Write-Warning "yt-dlp install may have failed, continuing..."
}

# Add Python Scripts dir to PATH so yt-dlp is accessible
$scriptsDir = & $pythonCmd -c "import sysconfig; print(sysconfig.get_path('scripts'))" 2>$null
if ($scriptsDir) {
    $env:PATH = "$scriptsDir;$env:PATH"
}

Write-Host "  Checking ffmpeg..."
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    try {
        winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
    } catch {
        Write-Warning "ffmpeg auto-install failed. Please install manually: https://ffmpeg.org/download.html"
    }
} else {
    Write-Host "  ffmpeg already installed"
}

# --------------- step 3: copy native host ---------------
Write-Host ""
Write-Host "3/4 Installing native host..."

$installDir = Join-Path $env:APPDATA "StarDownload"
if (!(Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

$nativeScript = Join-Path $nativeDir "stardownload.py"
if (Test-Path $nativeScript) {
    Copy-Item $nativeScript -Destination (Join-Path $installDir "stardownload.py") -Force
    Write-Host "  Installed to $installDir\stardownload.py"
} else {
    Write-Error "Cannot find native\stardownload.py"
    exit 1
}

# --------------- step 4: register native messaging host ---------------
Write-Host ""
Write-Host "4/4 Registering browser Native Host..."

# Write the manifest JSON file (registry points to this file)
$manifestJson = @{
    name = "com.stardownload.host"
    description = "StarDownload Native Host for YouTube Downloads"
    path = "$installDir\stardownload.py"
    type = "stdio"
    allowed_origins = @("chrome-extension://<YOUR_EXTENSION_ID>/")
}
$manifestPath = Join-Path $installDir "com.stardownload.host.json"
$manifestJson | ConvertTo-Json | Set-Content -Path $manifestPath -Encoding UTF8
Write-Host "  Manifest written to: $manifestPath"

# Create registry key for each detected browser (value = manifest file path)
$browsers = @()
if (Get-ItemProperty -Path "HKCU:\Software\Google\Chrome" -ErrorAction SilentlyContinue) {
    Write-Host "  Detected: Chrome"
    $browsers += @{ Name = "Chrome"; RegKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.stardownload.host" }
}
if (Get-ItemProperty -Path "HKCU:\Software\Microsoft\Edge" -ErrorAction SilentlyContinue) {
    Write-Host "  Detected: Edge"
    $browsers += @{ Name = "Edge"; RegKey = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.stardownload.host" }
}

if ($browsers.Count -eq 0) {
    Write-Host "  No Chrome or Edge detected. Skipping registry registration."
    Write-Host "  To register manually, add this key to the registry:"
    Write-Host "  HKCU\Software\Google\Chrome\NativeMessagingHosts\com.stardownload.host"
    Write-Host "  Value: $manifestPath"
} else {
    foreach ($browser in $browsers) {
        $parentKey = Split-Path $browser.RegKey -Parent
        try {
            New-RegistryKey $parentKey
            New-Item -Path $browser.RegKey -Force | Out-Null
            Set-ItemProperty -Path $browser.RegKey -Name "(default)" -Value $manifestPath
            Write-Host "  $($browser.Name): registered"
        } catch {
            Write-Error "$($browser.Name): registration failed - $_"
        }
    }
}

# --------------- done ---------------
Write-Host ""
Write-Host "======================================"
Write-Host "  Installation complete!"
Write-Host "======================================"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Open Chrome/Edge, go to chrome://extensions/"
Write-Host "  2. Enable Developer mode (top-right toggle)"
Write-Host "  3. Click Load unpacked, select: $scriptDir"
Write-Host "  4. Copy the extension ID from the extensions page"
Write-Host "  5. Edit $manifestPath"
Write-Host "     Replace the extension ID in allowed_origins with your actual ID"
Write-Host ""
