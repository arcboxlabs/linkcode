// NativeWind requires babel-preset-expo's nativewind jsxImportSource + the nativewind/babel preset.
// NativeWind's engine (react-native-css-interop) peer-depends on react-native-reanimated (v4),
// whose worklets babel plugin must be listed last.
module.exports = (api) => {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: ['react-native-worklets/plugin'],
  };
};
