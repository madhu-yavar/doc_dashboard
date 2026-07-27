/**
 * Simple Test Runner for Service Layer Tests
 *
 * Basic test runner that can execute our service tests without heavy framework dependencies
 */

const fs = require('fs');
const path = require('path');

class SimpleTestRunner {
  constructor() {
    this.tests = [];
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0
    };
    this.currentSuite = null;
  }

  describe(suiteName, testFn) {
    const parentSuite = this.currentSuite;
    this.currentSuite = suiteName;

    try {
      testFn.call(this);
    } catch (error) {
      console.error(`Error in suite "${suiteName}":`, error.message);
    }

    this.currentSuite = parentSuite;
  }

  test(testName, testFn) {
    this.tests.push({
      suite: this.currentSuite,
      name: testName,
      fn: testFn,
      status: 'pending'
    });
    this.results.total++;
  }

  async runTest(test) {
    const fullName = test.suite ? `${test.suite} > ${test.name}` : test.name;
    process.stdout.write(`  ○ ${fullName}... `);

    try {
      await test.fn();
      test.status = 'passed';
      this.results.passed++;
      process.stdout.write('✓ PASS\n');
      return true;
    } catch (error) {
      test.status = 'failed';
      this.results.failed++;
      process.stdout.write('✗ FAIL\n');
      console.error(`    Error: ${error.message}`);
      if (error.stack) {
        console.error(`    Stack: ${error.stack.split('\n').slice(1, 3).join('\n    ')}`);
      }
      return false;
    }
  }

  async run() {
    console.log('🧪 Running Service Layer Tests...\n');

    for (const test of this.tests) {
      await this.runTest(test);
    }

    this.printSummary();
    return this.results.failed === 0;
  }

  printSummary() {
    console.log('\n📊 Test Results:');
    console.log(`   Total:  ${this.results.total}`);
    console.log(`   ✓ Pass: ${this.results.passed}`);
    console.log(`   ✗ Fail: ${this.results.failed}`);
    console.log(`   ⊘ Skip: ${this.results.skipped}`);

    const passRate = this.results.total > 0
      ? ((this.results.passed / this.results.total) * 100).toFixed(1)
      : 0;
    console.log(`   Success Rate: ${passRate}%`);

    if (this.results.failed === 0) {
      console.log('\n✅ All tests passed!');
    } else {
      console.log(`\n❌ ${this.results.failed} test(s) failed`);
    }
  }
}

// Mock functions for jest compatibility
const mockFn = () => {
  const fn = (...args) => {
    fn.mock.calls.push(args);
    return fn.mockReturnValue || undefined;
  };

  fn.mock = { calls: [] };
  fn.mockReturnValue = undefined;
  fn.mockResolvedValue = undefined;
  fn.mockRejectedValue = undefined;
  fn.mockClear = () => { fn.mock.calls = []; };
  fn.mockImplementation = (impl) => { fn.mock.impl = impl; };
  fn.mockResolvedValue = (value) => { fn.mockReturnValue = Promise.resolve(value); };
  fn.mockRejectedValue = (value) => { fn.mockReturnValue = Promise.reject(value); };
  fn.mockReturnValue = (value) => { fn.mock.rv = value; };
  fn.fn = fn;

  return fn;
};

// Make describe and test available globally
global.describe = function(name, fn) {
  testRunner.describe(name, fn);
};

global.test = global.it = function(name, fn) {
  testRunner.test(name, fn);
};

global.expect = function(actual) {
  return {
    toBe: (expected) => {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toEqual: (expected) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toHaveProperty: (prop) => {
      if (!actual.hasOwnProperty(prop)) {
        throw new Error(`Expected object to have property "${prop}"`);
      }
    },
    toThrow: (expectedError) => {
      let threw = false;
      try {
        if (typeof actual === 'function') {
          actual();
        }
      } catch (error) {
        threw = true;
        if (expectedError && !error.message.includes(expectedError)) {
          throw new Error(`Expected error to contain "${expectedError}" but got "${error.message}"`);
        }
      }
      if (!threw) {
        throw new Error('Expected function to throw an error');
      }
    },
    toBeGreaterThan: (expected) => {
      if (actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeGreaterThanOrEqual: (expected) => {
      if (actual < expected) {
        throw new Error(`Expected ${actual} to be greater than or equal to ${expected}`);
      }
    },
    toBeLessThan: (expected) => {
      if (actual >= expected) {
        throw new Error(`Expected ${actual} to be less than ${expected}`);
      }
    },
    toBeLessThanOrEqual: (expected) => {
      if (actual > expected) {
        throw new Error(`Expected ${actual} to be less than or equal to ${expected}`);
      }
    },
    toHaveLength: (expected) => {
      if (!Array.isArray(actual) || actual.length !== expected) {
        throw new Error(`Expected array to have length ${expected} but got ${actual.length}`);
      }
    },
    toContain: (expected) => {
      if (!Array.isArray(actual) || !actual.includes(expected)) {
        throw new Error(`Expected array to contain ${expected}`);
      }
    },
    toBeNull: () => {
      if (actual !== null) {
        throw new Error(`Expected null but got ${actual}`);
      }
    },
    toBeTruthy: () => {
      if (!actual) {
        throw new Error(`Expected truthy value but got ${actual}`);
      }
    },
    toBeFalsy: () => {
      if (actual) {
        throw new Error(`Expected falsy value but got ${actual}`);
      }
    },
    toBeDefined: () => {
      if (actual === undefined) {
        throw new Error('Expected defined value but got undefined');
      }
    },
    arrayContaining: (expected) => {
      return {
        asymmetricMatch: (actual) => {
          if (!Array.isArray(actual)) return false;
          return expected.every(item =>
            actual.some(act => JSON.stringify(act) === JSON.stringify(item))
          );
        }
      };
    },
    objectContaining: (expected) => {
      return {
        asymmetricMatch: (actual) => {
          if (typeof actual !== 'object' || actual === null) return false;
          return Object.keys(expected).every(key =>
            JSON.stringify(actual[key]) === JSON.stringify(expected[key])
          );
        }
      };
    },
    any: (constructor) => {
      return {
        asymmetricMatch: (actual) => {
          return actual instanceof constructor || typeof actual === constructor.name.toLowerCase();
        }
      };
    },
    stringContaining: (expected) => {
      return {
        asymmetricMatch: (actual) => {
          return typeof actual === 'string' && actual.includes(expected);
        }
      };
    }
  };
};

global.jest = {
  fn: mockFn,
  spyOn: () => mockFn()
};

// Create test runner instance
const testRunner = new SimpleTestRunner();

// Load and run tests
async function runTests() {
  const testFiles = [
    './server/repositories/tests/basic_functional_test.cjs',
    './server/repositories/tests/inpatient_journey_test.cjs'
  ];

  for (const testFile of testFiles) {
    try {
      console.log(`\n📁 Loading ${testFile}...`);
      require(path.resolve(testFile));
    } catch (error) {
      console.error(`Failed to load ${testFile}:`, error.message);
    }
  }

  const success = await testRunner.run();
  process.exit(success ? 0 : 1);
}

// Run the tests
runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});