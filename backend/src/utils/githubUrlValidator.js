const validator = require('validator');

/**
 * Strictly validates and sanitizes GitHub repository URL.
 * Only github.com is allowed - no arbitrary URLs or command injection.
 * Returns normalized URL or throws.
 */
function validateAndSanitizeGitHubUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Repository URL is required');
  }

  const raw = input.trim();

  // Explicitly reject common non-HTTPS / local patterns early with clear messages
  if (/^(git@|ssh:\/\/)/i.test(raw)) {
    throw new Error('SSH Git URLs are not allowed. Use an HTTPS GitHub URL starting with https://github.com/');
  }
  if (/^file:\/\//i.test(raw)) {
    throw new Error('file:// URLs are not allowed. Use a public GitHub repository URL.');
  }
  if (/^([a-zA-Z]:\\|\\\\|\/)/.test(raw)) {
    throw new Error('Local filesystem paths are not allowed. Use a public GitHub repository URL.');
  }

  // Regex-level guard: must start with https://github.com/
  const githubPrefixRegex = /^https:\/\/github\.com\//i;
  if (!githubPrefixRegex.test(raw)) {
    throw new Error('Repository URL must start with https://github.com/');
  }

  let url = raw;

  // Must be a valid URL format
  if (!validator.isURL(url, { require_protocol: true })) {
    throw new Error('Invalid URL format');
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  // Only allow https (no file:, javascript:, etc.)
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS GitHub URLs are allowed');
  }

  // Strict host check: only github.com (no subdomains like raw.github.com for repo clone)
  if (parsed.hostname !== 'github.com') {
    throw new Error('Only github.com repository URLs are allowed');
  }

  // Path should look like /owner/repo or /owner/repo.git
  const pathMatch = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(\.git)?$/);
  if (!pathMatch) {
    throw new Error('URL must be in format: https://github.com/owner/repo');
  }

  // Secondary regex guard to avoid odd cases with query/fragment
  const finalUrl = `https://github.com/${pathMatch[1]}/${pathMatch[2]}`;
  const githubRepoRegex = /^https:\/\/github\.com\/[^/]+\/[^/]+$/i;
  if (!githubRepoRegex.test(finalUrl)) {
    throw new Error('URL must be a GitHub repository in the form https://github.com/owner/repo');
  }

  // Rebuild a clean URL (no fragments, no suspicious query params)
  const sanitized = `${finalUrl}.git`;

  return sanitized;
}

module.exports = { validateAndSanitizeGitHubUrl };
