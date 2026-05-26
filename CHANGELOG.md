# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).

## [0.3.0] - 2026-05-25

### Added

- Improved validation messaging in SOQL Explorer with auto-dismiss
- Sortable column headers across all explorers
- Multi-area crawler workflows and documentation
- Collapsible sections in SOQL Explorer for improved organization
- Enhanced field access audit with improved error handling and empty state displays
- SOQL Explorer filter bar positioned above editor, 25-row preview, parent field flattening, and export notifications
- Field access audit modal and backend functionality

### Changed

- Enhanced sortable column styling and configuration
- Improved SOQL Explorer collapsible section styling
- Refactored custom field detection logic for field access auditing

### Fixed

- Corrected smoke crawler asset placement
- Restored object explorer type checking

## [0.2.2] - 2026-05-24

### Added

- Add SOQL explorer screenshots and update README documentation

## [0.2.1] - 2026-05-22

### Changed

- Internal maintenance and tooling updates

## [0.2.0] - 2026-05-22

### Added

- SOQL Explorer for querying Salesforce objects with searchable SObject autocomplete
- Download functionality for REST request history

### Changed

- Standardized UI design system with BEM button naming

### Fixed

- Improved Tooling API support in SOQL service

## [0.1.6] - 2026-05-21

### Changed

- Improved Create Scratch Org modal layout and spacing

### Fixed

- Fixed snapshot query API to use Rest instead of Tooling
- Fixed error handling for already-expired or deleted resources

## [0.1.5] - 2026-05-20

The first release tracked in this changelog. MavMeta is a localhost control
center for Salesforce administrators and developers that turns complex org
management and metadata operations into a fast, modern, fully local experience.

### Added

- Org management — quick-switch between production, sandbox, and scratch orgs, single-click login to any authorized org in the browser, and a guided scratch org wizard
- Metadata discovery — browse and filter components across metadata types, preview raw component XML in-app, and see who last modified each component
- Object Manager (beta) — explore standard and custom objects and inspect child metadata such as fields and validation rules
- Metadata cart workflow — stage components from multiple types into a unified cart, run bulk actions, validate and deploy destructive changes with safety checks, and compare staged items across orgs before deploying
- REST Explorer — an interactive playground for testing and exploring Salesforce APIs
- LWC Playground — experiment with and preview Lightning Web Components locally
- Dark and light themes, fast search across types, components, and objects, and a fully local runtime that keeps credentials and metadata on your machine
