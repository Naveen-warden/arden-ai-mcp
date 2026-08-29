import { createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { exportJWK, importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import { MCP_JWT_KEY_ID, MCP_JWT_PRIVATE_KEY } from "../environment";
import { authBridgeConfig } from "./config";

const ALGORITHM = "EdDSA";
const TOKEN_TYPE = "at+jwt";
const TOKEN_USE = "mcp_access";

export type McpAccessTokenClaims = {
  sub: string;
  permission_id: string;
  client_id: string;
  scope: string;
  token_use: typeof TOKEN_USE;
  jti: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
};

const configSchema = z.object({
  issuer: z.string().min(1),
  audience: z.string().min(1),
  keyId: z.string().min(1),
  privateKeyPem: z.string().min(1),
  accessTokenTtlSeconds: z.number().positive(),
});

const inputSchema = z.object({
  userId: z.union([z.string(), z.number()]),
  permissionId: z.union([z.string(), z.number()]),
  clientId: z.string().min(1),
  scope: z.string().min(1),
});

export function createMcpJwtService(config: z.infer<typeof configSchema>) {
  const { issuer, audience, keyId, privateKeyPem, accessTokenTtlSeconds } =
    configSchema.parse({
      ...config,
      privateKeyPem: config.privateKeyPem.replace(/\\n/g, "\n").trim(),
    });

  const privateKeyObject = createPrivateKey(privateKeyPem);

  if (privateKeyObject.asymmetricKeyType !== "ed25519") {
    throw new Error("MCP JWT private key must be an Ed25519 key");
  }

  const publicKeyPem = createPublicKey(privateKeyObject)
    .export({ type: "spki", format: "pem" })
    .toString();

  const privateKey = importPKCS8(privateKeyPem, ALGORITHM);
  const publicKey = importSPKI(publicKeyPem, ALGORITHM);

  return {
    async signAccessToken(input: unknown) {
      const { userId, permissionId, clientId, scope } =
        inputSchema.parse(input);

      return new SignJWT({
        permission_id: String(permissionId),
        client_id: clientId,
        scope,
        token_use: TOKEN_USE,
      })
        .setProtectedHeader({
          alg: ALGORITHM,
          kid: keyId,
          typ: TOKEN_TYPE,
        })
        .setIssuer(issuer)
        .setSubject(String(userId))
        .setAudience(audience)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime(`${accessTokenTtlSeconds}s`)
        .sign(await privateKey);
    },

    async verifyAccessToken(token: string) {
      const { payload, protectedHeader } = await jwtVerify(
        token,
        await publicKey,
        {
          algorithms: [ALGORITHM],
          issuer,
          audience,
        },
      );

      if (protectedHeader.kid !== keyId || protectedHeader.typ !== TOKEN_TYPE) {
        throw new Error("Invalid MCP JWT headers");
      }

      if (
        typeof payload.sub !== "string" ||
        !payload.sub ||
        typeof payload.permission_id !== "string" ||
        !payload.permission_id ||
        typeof payload.client_id !== "string" ||
        !payload.client_id ||
        typeof payload.scope !== "string" ||
        !payload.scope ||
        payload.token_use !== TOKEN_USE ||
        typeof payload.jti !== "string" ||
        !payload.jti
      ) {
        throw new Error("Invalid MCP token type");
      }

      return payload as McpAccessTokenClaims;
    },

    async getPublicJwks() {
      const jwk = await exportJWK(await publicKey);

      return {
        keys: [
          {
            ...jwk,
            alg: ALGORITHM,
            kid: keyId,
            use: "sig",
          },
        ],
      };
    },
  };
}

let service: ReturnType<typeof createMcpJwtService>;

export function getMcpJwtService() {
  if (!service) {
    service = createMcpJwtService({
      issuer: authBridgeConfig.issuer,
      audience: authBridgeConfig.mcpResourceUrl,
      privateKeyPem: MCP_JWT_PRIVATE_KEY ?? "",
      keyId: MCP_JWT_KEY_ID ?? "",
      accessTokenTtlSeconds: authBridgeConfig.mcpAccessTokenTtlMs / 1000,
    });
  }

  return service;
}
