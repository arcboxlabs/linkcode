const { Buffer } = require('node:buffer');
const process = require('node:process');

const PHASES = new Set(['render', 'sign', 'upload']);
const PLATFORMS = new Set(['desktop', 'mobile']);
const RE_R2_ACCOUNT_ID = /^[0-9a-f]{32}$/;
const INPUTS = {
  render: [
    ['var', 'CONFIG_PUBLISHER_REPO'],
    ['secret', 'CONFIG_PUBLISHER_TOKEN'],
    ['var', 'CONFIG_RELEASE_KEYRINGS'],
    ['var', 'CONFIG_RELEASE_REVISION'],
  ],
  sign: {
    desktop: [
      ['secret', 'APPLE_API_KEY_BASE64'],
      ['secret', 'APPLE_API_KEY_ID'],
      ['secret', 'APPLE_API_ISSUER'],
      ['secret', 'APPLE_TEAM_ID'],
      ['secret', 'AZURE_CERTIFICATE_PROFILE'],
      ['secret', 'AZURE_CLIENT_ID'],
      ['secret', 'AZURE_CODE_SIGNING_ACCOUNT'],
      ['secret', 'AZURE_PUBLISHER_NAME'],
      ['secret', 'AZURE_SIGN_ENDPOINT'],
      ['secret', 'AZURE_TENANT_ID'],
      ['secret', 'MACOS_CSC_KEY_PASSWORD'],
      ['secret', 'MACOS_CSC_LINK'],
      ['var', 'POSTHOG_HOST'],
      ['secret', 'POSTHOG_PROJECT_TOKEN'],
      ['secret', 'SENTRY_DSN_DESKTOP'],
    ],
    mobile: [
      ['secret', 'EXPO_TOKEN'],
      ['secret', 'POSTHOG_PROJECT_TOKEN'],
      ['var', 'POSTHOG_HOST'],
      ['secret', 'SENTRY_AUTH_TOKEN'],
      ['secret', 'SENTRY_DSN_MOBILE'],
    ],
  },
  upload: {
    desktop: [
      ['secret', 'R2_ACCESS_KEY_ID'],
      ['secret', 'R2_ACCOUNT_ID'],
      ['secret', 'R2_SECRET_ACCESS_KEY'],
    ],
    mobile: [['secret', 'EXPO_TOKEN']],
  },
};

function validateReleaseInputs({ env, phase, platform }) {
  if (!PHASES.has(phase)) throw new TypeError(`phase: unsupported value ${phase}`);
  if (!PLATFORMS.has(platform)) throw new TypeError(`platform: unsupported value ${platform}`);
  const required = phase === 'render' ? INPUTS.render : INPUTS[phase][platform];
  const missing = required.filter(([, name]) => !env[name]);
  if (missing.length > 0) {
    const formatted = missing.map(([kind, name]) => `${kind} ${name}`).join(', ');
    throw new TypeError(
      `${phase}/${platform}: missing GitHub release environment inputs: ${formatted}`,
    );
  }
  if (phase === 'sign' && platform === 'desktop') {
    let key;
    try {
      key = Buffer.from(env.APPLE_API_KEY_BASE64, 'base64').toString('utf8');
    } catch {
      throw new TypeError('sign/desktop: secret APPLE_API_KEY_BASE64 must be valid base64');
    }
    if (!key.includes('BEGIN PRIVATE KEY') || !key.includes('END PRIVATE KEY')) {
      throw new TypeError(
        'sign/desktop: secret APPLE_API_KEY_BASE64 must encode an App Store Connect .p8 key',
      );
    }
  }
  if (phase === 'upload' && platform === 'desktop' && !RE_R2_ACCOUNT_ID.test(env.R2_ACCOUNT_ID)) {
    throw new TypeError(
      'upload/desktop: secret R2_ACCOUNT_ID must be a lowercase 32-hex Cloudflare account ID',
    );
  }
}

function runCli(argv = process.argv.slice(2), env = process.env) {
  const { values } = require('node:util').parseArgs({
    args: argv,
    options: { phase: { type: 'string' }, platform: { type: 'string' } },
    strict: true,
  });
  if (!values.phase) throw new TypeError('--phase is required');
  if (!values.platform) throw new TypeError('--platform is required');
  validateReleaseInputs({ env, phase: values.phase, platform: values.platform });
  console.log(`validated ${values.phase}/${values.platform} release inputs`);
}

if (require.main === module) runCli();

module.exports = { validateReleaseInputs };
