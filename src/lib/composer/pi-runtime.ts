import "server-only"

import { getModel } from "@earendil-works/pi-ai"
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

import {
  appendComposeEditProposal,
  appendComposeMessage,
  createComposeSession,
  getComposeSession,
  setComposeSessionPiFile,
} from "@/lib/composer/session-store"
import type { TextRangeEdit } from "@/lib/composer/types"
import { applyTextEdits } from "@/lib/composer/text-edits"
import {
  composerPiAgentDir,
  composerPiSessionDir,
  ensureComposerDataDirectories,
} from "@/lib/composer/paths"
import { getActiveCodexRuntimeCredentials } from "@/lib/connectors/store"

const DEFAULT_CODEX_MODEL = "gpt-5.5"
const PROPOSE_EDIT_TOOL_NAME = "propose_edit_text"

const SYSTEM_PROMPT = `You are Composer, a private writing companion embedded in a local single-user writing app.
Your only job is to help the operator compose the current Writing field.
The operator often speaks through speech-to-text. Treat operator messages as possible STT transcripts: normalize likely pronunciation mistakes, infer the intended wording cautiously, rephrase the intent, and ask for confirmation before changing text.
Only call propose_edit_text after the operator has explicitly confirmed the interpreted transcript or the incoming message says it is confirmed.
Use propose_edit_text as your only tool. It creates a human-reviewed edit proposal for the Writing field. Never claim an edit was already applied.
When proposing edits, use non-overlapping start/end character offsets against the exact current_text supplied in the user message. For a full replacement, use start 0 and end current_text.length. Prefer the smallest ranged edit that satisfies the request.
Keep responses concise and ask only one confirmation question at a time.`

const emptyResourceLoader = async ({
  agentDir,
  cwd,
  settingsManager,
}: {
  agentDir: string
  cwd: string
  settingsManager: SettingsManager
}): Promise<ResourceLoader> => {
  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    noContextFiles: true,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    settingsManager,
    systemPrompt: SYSTEM_PROMPT,
  })

  await loader.reload()

  return loader
}

type Queues = Map<string, Promise<unknown>>

const globalQueues = globalThis as typeof globalThis & {
  __composerPiSessionQueues?: Queues
}

function getQueues() {
  globalQueues.__composerPiSessionQueues ??= new Map()

  return globalQueues.__composerPiSessionQueues
}

