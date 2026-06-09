/**
 * Dual-Write Infrastructure - Phase 2A Implementation
 *
 * Central export point for dual-write components.
 * Provides unified interface to dual-write functionality.
 *
 * Phase 2A Scope: Auth + Documents domains only
 */

const { DualWriteManager } = require('./dual_write_manager.cjs');
const { ParityChecker } = require('./parity_checker.cjs');
const { DualWriteHealthMonitor } = require('./health_monitor.cjs');

// Export all dual-write components
module.exports = {
  DualWriteManager,
  ParityChecker,
  DualWriteHealthMonitor,

  // Factory function to get initialized health monitor
  getHealthMonitor: () => {
    return new DualWriteHealthMonitor();
  },

  // Factory function to get parity checker
  getParityChecker: () => {
    return new ParityChecker();
  },

  // Factory function to get dual-write manager
  getDualWriteManager: () => {
    return new DualWriteManager();
  }
};
