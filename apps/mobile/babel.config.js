// NativeWind v5 delegates to react-native-css/babel, which injects the worklets plugin.
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo', 'nativewind/babel'],
  };
};
