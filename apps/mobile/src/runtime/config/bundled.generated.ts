// Committed development sentinel. scripts/render-config-bundle.mts writes gitignored
// bundled.generated.<platform>.ts modules that Metro resolves over this file; never edit those
// by hand and never change this sentinel away from { bundle: null }.
const generatedConfigModule: unknown = { bundle: null };
export default generatedConfigModule;
