import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as cache from '@actions/cache'
import * as glob from '@actions/glob'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as Handlebars from 'handlebars'

// ─── Constants ───────────────────────────────────────────────────────────────

const UNIRTM_CONFIG_FILE_PATTERNS = [
  '**/.unirtm.toml',
  '**/unirtm.toml',
  '**/unirtm.lock',
  '**/.unirtm.lock'
]

const DEFAULT_CACHE_KEY_TEMPLATE =
  '{{cache_key_prefix}}-{{platform}}' +
  '{{#if version}}-{{version}}{{/if}}' +
  '{{#if mise_env}}-{{mise_env}}{{/if}}' +
  '{{#if install_args_hash}}-{{install_args_hash}}{{/if}}' +
  '-{{#if file_hash}}{{file_hash}}{{else}}no-config{{/if}}'

const GITHUB_RELEASES_API =
  'https://api.github.com/repos/snowdreamtech/UniRTM/releases'

const GITHUB_RELEASE_DOWNLOAD_BASE =
  'https://github.com/snowdreamtech/UniRTM/releases/download'

const NPM_PACKAGE = '@snowdreamtech/unirtm'

const GO_MODULE = 'github.com/snowdreamtech/unirtm'

// ─── Types ───────────────────────────────────────────────────────────────────

type InstallMethod = 'npm' | 'pip' | 'release' | 'go'

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * The main function for the action.
 */
export async function run(): Promise<void> {
  try {
    // Read the raw version input; actual resolution may be deferred
    // depending on the install method (npm/pip resolve 'latest' natively)
    const requestedVersion = core.getInput('version').trim()

    // Restore cache — for cache key we need a concrete version.
    // When the user omitted the version we resolve to second-latest;
    // when they said "latest" we resolve to absolute latest.
    // A specific version is used as-is.
    let cacheVersion = requestedVersion
    if (!requestedVersion) {
      cacheVersion = await fetchLatestVersion(false)
    } else if (requestedVersion.toLowerCase() === 'latest') {
      cacheVersion = await fetchLatestVersion(true)
    }
    core.info(`Target unirtm version: ${cacheVersion}`)

    // Restore cache
    let cacheKey: string | undefined
    let cacheHit = false
    if (core.getBooleanInput('cache')) {
      const result = await restoreUnirtmCache(cacheVersion)
      cacheKey = result.primaryKey
      cacheHit = result.hit
    } else {
      core.setOutput('cache-hit', false)
    }

    // If cache was restored, add binary dir to PATH and skip install
    if (cacheHit) {
      const binDir = getInstallBinDir()
      core.addPath(binDir)
      core.info(`Cache hit — skipping installation, added ${binDir} to PATH`)
    } else {
      // Determine installation method
      const requestedMethod = core.getInput('install_method').trim() as
        | InstallMethod
        | 'auto'
      const method: InstallMethod =
        requestedMethod === 'auto'
          ? await detectInstallMethod()
          : requestedMethod

      core.info(`Using installation method: ${method}`)
      core.setOutput('install-method', method)

      // For npm/pip, pass the original requested version (which may be
      // 'latest') so the package manager resolves it natively via its own
      // registry.  For release/go we need a concrete version number, so
      // we use the already-resolved cacheVersion.
      const installVersion = methodUsesRegistryLatest(method)
        ? requestedVersion || 'latest'
        : cacheVersion

      // Install unirtm
      const installed = await installUnirtm(method, installVersion)
      if (!installed) {
        core.setFailed(
          `Failed to install unirtm@${installVersion} via method "${method}"`
        )
        return
      }
    }

    // Verify installation
    const installedVersion = await verifyUnirtm()
    core.setOutput('unirtm-version', installedVersion)
    core.info(`unirtm ${installedVersion} is ready`)

    // Save cache (only on cache miss; post-action handles the actual save)
    if (cacheKey && core.getBooleanInput('cache_save')) {
      core.saveState('PRIMARY_KEY', cacheKey)
      core.saveState('CACHE_PATHS', JSON.stringify(getCachePaths()))
    }

    // Run unirtm trust if requested
    if (core.getBooleanInput('trust')) {
      await runUnirtmTrust()
    }

    // Run unirtm install if requested
    if (core.getBooleanInput('install')) {
      await runUnirtmInstall()
    }
  } catch (err) {
    if (err instanceof Error) core.setFailed(err.message)
    else throw err
  }
}

// ─── Version Resolution ───────────────────────────────────────────────────────

