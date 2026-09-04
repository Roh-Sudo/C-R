# Backup and Recovery

The current demo adapter stores data in `.data/platform.json`, which is ignored by Git. Back it up only through protected local/hosting storage; never commit it if it contains customer data.

The production target is PostgreSQL with scheduled encrypted backups, tested restores, migration review, and organization-scoped deletion. A deployment should retain scan metadata, evidence metadata, and audit history according to explicit organization retention settings. Restore into an isolated environment first, validate migrations, then promote the recovered database.

This repository does not provide automatic backups. Backup guarantees depend on the chosen hosting platform.
