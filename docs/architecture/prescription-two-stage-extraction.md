# Prescription Two-Stage Extraction

> Historical architecture note
> This file originally captured a provider-specific prescription design. The detailed provider/model references have been intentionally removed. Current docs in this repository use only generic proprietary terminology.

## Purpose

This archived design described a two-stage prescription workflow:

1. Stage 1 extracts printed and structured header content.
2. Stage 2 evaluates whether additional handwriting work is required.
3. Stage 3 optionally extracts handwritten medications, vitals, diagnosis details, and marked lab selections.
4. The combined result is then validated and mapped into the shared dashboard contract.

## Historical Design Shape

The historical proposal separated prescription processing into:

- an on-prem proprietary extraction path for header and structured fields
- an optional secondary handwriting/vision path for difficult handwritten content
- masking and privacy controls before any optional external-provider step
- a fallback mode where partial structured output is still preserved if handwriting extraction is unavailable

## Key Architectural Ideas Worth Preserving

- keep printed-text extraction separate from handwriting extraction
- preserve partial results between stages
- require explicit user action before optional external-provider handwriting enhancement
- track review requirements instead of over-promoting incomplete prescription output
- keep dashboard mapping and validation as a final shared boundary

## Status

This document is retained only as an archive of the staged prescription concept. It should not be used as the source of truth for current implementation details, provider contracts, or runtime configuration.

For current repository behavior, use the active architecture and implementation documents linked from [docs/README.md](../README.md).