/**
 * Fetch the target unirtm version from GitHub API.
 * @param absoluteLatest If true, fetches the absolute latest release. If false, fetches the second latest.
 */
async function fetchLatestVersion(absoluteLatest: boolean): Promise<string> {
  const targetDesc = absoluteLatest ? 'latest' : 'second latest'
  core.startGroup(`Fetching target unirtm version (${targetDesc})`)
  try {
    const token = core.getInput('github_token')
    const args = ['-fsSL', GITHUB_RELEASES_API]
    if (token) {
      args.push('-H', `Authorization: Bearer ${token}`)
    }
    args.push('-H', 'Accept: application/vnd.github+json')

    const result = await exec.getExecOutput('curl', args, { silent: true })
    const releases = JSON.parse(result.stdout) as {
      tag_name: string
      draft: boolean
      prerelease: boolean
    }[]

    // Filter out drafts and prereleases to ensure stability
    const stableReleases = releases.filter(r => !r.draft && !r.prerelease)

    if (absoluteLatest && stableReleases.length >= 1) {
      const version = stableReleases[0].tag_name.replace(/^v/, '')
      core.info(`Latest version: ${version}`)
      return version
    } else if (!absoluteLatest && stableReleases.length >= 2) {
      const version = stableReleases[1].tag_name.replace(/^v/, '')
      core.info(`Second latest version: ${version}`)
      return version
    } else {
      core.info(`Not enough stable releases found, falling back to 'latest'`)
      return 'latest'
    }
  } finally {
    core.endGroup()
  }
}

// ─── Smart Detection ──────────────────────────────────────────────────────────

/**
 * Auto-detect the best installation method based on available tools.
 * Priority: npm → pip → GitHub Release → go install
 */
async function detectInstallMethod(): Promise<InstallMethod> {
  core.startGroup('Detecting available installation method')
  try {
    if (await isCommandAvailable('npm')) {
      core.info('✅ npm detected → using npm install')
      return 'npm'
    }
    if (
      (await isCommandAvailable('pip')) ||
      (await isCommandAvailable('pip3'))
    ) {
      core.info(
        '✅ pip detected → using pip install (note: PyPI package may not be available yet)'
      )
      return 'pip'
    }
    if (await isCommandAvailable('go')) {
      core.info('✅ go detected → using go install')
      return 'go'
    }
    core.info(
      'ℹ️ No preferred runtime found → falling back to GitHub Release download'
    )
    return 'release'
  } finally {
    core.endGroup()
  }
}

/**
 * Check if a CLI command is available in PATH.
 * Cross-platform: uses `where` on Windows, `which` on Unix/macOS.
 */
async function isCommandAvailable(cmd: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await exec.exec('where', [cmd], { silent: true, ignoreReturnCode: false })
    } else {
      await exec.exec('which', [cmd], { silent: true, ignoreReturnCode: false })
    }
    return true
  } catch {
    return false
  }
}

// ─── Installation Dispatch ────────────────────────────────────────────────────

/**
 * Returns true for install methods that can resolve 'latest' via their own
 * registry (npm, pip), so we don't need to pre-resolve the version via GitHub.
 */
function methodUsesRegistryLatest(method: InstallMethod): boolean {
  return method === 'npm' || method === 'pip'
}

async function installUnirtm(
  method: InstallMethod,
  version: string
): Promise<boolean> {
  switch (method) {
    case 'npm':
      return installViaNpm(version)
    case 'pip':
      return installViaPip(version)
    case 'release':
      return installViaRelease(version)
    case 'go':
      return installViaGo(version)
  }
}

// ─── npm Installation ─────────────────────────────────────────────────────────

/**
 * Install unirtm via npm global install.
 * Requires npm to be available in PATH.
 */
async function installViaNpm(version: string): Promise<boolean> {
  core.startGroup(`Installing unirtm@${version} via npm`)
  try {
    const pkg = version ? `${NPM_PACKAGE}@${version}` : NPM_PACKAGE
    const code = await exec.exec('npm', ['install', '-g', pkg])
    if (code !== 0) return false

    // Ensure npm global bin is in PATH (npm bin was removed in npm v9+)
    const npmPrefixRes = await exec.getExecOutput('npm', ['prefix', '-g'], {
      silent: true
    })
    const npmPrefix = npmPrefixRes.stdout.trim()
    if (npmPrefix) {
      const npmBinDir =
        process.platform === 'win32' ? npmPrefix : path.join(npmPrefix, 'bin')
      core.addPath(npmBinDir)
    }

    return true
  } catch (err) {
    core.warning(`npm install failed: ${errorMessage(err)}`)
    return false
  } finally {
    core.endGroup()
  }
}

