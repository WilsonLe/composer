import crypto from "node:crypto"

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization")

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim()
  }

  return request.headers.get("x-composer-admin-token")?.trim()
}

export function requireConnectorAdmin(request: Request) {
  const expected = process.env.COMPOSER_CONNECTOR_ADMIN_TOKEN?.trim()

  if (!expected) {
    return Response.json(
      {
        error:
          "Connector admin token is not configured. Set COMPOSER_CONNECTOR_ADMIN_TOKEN before using connector APIs.",
      },
      { status: 503 }
    )
  }

  const received = bearerToken(request)

  if (!received || !timingSafeStringEqual(received, expected)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 })
  }

  return null
}
