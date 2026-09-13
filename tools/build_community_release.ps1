param(
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$workspaceRoot = [System.IO.Path]::GetFullPath((Split-Path $projectRoot -Parent))
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $workspaceRoot "output\双语提示词检查器_v19_混合提示词边界增强版"
}
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$stagingRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot ".staging\bpi-v19-public-release"))

function Assert-SafeWorkspaceChild([string]$PathValue) {
    $full = [System.IO.Path]::GetFullPath($PathValue)
    $prefix = $workspaceRoot.TrimEnd('\') + '\'
    if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝操作工作区以外的路径：$full"
    }
    if ($full -eq $workspaceRoot -or $full -eq $projectRoot) {
        throw "拒绝操作工作区根目录或项目根目录：$full"
    }
}

Assert-SafeWorkspaceChild $outputRoot
Assert-SafeWorkspaceChild $stagingRoot

foreach ($target in @($outputRoot, $stagingRoot)) {
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    New-Item -ItemType Directory -Path $target | Out-Null
}

$extensionName = "ComfyUI-Bilingual-Prompt-Inspector"
$stagingExtension = Join-Path $stagingRoot $extensionName
New-Item -ItemType Directory -Path $stagingExtension | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stagingExtension "data") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stagingExtension "tools") | Out-Null

$rootFiles = @(
    "__init__.py",
    "nodes.py",
    "server.py",
    "assistant_store.py",
    "dictionary_store.py",
    "package.json",
    "README.md",
    "DEVELOPMENT_HISTORY.md",
    "LICENSE",
    "THIRD_PARTY_NOTICE.md",
    "SECURITY.md"
)
foreach ($relative in $rootFiles) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $relative) -Destination (Join-Path $stagingExtension $relative)
}

Copy-Item -LiteralPath (Join-Path $projectRoot "js") -Destination (Join-Path $stagingExtension "js") -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "data\packs") -Destination (Join-Path $stagingExtension "data\packs") -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "data\base_tags.json") -Destination (Join-Path $stagingExtension "data\base_tags.json")
Copy-Item -LiteralPath (Join-Path $projectRoot "data\LARGE_DICTIONARY_SOURCES.md") -Destination (Join-Path $stagingExtension "data\LARGE_DICTIONARY_SOURCES.md")
Copy-Item -LiteralPath (Join-Path $projectRoot "tools\build_large_dictionary.py") -Destination (Join-Path $stagingExtension "tools\build_large_dictionary.py") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "release_docs\社区分享声明.txt") -Destination (Join-Path $stagingExtension "社区分享声明.txt")

$emptyPersonalDictionary = @{
    schema_version = 1
    tags = @()
} | ConvertTo-Json -Depth 4
Set-Content -LiteralPath (Join-Path $stagingExtension "data\user_tags.json") -Value $emptyPersonalDictionary -Encoding utf8

$largeSettings = @{
    schema_version = 1
    enabled = $true
} | ConvertTo-Json -Depth 4
Set-Content -LiteralPath (Join-Path $stagingExtension "data\large_dictionary.json") -Value $largeSettings -Encoding utf8

$packSettings = @{
    schema_version = 1
    enabled = @{
        base = $true
        anima = $true
        characters = $true
        poses = $true
        camera = $true
        clothing = $true
        adult = $false
    }
} | ConvertTo-Json -Depth 6
Set-Content -LiteralPath (Join-Path $stagingExtension "data\pack_settings.json") -Value $packSettings -Encoding utf8

$extensionZip = Join-Path $outputRoot "ComfyUI-Bilingual-Prompt-Inspector-v19-public.zip"
Compress-Archive -LiteralPath $stagingExtension -DestinationPath $extensionZip -CompressionLevel Optimal

foreach ($document in @("安装说明.txt", "大型词库手动安装说明.txt", "社区分享声明.txt")) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "release_docs\$document") -Destination (Join-Path $outputRoot $document)
}

$extensionHash = (Get-FileHash -LiteralPath $extensionZip -Algorithm SHA256).Hash
Set-Content -LiteralPath (Join-Path $outputRoot "文件校验SHA256.txt") -Value "ComfyUI-Bilingual-Prompt-Inspector-v19-public.zip`r`nSHA256: $extensionHash" -Encoding utf8

$bundleStaging = Join-Path $stagingRoot "bundle"
New-Item -ItemType Directory -Path $bundleStaging | Out-Null
Copy-Item -Path (Join-Path $outputRoot "*") -Destination $bundleStaging -Force
$bundleZip = Join-Path $outputRoot "双语提示词检查器_v19_混合提示词边界增强版.zip"
Compress-Archive -Path (Join-Path $bundleStaging "*") -DestinationPath $bundleZip -CompressionLevel Optimal

$forbidden = Get-ChildItem -LiteralPath $stagingExtension -Recurse -Force | Where-Object {
    $_.Name -eq "danbooru_tags.sqlite3" -or
    $_.Name -like "danbooru_tags.sqlite3.*" -or
    $_.Name -eq "assistant_settings.json" -or
    $_.Name -eq "installation_id" -or
    $_.Name -eq "__pycache__" -or
    $_.Extension -eq ".pyc" -or
    $_.FullName -like "*\data\backups\*"
}
if ($forbidden) {
    throw "发布暂存区包含禁止文件：$($forbidden.FullName -join ', ')"
}

Write-Host "社区发布包已生成：$bundleZip"
Write-Host "扩展安装包：$extensionZip"
Write-Host "扩展包 SHA256：$extensionHash"
