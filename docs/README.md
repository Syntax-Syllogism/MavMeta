# MavMeta Documentation

Welcome to the MavMeta documentation. This directory contains comprehensive guides for using and developing MavMeta.

## Quick Navigation

### For Users

Start here if you're using MavMeta:

- **[Features Guide](features-guide.md)** — Complete walkthroughs of all MavMeta features
  - Org Management, Metadata Explorer, Object Manager
  - Cart Workflow, Deployments, REST/SOQL Explorers
  - LWC Playground, Scratch Org Management
  - Tips, keyboard shortcuts, and best practices

- **[Configuration Guide](configuration.md)** — Environment variables and setup
  - Backend & frontend port configuration
  - Packaged CLI options (`mavmeta --help`, `mavmeta --version`)
  - Salesforce CLI integration
  - Scratch org definitions
  - Production deployment

- **[Troubleshooting Guide](troubleshooting.md)** — Common issues and fixes
  - Session/auth errors
  - Port conflicts
  - Metadata operations
  - Deploy issues
  - Quick reference table

### For Developers

Building on MavMeta or contributing code:

- **[Developer Guide](developer-guide.md)** — Architecture and extending
  - Architecture overview (frontend, backend, services)
  - Project structure walkthrough
  - Backend service layer & security
  - Frontend components & state management
  - Step-by-step: adding a new feature
  - Testing patterns
  - Debugging & performance tips

- **[API Reference](api-reference.md)** — Complete endpoint documentation
  - Session management
  - Org management endpoints
  - Metadata operations
  - Deployment APIs
  - REST, SOQL, LWC endpoints
  - Error response formats
  - Request/response examples

### For Security

- **[Security](security.md)** — Full threat model and mitigations
  - Threat actors and assets
  - Network model (binding, CORS, session token)
  - Credential protection
  - Destructive operation safeguards
  - How to verify security claims locally

---

## Documentation by Use Case

### "I want to use MavMeta to..."

**...manage multiple Salesforce orgs**
→ [Features Guide: Org Management](features-guide.md#org-management)

**...find and deploy metadata**
→ [Features Guide: Metadata Cart Workflow](features-guide.md#metadata-cart-workflow)

**...write and test SOQL queries**
→ [Features Guide: SOQL Explorer](features-guide.md#soql-explorer)

**...build or edit Lightning Web Components**
→ [Features Guide: LWC Playground](features-guide.md#lwc-playground)

**...set up environment variables**
→ [Configuration: Environment Variables](configuration.md#environment-variables)

**...run the packaged CLI or check its version**
→ [Configuration: Running the CLI](configuration.md#running-the-cli)

**...troubleshoot an error**
→ [Troubleshooting Guide](troubleshooting.md) (use the quick reference table)

### "I want to extend MavMeta by..."

**...understanding the architecture**
→ [Developer Guide: Architecture Overview](developer-guide.md#architecture-overview)

**...adding a new API endpoint**
→ [Developer Guide: Adding a New Feature](developer-guide.md#adding-a-new-feature)

**...writing tests**
→ [Developer Guide: Testing](developer-guide.md#testing)

**...debugging the frontend or backend**
→ [Developer Guide: Debugging](developer-guide.md#debugging)

**...checking all available endpoints**
→ [API Reference](api-reference.md)

---

## File Sizes & Overview

| Document                                 | Size   | Purpose                                |
| ---------------------------------------- | ------ | -------------------------------------- |
| [features-guide.md](features-guide.md)   | ~14 KB | User walkthrough of all features       |
| [developer-guide.md](developer-guide.md) | ~19 KB | Architecture, code patterns, extending |
| [api-reference.md](api-reference.md)     | ~14 KB | Complete endpoint reference            |
| [troubleshooting.md](troubleshooting.md) | ~19 KB | Common issues and solutions            |
| [configuration.md](configuration.md)     | ~9 KB  | Setup, env vars, tuning                |
| [security.md](security.md)               | ~9 KB  | Threat model, mitigations              |

---

## Key Resources

### Within MavMeta

- [README.md](../README.md) — Project overview, getting started
- [AGENTS.md](../AGENTS.md) — Project structure, coding conventions, testing
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Contribution guidelines
- [CHANGELOG.md](../CHANGELOG.md) — Version history
- [SECURITY.md](../SECURITY.md) — Security vulnerability reporting

### External

- [Salesforce Metadata API](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/)
- [Salesforce REST API](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/)
- [Svelte 5 Documentation](https://svelte.dev/docs)
- [Fastify Documentation](https://www.fastify.io/)

---

## Search Tips

Looking for something specific? Use these keywords:

### Authentication & Orgs

- [Org Management](features-guide.md#org-management) in Features Guide
- [Org Management](api-reference.md#org-management) in API Reference
- [Troubleshooting: Org Issues](troubleshooting.md#org-management)

#### Metadata & Components

- [Metadata Explorer](features-guide.md#metadata-explorer) in Features Guide
- [Metadata Operations](api-reference.md#metadata-operations) in API Reference
- [Developer: Backend Services](developer-guide.md#backend-architecture)

#### Deployments & Carts

- [Metadata Cart Workflow](features-guide.md#metadata-cart-workflow) in Features Guide
- [Deployment API](api-reference.md#deployment) in API Reference
- [Troubleshooting: Deploy Issues](troubleshooting.md#deploy--cart)

#### Configuration & Setup

- [Configuration Guide](configuration.md)
- [Developer: Environment Setup](developer-guide.md#environment-variables)

#### Errors & Debugging

- [Troubleshooting Guide](troubleshooting.md) (comprehensive issue list)
- [Developer: Debugging](developer-guide.md#debugging)

#### Security

- [Security Model](security.md)
- [Configuration: Security](configuration.md#security-configuration)

---

## Feedback & Questions

- **Bug reports** → [GitHub Issues](https://github.com/Syntax-Syllogism/MavMeta/issues)
- **Feature requests** → [GitHub Issues](https://github.com/Syntax-Syllogism/MavMeta/issues)
- **Security concerns** → [SECURITY.md](../SECURITY.md)
- **Documentation improvements** → [Contribute](../CONTRIBUTING.md)

---

## Documentation Roadmap

This documentation covers:

✅ User features and workflows  
✅ Complete API reference  
✅ Developer architecture & patterns  
✅ Configuration & environment  
✅ Security model  
✅ Troubleshooting & common issues

---

## Getting Started

**First time here?**

1. Read [README.md](../README.md) for a quick overview
1. Follow the getting-started instructions
1. Pick a feature from [Features Guide](features-guide.md)
1. If something breaks, check [Troubleshooting](troubleshooting.md)

**Want to extend MavMeta?**

1. Start with [Developer Guide: Architecture](developer-guide.md#architecture-overview)
1. Review [AGENTS.md](../AGENTS.md) for code conventions
1. Follow [Developer Guide: Adding a Feature](developer-guide.md#adding-a-new-feature)
1. Check [API Reference](api-reference.md) for endpoint patterns
1. Run tests: `npm run test`

---

Last updated: 2026-10-28

See [CHANGELOG.md](../CHANGELOG.md) for what's new in each version.
