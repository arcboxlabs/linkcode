const { AndroidConfig, withGradleProperties } = require('expo/config-plugins');

const GRADLE_JVM_ARGS = '-Xmx2048m -XX:MaxMetaspaceSize=1024m';

module.exports = (config) =>
  withGradleProperties(config, (config) => {
    config.modResults = AndroidConfig.BuildProperties.updateAndroidBuildProperty(
      config.modResults,
      'org.gradle.jvmargs',
      GRADLE_JVM_ARGS,
    );
    return config;
  });
