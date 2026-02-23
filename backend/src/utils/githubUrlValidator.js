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

  let url = input.trim();

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

  // Rebuild a clean URL (no fragments, no suspicious query params)
  const cleanPath = `/${pathMatch[1]}/${pathMatch[2].replace(/\.git$/, '')}`;
  const sanitized = `https://github.com${cleanPath}.git`;

  return sanitized;
}

module.exports = { validateAndSanitizeGitHubUrl };
