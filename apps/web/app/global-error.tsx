'use client'

import { useEffect } from 'react'

/**
 * A rebuild replaces the chunks an open tab is still holding references to, so
 * the next lazy import fails and React unmounts the whole tree. Restarting the
 * app while a session is open used to leave a bare "Application error" screen
 * with the recording still running and no way back.
 *
 * A stale chunk is recoverable: reload once and the tab picks up the new build.
 * Anything else gets an honest message instead of a blank page.
 */
const STALE_BUILD =
  /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module/i

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const staleBuild = STALE_BUILD.test(`${error.name} ${error.message}`)

  useEffect(() => {
    if (!staleBuild) return
    // Guard against a reload loop if the new build is broken too.
    const key = 'nod3:reloaded-for-stale-build'
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    window.location.reload()
  }, [staleBuild])

  return (
    <html lang="en">
      <body
        style={{
          background: '#08080a',
          color: '#eeeef2',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          display: 'grid',
          placeItems: 'center',
          minHeight: '100vh',
          margin: 0,
          padding: '0 24px',
        }}
      >
        <div style={{ maxWidth: 460 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
            <span
              style={{ width: 10, height: 10, borderRadius: 999, background: '#cdfa50' }}
              aria-hidden
            />
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14 }}>nod3</span>
          </div>

          <h1 style={{ fontSize: 20, fontWeight: 500, margin: '0 0 8px' }}>
            {staleBuild
              ? 'The app was rebuilt underneath this tab'
              : 'Something broke on this page'}
          </h1>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: '#85858f', margin: '0 0 24px' }}>
            {staleBuild
              ? 'Reloading to pick up the new build. If a session was recording, its audio was still being captured in this tab and is lost — sorry. Avoid restarting the server mid-session.'
              : 'Your sessions are files on disk and are unaffected. The error is below in case it is worth reporting.'}
          </p>

          {!staleBuild && (
            <pre
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 11.5,
                lineHeight: 1.6,
                color: '#ff5f56',
                background: '#16161b',
                border: '1px solid #23232b',
                borderRadius: 8,
                padding: '10px 12px',
                margin: '0 0 24px',
                whiteSpace: 'pre-wrap',
                overflowX: 'auto',
              }}
            >
              {error.message}
              {error.digest ? `\n\ndigest: ${error.digest}` : ''}
            </pre>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => reset()}
              style={{
                background: '#cdfa50',
                color: '#08080a',
                border: 0,
                borderRadius: 8,
                padding: '9px 16px',
                fontSize: 13.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                background: '#16161b',
                color: '#eeeef2',
                border: '1px solid #23232b',
                borderRadius: 8,
                padding: '9px 16px',
                fontSize: 13.5,
                textDecoration: 'none',
              }}
            >
              Back to problems
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
