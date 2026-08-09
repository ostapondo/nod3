'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

export interface LanguagePreference {
  language: string | null
  /** True once the server has been asked; the chooser waits for this. */
  loaded: boolean
  /** The click has been registered but the write has not come back yet. */
  saving: string | null
  error: string | null
  /** Resolves true only when the server confirmed the write. */
  setLanguage: (next: string) => Promise<boolean>
}

/**
 * The interview language is a long-lived choice — you prepare in one language —
 * so it is asked once on first run and then kept.
 *
 * It is stored server-side in `data/settings.json`, not in localStorage: this
 * app's premise is that your data is a set of files you own, and a browser
 * profile is neither durable nor the thing you own. It survives a restart, a
 * different browser, and opening the app from another machine.
 *
 * `language === null` after `loaded` means "never chosen", which is what
 * triggers the first-run screen.
 */
export function useLanguagePreference(): LanguagePreference {
  const [language, setLanguageState] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .settings()
      .then((s) => setLanguageState(s.language))
      .catch(() => {
        // Server unreachable: leave it unset rather than guessing, so the
        // chooser appears instead of silently starting in the wrong language.
        setError('Could not reach the local server to read your settings.')
      })
      .finally(() => setLoaded(true))
  }, [])

  const setLanguage = useCallback(async (next: string): Promise<boolean> => {
    setSaving(next)
    setError(null)

    // Deliberately not optimistic. An earlier version set the state first and
    // swallowed write failures, so a failed save looked like it worked and then
    // the first-run screen reappeared on the next visit with no explanation.
    // The choice is only shown as made once the server confirms it.
    try {
      const saved = await api.saveSettings({ language: next })
      setLanguageState(saved.language)
      return true
    } catch (err: unknown) {
      setError(`Could not save your choice: ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      setSaving(null)
    }
  }, [])

  return { language, loaded, saving, error, setLanguage }
}
