param(
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$workspaceRoot = [System.IO.Path]::GetFullPath((Split-Path $projectRoot -Parent))
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $workspaceRoot "output\双语提示词检查器_v1.1.0"
}
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$stagingRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot ".staging\bpi-v1.1.0-public-release"))

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
    "CHANGELOG.md",
    "DEVELOPMENT_HISTORY.md",
    "LICENSE",
    "THIRD_PARTY_NOTICE.md",
    "SECURITY.md"
)
foreach ($relative in $rootFiles) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $relative) -Destination (Join-Path $stagingExtension $relative)
}

Copy-Item -LiteralPath (Join-Path $projectRoot "js") -Destination (Join-Path $stagingExtension "js") -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "docs") -Destination (Join-Path $stagingExtension "docs") -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "data\packs") -Destination (Join-Path $stagingExtension "data\packs") -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "data\base_tags.json") -Destination (Join-Path $stagingExtension "data\base_tags.json")
Copy-Item -LiteralPath (Join-Path $projectRoot "data\search_concepts.json") -Destination (Join-Path $stagingExtension "data\search_concepts.json")
Copy-Item -LiteralPath (Join-Path $projectRoot "data\LARGE_DICTIONARY_SOURCES.md") -Destination (Join-Path $stagingExtension "data\LARGE_DICTIONARY_SOURCES.md")
Copy-Item -LiteralPath (Join-Path $projectRoot "tools\build_large_dictionary.py") -Destination (Join-Path $stagingExtension "tools\build_large_dictionary.py") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "release_docs\社区分享声明.txt") -Destination (Join-Path $stagingExtension "社区分享声明.txt")

$forbidden = Get-ChildItem -LiteralPath $stagingExtension -Recurse -Force | Where-Object {
    $_.Name -eq "user_tags.json" -or
    $_.Name -eq "pack_settings.json" -or
    $_.Name -eq "large_dictionary.json" -or
    $_.Name -eq "danbooru_tags.sqlite3" -or
    $_.Name -like "danbooru_tags.sqlite3.*" -or
    $_.Name -like "community_*.json" -or
    $_.Name -eq "assistant_settings.json" -or
    $_.Name -eq "installation_id" -or
    $_.Name -eq "__pycache__" -or
    $_.Extension -eq ".pyc" -or
    $_.FullName -like "*\data\backups\*" -or
    $_.FullName -like "*\data\runtime\*" -or
    $_.FullName -like "*\data\user_config\*"
}
if ($forbidden) {
    throw "发布暂存区包含禁止文件：$($forbidden.FullName -join ', ')"
}

$extensionZip = Join-Path $outputRoot "ComfyUI-Bilingual-Prompt-Inspector-v1.1.0-public.zip"
Compress-Archive -LiteralPath $stagingExtension -DestinationPath $extensionZip -CompressionLevel Optimal

$upgradeTestRoot = Join-Path $stagingRoot "upgrade-test"
$upgradeExtension = Join-Path $upgradeTestRoot $extensionName
$sentinelContents = [ordered]@{
    "data\user_tags.json" = '{"schema_version":1,"tags":[{"english":"keep_me","chinese":"保留词条"}]}'
    "data\pack_settings.json" = '{"schema_version":1,"enabled":{"adult":true}}'
    "data\large_dictionary.json" = '{"schema_version":1,"enabled":false}'
    "data\danbooru_tags.sqlite3" = 'test-only-large-dictionary-sentinel'
    "data\packs\community_keep.json" = '{"test":"community-pack-sentinel"}'
    "data\backups\user_tags.keep.json" = '{"test":"backup-sentinel"}'
    "data\runtime\installation_id" = 'test-only-installation-id-sentinel'
    "data\user_config\assistant_settings.json" = '{"test":"assistant-settings-sentinel"}'
}
$sentinelHashes = @{}
foreach ($relative in $sentinelContents.Keys) {
    $path = Join-Path $upgradeExtension $relative
    New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
    Set-Content -LiteralPath $path -Value $sentinelContents[$relative] -Encoding utf8 -NoNewline
    $sentinelHashes[$relative] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}
Expand-Archive -LiteralPath $extensionZip -DestinationPath $upgradeTestRoot -Force
foreach ($relative in $sentinelHashes.Keys) {
    $path = Join-Path $upgradeExtension $relative
    if (-not (Test-Path -LiteralPath $path)) {
        throw "覆盖升级测试失败，用户文件被删除：$relative"
    }
    $afterHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($afterHash -ne $sentinelHashes[$relative]) {
        throw "覆盖升级测试失败，用户文件被修改：$relative"
    }
}
$frontendSource = Get-Content -LiteralPath (Join-Path $projectRoot "js\bilingual_prompt.js") -Raw
if ($frontendSource -notmatch 'const PREFERENCES_KEY = "bpi\.dictionary\.preferences\.v1";') {
    throw "收藏与最近使用的浏览器存储键发生变化，升级兼容检查失败"
}

foreach ($document in @("安装说明.txt", "v1.1.0更新与升级说明.txt", "大型词库手动安装说明.txt", "社区分享声明.txt")) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "release_docs\$document") -Destination (Join-Path $outputRoot $document)
}

$extensionHash = (Get-FileHash -LiteralPath $extensionZip -Algorithm SHA256).Hash
Set-Content -LiteralPath (Join-Path $outputRoot "文件校验SHA256.txt") -Value "ComfyUI-Bilingual-Prompt-Inspector-v1.1.0-public.zip`r`nSHA256: $extensionHash" -Encoding utf8

$bundleStaging = Join-Path $stagingRoot "bundle"
New-Item -ItemType Directory -Path $bundleStaging | Out-Null
Copy-Item -Path (Join-Path $outputRoot "*") -Destination $bundleStaging -Force
$bundleZip = Join-Path $outputRoot "双语提示词检查器_v1.1.0.zip"
Compress-Archive -Path (Join-Path $bundleStaging "*") -DestinationPath $bundleZip -CompressionLevel Optimal

$bundleHash = (Get-FileHash -LiteralPath $bundleZip -Algorithm SHA256).Hash
$allHashes = @(
    "ComfyUI-Bilingual-Prompt-Inspector-v1.1.0-public.zip",
    "SHA256: $extensionHash",
    "",
    "双语提示词检查器_v1.1.0.zip",
    "SHA256: $bundleHash"
) -join "`r`n"
Set-Content -LiteralPath (Join-Path $outputRoot "v1.1.0_文件校验SHA256.txt") -Value $allHashes -Encoding utf8

Write-Host "社区发布包已生成：$bundleZip"
Write-Host "扩展安装包：$extensionZip"
Write-Host "扩展包 SHA256：$extensionHash"
Write-Host "分享包 SHA256：$bundleHash"
Write-Host "覆盖升级保留测试：通过"
