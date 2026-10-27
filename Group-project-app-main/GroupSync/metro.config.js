const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Expo Go SDK 57 can SIGSEGV when react-native-worklets initializes (@expo/ui / Reanimated).
// Stub the module on native; animations fall back without worklets (app still runs in Expo Go).
const baseResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-worklets' && platform !== 'web') {
    return { type: 'empty' };
  }
  if (baseResolveRequest) {
    return baseResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
