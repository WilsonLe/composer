import "server-only"

import crypto from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  CODEX_DEFAULT_MODEL,
  type CodexAuthorizationData,
  type CodexExchangeResult,
  expiresAtFromExpiresIn,
  refreshCodexAccessToken,
} from "@/lib/connectors/openai-codex-oauth"
import {
  DEEPGRAM_DEFAULT_MODEL,
  DEEPGRAM_PROVIDER_TYPE,
  SPEECH_TO_TEXT_CONNECTOR_TYPE,
  type DeepgramProjectsResponse,
} from "@/lib/connectors/deepgram"

const STORE_VERSION = 1
const CODEX_AUTHORIZATION_TTL_MS = 10 * 60 * 1000
const ENCRYPTION_ALGORITHM = "aes-256-gcm"
const DEFAULT_CONNECTOR_PRIORITY = 100

type EncryptedSecret = {
  algorithm: typeof ENCRYPTION_ALGORITHM
  iv: string
  tag: string
  value: string
}

type StoredCodexAuthorization = {
  authUrl: string
  codeVerifier: EncryptedSecret
  createdAt: string
  expiresAt: string
  id: string
  redirectUri: string
  state: EncryptedSecret
}

type StoredCodexConnection = {
  accessToken: EncryptedSecret
  chatgptAccountId?: string
  chatgptPlanType?: string
  createdAt: string
  defaultModel: string
  enabled: boolean
  id: string
  lastTokenRefreshAt?: string
  name: string
  openaiEmail: string
  priority: number
  refreshToken?: EncryptedSecret
  status: "connected" | "needs_reconnect" | "refresh_failed"
  statusMessage: string
  tokenExpiresAt?: string | null
  updatedAt: string
}

type StoredDeepgramConnection = {
  accountIdentifier?: string
  apiKey: EncryptedSecret
  createdAt: string
  defaultModel: string
  enabled: boolean
  id: string
  name: string
  priority: number
  projects?: DeepgramProjectsResponse
  providerType: typeof DEEPGRAM_PROVIDER_TYPE
  status: "connected" | "needs_reconnect"
  statusMessage: string
  type: typeof SPEECH_TO_TEXT_CONNECTOR_TYPE
  updatedAt: string
}

type ConnectorStoreFile = {
  codexAuthorizations: StoredCodexAuthorization[]
  codexConnections: StoredCodexConnection[]
  deepgramConnections: StoredDeepgramConnection[]
  version: typeof STORE_VERSION
}

export type PublicCodexAuthorization = {
  authUrl: string
  createdAt: string
  expiresAt: string
  id: string
  redirectUri: string
}

export type PublicCodexConnection = Omit<
  StoredCodexConnection,
  "accessToken" | "refreshToken"
>

export type PublicDeepgramConnection = Omit<StoredDeepgramConnection, "apiKey">

export type CodexRuntimeCredentials = {
  access: string
  accountId: string
  connectionId: string
  defaultModel: string
  email: string
  expires: number
  refresh: string
}

export type DeepgramRuntimeCredentials = {
  apiKey: string
  connectionId: string
  defaultModel: string
}

function nowISO() {
  return new Date().toISOString()
}

function normalizeConnectorPriority(priority?: number) {
  const normalized =
    typeof priority === "number" && Number.isFinite(priority)
      ? priority
      : DEFAULT_CONNECTOR_PRIORITY

  return Math.max(1, Math.min(999, Math.round(normalized)))
}

function nextConnectorPriority(connections: Array<{ priority?: number }>) {
  const priorities = connections.map((connection) =>
    normalizeConnectorPriority(connection.priority)
  )

  if (!priorities.length) {
    return 10
  }

  return Math.min(999, Math.max(...priorities) + 10)
}

function byFailoverPriority<T extends { createdAt: string; id: string; priority?: number }>(
  left: T,
  right: T
) {
  return (
    normalizeConnectorPriority(left.priority) -
      normalizeConnectorPriority(right.priority) ||
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
    left.id.localeCompare(right.id)
  )
}

function usableConnector(connection: { enabled?: boolean; status: string }) {
  return (connection.enabled ?? true) && connection.status === "connected"
}

