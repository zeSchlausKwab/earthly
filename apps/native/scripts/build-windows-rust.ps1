$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
Push-Location $RootDir
try {
  $env:CARGO_INCREMENTAL = "0"
  if ($env:RUSTFLAGS) {
    $env:RUSTFLAGS = "-C debuginfo=0 $($env:RUSTFLAGS)"
  } else {
    $env:RUSTFLAGS = "-C debuginfo=0"
  }

  cargo build -p earthly-ffi --release
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $OutDir = Join-Path $RootDir "apps\native\windows\lib"
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $SourceDll = Join-Path $RootDir "target\release\earthly_ffi.dll"
  $DestDll = Join-Path $OutDir "earthly_ffi.dll"
  Copy-Item -Force $SourceDll $DestDll
  Get-Item $DestDll | Format-Table Name, Length, LastWriteTime
} finally {
  Pop-Location
}
