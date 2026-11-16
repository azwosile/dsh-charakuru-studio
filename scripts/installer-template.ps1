$ErrorActionPreference = 'Stop'
try {
    $self = [IO.File]::ReadAllText($env:CHARAKURU_INSTALLER_SELF)
    $marker = '::CHARAKURU_PACKAGE_BASE64::'
    $encoded = $self.Substring($self.LastIndexOf($marker) + $marker.Length).Trim()
    $bytes = [Convert]::FromBase64String($encoded)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
    $expected = '__PACKAGE_SHA256__'
    if ($actual -ne $expected) { throw 'Embedded package checksum mismatch. Download the installer again.' }
    if ($env:CHARAKURU_INSTALLER_MODE -eq '/check') {
        Write-Host ('CHECK OK: embedded package SHA256 ' + $actual)
        Write-Host 'Check only: no extraction, installation, or profile changes.'
        exit 0
    }
    Write-Host 'Charakuru Studio 0.1.0 - desktop profile installer'
    Write-Host 'Please fully quit DeepSeek Harness before installation.'
    $candidates = @($env:DSH_NODE_EXECUTABLE, 'D:\DSH官方\DeepSeek Harness.exe', "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe", "$env:ProgramFiles\DeepSeek Harness\DeepSeek Harness.exe")
    $exe = $null
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $entry = Join-Path (Split-Path $candidate) 'resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'
            $archive = Join-Path (Split-Path $candidate) 'resources\app.asar'
            if (Test-Path -LiteralPath $archive -PathType Leaf) { $exe = $candidate; break }
        }
    }
    if (-not $exe) {
        Add-Type -AssemblyName System.Windows.Forms
        $picker = New-Object System.Windows.Forms.OpenFileDialog
        $picker.Title = 'Select DeepSeek Harness.exe'
        $picker.Filter = 'DeepSeek Harness|DeepSeek Harness.exe'
        try {
            if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'No Desktop executable selected.' }
            $exe = $picker.FileName
        } finally { $picker.Dispose() }
        $archive = Join-Path (Split-Path $exe) 'resources\app.asar'
        if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw 'Desktop resources/app.asar was not found beside the selected executable.' }
        $entry = Join-Path (Split-Path $exe) 'resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'
    }
    $cache = Join-Path $env:LOCALAPPDATA ('CharakuruStudio\installers\0.1.0\' + $actual.Substring(0, 12))
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $package = Join-Path $cache 'dsh-charakuru-studio-0.1.0.tgz'
    [IO.File]::WriteAllBytes($package, $bytes)
    $log = Join-Path $cache ('install-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
    Write-Host ('Desktop: ' + $exe)
    Write-Host 'Calling official Desktop CLI: plugin --profile desktop add <local-package>'
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $exe
    $start.Arguments = '--expose-internals "' + $entry + '" plugin --profile desktop add "' + $package + '"'
    $start.WorkingDirectory = $cache
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.CreateNoWindow = $true
    $start.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
    $process = [Diagnostics.Process]::Start($start)
    $outputTask = $process.StandardOutput.ReadToEndAsync()
    $errorTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $outputText = $outputTask.Result
    $errorText = $errorTask.Result
    $exitCode = $process.ExitCode
    $process.Dispose()
    [IO.File]::WriteAllText($log, $outputText + [Environment]::NewLine + $errorText)
    Write-Host $outputText
    if ($errorText) { Write-Host $errorText }
    Write-Host ('Log: ' + $log)
    if ($exitCode -ne 0) { throw ('Official CLI returned exit code ' + $exitCode + '. See the log above. Existing plugin selections and script approvals were not manually changed by this installer.') }
    Write-Host 'Package command completed. Reopen Desktop and check Charakuru Studio in Plugins.'
    Write-Host 'Existing plugins, including dsh-purge, were retained. No dependency scripts were auto-approved.'
    exit 0
} catch {
    Write-Host ('INSTALL ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
