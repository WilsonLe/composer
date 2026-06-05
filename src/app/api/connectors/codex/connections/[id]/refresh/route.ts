import { requireConnectorAdmin } from "@/lib/connectors/admin-auth"
import { refreshStoredCodexConnection } from "@/lib/connectors/store"

export const runtime = "nodejs"

function errorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Could not refresh OpenAI Codex connection.",
    },
    { status: 400 }
  )
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = requireConnectorAdmin(request)

  if (unauthorized) {
    return unauthorized
  }

  try {
    const { id } = await params
    const connection = await refreshStoredCodexConnection(id)

    return Response.json(connection)
  } catch (error) {
    return errorResponse(error)
  }
}
