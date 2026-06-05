import { z } from "zod"

import { requireConnectorAdmin } from "@/lib/connectors/admin-auth"
import { exchangeCodexAuthorizationCode } from "@/lib/connectors/openai-codex-oauth"
import {
  completeCodexConnection,
  listCodexConnections,
} from "@/lib/connectors/store"

export const runtime = "nodejs"

const completeCodexConnectionSchema = z.object({
  authorizationId: z.string().min(1),
  callbackInput: z.string().min(1),
  name: z.string().optional(),
})

function errorResponse(error: unknown, fallback: string, status = 400) {
  return Response.json(
    {
      error: error instanceof Error ? error.message : fallback,
    },
    { status }
  )
}

export async function GET(request: Request) {
  const unauthorized = requireConnectorAdmin(request)

  if (unauthorized) {
    return unauthorized
  }

  return Response.json({ connections: await listCodexConnections() })
}

export async function POST(request: Request) {
  const unauthorized = requireConnectorAdmin(request)

  if (unauthorized) {
    return unauthorized
  }

  try {
    const input = completeCodexConnectionSchema.parse(await request.json())
    const connection = await completeCodexConnection({
      authorizationId: input.authorizationId,
      callbackInput: input.callbackInput,
      exchange: exchangeCodexAuthorizationCode,
      name: input.name,
    })

    return Response.json(connection, { status: 201 })
  } catch (error) {
    return errorResponse(error, "Could not connect OpenAI Codex.")
  }
}
