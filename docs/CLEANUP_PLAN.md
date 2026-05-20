# Repository Cleanup & Organization Plan

**Date:** 2026-05-13  
**Purpose:** Clean up dangling files and organize repository structure  
**Estimated Cleanup:** ~450MB + improved developer experience

---

## Current Issues

### 🚨 Critical Problems
1. **425MB archive directory** with duplicate code
2. **26 loose files** in root directory
3. **16MB test data** cluttering the repository
4. **Multiple experiment directories** with unclear purpose
5. **No clear separation** between active development and testing/experimental code

### 📊 Size Breakdown
```
archive/     - 425MB (duplicate old code)
data/        - 16MB  (test PDF files)
tmp/         - 7MB   (temporary files)
node_modules/ - ~500MB (normal, in .gitignore)
```

---

## Proposed Directory Structure

### ✅ Clean Structure
```
doctor-dashboard/
├── src/                    # Active frontend code
├── server/                 # Active backend code  
├── agents/                 # Active AI agents
├── skills/                 # Active skills
├── tools/                  # Active tools
├── tests/                  # Test suite (organized)
├── docs/                   # Documentation (organized)
├── scripts/                # Build/utility scripts
├── config/                 # Configuration files
├── k8s/                    # Kubernetes configs
├── helm/                   # Helm charts
├── public/                 # Static assets
├── .gitignore              # Updated to exclude clutter
└── package.json            # Root package.json
```

### 🗂️ Moved/Reorganized
```
research/                   # All experimental/research work
├── experiments/           # Moved from root experiments/
├── gemma_test/            # Moved from root gemma_test/
├── eda/                   # Moved from root eda/
├── ground_truth/          # Moved from root ground_truth/
├── prototype/             # Moved from root prototype/
└── archive/               # Consider moving to separate repo or Git LFS
```

---

## Detailed Cleanup Actions

### Phase 1: Root Directory Cleanup (Immediate)

#### Files to DELETE
```bash
# Remove temporary test files
rm test-department-alerts.cjs
rm test-pharmacy-alert.cjs  
rm debug-dashboard.cjs
rm check-react-structure.cjs

# Remove test output files
rm test-output-chartnote-12.md

# Consolidate Azure pipelines (keep main one)
rm .azure-pipelines-ci.yml
rm .azure-pipelines-cd.yml
rm .azure-pipelines-k8s-cd.yml
# Keep: azure-pipelines.yml (main config)
```

#### Files to MOVE
```bash
# Move documentation to docs/
mv DOCUMENT_TYPE_ROUTER_IMPLEMENTATION.md docs/architecture/
mv REACT_ARCHITECTURE.md docs/architecture/react-architecture-legacy.md

# Move data files to proper location
mkdir -p tests/fixtures/pdfs
mv data/*.pdf tests/fixtures/pdfs/
```

### Phase 2: Directory Reorganization

#### Create Research Directory
```bash
mkdir -p research/
mv experiments research/
mv gemma_test research/
mv eda research/
mv ground_truth research/
mv prototype research/
mv agent_extraction_review research/
```

#### Clean Up Individual Directories
```bash
# Archive cleanup (425MB!)
rm -rf archive/  # Or move to separate repository

# Tmp cleanup
rm -rf tmp/

# Other directories
rm -rf aca/
rm -rf ideology/
# Move memory/ to docs/ if it's documentation
```

### Phase 3: Configuration Consolidation

#### Docker Files
```bash
# Keep main docker files in root
# docker-compose.yml
# docker-compose.gpu.yml
# Dockerfile

# Consider adding docker/ directory for complex setups
mkdir -p docker/
# Move docker-specific configs if needed
```

#### Configuration Files
```bash
# Consolidate TypeScript configs
# Keep: tsconfig.json, tsconfig.app.json, tsconfig.node.json

# Keep components.json (shadcn/ui config)
# Keep vite.config.ts
```

---

## File Organization Standards

### Test Data Management
```
tests/
├── fixtures/
│   ├── pdfs/           # Test PDF documents
│   ├── json/           # Test JSON data
│   └── images/         # Test images
├── unit/               # Unit tests
├── integration/        # Integration tests  
└── e2e/                # End-to-end tests
```

### Research Organization
```
research/
├── experiments/        # LLM/extraction experiments
├── evaluation/         # Model evaluation results
├── ground_truth/       # Ground truth data
├── eda/                # Exploratory data analysis
└── archive/            # Old experimental code
```

### Documentation Organization
```
docs/
├── architecture/       # Architecture docs
├── guides/            # Developer guides
├── operations/        # Ops/deployment docs
├── research/          # Research findings
├── testing/           # Testing documentation
└── api/               # API reference
```

---

## Git Repository Actions

### Update .gitignore
```bash
# Add to .gitignore
data/
tmp/
*.tmp
documents.json.tmp
debug-*.cjs
test-*.cjs
experiments/results/
research/archive/
*.log

# Keep important files
!tests/fixtures/
```

