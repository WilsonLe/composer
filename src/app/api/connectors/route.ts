import { requireConnectorAdmin } from "@/lib/connectors/admin-auth"
import { getConnectorFailoverPlan } from "@/lib/connectors/store"

export const runtime = "nodejs"

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

  try {
    return Response.json(await getConnectorFailoverPlan())
  } catch (error) {
    return errorResponse(error, "Could not load connector failover plan.")
  }
}
