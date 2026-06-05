import { generateCodexAuthorization } from "@/lib/connectors/openai-codex-oauth"
import { requireConnectorAdmin } from "@/lib/connectors/admin-auth"
import { createCodexAuthorizationRecord } from "@/lib/connectors/store"

export const runtime = "nodejs"

function errorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Could not start Codex authorization.",
    },
    { status: 400 }
  )
}

export async function POST(request: Request) {
  const unauthorized = requireConnectorAdmin(request)

  if (unauthorized) {
    return unauthorized
  }

  try {
    const authorization = generateCodexAuthorization()
    const record = await createCodexAuthorizationRecord(authorization)

    return Response.json(record, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
