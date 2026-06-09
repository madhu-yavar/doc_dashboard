/**
 * Health Monitor - Phase 2A Implementation
 *
 * Provides health monitoring and observability for dual-write operations.
 * Tracks metrics and provides health status endpoints.
 *
 * Phase 2A Scope: Auth + Documents domains only
 */

class DualWriteHealthMonitor {
  constructor() {
    this.metrics = {
      total_writes: 0,
      successful_dual_writes: 0,
      postgres_failures: 0,
      file_failures: 0,
      last_check: null,
      domain_metrics: {
        auth: { writes: 0, failures: 0 },
        documents: { writes: 0, failures: 0 }
      }
    };

    this.startup_time = new Date().toISOString();
  }

  /**
   * Record a write operation
   */
  async recordWrite(domain, operation, success, error = null) {
    this.metrics.total_writes++;
    this.metrics.last_check = new Date().toISOString();

    if (!this.metrics.domain_metrics[domain]) {
      this.metrics.domain_metrics[domain] = { writes: 0, failures: 0 };
    }

    this.metrics.domain_metrics[domain].writes++;

    if (success) {
      this.metrics.successful_dual_writes++;
    } else {
      if (error && error.is_postgres) {
        this.metrics.postgres_failures++;
        this.metrics.domain_metrics[domain].failures++;
      } else {
        this.metrics.file_failures++;
      }
    }
  }

  /**
   * Get health status
   */
  getHealthStatus() {
    return {
      status: this.calculateHealthStatus(),
      metrics: this.getMetrics(),
      recommendations: this.getRecommendations(),
      uptime_seconds: this.calculateUptime()
    };
  }

  /**
   * Calculate overall health status
   */
  calculateHealthStatus() {
    const totalOps = this.metrics.total_writes;
    const failureRate = totalOps > 0 ? (this.metrics.postgres_failures / totalOps) : 0;

    if (this.metrics.file_failures > 0) {
      return 'unhealthy'; // Filesystem failures are critical
    } else if (failureRate > 0.1) {
      return 'unhealthy'; // >10% failure rate
    } else if (failureRate > 0.05) {
      return 'degraded'; // >5% failure rate
    } else if (totalOps === 0) {
      return 'initializing'; // No operations yet
    } else {
      return 'healthy'; // ≤5% failure rate
    }
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      uptime_seconds: this.calculateUptime(),
      success_rate: this.calculateSuccessRate()
    };
  }

  /**
   * Calculate success rate percentage
   */
  calculateSuccessRate() {
    const totalOps = this.metrics.total_writes;
    if (totalOps === 0) return 100;

    return ((this.metrics.successful_dual_writes / totalOps) * 100).toFixed(2);
  }

  /**
   * Calculate uptime since startup
   */
  calculateUptime() {
    const startup = new Date(this.startup_time);
    const now = new Date();
    return Math.floor((now - startup) / 1000);
  }

  /**
   * Get operational recommendations
   */
  getRecommendations() {
    const recommendations = [];
    const totalOps = this.metrics.total_writes;
    const failureRate = totalOps > 0 ? (this.metrics.postgres_failures / totalOps) : 0;

    // Critical filesystem issues
    if (this.metrics.file_failures > 0) {
      recommendations.push('CRITICAL: Filesystem failures detected - immediate investigation required');
    }

    // High postgres failure rate
    if (this.metrics.postgres_failures > 10) {
      recommendations.push(`Review repair queue - ${this.metrics.postgres_failures} PostgreSQL failures detected`);
    }

    // Elevated failure rate
    if (failureRate > 0.05) {
      recommendations.push(`PostgreSQL failure rate ${(failureRate * 100).toFixed(1)}% - investigate connection issues`);
    }

    // Domain-specific issues
    Object.keys(this.metrics.domain_metrics).forEach(domain => {
      const domainMetrics = this.metrics.domain_metrics[domain];
      const domainFailureRate = domainMetrics.writes > 0 ? (domainMetrics.failures / domainMetrics.writes) : 0;

      if (domainFailureRate > 0.1) {
        recommendations.push(`${domain.charAt(0).toUpperCase() + domain.slice(1)} domain: High failure rate - investigate ${domain} operations`);
      }
    });

    // Positive status
    if (totalOps > 100 && this.metrics.successful_dual_writes === totalOps) {
      recommendations.push('Dual-write operating normally - all systems healthy');
    } else if (totalOps > 0 && this.metrics.postgres_failures === 0) {
      recommendations.push('No PostgreSQL failures detected - system operating normally');
    }

    return recommendations;
  }

  /**
   * Get domain-specific health status
   */
  getDomainHealth(domain) {
    if (!this.metrics.domain_metrics[domain]) {
      return {
        domain,
        status: 'unknown',
        writes: 0,
        failures: 0,
        failure_rate: 0
      };
    }

    const domainMetrics = this.metrics.domain_metrics[domain];
    const failureRate = domainMetrics.writes > 0 ? (domainMetrics.failures / domainMetrics.writes) : 0;

    return {
      domain,
      status: this.calculateDomainStatus(failureRate),
      writes: domainMetrics.writes,
      failures: domainMetrics.failures,
      failure_rate: (failureRate * 100).toFixed(2) + '%'
    };
  }

  /**
   * Calculate health status for a specific domain
   */
  calculateDomainStatus(failureRate) {
    if (failureRate === 0) return 'healthy';
    if (failureRate < 0.05) return 'healthy';
    if (failureRate < 0.1) return 'degraded';
    return 'unhealthy';
  }

  /**
   * Reset metrics (use with caution)
   */
  resetMetrics() {
    this.metrics = {
      total_writes: 0,
      successful_dual_writes: 0,
      postgres_failures: 0,
      file_failures: 0,
      last_check: null,
      domain_metrics: {
        auth: { writes: 0, failures: 0 },
        documents: { writes: 0, failures: 0 }
      }
    };
    this.startup_time = new Date().toISOString();
  }

  /**
   * Get metrics summary for dashboard
   */
  getDashboardSummary() {
    return {
      overall_status: this.calculateHealthStatus(),
      total_operations: this.metrics.total_writes,
      success_rate: this.calculateSuccessRate() + '%',
      uptime: this.formatUptime(this.calculateUptime()),
      domains: {
        auth: this.getDomainHealth('auth'),
        documents: this.getDomainHealth('documents')
      },
      recent_recommendations: this.getRecommendations().slice(0, 3)
    };
  }

  /**
   * Format uptime for display
   */
  formatUptime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  }
}

module.exports = { DualWriteHealthMonitor };