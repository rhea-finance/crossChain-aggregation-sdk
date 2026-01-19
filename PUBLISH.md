# Publishing Guide

## Create GitHub Repository

1. Visit https://github.com/rhea-finance
2. Click "New repository"
3. Repository name: `crossChain-aggregation-dex`
4. Description: `Cross-chain DEX aggregation SDK for multi-chain token swaps and routing`
5. Select Public
6. Do not initialize README, .gitignore, or license (we already have them)
7. Click "Create repository"

## Initialize Git and Push Code

```bash
cd cross-chain-dex-aggregator-sdk

# Initialize Git
git init

# Add remote repository
git remote add origin https://github.com/rhea-finance/crossChain-aggregation-dex.git

# Add all files
git add .

# Commit
git commit -m "Initial commit: Cross-chain DEX Aggregation SDK"

# Push to main branch
git branch -M main
git push -u origin main
```

## Publish to npm (Optional)

If you need to publish to npm:

1. Login to npm:
   ```bash
   npm login
   ```

2. Update version:
   ```bash
   npm version patch  # or minor, major
   ```

3. Build project:
   ```bash
   pnpm build
   ```

4. Publish:
   ```bash
   npm publish --access public
   ```

## Version Management

Use Semantic Versioning (SemVer):
- `MAJOR`: Incompatible API changes
- `MINOR`: Backward-compatible feature additions
- `PATCH`: Backward-compatible bug fixes

## Tags and Releases

Create Release on GitHub:

1. Visit the repository's Releases page
2. Click "Create a new release"
3. Select tag (e.g., v1.0.0)
4. Fill in release title and description
5. Publish
