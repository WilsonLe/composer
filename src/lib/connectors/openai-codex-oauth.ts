import crypto from "node:crypto"

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize"
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token"
const CODEX_SCOPE = "openid profile email offline_access"
const BASE64_BLOCK_SIZE = 4

export const CODEX_DEFAULT_MODEL = "gpt-5.5"
export const CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback"

export type CodexAuthorizationData = {
  authUrl: string
  codeVerifier: string
  redirectUri: string
  state: string
}

export type CodexTokenSet = {
  accessToken: string
  expiresIn?: number
  idToken?: string
  refreshToken?: string
  scope?: string
}

export type CodexAccountInfo = {
  chatgptAccountId?: string
  email: string
  planType?: string
}

export type CodexExchangeResult = CodexTokenSet & CodexAccountInfo

export class CodexAuthError extends Error {
  code?: string
  status?: number

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message)
    this.name = "CodexAuthError"
    this.code = options?.code
    this.status = options?.status
  }
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const padding =
    (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) %
    BASE64_BLOCK_SIZE

  return Buffer.from(`${base64}${"=".repeat(padding)}`, "base64").toString(
    "utf8"
  )
}

function decodeJwtPayload(token?: string | null) {
  if (!token || typeof token !== "string") {
    return null
  }

  const [, payload] = token.split(".")

  if (!payload) {
    return null
  }

  try {
    return JSON.parse(base64UrlDecode(payload)) as Record<string, unknown>
  } catch {
    return null
  }
}

function stringClaim(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString("base64url")
}

function generateCodeChallenge(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest("base64url")
}

function generateState() {
  return crypto.randomBytes(32).toString("base64url")
}

function buildAuthUrl({
  codeChallenge,
  redirectUri,
  state,
}: {
  codeChallenge: string
  redirectUri: string
  state: string
}) {
  const params = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    codex_cli_simplified_flow: "true",
    id_token_add_organizations: "true",
    originator: "codex_cli_rs",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CODEX_SCOPE,
    state,
  })

  return `${CODEX_AUTHORIZE_URL}?${params.toString()}`
}

export function generateCodexAuthorization(): CodexAuthorizationData {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = generateState()

  return {
    authUrl: buildAuthUrl({
      codeChallenge,
      redirectUri: CODEX_REDIRECT_URI,
      state,
    }),
    codeVerifier,
    redirectUri: CODEX_REDIRECT_URI,
    state,
  }
}

export function parseCodexCallbackInput(input: string) {
  const trimmed = input.trim()

  if (!trimmed) {
    throw new CodexAuthError(
      "Paste the OpenAI Codex callback URL or authorization code."
    )
  }

  try {
    const parsed = new URL(trimmed)
    const code =
      parsed.searchParams.get("code") ||
      parsed.hash.match(/[?#&]code=([^&]+)/)?.[1]
    const state =
      parsed.searchParams.get("state") ||
      parsed.hash.match(/[?#&]state=([^&]+)/)?.[1]

    if (!code) {
      throw new CodexAuthError(
        "The callback URL does not include an authorization code."
      )
    }

    return {
      code: decodeURIComponent(code),
      state: state ? decodeURIComponent(state) : undefined,
    }
  } catch (error) {
    if (error instanceof CodexAuthError) {
      throw error
    }

    return {
      code: trimmed,
      state: undefined,
    }
  }
}

export function extractCodexAccountInfo(
  idToken?: string | null,
  accessToken?: string | null
): Partial<CodexAccountInfo> {
  const idPayload = decodeJwtPayload(idToken)
  const accessPayload = decodeJwtPayload(accessToken)
  const payload = idPayload || accessPayload

  if (!payload) {
    return {}
  }

  const openAIAuth = payload["https://api.openai.com/auth"]
  const authClaims =
    openAIAuth && typeof openAIAuth === "object"
      ? (openAIAuth as Record<string, unknown>)
      : {}

  return {
    chatgptAccountId:
      stringClaim(authClaims.chatgpt_account_id) ||
      stringClaim(payload.account_id) ||
      stringClaim(accessPayload?.account_id),
    email:
      stringClaim(payload.email) ||
      stringClaim(payload.preferred_username) ||
      stringClaim(accessPayload?.email) ||
      stringClaim(accessPayload?.preferred_username),
    planType:
      stringClaim(authClaims.chatgpt_plan_type) ||
      stringClaim(payload.plan_type) ||
      stringClaim(accessPayload?.plan_type),
  }
}

async function parseTokenResponse(response: Response) {
  const text = await response.text()

  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }

  if (!response.ok) {
    const errorValue = parsed.error
    const errorCode =
      typeof errorValue === "string"
        ? errorValue
        : errorValue &&
            typeof errorValue === "object" &&
            "code" in errorValue &&
            typeof errorValue.code === "string"
          ? errorValue.code
          : undefined
    const description =
      stringClaim(parsed.error_description) ||
      stringClaim(parsed.detail) ||
      stringClaim(parsed.message) ||
      (errorValue && typeof errorValue === "object" && "message" in errorValue
        ? stringClaim(errorValue.message)
        : undefined) ||
      text ||
      "OpenAI token exchange failed."

    throw new CodexAuthError(description, {
      code: errorCode,
      status: response.status,
    })
  }

  return parsed
}

function mapTokenSet(tokens: Record<string, unknown>): CodexTokenSet {
  const accessToken = stringClaim(tokens.access_token)

  if (!accessToken) {
    throw new CodexAuthError("OpenAI did not return an access token.")
  }

  const expiresIn =
    typeof tokens.expires_in === "number" ? tokens.expires_in : undefined

  return {
    accessToken,
    expiresIn,
    idToken: stringClaim(tokens.id_token),
    refreshToken: stringClaim(tokens.refresh_token),
    scope: stringClaim(tokens.scope),
  }
}

export async function exchangeCodexAuthorizationCode({
  callbackInput,
  codeVerifier,
  expectedState,
  redirectUri,
}: {
  callbackInput: string
  codeVerifier: string
  expectedState: string
  redirectUri: string
}): Promise<CodexExchangeResult> {
  const { code, state } = parseCodexCallbackInput(callbackInput)

  if (state && state !== expectedState) {
    throw new CodexAuthError(
      "The pasted callback URL state does not match this connect attempt. Start a new connect flow and try again."
    )
  }

  const response = await fetch(CODEX_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: CODEX_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  })

  const tokenSet = mapTokenSet(await parseTokenResponse(response))
  const accountInfo = extractCodexAccountInfo(
    tokenSet.idToken,
    tokenSet.accessToken
  )
  const email = accountInfo.email?.toLowerCase()

  if (!email) {
    throw new CodexAuthError(
      "OpenAI did not return an email address for this Codex account. Reconnect with an OpenAI account that exposes an email claim."
    )
  }

  return {
    ...tokenSet,
    chatgptAccountId: accountInfo.chatgptAccountId,
    email,
    planType: accountInfo.planType,
  }
}

export async function refreshCodexAccessToken(refreshToken: string) {
  const response = await fetch(CODEX_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: CODEX_SCOPE,
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  })

  return mapTokenSet(await parseTokenResponse(response))
}

export function expiresAtFromExpiresIn(expiresIn?: number) {
  return expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null
}
