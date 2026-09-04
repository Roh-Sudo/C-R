# Privacy Architecture

The scanner runs locally and sends data only when `--upload` is explicitly used.

Data that may leave the developer environment:

- redacted finding metadata and evidence
- AI provider, technology, model identifier when observable, file and line
- repository, branch, commit, pull request, workflow, and scan metadata

Data that does not leave the environment:

- repository source files
- complete secrets or credentials
- raw sensitive records
- complete AI prompts or model responses

The API does not intentionally log authorization headers, cookies, tokens, webhook signatures, source, or raw evidence. Local demo persistence is `.data/platform.json`; production deployments must use encrypted PostgreSQL storage, documented retention, access controls, backups, and deletion procedures.
