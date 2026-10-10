// Extends app.json. EXPO_PUBLIC_BASE_URL serves the web build from a subpath (GitHub Pages: /Pepper).
// Unset, the site is served from the domain root (Vercel, local dev).

/** @param {{ config: import('expo/config').ExpoConfig }} ctx */
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    baseUrl: process.env.EXPO_PUBLIC_BASE_URL || undefined,
  },
});