// ─── pip Installation ─────────────────────────────────────────────────────────

/**
 * Install unirtm via pip.
 * NOTE: PyPI package is not yet available; this is a reserved implementation.
 * Falls back to GitHub Release download with a warning.
 */
async function installViaPip(version: string): Promise<boolean> {
  core.startGroup(`Installing unirtm@${version} via pip`)
  core.warning(
    'pip installation method is reserved for future use. ' +
      'The PyPI package "unirtm" is not yet available. ' +
      'Falling back to GitHub Release download.'
  )
  core.endGroup()
  return installViaRelease(version)
}

// ─── GitHub Release Installation ─────────────────────────────────────────────

/**
 * Download and install unirtm binary from GitHub Releases.
 * Supports github_proxy prefix and automatic retry.
 */
async function installViaRelease(version: string): Promise<boolean> {
  core.startGroup(`Installing unirtm@${version} via GitHub Release`)
  try {
    const targetStr = getTarget()
    const ext = process.platform === 'win32' ? '.zip' : '.tar.gz'
    const assetName = `unirtm_${targetStr}${ext}`
    const githubProxy =
      core.getInput('github_proxy').trim() ||
      process.env.GITHUB_PROXY?.trim() ||
      ''

    const rawUrl =
      version === 'latest'
        ? `https://github.com/snowdreamtech/UniRTM/releases/latest/download/${assetName}`
        : `${GITHUB_RELEASE_DOWNLOAD_BASE}/v${version}/${assetName}`
    const downloadUrl = githubProxy
      ? `${githubProxy.replace(/\/$/, '')}/${rawUrl}`
      : rawUrl

    core.info(`Download URL: ${downloadUrl}`)

    // Install binary into ~/.local/bin
    const binDir = getInstallBinDir()
    await fs.promises.mkdir(binDir, { recursive: true })

    const archivePath = path.join(os.tmpdir(), assetName)
    const extractDir = path.join(os.tmpdir(), `unirtm-extract-${Date.now()}`)

    // Download with retry
    await downloadWithRetry(downloadUrl, archivePath)

    // Extract
    await fs.promises.mkdir(extractDir, { recursive: true })
    if (ext === '.zip') {
      await exec.exec('unzip', ['-o', archivePath, '-d', extractDir])
    } else {
      await exec.exec('tar', ['-xzf', archivePath, '-C', extractDir])
    }

    // Find and move binary
    const binaryName = process.platform === 'win32' ? 'unirtm.exe' : 'unirtm'
    const binaryPath = await findFile(extractDir, binaryName)
    if (!binaryPath) {
      throw new Error(`Binary "${binaryName}" not found in extracted archive`)
    }
    const destPath = path.join(binDir, binaryName)
    await fs.promises.copyFile(binaryPath, destPath)
    if (process.platform !== 'win32') {
      await exec.exec('chmod', ['+x', destPath])
    }

    core.addPath(binDir)
    core.info(`unirtm installed to ${destPath}`)

    // Cleanup temp files
    await fs.promises.rm(archivePath, { force: true })
    await fs.promises.rm(extractDir, { recursive: true, force: true })

    return true
  } catch (err) {
    core.warning(`GitHub Release install failed: ${errorMessage(err)}`)
    return false
  } finally {
    core.endGroup()
  }
}

/**
 * Download a file with automatic retry (up to 3 attempts).
 */
async function downloadWithRetry(
  url: string,
  dest: string,
  maxRetries = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      core.info(`Downloading (attempt ${attempt}/${maxRetries}): ${url}`)
      const code = await exec.exec('curl', [
        '-fsSL',
        '--retry',
        '3',
        '--retry-delay',
        '2',
        '-o',
        dest,
        url
      ])
      if (code === 0) return
      throw new Error(`curl exited with code ${code}`)
    } catch (err) {
      if (attempt === maxRetries) throw err
      const delay = attempt * 2000
      core.info(`Retrying in ${delay / 1000}s...`)
      await sleep(delay)
    }
  }
}

/**
 * Recursively find the first file matching a name inside a directory.
 */
async function findFile(
  dir: string,
  name: string
): Promise<string | undefined> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = await findFile(fullPath, name)
      if (found) return found
    } else if (entry.name === name) {
      return fullPath
    }
  }
  return undefined
}