function emptyStore(): ConnectorStoreFile {
  return {
    codexAuthorizations: [],
    codexConnections: [],
    deepgramConnections: [],
    version: STORE_VERSION,
  }
}

function connectorStorePath() {
  return path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.CONNECTOR_STORE_PATH?.trim() || ".data/connectors.json"
  )
}

function normalizeStore(value: unknown): ConnectorStoreFile {
  if (!value || typeof value !== "object") {
    return emptyStore()
  }

  const store = value as Partial<ConnectorStoreFile>

  return {
    codexAuthorizations: Array.isArray(store.codexAuthorizations)
      ? store.codexAuthorizations
      : [],
    codexConnections: Array.isArray(store.codexConnections)
      ? store.codexConnections
      : [],
    deepgramConnections: Array.isArray(store.deepgramConnections)
      ? store.deepgramConnections
      : [],
    version: STORE_VERSION,
  }
}

async function readStore() {
  try {
    const raw = await readFile(connectorStorePath(), "utf8")
    return normalizeStore(JSON.parse(raw) as unknown)
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = (error as { code?: unknown }).code

      if (code === "ENOENT") {
        return emptyStore()
      }
    }

    throw error
  }
}

async function writeStore(store: ConnectorStoreFile) {
  const filePath = connectorStorePath()
  const directory = path.dirname(filePath)
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`

  await mkdir(directory, { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8")
  await rename(temporaryPath, filePath)
}

function encryptionKey() {
  const raw = process.env.CONNECTOR_ENCRYPTION_KEY?.trim()

  if (!raw) {
    throw new Error(
      "Connector encryption key is not configured. Set CONNECTOR_ENCRYPTION_KEY before saving connector credentials."
    )
  }

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex")
  }

  const base64 = Buffer.from(raw, "base64")

  if (base64.length === 32) {
    return base64
  }

  return crypto.createHash("sha256").update(raw).digest()
}

function encryptSecret(value: string): EncryptedSecret {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(
    ENCRYPTION_ALGORITHM,
    encryptionKey(),
    iv
  )
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])

  return {
    algorithm: ENCRYPTION_ALGORITHM,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    value: encrypted.toString("base64url"),
  }
}

function decryptSecret(secret?: EncryptedSecret) {
  if (!secret) {
    return undefined
  }

  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    encryptionKey(),
    Buffer.from(secret.iv, "base64url")
  )
  decipher.setAuthTag(Buffer.from(secret.tag, "base64url"))

  return Buffer.concat([
    decipher.update(Buffer.from(secret.value, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

function publicCodexAuthorization(
  authorization: StoredCodexAuthorization
): PublicCodexAuthorization {
  return {
    authUrl: authorization.authUrl,
    createdAt: authorization.createdAt,
    expiresAt: authorization.expiresAt,
    id: authorization.id,
    redirectUri: authorization.redirectUri,
  }
}

function publicCodexConnection(
  connection: StoredCodexConnection
): PublicCodexConnection {
  return {
    chatgptAccountId: connection.chatgptAccountId,
    chatgptPlanType: connection.chatgptPlanType,
    createdAt: connection.createdAt,
    defaultModel: connection.defaultModel,
    enabled: connection.enabled ?? true,
    id: connection.id,
    lastTokenRefreshAt: connection.lastTokenRefreshAt,
    name: connection.name,
    openaiEmail: connection.openaiEmail,
    priority: normalizeConnectorPriority(connection.priority),
    status: connection.status,
    statusMessage: connection.statusMessage,
    tokenExpiresAt: connection.tokenExpiresAt,
    updatedAt: connection.updatedAt,
  }
}

function publicDeepgramConnection(
  connection: StoredDeepgramConnection
): PublicDeepgramConnection {
  return {
    accountIdentifier: connection.accountIdentifier,
    createdAt: connection.createdAt,
    defaultModel: connection.defaultModel,
    enabled: connection.enabled ?? true,
    id: connection.id,
    name: connection.name,
    priority: normalizeConnectorPriority(connection.priority),
    projects: connection.projects,
    providerType: connection.providerType,
    status: connection.status,
    statusMessage: connection.statusMessage,
    type: connection.type,
    updatedAt: connection.updatedAt,
  }
}

function pruneExpiredAuthorizations(store: ConnectorStoreFile) {
  const now = Date.now()
  store.codexAuthorizations = store.codexAuthorizations.filter(
    (authorization) => new Date(authorization.expiresAt).getTime() > now
  )
}

export async function createCodexAuthorizationRecord(
  authorization: CodexAuthorizationData
) {
  const store = await readStore()
  const createdAt = nowISO()
  const expiresAt = new Date(
    Date.now() + CODEX_AUTHORIZATION_TTL_MS
  ).toISOString()
  const record: StoredCodexAuthorization = {
    authUrl: authorization.authUrl,
    codeVerifier: encryptSecret(authorization.codeVerifier),
    createdAt,
    expiresAt,
    id: crypto.randomUUID(),
    redirectUri: authorization.redirectUri,
    state: encryptSecret(authorization.state),
  }

  pruneExpiredAuthorizations(store)
  store.codexAuthorizations.push(record)
  await writeStore(store)

  return publicCodexAuthorization(record)
}

async function readCodexAuthorization(store: ConnectorStoreFile, id: string) {
  pruneExpiredAuthorizations(store)

  const authorization = store.codexAuthorizations.find(
    (candidate) => candidate.id === id
  )

  if (!authorization) {
    throw new Error("Start a new Codex authorization before completing login.")
  }

  return {
    codeVerifier: decryptSecret(authorization.codeVerifier) || "",
    expectedState: decryptSecret(authorization.state) || "",
    redirectUri: authorization.redirectUri,
  }
}

export async function listCodexConnections() {
  const store = await readStore()

  return [...store.codexConnections]
    .sort(byFailoverPriority)
    .map(publicCodexConnection)
}

export async function upsertCodexConnection({
  authorizationId,
  name,
  tokens,
}: {
  authorizationId: string
  name?: string
  tokens: CodexExchangeResult
}) {
  const store = await readStore()
  const existing = store.codexConnections.find(
    (connection) => connection.openaiEmail === tokens.email
  )
  const timestamp = nowISO()
  const nextConnection: StoredCodexConnection = {
    accessToken: encryptSecret(tokens.accessToken),
    chatgptAccountId: tokens.chatgptAccountId,
    chatgptPlanType: tokens.planType,
    createdAt: existing?.createdAt || timestamp,
    defaultModel: existing?.defaultModel || CODEX_DEFAULT_MODEL,
    enabled: existing?.enabled ?? true,
    id: existing?.id || crypto.randomUUID(),
    lastTokenRefreshAt: timestamp,
    name: name?.trim() || existing?.name || tokens.email,
    openaiEmail: tokens.email,
    priority: existing?.priority ?? nextConnectorPriority(store.codexConnections),
    refreshToken: tokens.refreshToken
      ? encryptSecret(tokens.refreshToken)
      : existing?.refreshToken,
    status: "connected",
    statusMessage: "Connected to OpenAI Codex.",
    tokenExpiresAt: expiresAtFromExpiresIn(tokens.expiresIn),
    updatedAt: timestamp,
  }

  store.codexAuthorizations = store.codexAuthorizations.filter(
    (authorization) => authorization.id !== authorizationId
  )

  if (existing) {
    store.codexConnections = store.codexConnections.map((connection) =>
      connection.id === existing.id ? nextConnection : connection
    )
  } else {
    store.codexConnections.push(nextConnection)
  }

  await writeStore(store)

  return publicCodexConnection(nextConnection)
}

export async function completeCodexConnection({
  authorizationId,
  callbackInput,
  name,
  exchange,
}: {
  authorizationId: string
  callbackInput: string
  name?: string
  exchange: (input: {
    callbackInput: string
    codeVerifier: string
    expectedState: string
    redirectUri: string
  }) => Promise<CodexExchangeResult>
}) {
  const store = await readStore()
  const authorization = await readCodexAuthorization(store, authorizationId)
  await writeStore(store)
  const tokens = await exchange({ callbackInput, ...authorization })

  return upsertCodexConnection({ authorizationId, name, tokens })
}

export async function refreshStoredCodexConnection(id: string) {
  const store = await readStore()
  const connection = store.codexConnections.find(
    (candidate) => candidate.id === id
  )

  if (!connection) {
    throw new Error("Codex connection was not found.")
  }

  const refreshToken = decryptSecret(connection.refreshToken)

  if (!refreshToken) {
    connection.status = "needs_reconnect"
    connection.statusMessage =
      "This Codex connection is missing a refresh token. Reconnect the account."
    connection.updatedAt = nowISO()
    await writeStore(store)
    return publicCodexConnection(connection)
  }

  try {
    const tokens = await refreshCodexAccessToken(refreshToken)
    const timestamp = nowISO()
    connection.accessToken = encryptSecret(tokens.accessToken)
    connection.refreshToken = tokens.refreshToken
      ? encryptSecret(tokens.refreshToken)
      : connection.refreshToken
    connection.lastTokenRefreshAt = timestamp
    connection.status = "connected"
    connection.statusMessage = "Connected to OpenAI Codex."
    connection.tokenExpiresAt = expiresAtFromExpiresIn(tokens.expiresIn)
    connection.updatedAt = timestamp
    await writeStore(store)

    return publicCodexConnection(connection)
  } catch (error) {
    connection.status = "refresh_failed"
    connection.statusMessage =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "OpenAI Codex token refresh failed."
    connection.updatedAt = nowISO()
    await writeStore(store)

    throw error
  }
}

export async function listDeepgramConnections() {
  const store = await readStore()

  return [...store.deepgramConnections]
    .sort(byFailoverPriority)
    .map(publicDeepgramConnection)
}

export async function createDeepgramConnection({
  accountIdentifier,
  apiKey,
  name,
  projects,
  statusMessage,
}: {
  accountIdentifier?: string
  apiKey: string
  name?: string
  projects?: DeepgramProjectsResponse
  statusMessage: string
}) {
  const store = await readStore()
  const timestamp = nowISO()
  const displayName = name?.trim() || accountIdentifier || "Deepgram"
  const record: StoredDeepgramConnection = {
    accountIdentifier,
    apiKey: encryptSecret(apiKey),
    createdAt: timestamp,
    defaultModel: DEEPGRAM_DEFAULT_MODEL,
    enabled: true,
    id: crypto.randomUUID(),
    name: displayName,
    priority: nextConnectorPriority(store.deepgramConnections),
    projects,
    providerType: DEEPGRAM_PROVIDER_TYPE,
    status: "connected",
    statusMessage,
    type: SPEECH_TO_TEXT_CONNECTOR_TYPE,
    updatedAt: timestamp,
  }

  store.deepgramConnections.push(record)
  await writeStore(store)

  return publicDeepgramConnection(record)
}

type ConnectorConnectionUpdate = {
  defaultModel?: string
  enabled?: boolean
  name?: string
  priority?: number
}

function applyConnectionUpdate(
  connection: {
    defaultModel: string
    enabled?: boolean
    name: string
    priority?: number
    updatedAt: string
  },
  input: ConnectorConnectionUpdate
) {
  if (input.defaultModel !== undefined) {
    connection.defaultModel = input.defaultModel.trim()
  }

  if (input.enabled !== undefined) {
    connection.enabled = input.enabled
  }

  if (input.name !== undefined) {
    connection.name = input.name.trim()
  }

  if (input.priority !== undefined) {
    connection.priority = normalizeConnectorPriority(input.priority)
  }

  connection.updatedAt = nowISO()
}

export async function updateCodexConnection(
  id: string,
  input: ConnectorConnectionUpdate
) {
  const store = await readStore()
  const connection = store.codexConnections.find(
    (candidate) => candidate.id === id
  )

  if (!connection) {
    throw new Error("Codex connection was not found.")
  }

  applyConnectionUpdate(connection, input)
  await writeStore(store)

  return publicCodexConnection(connection)
}

export async function deleteCodexConnection(id: string) {
  const store = await readStore()
  const nextConnections = store.codexConnections.filter(
    (connection) => connection.id !== id
  )

  if (nextConnections.length === store.codexConnections.length) {
    throw new Error("Codex connection was not found.")
  }

  store.codexConnections = nextConnections
  await writeStore(store)
}

export async function updateDeepgramConnection(
  id: string,
  input: ConnectorConnectionUpdate
) {
  const store = await readStore()
  const connection = store.deepgramConnections.find(
    (candidate) => candidate.id === id
  )

  if (!connection) {
    throw new Error("Deepgram connection was not found.")
  }

  applyConnectionUpdate(connection, input)
  await writeStore(store)

  return publicDeepgramConnection(connection)
}

export async function deleteDeepgramConnection(id: string) {
  const store = await readStore()
  const nextConnections = store.deepgramConnections.filter(
    (connection) => connection.id !== id
  )

  if (nextConnections.length === store.deepgramConnections.length) {
    throw new Error("Deepgram connection was not found.")
  }

  store.deepgramConnections = nextConnections
  await writeStore(store)
}

function failoverPlan<T extends { enabled: boolean; id: string; status: string }>(
  connections: T[]
) {
  const active = connections.find(usableConnector) || null

  return {
    active,
    disabled: connections.filter((connection) => !connection.enabled),
    fallbacks: connections.filter(
      (connection) =>
        connection.enabled && connection.status === "connected" &&
        connection.id !== active?.id
    ),
    needsAttention: connections.filter(
      (connection) => connection.enabled && connection.status !== "connected"
    ),
  }
}

export async function getActiveCodexRuntimeCredentials(): Promise<CodexRuntimeCredentials> {
  let store = await readStore()
  let connection = [...store.codexConnections]
    .sort(byFailoverPriority)
    .find(usableConnector)

  if (!connection) {
    throw new Error("Connect Codex before starting a Pi session.")
  }

  const expiresAt = connection.tokenExpiresAt
    ? new Date(connection.tokenExpiresAt).getTime()
    : Date.now() + 60 * 60 * 1000

  if (expiresAt <= Date.now() + 5 * 60 * 1000 && connection.refreshToken) {
    await refreshStoredCodexConnection(connection.id)
    store = await readStore()
    connection = store.codexConnections.find(
      (candidate) => candidate.id === connection?.id
    )
  }

  if (!connection || !usableConnector(connection)) {
    throw new Error("Reconnect Codex before starting a Pi session.")
  }

  const access = decryptSecret(connection.accessToken)
  const refresh = decryptSecret(connection.refreshToken)
  const accountId = connection.chatgptAccountId

  if (!access || !refresh || !accountId) {
    throw new Error("Reconnect Codex before starting a Pi session.")
  }

  return {
    access,
    accountId,
    connectionId: connection.id,
    defaultModel: connection.defaultModel || CODEX_DEFAULT_MODEL,
    email: connection.openaiEmail,
    expires: connection.tokenExpiresAt
      ? new Date(connection.tokenExpiresAt).getTime()
      : Date.now() + 60 * 60 * 1000,
    refresh,
  }
}

export async function getActiveDeepgramRuntimeCredentials(): Promise<DeepgramRuntimeCredentials> {
  const store = await readStore()
  const connection = [...store.deepgramConnections]
    .sort(byFailoverPriority)
    .find(usableConnector)

  if (!connection) {
    throw new Error("Connect Deepgram before using speech input.")
  }

  const apiKey = decryptSecret(connection.apiKey)

  if (!apiKey) {
    throw new Error("Reconnect Deepgram before using speech input.")
  }

  return {
    apiKey,
    connectionId: connection.id,
    defaultModel: connection.defaultModel || DEEPGRAM_DEFAULT_MODEL,
  }
}

export async function getConnectorFailoverPlan() {
  const codexConnections = await listCodexConnections()
  const deepgramConnections = await listDeepgramConnections()

  return {
    composer: failoverPlan(codexConnections),
    connections: {
      codex: codexConnections,
      deepgram: deepgramConnections,
    },
    speechToText: failoverPlan(deepgramConnections),
  }
}
