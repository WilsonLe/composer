import { z } from "zod"

import {
  sendTranscriptComposeMessage,
  sendTypedComposeMessage,
} from "@/lib/composer/pi-runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const messageSchema = z.object({
  confirmed: z.boolean().optional(),
  content: z.string().trim().min(1),
  currentText: z.string().optional().default(""),
  source: z.enum(["transcript", "typed"]),
})

function errorResponse(error: unknown, fallback: string, status = 400) {
  return Response.json(
    {
      error: error instanceof Error ? error.message : fallback,
    },
    { status }
  )
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params
    const input = messageSchema.parse(await request.json())

    if (input.source === "typed") {
      return Response.json(
        await sendTypedComposeMessage({
          content: input.content,
          sessionId,
        })
      )
    }

    return Response.json(
      await sendTranscriptComposeMessage({
        confirmed: input.confirmed,
        content: input.content,
        currentText: input.currentText,
        sessionId,
      })
    )
  } catch (error) {
    return errorResponse(error, "Could not send compose message.")
  }
}
