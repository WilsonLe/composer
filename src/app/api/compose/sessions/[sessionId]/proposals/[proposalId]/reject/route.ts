import {
  getComposeSession,
  updateComposeEditProposalStatus,
} from "@/lib/composer/session-store"

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

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ proposalId: string; sessionId: string }> }
) {
  try {
    const { proposalId, sessionId } = await params
    const proposal = await updateComposeEditProposalStatus({
      proposalId,
      sessionId,
      status: "rejected",
    })

    return Response.json({
      proposal,
      session: await getComposeSession(sessionId),
    })
  } catch (error) {
    return errorResponse(error, "Could not reject edit proposal.")
  }
}
