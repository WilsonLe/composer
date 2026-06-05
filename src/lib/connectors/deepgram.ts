const DEEPGRAM_API_BASE_URL = "https://api.deepgram.com"

export const DEEPGRAM_PROVIDER_TYPE = "deepgram" as const
export const SPEECH_TO_TEXT_CONNECTOR_TYPE = "speech_to_text" as const
export const DEEPGRAM_DEFAULT_MODEL = "nova-3" as const

export type DeepgramProject = {
  project_id?: string
  name?: string
}

export type DeepgramProjectsResponse = {
  projects?: DeepgramProject[]
}

type DeepgramListenResponse = {
  metadata?: {
    duration?: number
    model_info?: Record<string, { name?: string; version?: string }>
    request_id?: string
  }
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        confidence?: number
        language?: string
        transcript?: string
        words?: unknown[]
      }>
      detected_language?: string
    }>
  }
}

export type DeepgramTranscriptionResult = {
  confidence?: number
  detectedLanguage?: string
  duration?: number
  metadata?: Record<string, unknown>
  model: string
  requestID?: string
  transcript: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

async function parseDeepgramResponse(response: Response) {
  const text = await response.text()

  if (!text.trim()) {
    return undefined
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function deepgramErrorMessage(status: number, body: unknown, fallback: string) {
  if (isRecord(body)) {
    for (const key of ["err_msg", "message", "error", "detail"]) {
      const value = body[key]

      if (typeof value === "string" && value.trim()) {
        return `Deepgram ${status}: ${value.trim()}`.slice(0, 500)
      }
    }
  }

  if (typeof body === "string" && body.trim()) {
    return `Deepgram ${status}: ${body.trim()}`.slice(0, 500)
  }

  return fallback
}

async function deepgramJSONRequest<T>({
  apiKey,
  method,
  path,
  signal,
}: {
  apiKey: string
  method: "GET"
  path: string
  signal?: AbortSignal
}): Promise<T> {
  const response = await fetch(`${DEEPGRAM_API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Token ${apiKey}`,
    },
    method,
    signal,
  })
  const parsed = await parseDeepgramResponse(response)

  if (!response.ok) {
    throw new Error(
      deepgramErrorMessage(response.status, parsed, "Deepgram request failed.")
    )
  }

  return (isRecord(parsed) ? parsed : {}) as T
}

export async function verifyDeepgramApiKey(
  apiKey: string,
  signal?: AbortSignal
) {
  const trimmed = stringValue(apiKey)

  if (!trimmed) {
    throw new Error("Paste a Deepgram API key.")
  }

  const projects = await deepgramJSONRequest<DeepgramProjectsResponse>({
    apiKey: trimmed,
    method: "GET",
    path: "/v1/projects",
    signal,
  })
  const firstProject = projects.projects?.find(
    (project) => project.name || project.project_id
  )
  const accountIdentifier = firstProject
    ? firstProject.name || firstProject.project_id
    : "Deepgram API key"

  return {
    accountIdentifier,
    projects,
  }
}

export async function transcribeDeepgramAudio({
  apiKey,
  audio,
  contentType,
  model = DEEPGRAM_DEFAULT_MODEL,
  signal,
}: {
  apiKey: string
  audio: Blob | Buffer | Uint8Array | ArrayBuffer
  contentType?: string
  model?: string
  signal?: AbortSignal
}): Promise<DeepgramTranscriptionResult> {
  const params = new URLSearchParams({
    detect_language: "true",
    model,
    smart_format: "true",
  })
  const response = await fetch(
    `${DEEPGRAM_API_BASE_URL}/v1/listen?${params.toString()}`,
    {
      body: audio as BodyInit,
      headers: {
        Authorization: `Token ${apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      method: "POST",
      signal,
    }
  )
  const parsed = await parseDeepgramResponse(response)

  if (!response.ok) {
    throw new Error(
      deepgramErrorMessage(
        response.status,
        parsed,
        "Deepgram transcription failed."
      )
    )
  }

  const result = (isRecord(parsed) ? parsed : {}) as DeepgramListenResponse
  const channel = result.results?.channels?.[0]
  const alternative = channel?.alternatives?.[0]
  const transcript = stringValue(alternative?.transcript) || ""

  if (!transcript) {
    throw new Error("Deepgram did not return a transcript for this audio.")
  }

  return {
    confidence: alternative?.confidence,
    detectedLanguage: channel?.detected_language || alternative?.language,
    duration: result.metadata?.duration,
    metadata: isRecord(parsed) ? parsed : undefined,
    model,
    requestID: result.metadata?.request_id,
    transcript,
  }
}

export function summarizeDeepgramProjectList(projects: DeepgramProjectsResponse) {
  const count = projects.projects?.length ?? 0

  if (!count) {
    return "Deepgram API key verified."
  }

  return `Deepgram API key verified for ${count} project${count === 1 ? "" : "s"}.`
}
