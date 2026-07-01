// babel-preset-expo auto-injects the react-native-worklets plugin when the package resolves.
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
