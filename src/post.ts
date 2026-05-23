/**
 * Post-action: save the unirtm cache after the main job completes.
 */
import * as core from '@actions/core'
import * as cache from '@actions/cache'
import * as fs from 'fs'

export async function post(): Promise<void> {
  try {
    const shouldCache = core.getBooleanInput('cache')
    const shouldSave = core.getBooleanInput('cache_save')
    if (!shouldCache || !shouldSave) {
      core.info('Cache save skipped (cache or cache_save is false)')
      return
    }

    const primaryKey = core.getState('PRIMARY_KEY')
    const installDir = core.getState('INSTALL_DIR')

    if (!primaryKey || !installDir) {
      core.info('No cache state found, skipping cache save')
      return
    }

    if (!fs.existsSync(installDir)) {
      core.warning(
        `Install directory not found, skipping cache save: ${installDir}`
      )
      return
    }

    core.startGroup('Saving unirtm cache (post-action)')
    const id = await cache.saveCache([installDir], primaryKey)
    if (id !== -1) {
      core.info(`Cache saved with key: ${primaryKey}`)
    } else {
      core.info('Cache already exists for this key, skipping save')
    }
    core.endGroup()
  } catch (err) {
    // Never fail the workflow due to cache errors
    if (err instanceof Error) {
      core.warning(`Cache save failed: ${err.message}`)
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
post()
