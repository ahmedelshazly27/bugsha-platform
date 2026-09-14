// Monorepo Metro config; on the web the native-only modules are stubbed (scripts/metro.web-stubs.js) for the render harness.
const { getDefaultConfig } = require('expo/metro-config'); const path = require('path');
const root = path.resolve(__dirname, '../..'); const config = getDefaultConfig(__dirname);
config.watchFolders = [root]; config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), path.resolve(root, 'node_modules')];
module.exports = require('../../scripts/metro.web-stubs')(config);
