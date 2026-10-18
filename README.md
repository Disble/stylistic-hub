# Stylistic Hub

Windows desktop app that installs the Stylistic add-in into Microsoft Word and runs the local backend that analyzes documents with the model provider you sign in to. Suggestions arrive in Word as track changes and comments.

## Documentation

- [Architecture](docs/architecture.md): the system as a whole and the backend's design.
- [Roadmap](docs/roadmap.md): milestones reached and what comes next.
- [ADR 0001: component delivery](docs/adr/0001-component-delivery.md): why the hub becomes a launcher that installs and updates the server and modules on its own.
- [API v1](docs/api.md): the HTTP contract the add-in speaks.
- [Add-in contract](docs/addin-contract.md): what an add-in build must give the hub.
- [Development](docs/development.md): requirements, commands and hooks.

Agents start with [`AGENTS.md`](AGENTS.md).
