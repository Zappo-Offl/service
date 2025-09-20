# Zappo Service - Rollback and Commit Management Guide

## Project Overview
- **Repository**: https://github.com/charan0318/zappo
- **Project Type**: Node.js WhatsApp ETH wallet bot
- **Current Branch**: rollback-ETH (fully rebranded to ETH)
- **Latest Commit**: 6db9f37 "fix"

## Current Situation
The repository has a `rollback-ETH` branch that appears to be synchronized with master. Both branches point to the same commit (6db9f37). Project has been successfully rebranded from AVAX to ETH with all references updated.

## Available Git Operations

### 1. Rollback to Previous Commit
```bash
# View commit history
git log --oneline -10

# Rollback to specific commit (soft reset - keeps changes)
git reset --soft <commit-hash>

# Rollback to specific commit (hard reset - removes changes)
git reset --hard <commit-hash>

# Create a new commit that reverts changes
git revert <commit-hash>
```

### 2. Branch Management
```bash
# Create backup branch before rollback
git checkout -b backup-$(date +%Y%m%d)

# Switch between branches
git checkout master
git checkout rollback-ETH

# Compare branches
git diff master..rollback-ETH
```

### 3. Commit Fixes
```bash
# Amend last commit
git commit --amend -m "Fixed commit message"

# Interactive rebase for multiple commits
git rebase -i HEAD~n

# Cherry-pick specific commits
git cherry-pick <commit-hash>
```

## Recent Changes Analysis
Latest commit (6db9f37) includes:
- TestUSDC.js and testARB.js test files added
- Configuration updates in src/config/index.js
- Transaction handler refactoring (425 lines changed)
- Database and service layer updates

## Development Guidelines
- Always create backup branches before major rollbacks
- Use descriptive commit messages
- Test thoroughly after rollback operations
- Document rollback procedures in commit messages

## VS Code Extensions Installed
- Node.js Extension Pack
- GitLens (for enhanced Git visualization)
- Git History (for commit history viewing)