// ─── go Installation ──────────────────────────────────────────────────────────

/**
 * Install unirtm via `go install`.
 * Requires go to be available in PATH.
 */
async function installViaGo(version: string): Promise<boolean> {
  core.startGroup(`Installing unirtm@${version} via go install`)
  try {
    const pkg =
      version && version !== 'latest'
        ? `${GO_MODULE}@v${version}`
        : `${GO_MODULE}@latest`
    const code = await exec.exec('go', ['install', pkg])
    if (code !== 0) return false

    // go installs to $GOPATH/bin or $HOME/go/bin
    const goPathBin = process.env.GOPATH
      ? path.join(process.env.GOPATH, 'bin')
      : path.join(os.homedir(), 'go', 'bin')
    core.addPath(goPathBin)
    core.info(`Added ${goPathBin} to PATH`)
    return true
  } catch (err) {
    core.warning(`go install failed: ${errorMessage(err)}`)
    return false
  } finally {
    core.endGroup()
  }
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify unirtm is accessible and return its version string.
 */
async function verifyUnirtm(): Promise<string> {
  core.startGroup('Verifying unirtm installation')
  try {
    const result = await exec.getExecOutput('unirtm', ['version'], {
      silent: false,
      ignoreReturnCode: true
    })
    const versionMatch = result.stdout
      .trim()
      .match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/)
    return versionMatch ? versionMatch[1] : result.stdout.trim()
  } finally {
    core.endGroup()
  }
}

// ─── Run unirtm trust ─────────────────────────────────────────────────────────

/**
 * Run `unirtm trust` to trust the configuration file.
 */
async function runUnirtmTrust(): Promise<void> {
  core.startGroup('Running: unirtm trust')
  try {
    await exec.exec('unirtm', ['trust'])
  } finally {
    core.endGroup()
  }
}

// ─── Run unirtm install ───────────────────────────────────────────────────────

/**
 * Run `unirtm install [install_args]` to install tools defined in config.
 */
async function runUnirtmInstall(): Promise<void> {
  const installArgs = core.getInput('install_args').trim()
  const args = ['install', ...installArgs.split(/\s+/).filter(Boolean)]
  core.startGroup(`Running: unirtm ${args.join(' ')}`)
  try {
    await exec.exec('unirtm', args)
  } finally {
    core.endGroup()
  }
}

// ─── Cache ────────────────────────────────────────────────────────────────────

/**
 * Return all paths that should be cached.
 * Matches the reference pattern from UniRTM's own CI:
 *   ~/.local/bin                          (binary, Linux + macOS)
 *   ~/.local/share/unirtm                 (data dir, Linux)
 *   ~/Library/Application Support/unirtm (data dir, macOS)
 *   ~/AppData/Local/unirtm                (data dir, Windows)
 */
function getCachePaths(): string[] {
  const home = os.homedir()
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.local', 'share', 'unirtm'),
    path.join(home, 'Library', 'Application Support', 'unirtm'),
    path.join(
      process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
      'unirtm'
    )
  ]
}

/**
 * Restore the unirtm installation from cache.
 * Supports primary key + OS-prefixed restore-keys for better hit rates.
 */
async function restoreUnirtmCache(
  version: string
): Promise<{ primaryKey: string; hit: boolean }> {
  core.startGroup('Restoring unirtm cache')

  const cacheKeyTemplate =
    core.getInput('cache_key') || DEFAULT_CACHE_KEY_TEMPLATE
  const primaryKey = await processCacheKeyTemplate(cacheKeyTemplate, version)

  // Fallback restore-keys (OS-scoped, progressively broader)
  const runnerOs = process.env.RUNNER_OS ?? process.platform
  const restoreKeys = [
    `${core.getInput('cache_key_prefix') || 'setup-unirtm-v1'}-${runnerOs.toLowerCase()}-unirtm-`,
    `${core.getInput('cache_key_prefix') || 'setup-unirtm-v1'}-${runnerOs.toLowerCase()}-`
  ]

  const cachePaths = getCachePaths()
  core.info(`Cache paths:\n  ${cachePaths.join('\n  ')}`)
  core.info(`Primary key: ${primaryKey}`)
  core.info(`Restore keys:\n  ${restoreKeys.join('\n  ')}`)

  const hitKey = await cache.restoreCache(cachePaths, primaryKey, restoreKeys)
  const hit = Boolean(hitKey)

  core.setOutput('cache-hit', hit)
  if (hit) {
    core.info(`Cache restored from key: ${hitKey}`)
  } else {
    core.info('No cache found, will install fresh')
  }

  core.endGroup()
  return { primaryKey, hit }
}

