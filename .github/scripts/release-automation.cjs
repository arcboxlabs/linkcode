const { Buffer } = require('node:buffer');

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[\dA-Z][\d.A-Z-]*)?$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PENDING_LABEL = 'autorelease: pending';
const TAGGED_LABEL = 'autorelease: tagged';

function labelNames(pull) {
  return pull.labels.flatMap((label) => (label.name ? [label.name] : []));
}

function requireOne(items, description) {
  if (items.length !== 1) {
    throw new Error(`Expected one ${description}, found ${items.length}`);
  }
  return items[0];
}

async function fileAtRef({ github, owner, path, ref, repo }) {
  const { data } = await github.rest.repos.getContent({ owner, path, ref, repo });
  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`Expected ${path} at ${ref} to be a file`);
  }
  return data;
}

async function releasesForTag({ github, owner, repo, tag }) {
  const releases = await github.paginate(github.rest.repos.listReleases, {
    owner,
    repo,
    per_page: 100,
  });
  return releases.filter((release) => release.tag_name === tag);
}

async function tagSha({ github, owner, repo, tag }) {
  try {
    const { data } = await github.rest.git.getRef({ owner, repo, ref: `tags/${tag}` });
    return data.object.sha;
  } catch (error) {
    if (error.status === 404) return;
    throw error;
  }
}

async function resolveCandidate({ core, github, owner, repo, testedSha }) {
  const { data: associatedPulls } = await github.rest.repos.listPullRequestsAssociatedWithCommit({
    owner,
    repo,
    commit_sha: testedSha,
  });
  const candidates = associatedPulls.filter(
    (pull) =>
      pull.base.ref === 'master' &&
      pull.merge_commit_sha === testedSha &&
      pull.head.ref.startsWith('release-please--'),
  );

  if (candidates.length === 0) {
    core.setOutput('state', 'none');
    return;
  }
  const candidate = requireOne(candidates, `release-please PR for ${testedSha}`);
  const labels = labelNames(candidate);
  const pending = labels.includes(PENDING_LABEL);
  const tagged = labels.includes(TAGGED_LABEL);

  const packageFile = await fileAtRef({
    github,
    owner,
    repo,
    path: 'apps/desktop/package.json',
    ref: testedSha,
  });
  const version = JSON.parse(Buffer.from(packageFile.content, 'base64').toString()).version;
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error(`Invalid Desktop release version: ${version}`);
  }

  const tag = `v${version}`;
  const releases = await releasesForTag({ github, owner, repo, tag });
  if (releases.length > 1) throw new Error(`Found multiple matching releases for ${tag}`);

  const existingSha = await tagSha({ github, owner, repo, tag });
  if (existingSha && existingSha !== testedSha) {
    throw new Error(`${tag} already points to ${existingSha}, expected ${testedSha}`);
  }

  core.setOutput('sha', testedSha);
  core.setOutput('tag', tag);
  if (existingSha && releases.length === 1) {
    const release = releases[0];
    if (release.target_commitish !== testedSha) {
      throw new Error(`${tag} Release targets ${release.target_commitish}, expected ${testedSha}`);
    }
    if (!tagged) {
      await github.rest.issues.addLabels({
        owner,
        repo,
        issue_number: candidate.number,
        labels: [TAGGED_LABEL],
      });
    }
    if (pending) {
      await github.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: candidate.number,
        name: PENDING_LABEL,
      });
    }
    core.setOutput('state', 'done');
    return;
  }

  if (!pending) throw new Error(`Release PR for ${testedSha} is not pending`);
  const closedPulls = await github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: 'closed',
    base: 'master',
    sort: 'updated',
    direction: 'desc',
    per_page: 100,
  });
  const pendingPulls = closedPulls.filter(
    (pull) =>
      pull.merged_at &&
      pull.head.ref.startsWith('release-please--') &&
      labelNames(pull).includes(PENDING_LABEL),
  );
  const pendingPull = requireOne(pendingPulls, 'merged pending release-please PR');
  if (pendingPull.merge_commit_sha !== testedSha) {
    throw new Error(`Pending release PR does not match CI-tested ${testedSha}`);
  }
  core.setOutput('state', 'pending');
}

async function verifyConfig({ github, owner, repo, testedSha }) {
  const comparisons = await Promise.all(
    ['release-please-config.json', '.release-please-manifest.json'].map(async (path) => {
      const [tested, current] = await Promise.all([
        fileAtRef({ github, owner, repo, path, ref: testedSha }),
        fileAtRef({ github, owner, repo, path, ref: 'master' }),
      ]);
      return { current, path, tested };
    }),
  );
  for (const { current, path, tested } of comparisons) {
    if (current.sha !== tested.sha) {
      throw new Error(`${path} changed after CI-tested release candidate ${testedSha}`);
    }
  }
}

async function verifyStartedRelease({
  core,
  github,
  owner,
  releaseCreated,
  releasePleaseSha,
  releasePleaseTag,
  releaseSha,
  releaseTag,
  repo,
}) {
  if (!SHA_PATTERN.test(releaseSha)) throw new Error(`Invalid release SHA: ${releaseSha}`);
  if (releaseCreated !== 'true') {
    throw new Error('release-please did not create the expected Desktop draft');
  }
  if (releasePleaseSha !== releaseSha || releasePleaseTag !== releaseTag) {
    throw new Error('release-please output does not match the CI-tested release candidate');
  }

  const releases = await releasesForTag({ github, owner, repo, tag: releaseTag });
  const drafts = releases.filter(
    (release) => release.draft && release.target_commitish === releaseSha,
  );
  requireOne(drafts, `draft Release for ${releaseTag}`);
  const existingSha = await tagSha({ github, owner, repo, tag: releaseTag });
  if (existingSha !== releaseSha) {
    throw new Error(`${releaseTag} points to ${existingSha}, expected ${releaseSha}`);
  }
  await core.summary
    .addRaw(`Started signed Desktop release for ${releaseTag} at ${releaseSha}`)
    .write();
}

async function verifyDesktopRelease({ github, owner, repo, sha, tag }) {
  const release = requireOne(
    await releasesForTag({ github, owner, repo, tag }),
    `release-please Release for ${tag}`,
  );
  if (release.target_commitish !== sha) {
    throw new Error(`${tag} Release targets ${release.target_commitish}, expected ${sha}`);
  }
}

module.exports = {
  resolveCandidate,
  verifyConfig,
  verifyDesktopRelease,
  verifyStartedRelease,
};
