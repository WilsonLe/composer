import { transcribeDeepgramAudio } from "@/lib/connectors/deepgram"
import { getActiveDeepgramRuntimeCredentials } from "@/lib/connectors/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function errorResponse(error: unknown, fallback: string, status = 400) {
  return Response.json(
    {
      error: error instanceof Error ? error.message : fallback,
    },
    { status }
  )
}

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const audio = form.get("audio")

    if (!(audio instanceof File)) {
      throw new Error("Attach an audio recording.")
    }

    const credentials = await getActiveDeepgramRuntimeCredentials()
    const result = await transcribeDeepgramAudio({
      apiKey: credentials.apiKey,
      audio,
      contentType: audio.type || undefined,
      model: credentials.defaultModel,
      signal: request.signal,
    })

    return Response.json(result)
  } catch (error) {
    return errorResponse(error, "Could not transcribe audio.")
  }
}
