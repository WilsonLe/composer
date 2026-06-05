import { listComposeSessions } from "@/lib/composer/session-store"
import { startComposePiSession } from "@/lib/composer/pi-runtime"

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

export async function GET() {
  try {
    return Response.json({ sessions: await listComposeSessions() })
  } catch (error) {
    return errorResponse(error, "Could not load compose sessions.")
  }
}

export async function POST() {
  try {
    const session = await startComposePiSession()

    return Response.json(session, { status: 201 })
  } catch (error) {
    return errorResponse(error, "Could not start Pi session.")
  }
}
