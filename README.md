# Arden AI

Mastra application for understanding and automating work across the `arden-server` and `arden-admin` codebases.

## Commands

```shell
npm run dev
npm run knowledge:refresh
npm run routes:check
npm run type-check
npm run build
npm run mcp:server
```

Mastra Studio is available at [http://localhost:4111](http://localhost:4111) while the development server is running.

## Environment

```dotenv
OPENAI_API_KEY=...
ARDEN_AI_MODEL=openai/gpt-4o-mini
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=arden_code_chunks
# QDRANT_API_KEY=...
ARDEN_API_URL=http://localhost:5000/api/v1
ARDEN_ACCESS_TOKEN=...
ARDEN_PERMISSION_ID=...
# Generation-time only when arden-server cannot be auto-discovered:
# ARDEN_SERVER_PATH=/absolute/path/to/arden-server
```

`ARDEN_AI_MODEL` uses Mastra's `provider/model` format. Code-search tools do not require an LLM or `OPENAI_API_KEY`; agents do.

## Route Knowledge

The published application does not read the `arden-server` filesystem. Exact API routes are shipped in the versioned manifest:

```text
src/generated/arden-server-routes.json
```

Refresh it after route changes:

```shell
npm run knowledge:refresh
```

The generator reads `arden-server/src/routes`, records the backend Git commit, and writes every supported route to the manifest. `ARDEN_SERVER_PATH` is only needed while running this generator and is not required by the deployed application.

Use this command in CI after checking out both repositories:

```shell
npm run routes:check
```

It fails when the committed manifest does not match the checked-out `arden-server`. A normal `npm run build` intentionally uses the committed manifest and therefore works when only the Mastra repository is present.

## Structure

```text
src/
|-- codeChunks/              Shared embedding and semantic-search logic
|-- database/                Qdrant and other database infrastructure
|-- generated/               Versioned knowledge generated from source repos
|-- environment.ts           Environment configuration
`-- mastra/
    |-- agents/
    |   |-- arden-admin/
    |   `-- arden-server/
    |-- tools/
    |   |-- arden-admin/
    |   `-- arden-server/
    `-- index.ts             Mastra resource registration
```

Repository-specific tools enforce their repository filter internally. Shared Qdrant and embedding behavior belongs outside tool and agent definitions.

## Resources

Tools:

- `arden-server-code-search`
- `arden-server-resolve-api-endpoint`
- `arden-server-get-api-data`
- `arden-admin-code-search`

Agents:

- `arden-server-codebase-agent`
- `arden-admin-codebase-agent`

The search layer is compatible with the existing `arden_code_chunks` collection and uses `Xenova/bge-small-en` 384-dimensional normalized embeddings.

## MCP Server

The native `@mastra/mcp` server exposes these read-only tools:

- `arden-server-code-search`
- `arden-admin-code-search`
- `arden-server-resolve-api-endpoint`
- `arden-server-get-api-data`

It also exposes:

- `arden://knowledge/route-manifest`
- `arden://knowledge/usage-guide`

Start the stdio server for local MCP clients:

```shell
npm run mcp:server
```

Inspect it interactively:

```shell
npm run mcp:inspect
```

OpenCode local configuration:

```jsonc
{
  "mcp": {
    "arden-codebase": {
      "type": "local",
      "command": [
        "npm",
        "--silent",
        "--prefix",
        "/absolute/path/to/my-mastra-app",
        "run",
        "mcp:server"
      ],
      "enabled": true
    }
  }
}
```

When the Mastra HTTP server is running, the registered MCP server is also available at the Streamable HTTP endpoint:

```text
http://localhost:4111/api/mcp/arden-codebase/mcp
```
