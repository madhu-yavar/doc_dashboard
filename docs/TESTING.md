# Testing Guide

**Project:** Doctor Dashboard - Clinical Intelligence System  
**Version:** 3.0.0  
**Last Updated:** 2026-05-13

---

## Table of Contents

1. [Testing Overview](#testing-overview)
2. [Testing Setup](#testing-setup)
3. [Types of Tests](#types-of-tests)
4. [Running Tests](#running-tests)
5. [Writing Tests](#writing-tests)
6. [Test Coverage](#test-coverage)
7. [Continuous Integration](#continuous-integration)
8. [Troubleshooting Tests](#troubleshooting-tests)

---

## Testing Overview

### Testing Philosophy

The Doctor Dashboard project follows a **multi-layered testing approach**:

1. **Unit Tests** - Test individual functions and components
2. **Integration Tests** - Test interactions between modules
3. **End-to-End Tests** - Test complete user workflows
4. **Performance Tests** - Validate system performance under load

### Testing Stack

- **Test Runner:** Vitest for unit/integration tests
- **E2E Framework:** Playwright for browser automation
- **Assertion Library:** Vitest built-in assertions
- **Mock Library:** Vitest built-in mocking
- **Coverage Tool:** Vitest coverage (c8)

---

## Testing Setup

### Initial Setup

```bash
# Install testing dependencies
npm install --save-dev vitest @vitest/ui @playwright/test

# Initialize Playwright (for E2E tests)
npx playwright install
```

### Configuration Files

#### Vitest Configuration ([vitest.config.ts](vitest.config.ts))
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'c8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/']
    }
  }
});
```

#### Playwright Configuration ([playwright.config.ts](playwright.config.ts))
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/test',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

---

## Types of Tests

### 1. Unit Tests

Test individual functions, components, and modules in isolation.

**When to use:**
- Testing pure functions
- Validating business logic
- Testing utility functions
- Component behavior testing

**Example locations:**
- [src/test/processed-documents.test.ts](src/test/processed-documents.test.ts)
- [src/test/medications-detail.test.tsx](src/test/medications-detail.test.tsx)

### 2. Integration Tests

Test interactions between multiple modules or components.

**When to use:**
- Testing API endpoints
- Validating database operations
- Testing component integration
- Agent and skill interactions

**Example locations:**
- [tests/test_dashboard_flow.cjs](tests/test_dashboard_flow.cjs)
- [tests/test_labs_meds.cjs](tests/test_labs_meds.cjs)

### 3. End-to-End Tests

Test complete user workflows from start to finish.

**When to use:**
- Testing critical user paths
- Validating complete features
- Testing cross-component workflows
- Browser compatibility testing

**Example locations:**
- [src/test/upload-center.test.tsx](src/test/upload-center.test.tsx)

### 4. Performance Tests

Test system performance and resource usage.

**When to use:**
- Validating response times
- Testing concurrent user handling
- Database query performance
- LLM response time validation

**Example locations:**
- [docs/testing/performance.md](docs/testing/performance.md)

---

## Running Tests

### Basic Test Commands

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test -- extractDemographics

# Run tests matching pattern
npm test -- --grep "medication"
```

### Running Specific Test Suites

```bash
# Unit tests only
npm test -- src/lib/

# Integration tests
npm test -- tests/

# E2E tests
npx playwright test

# UI tests only
npm test -- src/components/ui/
```

### Running Tests by Category

```bash
# Backend/Agent tests
node tests/test_dashboard_flow.cjs
node tests/test_discharge_extraction.cjs

# LLM evaluation tests
node scripts/evaluate_prescription_stage3_prompts.cjs

# Performance tests
node experiments/performance_test.cjs
```

---

## Writing Tests

### Unit Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { extractMedications } from './lib/extractors';

describe('Medication Extraction', () => {
  let sampleDocument;
  
  beforeEach(() => {
    sampleDocument = {
      text: 'Prescribed: Aspirin 100mg daily'
    };
  });

  describe('extraction logic', () => {
    it('should extract medication names correctly', () => {
      const result = extractMedications(sampleDocument);
      expect(result.medications).toContain('Aspirin');
    });

    it('should handle empty documents', () => {
      const result = extractMedications({ text: '' });
      expect(result.medications).toEqual([]);
    });

    it('should extract dosage information', () => {
      const result = extractMedications(sampleDocument);
      expect(result.medications[0].dosage).toBe('100mg');
    });
  });

  describe('error handling', () => {
    it('should throw error for invalid input', () => {
      expect(() => extractMedications(null)).toThrow();
    });
  });
});
```

### Component Testing

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import MedicationCard from './MedicationCard';

describe('MedicationCard Component', () => {
  const mockMedication = {
    name: 'Aspirin',
    dosage: '100mg',
    frequency: 'daily'
  };

  it('should render medication name', () => {
    render(<MedicationCard medication={mockMedication} />);
    expect(screen.getByText('Aspirin')).toBeInTheDocument();
  });

  it('should display dosage information', () => {
    render(<MedicationCard medication={mockMedication} />);
    expect(screen.getByText('100mg')).toBeInTheDocument();
  });

  it('should handle missing data gracefully', () => {
    render(<MedicationCard medication={{}} />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });
});
```

### Integration Testing

```javascript
const { processDocument } = require('../agents/document_type_router.cjs');

describe('Document Processing Integration', () => {
  it('should process discharge summary completely', async () => {
    const testFile = './data/test_discharge_summary.pdf';
    const result = await processDocument(testFile);
    
    expect(result.status).toBe('success');
    expect(result.extracted_data).toBeDefined();
    expect(result.extracted_data.demographics).toBeDefined();
    expect(result.extracted_data.medications).toBeDefined();
  });

  it('should handle invalid document types', async () => {
    const result = await processDocument('./data/invalid.txt');
    expect(result.status).toBe('error');
    expect(result.error).toContain('unsupported document type');
  });
});
```

### Mocking External Dependencies

```typescript
import { vi } from 'vitest';
import { fetchPatientData } from './lib/api';

// Mock LLM client
vi.mock('../tools/llm/gemma_client.tool.cjs', () => ({
  gemmaClient: {
    execute: vi.fn(() => Promise.resolve({
      text: 'Mocked LLM response'
    }))
  }
}));

describe('Patient Data Fetching', () => {
  it('should handle LLM errors gracefully', async () => {
    const { gemmaClient } = await import('../tools/llm/gemma_client.tool.cjs');
    gemmaClient.execute.mockRejectedValueOnce(new Error('LLM timeout'));
    
    const result = await fetchPatientData('patient123');
    expect(result.error).toBeDefined();
  });
});
```

---

## Test Coverage

### Coverage Goals

| Area | Target Coverage | Current Status |
|------|----------------|----------------|
| Utility Functions | 90%+ | 🟢 Good |
| Business Logic | 85%+ | 🟡 Medium |
| React Components | 80%+ | 🟡 Medium |
| API Endpoints | 75%+ | 🟢 Good |
| Agent/Skills | 70%+ | 🟡 Medium |

### Generating Coverage Reports

```bash
# Generate coverage report
npm test -- --coverage

# View HTML coverage report
open coverage/index.html

# Check coverage for specific file
npm test -- --coverage src/lib/extractors
```

### Coverage Exclusions

```javascript
// vitest.config.ts
coverage: {
  exclude: [
    'node_modules/',
    'src/test/',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.config.ts',
    'src/main.tsx',
    'src/vite-env.d.ts'
  ]
}
```

---

## Continuous Integration

### CI/CD Integration

Tests run automatically on:
- Every pull request
- Every push to main branch
- Scheduled nightly builds

### CI Test Pipeline

```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
      - run: npm run test:e2e
      - uses: codecov/codecov-action@v3
```

### Test Status Checks

Before merging:
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] E2E tests pass on critical paths
- [ ] Coverage threshold maintained
- [ ] No performance regressions

---

## Troubleshooting Tests

### Common Issues

#### Flaky Tests

**Problem:** Tests pass sometimes but fail other times

```typescript
// Bad: Unreliable timing
it('should update after delay', () => {
  updateComponent();
  setTimeout(() => {
    expect(element).toBeVisible();
  }, 1000); // Race condition
});

// Good: Use async/await
it('should update after delay', async () => {
  updateComponent();
  await waitFor(() => {
    expect(element).toBeVisible();
  });
});
```

#### Async Issues

**Problem:** Tests fail due to async operations

```typescript
// Bad: Not waiting for promises
it('should fetch data', () => {
  fetchData(); // Not awaited
  expect(data).toBeDefined(); // Fails
});

// Good: Proper async handling
it('should fetch data', async () => {
  await fetchData();
  expect(data).toBeDefined();
});
```

#### Mock Failures

**Problem:** Mocks not working as expected

```typescript
// Clear mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

// Verify mock calls
expect(mockFunction).toHaveBeenCalledWith(expectedArgs);
expect(mockFunction).toHaveBeenCalledTimes(1);
```

### Debugging Tests

```bash
# Run tests in debug mode
npm test -- --inspect-brk

# Run single test file with verbose output
npm test -- extractDemications --reporter=verbose

# Run tests with UI
npm test -- --ui
```

### Test Performance Issues

```bash
# Profile slow tests
npm test -- --reporter=verbose

# Run tests in series (slower but easier to debug)
npm test -- --run --reporter=verbose --no-coverage
```

---

## Testing Best Practices

### General Guidelines

1. **Arrange, Act, Assert** pattern
2. **One assertion per test** when possible
3. **Descriptive test names** that explain what is being tested
4. **Test behavior, not implementation**
5. **Keep tests simple** and focused
6. **Mock external dependencies** appropriately
7. **Clean up** after tests (use afterEach/afterAll)

### Test Organization

```typescript
// Good: Clear test structure
describe('Feature Name', () => {
  describe('when condition X', () => {
    it('should do Y', () => {
      // Test implementation
    });
  });
});
```

### Avoid Anti-Patterns

```typescript
// Bad: Testing implementation details
it('should use useState hook', () => {
  // Don't test how React works
});

// Good: Testing behavior
it('should update display when data changes', () => {
  // Test what user experiences
});
```

---

## Specialized Testing Scenarios

### LLM Response Testing

```typescript
describe('LLM Integration', () => {
  it('should handle timeout gracefully', async () => {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), 100)
    );
    
    await expect(extractWithTimeout(timeoutPromise, 50))
      .rejects.toThrow('extraction timeout');
  });
});
```

### File Upload Testing

```typescript
describe('File Upload', () => {
  it('should validate file type', () => {
    const invalidFile = new File(['content'], 'test.txt', {
      type: 'text/plain'
    });
    
    expect(() => validateUploadFile(invalidFile))
      .toThrow('Invalid file type');
  });
});
```

### Authentication Testing

```typescript
describe('Authentication', () => {
  it('should redirect unauthenticated users', async () => {
    const result = render(<DashboardPage />);
    await waitFor(() => {
      expect(result.router.pathname).toBe('/login');
    });
  });
});
```

---

## Test Maintenance

### Regular Maintenance Tasks

- **Update tests** when features change
- **Remove obsolete tests** for deprecated features
- **Refactor duplicate test code** into utilities
- **Review test coverage** regularly
- **Update test data** to reflect current requirements

### Test Data Management

```typescript
// test/fixtures.ts
export const testFixtures = {
  validMedication: {
    name: 'Aspirin',
    dosage: '100mg',
    frequency: 'daily'
  },
  invalidMedication: {
    name: '',
    dosage: 'invalid'
  }
};
```

---

## Additional Resources

### Internal Documentation
- [API Testing Guide](guides/api-reference.md)
- [Performance Testing](testing/performance.md)
- [LLM Evaluation](testing/llm-evaluation.md)

### External Resources
- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Library](https://testing-library.com/)
- [React Testing Best Practices](https://react.dev/learn/testing)

---

**Last Updated:** 2026-05-13  
**Maintained by:** Development Team  
**Questions?** Contact the development team or create an issue in the repository.