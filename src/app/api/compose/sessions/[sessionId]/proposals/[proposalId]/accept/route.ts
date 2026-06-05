import { z } from "zod"

import {
  applyComposeEditProposal,
  getComposeSession,
} from "@/lib/composer/session-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const acceptProposalSchema = z.object({
  currentText: z.string().optional(),
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
  { params }: { params: Promise<{ proposalId: string; sessionId: string }> }
) {
  try {
    const { proposalId, sessionId } = await params
    const input = acceptProposalSchema.parse(await request.json().catch(() => ({})))
    const { appliedText, proposal } = await applyComposeEditProposal({
      currentText: input.currentText,
      proposalId,
      sessionId,
    })

    return Response.json({
      appliedText,
      proposal,
      session: await getComposeSession(sessionId),
    })
  } catch (error) {
    return errorResponse(error, "Could not accept edit proposal.")
  }
}
