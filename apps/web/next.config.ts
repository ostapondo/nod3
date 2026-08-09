import type { NextConfig } from 'next'

const API = process.env.NEXT_PUBLIC_API ?? 'http://localhost:4000'

const config: NextConfig = {
  reactStrictMode: true,
  // Proxy the API through Next so the browser only ever talks to one origin —
  // keeps CORS out of the picture and makes the whole thing feel like one app.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }]
  },
}

export default config
