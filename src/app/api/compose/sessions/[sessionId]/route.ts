import { getComposeSession } from "@/lib/composer/session-store"

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params

    return Response.json(await getComposeSession(sessionId))
  } catch (error) {
    return errorResponse(error, "Could not load compose session.", 404)
  }
}