async function runInSessionQueue<T>(sessionId: string, task: () => Promise<T>) {
  const queues = getQueues()
  const previous = queues.get(sessionId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(task)

  queues.set(
    sessionId,
    current.finally(() => {
      if (queues.get(sessionId) === current) {
        queues.delete(sessionId)
      }
    })
  )

  return current
}

function normalizeTranscript(transcript: string) {
  const normalized = transcript.trim()

  if (!normalized) {
    throw new Error("Transcript is empty.")
  }

  return normalized
}

function proposeEditTool({
  currentText,
  sessionId,
}: {
  currentText: string
  sessionId: string
}) {
  return defineTool({
    name: PROPOSE_EDIT_TOOL_NAME,
    label: "Propose edit text",
    description:
      "Create a human-reviewed edit proposal for the Composer Writing field using non-overlapping character ranges.",
    promptSnippet:
      "propose_edit_text: propose non-overlapping ranged edits to the current Writing field for human approval.",
    promptGuidelines: [
      "Use propose_edit_text only after the operator confirms the interpreted STT transcript.",
      "propose_edit_text must use offsets against the supplied current_text and should prefer the smallest ranged edit that satisfies the request.",
    ],
    parameters: Type.Object({
      edits: Type.Array(
        Type.Object({
          end: Type.Number({ minimum: 0 }),
          reason: Type.Optional(Type.String()),
          replacement: Type.String(),
          start: Type.Number({ minimum: 0 }),
        }),
        { minItems: 1 }
      ),
      summary: Type.String({ minLength: 1 }),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const edits = params.edits.map(
        (edit): TextRangeEdit => ({
          end: edit.end,
          reason: edit.reason,
          replacement: edit.replacement,
          start: edit.start,
        })
      )
      const afterText = applyTextEdits(currentText, edits)
      const proposal = await appendComposeEditProposal({
        beforeText: currentText,
        edits,
        sessionId,
        summary: params.summary,
      })

      return {
        content: [
          {
            type: "text" as const,
            text: `Edit proposal ${proposal.id} is waiting for operator approval. Proposed length: ${afterText.length} characters.`,
          },
        ],
        details: {
          afterText,
          proposalId: proposal.id,
        },
        terminate: true,
      }
    },
  })
}

async function createConfiguredAgentSession({
  currentText,
  piSessionFile,
  sessionId,
}: {
  currentText: string
  piSessionFile?: string
  sessionId: string
}) {
  await ensureComposerDataDirectories()

  const codex = await getActiveCodexRuntimeCredentials()
  const model = getModel("openai-codex", DEFAULT_CODEX_MODEL)

  if (!model) {
    throw new Error(`OpenAI Codex model ${DEFAULT_CODEX_MODEL} is unavailable.`)
  }

  const cwd = process.cwd()
  const agentDir = composerPiAgentDir()
  const authStorage = AuthStorage.inMemory({
    "openai-codex": {
      access: codex.access,
      chatgpt_account_id: codex.accountId,
      expires: codex.expires,
      refresh: codex.refresh,
      type: "oauth",
    },
  })
  const modelRegistry = ModelRegistry.inMemory(authStorage)
  const settingsManager = SettingsManager.create(cwd, agentDir)

  settingsManager.applyOverrides({
    compaction: { enabled: true },
    retry: { baseDelayMs: 1000, enabled: true, maxRetries: 2 },
  })

  const resourceLoader = await emptyResourceLoader({
    agentDir,
    cwd,
    settingsManager,
  })
  const sessionManager = piSessionFile
    ? SessionManager.open(piSessionFile, composerPiSessionDir(), cwd)
    : SessionManager.create(cwd, composerPiSessionDir())

  const result = await createAgentSession({
    agentDir,
    authStorage,
    customTools: [proposeEditTool({ currentText, sessionId })],
    cwd,
    model,
    modelRegistry,
    resourceLoader,
    sessionManager,
    settingsManager,
    thinkingLevel: "medium",
    tools: [PROPOSE_EDIT_TOOL_NAME],
  })

  result.session.setActiveToolsByName([PROPOSE_EDIT_TOOL_NAME])

  return result.session
}

export async function startComposePiSession() {
  await getActiveCodexRuntimeCredentials()
  await ensureComposerDataDirectories()

  const composeSession = await createComposeSession()
  const agentSession = await createConfiguredAgentSession({
    currentText: "",
    sessionId: composeSession.id,
  })

  try {
    if (agentSession.sessionFile) {
      await setComposeSessionPiFile(composeSession.id, agentSession.sessionFile)
    }

    agentSession.setSessionName("Composer")
  } finally {
    agentSession.dispose()
  }

  return getComposeSession(composeSession.id)
}

function confirmationPrompt({
  currentText,
  transcript,
}: {
  currentText: string
  transcript: string
}) {
  return `current_text length: ${currentText.length}
<current_text>
${currentText}
</current_text>

Unconfirmed STT transcript from the operator:
<transcript>
${transcript}
</transcript>

Normalize likely speech-to-text mistakes, rephrase the operator's intended request in one sentence, and ask the operator to confirm. Do not call ${PROPOSE_EDIT_TOOL_NAME} in this turn.`
}

function confirmedPrompt({
  currentText,
  transcript,
}: {
  currentText: string
  transcript: string
}) {
  return `current_text length: ${currentText.length}
<current_text>
${currentText}
</current_text>

The operator confirmed this STT-derived intent/transcript:
<confirmed_transcript>
${transcript}
</confirmed_transcript>

Respond to the confirmed intent. If the Writing field should change, call ${PROPOSE_EDIT_TOOL_NAME} with ranged edits against current_text. If no edit is needed, answer briefly without using tools.`
}

async function runPiTurn({
  currentText,
  prompt,
  sessionId,
}: {
  currentText: string
  prompt: string
  sessionId: string
}) {
  const composeSession = await getComposeSession(sessionId)
  const agentSession = await createConfiguredAgentSession({
    currentText,
    piSessionFile: composeSession.piSessionFile,
    sessionId,
  })
  const textDeltas: string[] = []
  const unsubscribe = agentSession.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      textDeltas.push(event.assistantMessageEvent.delta)
    }
  })

  try {
    if (agentSession.sessionFile && agentSession.sessionFile !== composeSession.piSessionFile) {
      await setComposeSessionPiFile(sessionId, agentSession.sessionFile)
    }

    await agentSession.prompt(prompt, { expandPromptTemplates: false })
  } finally {
    unsubscribe()
    agentSession.dispose()
  }

  const assistantText = textDeltas.join("").trim()

  if (assistantText) {
    await appendComposeMessage({
      content: assistantText,
      role: "assistant",
      sessionId,
    })
  }

  return getComposeSession(sessionId)
}

export async function sendTypedComposeMessage({
  content,
  sessionId,
}: {
  content: string
  sessionId: string
}) {
  const normalized = content.trim()

  if (!normalized) {
    throw new Error("Message is empty.")
  }

  await appendComposeMessage({
    content: normalized,
    role: "user",
    sessionId,
    source: "typed",
  })

  return getComposeSession(sessionId)
}

export async function sendTranscriptComposeMessage({
  confirmed = false,
  content,
  currentText,
  sessionId,
}: {
  confirmed?: boolean
  content: string
  currentText: string
  sessionId: string
}) {
  const transcript = normalizeTranscript(content)

  return runInSessionQueue(sessionId, async () => {
    await appendComposeMessage({
      content: confirmed ? `Confirmed: ${transcript}` : transcript,
      role: "user",
      sessionId,
      source: "transcript",
    })

    return runPiTurn({
      currentText,
      prompt: confirmed
        ? confirmedPrompt({ currentText, transcript })
        : confirmationPrompt({ currentText, transcript }),
      sessionId,
    })
  })
}
