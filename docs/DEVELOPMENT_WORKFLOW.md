# Development Workflow Guide

**Project:** Doctor Dashboard - Clinical Intelligence System  
**Version:** 3.0.0  
**Last Updated:** 2026-05-13

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Environment Setup](#development-environment-setup)
3. [Daily Development Workflow](#daily-development-workflow)
4. [Code Standards and Conventions](#code-standards-and-conventions)
5. [Testing Practices](#testing-practices)
6. [Git Workflow](#git-workflow)
7. [Debugging and Troubleshooting](#debugging-and-troubleshooting)
8. [Deployment Process](#deployment-process)

---

## Getting Started

### Prerequisites

Before starting development, ensure you have:

- **Node.js** 18+ installed
- **npm** or **yarn** package manager
- Access to **Gemma LLM API** (for local development)
- **Git** for version control
- **VS Code** or preferred IDE
- **Docker** (for containerized development)

### Initial Setup

```bash
# Clone the repository
git clone <repository-url>
cd doctor-dashboard

# Install dependencies
npm install

# Copy environment template (DO NOT commit actual .env)
cp .env.example .env

# Configure your local environment
# Edit .env with your local API endpoints and keys

# Start development servers
npm run dev    # Frontend on :5173
npm run server # Backend on :8001
```

---

## Development Environment Setup

### Environment Configuration

1. **Create `.env.development`** for local development:
```bash
# Frontend
VITE_API_URL=http://localhost:8001

# Backend
PORT=8001
NODE_ENV=development

# LLM Configuration
GEMMA_URL=http://localhost:8000/v1/chat/completions
GEMMA_MODEL=google/gemma-4-26B-A4B-it
```

2. **Never commit** `.env` files - use `.env.example` as template

### IDE Setup

#### VS Code Extensions (Recommended)
- ESLint
- Prettier
- TypeScript and JavaScript Language Features
- REST Client (for API testing)
- GitLens (for Git history)

#### VS Code Settings
Create `.vscode/settings.json`:
```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

---

## Daily Development Workflow

### 1. Start Development Day

```bash
# Pull latest changes
git pull origin main

# Check for new dependencies
npm install

# Start backend (Terminal 1)
npm run server

# Start frontend (Terminal 2)
npm run dev

# Run tests in watch mode (Terminal 3 - optional)
npm run test:watch
```

### 2. Making Changes

#### Feature Development Workflow

1. **Create feature branch:**
```bash
git checkout -b feature/your-feature-name
```

2. **Make changes** following code standards
3. **Test locally** using provided test suites
4. **Commit changes** with descriptive messages
5. **Push and create PR** for review

#### Bug Fix Workflow

1. **Create bugfix branch:**
```bash
git checkout -b fix/bug-description
```

2. **Write reproduction test** (if applicable)
3. **Implement fix** with test coverage
4. **Verify fix** resolves the issue
5. **Document changes** in commit message

### 3. Code Quality Checks

Before committing:

```bash
# Run linter
npm run lint

# Run tests
npm test

# Build frontend (check for build errors)
npm run build
```

---

## Code Standards and Conventions

### File Naming Conventions

- **Components:** PascalCase - `PatientDashboard.tsx`
- **Utilities:** camelCase - `formatDate.ts`
- **Constants:** UPPER_SNAKE_CASE - `API_ENDPOINTS.ts`
- **Styles:** kebab-case - `patient-dashboard.css`

### Code Organization

#### Frontend Structure
```
src/
├── components/
│   ├── ui/           # Reusable UI components
│   └── dashboard/    # Dashboard-specific components
├── pages/            # Page-level components
├── lib/              # Utilities and helpers
├── hooks/            # Custom React hooks
├── types/            # TypeScript type definitions
└── styles/           # Global styles
```

#### Backend Structure
```
server/
├── index.cjs         # Main server file
├── storage/          # Data persistence
├── auth_service.cjs  # Authentication logic
└── analytics_store.cjs # Database operations

agents/
├── core/             # Base agent classes
├── extraction/       # Extraction agents
└── *                 # Specialized agents

skills/
├── extraction/       # Extraction skills
├── validation/       # Validation skills
└── presentation/     # Presentation skills

tools/
├── llm/              # LLM client tools
├── pdf/              # PDF processing tools
└── clinical/         # Clinical data tools
```

### Coding Standards

#### TypeScript/JavaScript
- **Use TypeScript** for all new frontend code
- **Prefer const** over let (immutability)
- **Use arrow functions** for callbacks
- **Avoid any types** - use proper TypeScript types
- **Document complex logic** with JSDoc comments

#### React Best Practices
- **Functional components** with hooks (no class components)
- **Props destructuring** for cleaner code
- **Custom hooks** for reusable logic
- **Memoization** for expensive computations
- **Error boundaries** for error handling

#### Backend Best Practices
- **Async/await** over callbacks
- **Error handling** with try-catch blocks
- **Input validation** on all endpoints
- **Status codes** following HTTP standards
- **Logging** with appropriate levels

### Comment Standards

```typescript
/**
 * Extracts patient demographics from clinical document
 * @param document - The clinical document object
 * @param options - Extraction options
 * @returns Patient demographics object
 * @throws Error if document is invalid
 */
async function extractDemographics(
  document: ClinicalDocument,
  options: ExtractionOptions
): Promise<Demographics> {
  // Implementation
}
```

---

## Testing Practices

### Test Organization

```
src/test/
├── setup.ts              # Test configuration
├── *.test.ts             # Unit tests
└── *.test.tsx            # Component tests

tests/
├── test_*.cjs            # Integration tests
└── *.md                  # Test results and summaries
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- extractDemographics

# Run integration tests
node tests/test_dashboard_flow.cjs
```

### Writing Tests

#### Unit Tests (Vitest)

```typescript
import { describe, it, expect } from 'vitest';
import { extractMedications } from './lib/extractors';

describe('Medication Extraction', () => {
  it('should extract medication names correctly', () => {
    const document = {
      text: 'Prescribed: Aspirin 100mg daily'
    };
    const result = extractMedications(document);
    expect(result.medications).toContain('Aspirin');
  });

  it('should handle empty documents', () => {
    const result = extractMedications({ text: '' });
    expect(result.medications).toEqual([]);
  });
});
```

#### Integration Tests

```javascript
describe('Document Processing Flow', () => {
  it('should process discharge summary end-to-end', async () => {
    const result = await processDocument('discharge_summary.pdf');
    expect(result.status).toBe('success');
    expect(result.extracted_data).toBeDefined();
  });
});
```

### Test Coverage Goals

- **Unit Tests:** 80%+ coverage for utility functions
- **Integration Tests:** Cover critical user flows
- **E2E Tests:** Cover main business scenarios
- **Performance Tests:** Validate LLM response times

---

## Git Workflow

### Branch Strategy

- `main` - Production-ready code
- `develop` - Integration branch (if using)
- `feature/*` - New features
- `fix/*` - Bug fixes
- `refactor/*` - Code refactoring
- `docs/*` - Documentation updates

### Commit Message Standards

```bash
# Format: <type>(<scope>): <description>

# Types
feat:     New feature
fix:      Bug fix
docs:     Documentation changes
style:    Code style changes (formatting)
refactor: Code refactoring
test:     Adding or updating tests
chore:    Maintenance tasks

# Examples
feat(extraction): add handwriting detection capability
fix(auth): resolve session timeout issue
docs(readme): update setup instructions
refactor(agents): simplify agent state management
```

### Pull Request Guidelines

1. **Title:** Follow commit message format
2. **Description:** Include:
   - What changes were made
   - Why changes were needed
   - How changes were tested
   - Screenshots (if UI changes)
3. **Assign reviewers** from team
4. **Ensure CI/CD checks pass**
5. **Resolve review comments** before merge

### Code Review Process

1. **Self-review** before requesting reviews
2. **Address all comments** or explain why not
3. **Keep PRs focused** - one logical change per PR
4. **Test review changes** before approval

---

## Debugging and Troubleshooting

### Common Issues and Solutions

#### Backend Issues

**Issue:** Server won't start
```bash
# Check port availability
lsof -i :8001

# Check environment variables
cat .env | grep PORT

# Check server logs
tail -f server.log
```

**Issue:** LLM connection timeout
```bash
# Test LLM endpoint
curl http://localhost:8000/v1/chat/completions

# Check timeout configuration
grep EXTRACTION_GEMMA_TIMEOUT_MS .env

# Increase timeout if needed
EXTRACTION_GEMMA_TIMEOUT_MS=600000
```

#### Frontend Issues

**Issue:** Build failures
```bash
# Clear build artifacts
rm -rf dist node_modules
npm install
npm run build

# Check TypeScript errors
npx tsc --noEmit
```

**Issue:** API connection errors
```bash
# Check API URL configuration
grep VITE_API_URL .env

# Test API health
curl http://localhost:8001/api/health
```

### Debugging Tools

#### Backend Debugging
- **Console logging:** Use `console.log()` for debugging (remove in production)
- **Node.js debugger:** Use Chrome DevTools or VS Code debugger
- **Request inspection:** Use middleware to log requests

#### Frontend Debugging
- **React DevTools:** Browser extension for component inspection
- **Browser DevTools:** Network tab for API calls
- **Console logging:** Use `console.log()` for debugging

### Performance Debugging

```bash
# Profile Node.js performance
node --prof server/index.cjs

# Analyze frontend bundle
npm run build -- --mode analyze

# Check database performance
sqlite3 server/storage/analytics.sqlite ".schema"
```

---

## Deployment Process

### Pre-Deployment Checklist

- [ ] All tests pass (`npm test`)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] No ESLint errors (`npm run lint`)
- [ ] Environment variables configured
- [ ] Database migrations run (if applicable)
- [ ] Security audit passed (`npm audit`)
- [ ] Documentation updated

### Development Deployment

```bash
# Build frontend
npm run build

# Start production server
NODE_ENV=production npm run server
```

### Docker Deployment

```bash
# Build image
docker build -t doctor-dashboard:latest .

# Run container
docker run -d \
  --name doctor-dashboard \
  -p 8001:8001 \
  --env-file .env.production \
  -v $(pwd)/server/storage:/app/server/storage \
  doctor-dashboard:latest
```

### Production Deployment

See [deployment.md](operations/deployment.md) for complete production deployment procedures.

---

## Development Best Practices

### Daily Workflow

1. **Start day:** Pull latest changes, check for issues
2. **Development:** Work on feature branches with frequent commits
3. **Testing:** Write tests alongside code
4. **Code review:** Participate in team reviews
5. **Documentation:** Update docs as needed
6. **End day:** Push work, create PRs if ready

### Code Review Etiquette

- **Be constructive:** Focus on code, not person
- **Explain reasoning:** Help others understand
- **Be responsive:** Address reviews promptly
- **Learn from feedback:** Use reviews to improve

### Continuous Improvement

- **Stay updated:** Keep dependencies current
- **Share knowledge:** Document learnings
- **Automate tasks:** Create scripts for repetitive work
- **Monitor performance:** Keep an eye on system health

---

## Additional Resources

### Internal Documentation
- [API Reference](guides/api-reference.md)
- [Architecture Documentation](architecture/)
- [Security Guidelines](operations/security.md)

### External Resources
- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Express.js Guide](https://expressjs.com/en/guide/routing.html)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

---

**Last Updated:** 2026-05-13  
**Maintained by:** Development Team  
**Questions?** Contact the development team or create an issue in the repository.
