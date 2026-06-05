import "server-only"

import crypto from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import type {
  ComposeEditProposal,
  ComposeMessageSource,
  ComposeSessionMessage,
  ComposeSessionRecord,
  TextRangeEdit,
} from "@/lib/composer/types"
import { applyTextEdits } from "@/lib/composer/text-edits"
import { composeSessionsStorePath, ensureComposerDataDirectories } from "@/lib/composer/paths"

const STORE_VERSION = 1

export type ComposeSessionStoreFile = {
  sessions: ComposeSessionRecord[]
  version: typeof STORE_VERSION
}

function nowISO() {
  return new Date().toISOString()
}

function emptyStore(): ComposeSessionStoreFile {
  return {
    sessions: [],
    version: STORE_VERSION,
  }
}

function normalizeStore(value: unknown): ComposeSessionStoreFile {
  if (!value || typeof value !== "object") {
    return emptyStore()
  }

  const candidate = value as Partial<ComposeSessionStoreFile>

  return {
    sessions: Array.isArray(candidate.sessions) ? candidate.sessions : [],
    version: STORE_VERSION,
  }
}

async function readStore() {
  try {
    const raw = await readFile(composeSessionsStorePath(), "utf8")
    return normalizeStore(JSON.parse(raw) as unknown)
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = (error as { code?: unknown }).code

      if (code === "ENOENT") {
        return emptyStore()
      }
    }

    throw error
  }
}

async function writeStore(store: ComposeSessionStoreFile) {
  await ensureComposerDataDirectories()
  const filePath = composeSessionsStorePath()
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`

  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8")
  await rename(temporaryPath, filePath)
}

function byUpdatedAt(left: ComposeSessionRecord, right: ComposeSessionRecord) {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
}

export async function listComposeSessions() {
  const store = await readStore()

  return [...store.sessions].sort(byUpdatedAt)
}

export async function createComposeSession() {
  const store = await readStore()
  const timestamp = nowISO()
  const session: ComposeSessionRecord = {
    createdAt: timestamp,
    id: crypto.randomUUID(),
    messages: [],
    proposals: [],
    title: "Compose",
    updatedAt: timestamp,
  }

  store.sessions.push(session)
  await writeStore(store)

  return session
}

export async function getComposeSession(id: string) {
  const store = await readStore()
  const session = store.sessions.find((candidate) => candidate.id === id)

  if (!session) {
    throw new Error("Compose session was not found.")
  }

  return session
}

export async function updateComposeSession(
  id: string,
  update: (session: ComposeSessionRecord) => void
) {
  const store = await readStore()
  const session = store.sessions.find((candidate) => candidate.id === id)

  if (!session) {
    throw new Error("Compose session was not found.")
  }

  update(session)
  session.updatedAt = nowISO()
  await writeStore(store)

  return session
}

export async function setComposeSessionPiFile(id: string, piSessionFile: string) {
  return updateComposeSession(id, (session) => {
    session.piSessionFile = piSessionFile
  })
}

export async function appendComposeMessage({
  content,
  role,
  sessionId,
  source,
}: {
  content: string
  role: ComposeSessionMessage["role"]
  sessionId: string
  source?: ComposeMessageSource
}) {
  const message: ComposeSessionMessage = {
    content,
    createdAt: nowISO(),
    id: crypto.randomUUID(),
    role,
    source,
  }

  await updateComposeSession(sessionId, (session) => {
    session.messages.push(message)
  })

  return message
}

export async function appendComposeEditProposal({
  beforeText,
  edits,
  sessionId,
  summary,
}: {
  beforeText: string
  edits: TextRangeEdit[]
  sessionId: string
  summary: string
}) {
  const timestamp = nowISO()
  const proposal: ComposeEditProposal = {
    afterText: applyTextEdits(beforeText, edits),
    beforeText,
    createdAt: timestamp,
    edits,
    id: crypto.randomUUID(),
    sessionId,
    status: "pending",
    summary: summary.trim() || "Edit",
    updatedAt: timestamp,
  }

  await updateComposeSession(sessionId, (session) => {
    session.proposals.push(proposal)
  })

  return proposal
}

export async function updateComposeEditProposalStatus({
  proposalId,
  sessionId,
  status,
}: {
  proposalId: string
  sessionId: string
  status: ComposeEditProposal["status"]
}) {
  let proposal: ComposeEditProposal | undefined
  const timestamp = nowISO()

  await updateComposeSession(sessionId, (session) => {
    proposal = session.proposals.find((candidate) => candidate.id === proposalId)

    if (!proposal) {
      throw new Error("Edit proposal was not found.")
    }

    proposal.status = status
    proposal.updatedAt = timestamp
  })

  return proposal
}

export async function applyComposeEditProposal({
  currentText,
  proposalId,
  sessionId,
}: {
  currentText?: string
  proposalId: string
  sessionId: string
}) {
  let appliedText = ""
  let proposal: ComposeEditProposal | undefined
  const timestamp = nowISO()

  await updateComposeSession(sessionId, (session) => {
    proposal = session.proposals.find((candidate) => candidate.id === proposalId)

    if (!proposal) {
      throw new Error("Edit proposal was not found.")
    }

    appliedText = applyTextEdits(currentText ?? proposal.beforeText, proposal.edits)
    proposal.status = "accepted"
    proposal.updatedAt = timestamp
  })

  return {
    appliedText,
    proposal,
  }
}
