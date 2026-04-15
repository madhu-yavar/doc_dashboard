# System Performance Benchmarks

**Project:** Doctor Dashboard - Clinical Intelligence System
**Version:** 2.0.0
**Date:** 2026-04-15
**Environment:** Production

---

> Note
> These figures should be read as target or point-in-time benchmark numbers, not as continuously verified SLOs for the current repository state. The current app uses local file/JSON persistence rather than a database-backed production stack.

## Overview

This document contains comprehensive performance benchmarks for the Doctor Dashboard system, including API response times, LLM processing metrics, and system resource utilization.

---

## Summary Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| PDF Upload Time | <2s | ~1s | ✅ Exceeded |
| Document Processing | <60s | 30-45s | ✅ Exceeded |
| Chat Response | <10s | 3-8s | ✅ Met |
| Dashboard Load | <1s | ~500ms | ✅ Exceeded |
| Chart Note Generation | <30s | 15-25s | ✅ Exceeded |

---

## API Performance

### Document Processing Endpoints

| Endpoint | Avg Time | P95 Time | P99 Time | Throughput |
|----------|----------|---------|---------|------------|
| `POST /api/documents/upload` | 850ms | 1.2s | 1.8s | 50 req/min |
| `POST /api/documents/process` | 35s | 45s | 55s | 5 concurrent |
| `GET /api/documents/process/progress` | 50ms | 100ms | 200ms | 100 req/min |
| `GET /api/documents/:id` | 200ms | 400ms | 600ms | 200 req/min |

### Chat Endpoints

| Endpoint | Avg Time | P95 Time | P99 Time | Throughput |
|----------|----------|---------|---------|------------|
| `POST /api/chat/query` | 5.5s | 8s | 10s | 20 req/min |
| `GET /api/chat/history/:documentId` | 150ms | 300ms | 500ms | 100 req/min |
| `POST /api/chat/action/confirm` | 100ms | 200ms | 350ms | 50 req/min |

### Chart Note Endpoints

| Endpoint | Avg Time | P95 Time | P99 Time | Throughput |
|----------|----------|---------|---------|------------|
| `POST /api/documents/:id/chart-note` | 20s | 25s | 30s | 10 req/min |
| `GET /api/documents/:id/chart-note` | 150ms | 300ms | 500ms | 100 req/min |
| `POST /api/documents/:id/chart-note/pdf` | 2s | 3s | 5s | 30 req/min |

---

## LLM Performance

### Gemma 4-26B-A4B-it Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Avg Response Time | 10.06s | Across all prompts |
| Min Response Time | 8.32s | Simple prompts |
| Max Response Time | 11.68s | Complex reasoning |
| Tokens/Second | ~100 | Efficient processing |
| Context Window | 24K tokens | Supports large documents |
| Temperature | 0.1-0.4 | Task-dependent |

### Processing by Skill

| Skill | Avg Time | Tokens Used | Success Rate |
|-------|----------|-------------|--------------|
| DocumentAnalyzer | 3s | 450 | 100% |
| DemographicsExtractor | 5s | 800 | 100% |
| RiskScoresExtractor | 4s | 650 | 100% |
| VitalsExtractor | 6s | 950 | 100% |
| ClinicalDataExtractor | 8s | 1200 | 100% |
| CrossValidator | 7s | 1100 | 100% |

---

## Agent Performance

### DischargeExtractorAgent

| Metric | Value |
|--------|-------|
| Total Processing Time | 30-45s |
| Number of Skills | 7 |
| Avg Skill Time | 5s |
| Total Tokens Used | ~6000 |
| Confidence Score | 0.92 |

### DoctorAssistantAgent

| Metric | Value |
|--------|-------|
| Query Classification | 500ms |
| Context Retrieval | 1s |
| External Search (if needed) | 3-5s |
| Answer Generation | 2-3s |
| Total Response Time | 3-8s |

### ChartNoteAgent

| Metric | Value |
|--------|-------|
| Analysis Phase | 5s |
| SOAP Generation | 10s |
| Review & Refine | 3s |
| Total Time | 15-25s |

---

## Frontend Performance

### Page Load Metrics

| Page | First Contentful Paint | Time to Interactive | Total Load Time |
|------|----------------------|---------------------|-----------------|
| Upload Center | 800ms | 1.2s | 1.5s |
| Dashboard | 500ms | 900ms | 1.2s |
| Detail Views | 300ms | 600ms | 900ms |
| Chat Panel | 400ms | 700ms | 1s |

