// Learn more https://docs.expo.io/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const workletsVersion = require('react-native-worklets/package.json').version;

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Invalidate Metro transform cache when worklets version changes.
config.cacheVersion = `worklets-${workletsVersion}`;

const previousResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === '@shopify/flash-list') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'lib/flash-list.web.tsx'),
    };
  }
  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
