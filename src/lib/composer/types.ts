export type ComposeMessageSource = "typed" | "transcript"

export type ComposeSessionMessage = {
  content: string
  createdAt: string
  id: string
  role: "assistant" | "system" | "user"
  source?: ComposeMessageSource
}

export type TextRangeEdit = {
  end: number
  reason?: string
  replacement: string
  start: number
}

export type ComposeEditProposal = {
  afterText: string
  beforeText: string
  createdAt: string
  edits: TextRangeEdit[]
  id: string
  sessionId: string
  status: "accepted" | "pending" | "rejected"
  summary: string
  updatedAt: string
}

export type ComposeSessionRecord = {
  createdAt: string
  id: string
  messages: ComposeSessionMessage[]
  piSessionFile?: string
  proposals: ComposeEditProposal[]
  title: string
  updatedAt: string
}