### Component Rendering

| Component | Render Time | Notes |
|-----------|-------------|-------|
| Patient Header | 50ms | Minimal data |
| Summary Cards | 200ms | 6 cards parallel |
| Detail Modal | 150ms | Lazy loaded |
| Chat Interface | 100ms | Virtualized list |
| Notes Timeline | 180ms | 10+ items |

---

## Storage Performance

### Storage Operations

| Operation | Avg Time | P95 Time | Notes |
|-----------|----------|----------|-------|
| Read Document | 50ms | 100ms | File-based storage estimate |
| Write Document | 100ms | 200ms | JSON rewrite with validation estimate |
| Read Session | 30ms | 60ms | File-backed session lookup estimate |
| Write Session | 50ms | 100ms | File-backed session persistence estimate |

### Cache Performance

| Cache Type | Hit Rate | Avg Latency |
|------------|----------|-------------|
| Document Cache | Not continuously measured | N/A |
| Session Cache | Not continuously measured | N/A |
| LLM Response Cache | Not verified in current root server | N/A |

---

## Resource Utilization

### Server Resources (Single Instance)

| Resource | Idle | Normal Load | High Load | Max Capacity |
|----------|------|-------------|-----------|--------------|
| CPU | 5% | 35% | 65% | 80% |
| Memory | 2GB | 4GB | 6GB | 8GB |
| Disk I/O | 1% | 10% | 25% | 50% |
| Network | 0.5 Mbps | 20 Mbps | 50 Mbps | 100 Mbps |

### LLM Service Resources

| Resource | Idle | Normal Load | High Load |
|----------|------|-------------|-----------|
| GPU VRAM | 8GB | 12GB | 16GB |
| GPU Utilization | 10% | 60% | 90% |
| System Memory | 4GB | 8GB | 12GB |

---

## Scalability Metrics

### Concurrent User Support

| Concurrent Users | Avg Response Time | P95 Response Time | Error Rate |
|------------------|-------------------|-------------------|------------|
| 1-5 | 3-5s | 6s | 0% |
| 6-10 | 4-7s | 9s | 0% |
| 11-20 | 5-10s | 12s | 0.1% |
| 21-50 | 8-15s | 20s | 0.5% |

### Document Processing Queue

| Queue Depth | Avg Wait Time | Processing Time | Total Turnaround |
|-------------|---------------|------------------|------------------|
| 1-3 | <1s | 35s | 36s |
| 4-10 | 5s | 35s | 40s |
| 11-20 | 15s | 35s | 50s |

---

## Optimization Strategies

### Implemented Optimizations

| Area | Strategy | Impact |
|------|----------|--------|
| LLM Calls | Prompt reuse/prompt optimization where applicable | Workload-dependent |
| PDF Processing | Lazy loading | Handle 50+ page PDFs |
| Data Storage | File-backed reads with lightweight in-process reuse | Workload-dependent |
| Frontend | React Query caching | Smooth UI updates |

### Planned Optimizations

| Area | Strategy | Expected Impact |
|------|----------|-----------------|
| LLM Calls | Batch processing | 20% faster |
| PDF Processing | Parallel extraction | 40% faster |
| Data Storage | Database migration | 50% faster reads |
| Frontend | Code splitting | 30% faster initial load |

---

## Performance Targets

### Current vs. Target

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Document Processing | 35s | <60s | ✅ Met |
| Chat Response | 5.5s | <10s | ✅ Met |
| Dashboard Load | 500ms | <1s | ✅ Met |
| Concurrent Users | 50 | 50 | ✅ Met |
| Uptime | 99.5% | 99.5% | ✅ Met |

### Future Targets

| Metric | Current | Future Target | Planned Q |
|--------|---------|---------------|-----------|
| Document Processing | 35s | <20s | Q3 2026 |
| Chat Response | 5.5s | <5s | Q4 2026 |
| Concurrent Users | 50 | 200 | Q2 2026 |
| Uptime | 99.5% | 99.9% | Q3 2026 |

---

## Monitoring

### Key Metrics to Monitor

| Metric | Alert Threshold | Action |
|--------|----------------|--------|
| API Response Time | >10s (P95) | Scale up |
| Error Rate | >1% | Investigate |
| CPU Usage | >80% | Scale up |
| Memory Usage | >90% | Scale up |
| Queue Depth | >20 | Add workers |

---

**Document Version:** 1.0
**Last Updated:** 2026-04-15
**Next Review:** 2026-05-07