/**
 * Save the unirtm installation to cache.
 * Called from post-action (src/post.ts) after the job completes.
 */
async function saveUnirtmCache(cacheKey: string): Promise<void> {
  core.startGroup('Saving unirtm cache')
  const cachePaths = getCachePaths()

  // Filter to paths that actually exist (non-existent paths cause cache errors)
  const existingPaths = cachePaths.filter(p => fs.existsSync(p))
  if (existingPaths.length === 0) {
    core.warning('No cache paths found on disk, skipping cache save')
    core.endGroup()
    return
  }

  core.info(`Saving paths:\n  ${existingPaths.join('\n  ')}`)
  const id = await cache.saveCache(existingPaths, cacheKey)
  if (id !== -1) {
    core.info(`Cache saved (key: ${cacheKey})`)
  } else {
    core.info('Cache already exists for this key')
  }
  core.endGroup()
}

// Export for use by post.ts
export { saveUnirtmCache, getCachePaths }

// ─── Cache Key Template ───────────────────────────────────────────────────────

async function processCacheKeyTemplate(
  template: string,
  version: string
): Promise<string> {
  const installArgs = core.getInput('install_args')
  const cacheKeyPrefix = core.getInput('cache_key_prefix') || 'setup-unirtm-v1'
  const miseEnv = process.env.MISE_ENV?.replace(/,/g, '-') ?? ''
  const platform = `${getPlatformArch()}-${getRunnerImageId()}`

  // Hash unirtm config files
  const fileHash = await glob.hashFiles(UNIRTM_CONFIG_FILE_PATTERNS.join('\n'))

  // Hash install args (sorted, flags excluded)
  let installArgsHash = ''
  if (installArgs) {
    const tools = installArgs
      .split(/\s+/)
      .filter(a => !a.startsWith('-'))
      .sort()
      .join(' ')
    if (tools) {
      installArgsHash = crypto.createHash('sha256').update(tools).digest('hex')
    }
  }

  const baseData = {
    version,
    cache_key_prefix: cacheKeyPrefix,
    platform,
    file_hash: fileHash,
    mise_env: miseEnv,
    install_args_hash: installArgsHash
  }

  // Compute default key first
  const defaultKey = Handlebars.compile(DEFAULT_CACHE_KEY_TEMPLATE)(baseData)

  const templateData = {
    ...baseData,
    default: defaultKey,
    env: process.env
  }

  return Handlebars.compile(template)(templateData)
}

// ─── Platform Helpers ─────────────────────────────────────────────────────────

/**
 * Return the platform-arch string matching goreleaser naming:
 * e.g. Linux_x86_64, Darwin_arm64, Windows_x86_64
 */
function getTarget(): string {
  const osName = getPlatformName()
  const arch = getArchName()
  return `${osName}_${arch}`
}

function getPlatformName(): string {
  switch (process.platform) {
    case 'linux':
      return 'Linux'
    case 'darwin':
      return 'Darwin'
    case 'win32':
      return 'Windows'
    default:
      throw new Error(`Unsupported platform: ${process.platform}`)
  }
}

function getArchName(): string {
  switch (process.arch) {
    case 'x64':
      return 'x86_64'
    case 'ia32':
      return 'i386'
    case 'arm64':
      return 'arm64'
    case 'arm':
      return 'armv6'
    default:
      throw new Error(`Unsupported arch: ${process.arch}`)
  }
}

/**
 * Platform-arch string for cache key (lowercase, e.g. linux-x64).
 */
function getPlatformArch(): string {
  const p =
    process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'macos'
        : 'linux'
  const a = process.arch
  return `${p}-${a}`
}

/**
 * Return the runner image ID for cache key uniqueness.
 * GitHub-hosted runners expose ImageOS (e.g. "ubuntu24", "macos15").
 */
function getRunnerImageId(): string {
  return process.env.ImageOS ?? 'self-hosted'
}

// ─── Install Dirs ─────────────────────────────────────────────────────────────

/**
 * Return the directory where the unirtm binary should be placed.
 * This is always ~/.local/bin (cross-platform).
 */
function getInstallBinDir(): string {
  return path.join(os.homedir(), '.local', 'bin')
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