### Git History Cleanup (Optional but Recommended)
```bash
# Remove large files from Git history
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch archive/*" \
  --prune-empty --tag-name-filter cat -- --all

# Clean up refs
git for-each-ref --format='delete %(refname)' refs/original | git update-ref --stdin
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### Consider Git LFS for Large Files
```bash
# Install Git LFS
git lfs install

# Track large files
git lfs track "*.pdf"
git lfs track "data/*"

# Migrate existing files
git lfs migrate import --include="*.pdf,data/*"
```

---

## Post-Cleanup Validation

### Checklist
- [ ] All tests still pass (`npm test`)
- [ ] Application starts correctly (`npm run dev`, `npm run server`)
- [ ] No broken imports or missing files
- [ ] Documentation links updated
- [ ] CI/CD pipelines still work
- [ ] Git repository size reduced
- [ ] .gitignore properly configured

### Size Comparison
```
Before: ~500MB (with 425MB archive)
After: ~75MB (without archive and clutter)
Reduction: ~85%
```

---

## Maintenance Going Forward

### Branch Strategy for Experiments
```bash
# Create research branches for experiments
git checkout -b research/new-experiment

# Merge findings to main when complete
# Keep experimental code in research/ directory
```

### Regular Cleanup Schedule
- **Weekly:** Clean tmp/ directories, remove debug files
- **Monthly:** Review and archive old experiments
- **Quarterly:** Review archive/ and remove obsolete code
- **Annually:** Major repository cleanup and reorganization

### Documentation Updates
- Keep docs/ organized and up-to-date
- Remove obsolete documentation
- Archive old docs to docs/archive/ instead of deleting

---

## Migration Script

### Automated Cleanup Script
```bash
#!/bin/bash
# cleanup-repo.sh

echo "Starting repository cleanup..."

# Phase 1: Remove obvious junk files
rm -f test-*.cjs
rm -f debug-*.cjs  
rm -f check-*.cjs
rm -f test-output-*.md

# Phase 2: Create organized structure
mkdir -p research
mkdir -p tests/fixtures/pdfs

# Phase 3: Move files to proper locations
mv experiments research/
mv gemma_test research/
mv eda research/
mv ground_truth research/
mv prototype research/

# Phase 4: Move test data
mv data/*.pdf tests/fixtures/pdfs/ 2>/dev/null || true
rmdir data 2>/dev/null || true

# Phase 5: Remove archive (be careful!)
read -p "Remove archive directory? (y/n): " confirm
if [ "$confirm" = "y" ]; then
    rm -rf archive/
fi

# Phase 6: Move documentation
mv DOCUMENT_TYPE_ROUTER_IMPLEMENTATION.md docs/architecture/
mv REACT_ARCHITECTURE.md docs/architecture/

echo "Cleanup complete! Please test your application."
```

---

## Expected Benefits

### ✅ Immediate Improvements
1. **85% repository size reduction** (500MB → 75MB)
2. **Faster git operations** (clone, pull, push)
3. **Clearer project structure** for new developers
4. **Better separation** of production vs experimental code
5. **Reduced confusion** about which code is active

### 📈 Long-term Benefits
1. **Easier onboarding** for new team members
2. **Better performance** in IDEs and editors
3. **Cleaner git history** and smaller repository size
4. **More professional** project structure
5. **Easier maintenance** and refactoring

---

## Risk Assessment

### ⚠️ Low Risk Changes
- Moving test files to tests/
- Moving documentation to docs/
- Removing temporary debug files
- Creating research/ directory

### 🟡 Medium Risk Changes  
- Removing archive/ directory (verify nothing needed)
- Moving experiment directories (check for active work)
- Updating .gitignore (verify nothing important ignored)

### 🔴 High Risk Changes
- Git history rewrite (coordinate with team)
- Changing import paths (thorough testing required)
- Removing data files (verify test suite doesn't need them)

---

## Implementation Timeline

### Week 1: Safe Cleanup
- Remove temporary files (test-*.cjs, debug-*.cjs)
- Move documentation to proper locations
- Update .gitignore

### Week 2: Directory Reorganization  
- Create research/ directory structure
- Move experimental directories
- Organize test fixtures

### Week 3: Deep Clean
- Review and remove archive/
- Clean up tmp/ and other clutter
- Update all import paths

### Week 4: Final Polish
- Git cleanup and LFS implementation
- Update documentation and README
- Team training on new structure

---

**Next Steps:** Review this plan with the team, backup the repository, and begin with Phase 1 safe cleanup.

**Questions to Consider:**
1. Is anyone actively using code in the archive/ directory?
2. Are the experiment results still needed for reference?
3. Should we use Git LFS for large PDF files?
4. Does the team agree with the proposed structure?