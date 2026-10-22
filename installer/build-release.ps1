# Builds ClaudeWake-Setup-<version>.exe.
# Steps: bundle clasp into one file (it does not load from node_modules under a Hebrew path),
# collect the app into build\app, then compile with Inno Setup.
param([string]$Version = '1.0.0')
$ErrorActionPreference = 'Stop'
$inst = $PSScriptRoot
$root = Split-Path -Parent $inst
$out  = Join-Path $inst 'build'
$app  = Join-Path $out 'app'
$deps = Join-Path $inst '.deps'
function Step($t) { Write-Host "== $t" }

Step 'clean'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
foreach ($d in 'app\lib', 'app\web', 'app\script', 'app\clasp', 'runtime') { New-Item -ItemType Directory -Force -Path (Join-Path $app $d) | Out-Null }

Step 'bundle clasp (esbuild)'
if (-not (Test-Path (Join-Path $deps 'node_modules\@google\clasp'))) {
  New-Item -ItemType Directory -Force -Path $deps | Out-Null
  Push-Location $deps
  try {
    if (-not (Test-Path 'package.json')) { Set-Content 'package.json' '{"name":"claude-wake-build","private":true}' -Encoding ASCII }
    & npm install --no-audit --no-fund @google/clasp@3.4.1 esbuild@0.24.2
    if ($LASTEXITCODE) { throw 'npm install failed' }
  } finally { Pop-Location }
}
Push-Location $deps
try {
  $banner = "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);"
  & npx --no-install esbuild node_modules/@google/clasp/build/src/index.js --bundle --platform=node --format=esm --target=node22 `
      "--outfile=$app\app\clasp\clasp.mjs" "--banner:js=$banner" --log-level=warning
  if ($LASTEXITCODE) { throw 'esbuild failed' }
} finally { Pop-Location }

Step 'app files'
Copy-Item (Join-Path $root 'app\server.mjs') (Join-Path $app 'app')
Copy-Item (Join-Path $root 'app\lib\*') (Join-Path $app 'app\lib')
Copy-Item (Join-Path $root 'app\web\*') (Join-Path $app 'app\web')
Copy-Item (Join-Path $root 'src\Code.gs'), (Join-Path $root 'src\appsscript.json') (Join-Path $app 'app\script')
Copy-Item (Join-Path $inst 'launcher.vbs') $app
& (Join-Path $inst 'make-icon.ps1') -Out (Join-Path $inst 'icon.ico')
Copy-Item (Join-Path $inst 'icon.ico') $app
Set-Content -Path (Join-Path $app 'version.txt') -Value $Version -Encoding ASCII

Step 'node runtime'
Copy-Item (Get-Command node).Source (Join-Path $app 'runtime\node.exe')

Step 'smoke test'
$node = Join-Path $app 'runtime\node.exe'
& $node --check (Join-Path $app 'app\server.mjs'); if ($LASTEXITCODE) { throw 'server.mjs invalid' }
$help = & $node --no-warnings --use-system-ca (Join-Path $app 'app\clasp\clasp.mjs') --help 2>&1 | Out-String
if ($help -notmatch 'create-deployment') { throw "bundled clasp does not run:`n$help" }

Step 'compile installer'
$iss = Join-Path $inst 'claude-wake.iss'
$text = [IO.File]::ReadAllText($iss, [Text.Encoding]::UTF8)
[IO.File]::WriteAllText($iss, $text, (New-Object Text.UTF8Encoding $true))   # Inno Setup needs a BOM for Hebrew
$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 not found' }
& $iscc "/DAppVersion=$Version" $iss
if ($LASTEXITCODE) { throw 'ISCC failed' }
$exe = Get-Item (Join-Path $inst "output\ClaudeWake-Setup-$Version.exe")
$hash = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash.ToLower()
Set-Content -Path ($exe.FullName + '.sha256') -Value "$hash  $($exe.Name)" -Encoding ASCII
Write-Host ("built: {0} ({1:N1} MB)" -f $exe.FullName, ($exe.Length / 1MB))
Write-Host "SHA256: $hash"
