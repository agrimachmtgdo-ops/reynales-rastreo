// Metro detecta el monorepo pnpm automáticamente desde Expo SDK 52.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
