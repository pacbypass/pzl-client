/**
 * Dynamic Expo config = app.json plus a BUILD STAMP, so a running app can always
 * be identified ("is the phone actually on the build I just made?"). Shown in
 * the Debug tab. Resolution order: an explicit BUILD_STAMP env var (what the
 * local build passes), the EAS build's commit hash, then the working copy's git
 * HEAD, then "dev" for Metro runs.
 */
const { execSync } = require('child_process');

function gitSha() {
  if (process.env.BUILD_STAMP) return process.env.BUILD_STAMP;
  if (process.env.EAS_BUILD_GIT_COMMIT_HASH) {
    return process.env.EAS_BUILD_GIT_COMMIT_HASH.slice(0, 7);
  }
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    buildStamp: gitSha(),
    buildTime: new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z',
  },
});
