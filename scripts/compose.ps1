<#
.SYNOPSIS
`docker compose` with this project's files and environment already worked out.

.DESCRIPTION
The PowerShell twin of scripts/compose.sh - same files, same project name, so
the two can be used interchangeably on the same machine without creating a
second set of containers.

What it saves you from is not typing, it is this:

  docker compose --project-directory . `
    -f deploy/compose/base.yml -f deploy/compose/local.yml `
    --env-file deploy/environments/local/compose.env up -d --build

Every part of that is load-bearing and silently wrong if left out. Without the
env file the portal is built against the compose defaults and Postgres refuses
the password it was initialised with - neither failure names its cause.

.EXAMPLE
./scripts/compose.ps1 up -d --build

.EXAMPLE
./scripts/compose.ps1 logs -f backend

.EXAMPLE
./scripts/compose.ps1 down
#>

# ValueFromRemainingArguments so everything after the (optional) environment is
# handed to docker straight through: this wraps compose, it does not replace it.
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
)

$ErrorActionPreference = 'Stop'

$Environment = if ($env:PESTBASE_ENV) { $env:PESTBASE_ENV } else { 'local' }

# An environment named as the first argument wins, as in the shell version.
if ($Args.Count -gt 0 -and $Args[0] -eq 'local') {
    $Environment = 'local'
    $Args = $Args[1..($Args.Count - 1)]
}

$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root "deploy/environments/$Environment/compose.env"
$Overlay = Join-Path $Root "deploy/compose/$Environment.yml"
$BaseFile = Join-Path $Root 'deploy/compose/base.yml'
$BackendEnv = Join-Path $Root 'backend/.env'

if (-not (Test-Path $EnvFile)) { throw "No environment descriptor at $EnvFile" }
if (-not (Test-Path $Overlay)) { throw "No compose overlay at $Overlay" }
if (-not (Test-Path $BackendEnv)) {
    throw "backend/.env is missing. Copy backend/.env.example and fill it in."
}

$Command = @(
    'compose',
    '--project-directory', $Root,
    # The same project name as compose.sh uses, so switching shells does not
    # start a second, parallel stack against different volumes.
    '--project-name', "pestbase-$Environment",
    '-f', $BaseFile,
    '-f', $Overlay,
    '--env-file', $EnvFile
)

# A runtime file overrides the checked-in descriptor when it exists, so real
# secrets never sit in the repository.
$RuntimeEnv = Join-Path $Root "deploy/runtime/$Environment/compose.env"
if (Test-Path $RuntimeEnv) { $Command += @('--env-file', $RuntimeEnv) }

& docker @Command @Args
exit $LASTEXITCODE
