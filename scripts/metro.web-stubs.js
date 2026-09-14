// Web render harness: Metro resolver that stubs native-only modules so the phone apps can be
// exported for the web and screenshotted (scripts/render-screens.mjs). Not used by EAS builds.
const path = require('path');
const STUBS = { 'react-native-maps': 'maps', 'expo-sqlite': 'sqlite' };
module.exports = function withWebStubs(config) {
  const prev = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (platform === 'web' && STUBS[moduleName]) return { type: 'sourceFile', filePath: path.join(__dirname, 'web-stubs', `${STUBS[moduleName]}.js`) };
    return prev ? prev(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  };
  return config;
};
