module.exports = {
  ci: {
    collect: {
      // Use the built static files
      staticDistDir: './dist',
      // Test these URLs (relative paths)
      url: ['/', '/posts/shroomdog-picks-20260212-karpathy-deepwiki-bacterial-code/', '/en/'],
      numberOfRuns: 3, // Run 3 times for stability
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.8 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['warn', { minScore: 0.9 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './quality/lighthouse-reports',
    },
  },
};
