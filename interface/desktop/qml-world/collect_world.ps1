# Build a world-only web bundle: world.html plus exactly what it references.
# Output default: interface/desktop/qml-world/dist/world
param(
  [string]$Out = "$PSScriptRoot\dist\world"
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$web = Join-Path $repo "interface\web"
$engine = Join-Path $repo "engine"
$target = Join-Path $Out "web"
$engineTarget = Join-Path $Out "engine"

if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
New-Item -ItemType Directory -Path $target | Out-Null
New-Item -ItemType Directory -Path $engineTarget | Out-Null

# world page and only its own UI files
Copy-Item -LiteralPath (Join-Path $web "world.html") -Destination $target
New-Item -ItemType Directory -Path (Join-Path $target "styles") -Force | Out-Null
foreach ($name in @("world-controls.css", "world-social.css", "scene-world.css")) {
  Copy-Item -LiteralPath (Join-Path $web "styles\$name") -Destination (Join-Path $target "styles\$name") -Force
}

New-Item -ItemType Directory -Path (Join-Path $target "js\scene\world") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $target "js\scene\world") -Force | Out-Null
Copy-Item -Path (Join-Path $web "js\scene\world\*") -Destination (Join-Path $target "js\scene\world") -Recurse
Copy-Item -LiteralPath (Join-Path $web "js\scene\world-controls.js") -Destination (Join-Path $target "js\scene\world-controls.js")

# engine source referenced by world.html; assets are added selectively below
foreach ($dir in @("math", "character", "graphics", "world", "formats", "render")) {
  Copy-Item -LiteralPath (Join-Path $engine $dir) -Destination (Join-Path $engineTarget $dir) -Recurse
}

$modelSource = Join-Path $engine "assets\models\furina"
$modelTarget = Join-Path $engineTarget "assets\models\furina"
New-Item -ItemType Directory -Path $modelTarget -Force | Out-Null
Copy-Item -Path (Join-Path $modelSource "*") -Destination $modelTarget -Recurse

Copy-Item -LiteralPath (Join-Path $engine "assets\all_animations.glb") `
  -Destination (Join-Path $engineTarget "assets\all_animations.glb")

$size = (Get-ChildItem $Out -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host "world bundle: $Out ($([math]::Round($size / 1MB, 1)) MB)"
