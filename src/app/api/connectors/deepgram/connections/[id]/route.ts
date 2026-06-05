import { z } from "zod"

import {
  deleteDeepgramConnection,
  updateDeepgramConnection,
} from "@/lib/connectors/store"

export const runtime = "nodejs"

const updateConnectionSchema = z.object({
  defaultModel: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  priority: z.coerce.number().int().min(1).max(999).optional(),
})

function errorResponse(error: unknown, fallback: string, status = 400) {
  return Response.json(
    {
      error: error instanceof Error ? error.message : fallback,
    },
    { status }
  )
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const input = updateConnectionSchema.parse(await request.json())
    const connection = await updateDeepgramConnection(id, input)

    return Response.json(connection)
  } catch (error) {
    return errorResponse(error, "Could not update Deepgram connection.")
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await deleteDeepgramConnection(id)

    return new Response(null, { status: 204 })
  } catch (error) {
    return errorResponse(error, "Could not delete Deepgram connection.")
  }
}
