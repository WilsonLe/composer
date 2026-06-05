import { z } from "zod"

import { requireConnectorAdmin } from "@/lib/connectors/admin-auth"
import {
  summarizeDeepgramProjectList,
  verifyDeepgramApiKey,
} from "@/lib/connectors/deepgram"
import {
  createDeepgramConnection,
  listDeepgramConnections,
} from "@/lib/connectors/store"

export const runtime = "nodejs"

const createDeepgramConnectionSchema = z.object({
  accountIdentifier: z.string().optional(),
  apiKey: z.string().min(1),
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

  return Response.json({ connections: await listDeepgramConnections() })
}

export async function POST(request: Request) {
  const unauthorized = requireConnectorAdmin(request)

  if (unauthorized) {
    return unauthorized
  }

  try {
    const input = createDeepgramConnectionSchema.parse(await request.json())
    const verification = await verifyDeepgramApiKey(input.apiKey, request.signal)
    const accountIdentifier =
      input.accountIdentifier || verification.accountIdentifier
    const connection = await createDeepgramConnection({
      accountIdentifier,
      apiKey: input.apiKey,
      name: input.name,
      projects: verification.projects,
      statusMessage: summarizeDeepgramProjectList(verification.projects),
    })

    return Response.json(connection, { status: 201 })
  } catch (error) {
    return errorResponse(error, "Could not connect Deepgram.")
  }
}
