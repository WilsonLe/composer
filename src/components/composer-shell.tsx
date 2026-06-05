"use client"

import Link from "next/link"
import type { FormEvent } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Bot,
  Check,
  ExternalLink,
  Loader2,
  MessageSquareText,
  Mic,
  PlugZap,
  Plus,
  RefreshCw,
  Send,
  SquarePen,
  Star,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type {
  ComposeEditProposal,
  ComposeSessionMessage,
  ComposeSessionRecord,
} from "@/lib/composer/types"

type PrimaryView = "compose" | "connectors"
type ConnectorKind = "codex" | "deepgram"

type ConnectionBase = {
  createdAt: string
  defaultModel: string
  enabled: boolean
  id: string
  name: string
  priority: number
  status: string
  statusMessage: string
  updatedAt: string
}

type CodexConnection = ConnectionBase & {
  chatgptAccountId?: string
  chatgptPlanType?: string
  lastTokenRefreshAt?: string
  openaiEmail: string
  tokenExpiresAt?: string | null
}

type DeepgramConnection = ConnectionBase & {
  accountIdentifier?: string
  providerType: string
  type: string
}

type FailoverPlan<TConnection extends ConnectionBase> = {
  active: TConnection | null
  disabled: TConnection[]
  fallbacks: TConnection[]
  needsAttention: TConnection[]
}

type ConnectorPlan = {
  composer: FailoverPlan<CodexConnection>
  connections: {
    codex: CodexConnection[]
    deepgram: DeepgramConnection[]
  }
  speechToText: FailoverPlan<DeepgramConnection>
}

type CodexAuthorization = {
  authUrl: string
  createdAt: string
  expiresAt: string
  id: string
  redirectUri: string
}

type DeepgramTranscriptionResult = {
  confidence?: number
  detectedLanguage?: string
  duration?: number
  model: string
  requestID?: string
  transcript: string
}

type CodexConnectorRow = {
  capability: "Text composition"
  connection: CodexConnection
  kind: "codex"
  provider: "OpenAI Codex"
}

type DeepgramConnectorRow = {
  capability: "Speech to text"
  connection: DeepgramConnection
  kind: "deepgram"
  provider: "Deepgram"
}

type ConnectorRow = CodexConnectorRow | DeepgramConnectorRow

const EMPTY_PLAN: ConnectorPlan = {
  composer: {
    active: null,
    disabled: [],
    fallbacks: [],
    needsAttention: [],
  },
  connections: {
    codex: [],
    deepgram: [],
  },
  speechToText: {
    active: null,
    disabled: [],
    fallbacks: [],
    needsAttention: [],
  },
}

function statusBadgeVariant(status: string) {
  if (status === "connected") {
    return "default" as const
  }

  return "destructive" as const
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ")
}

function friendlyDate(value?: string | null) {
  if (!value) {
    return "—"
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function accountLabel(row: ConnectorRow) {
  if (row.kind === "codex") {
    return row.connection.openaiEmail
  }

  return row.connection.accountIdentifier || "—"
}

function credentialMetadata(row: ConnectorRow) {
  if (row.kind === "codex") {
    return [
      row.connection.defaultModel,
      `Priority ${row.connection.priority}`,
      `Token expires ${friendlyDate(row.connection.tokenExpiresAt)}`,
    ]
  }

  return [
    row.connection.defaultModel,
    `Priority ${row.connection.priority}`,
    row.connection.providerType,
  ]
}

function connectorRows(plan: ConnectorPlan): ConnectorRow[] {
  return [
    ...plan.connections.codex.map(
      (connection): CodexConnectorRow => ({
        capability: "Text composition",
        connection,
        kind: "codex",
        provider: "OpenAI Codex",
      })
    ),
    ...plan.connections.deepgram.map(
      (connection): DeepgramConnectorRow => ({
        capability: "Speech to text",
        connection,
        kind: "deepgram",
        provider: "Deepgram",
      })
    ),
  ].sort(
    (left, right) =>
      left.connection.priority - right.connection.priority ||
      left.provider.localeCompare(right.provider) ||
      left.connection.createdAt.localeCompare(right.connection.createdAt)
  )
}

export function ComposerShell({ activeView }: { activeView: PrimaryView }) {
  const [plan, setPlan] = useState<ConnectorPlan>(EMPTY_PLAN)
  const [loading, setLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [composeDraft, setComposeDraft] = useState("")
  const [connectorSheetOpen, setConnectorSheetOpen] = useState(false)
  const [connectorProvider, setConnectorProvider] =
    useState<ConnectorKind>("codex")
  const [codexName, setCodexName] = useState("")
  const [codexAuthorization, setCodexAuthorization] =
    useState<CodexAuthorization | null>(null)
  const [codexCallbackInput, setCodexCallbackInput] = useState("")
  const [deepgramName, setDeepgramName] = useState("")
  const [deepgramAccount, setDeepgramAccount] = useState("")
  const [deepgramApiKey, setDeepgramApiKey] = useState("")
  const [composeSession, setComposeSession] =
    useState<ComposeSessionRecord | null>(null)
  const [composeSessionLoading, setComposeSessionLoading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [pendingTranscript, setPendingTranscript] = useState("")
  const [typedChatDraft, setTypedChatDraft] = useState("")
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])

  const rows = useMemo(() => connectorRows(plan), [plan])
  const viewLabel = activeView === "compose" ? "Compose" : "Connectors"

  useEffect(() => {
    void loadPlan()
    void loadComposeSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connectorRequest<TResponse>(
    path: string,
    options: RequestInit = {}
  ) {
    const headers = new Headers(options.headers)

    if (
      options.body &&
      !(options.body instanceof FormData) &&
      !headers.has("content-type")
    ) {
      headers.set("content-type", "application/json")
    }

    const response = await fetch(path, {
      ...options,
      headers,
    })

    if (response.status === 204) {
      return null as TResponse
    }

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string
    }

    if (!response.ok) {
      throw new Error(payload.error || response.statusText)
    }

    return payload as TResponse
  }

  async function runAction(actionId: string, action: () => Promise<void>) {
    setBusyAction(actionId)

    try {
      await action()
    } catch (actionError) {
      toast.error(
        actionError instanceof Error
          ? actionError.message
          : "Something went wrong."
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function loadPlan() {
    setLoading(true)

    try {
      const nextPlan = await connectorRequest<ConnectorPlan>("/api/connectors")
      setPlan(nextPlan)
    } catch (loadError) {
      toast.error(
        loadError instanceof Error
          ? loadError.message
          : "Could not load connectors."
      )
    } finally {
      setLoading(false)
    }
  }

  async function loadComposeSessions() {
    setComposeSessionLoading(true)

    try {
      const payload = await connectorRequest<{ sessions: ComposeSessionRecord[] }>(
        "/api/compose/sessions"
      )
      setComposeSession(payload.sessions[0] || null)
    } catch (loadError) {
      toast.error(
        loadError instanceof Error
          ? loadError.message
          : "Could not load Pi sessions."
      )
    } finally {
      setComposeSessionLoading(false)
    }
  }

  async function startComposeSession() {
    await runAction("compose:start", async () => {
      const session = await connectorRequest<ComposeSessionRecord>(
        "/api/compose/sessions",
        { method: "POST" }
      )
      setComposeSession(session)
      setPendingTranscript("")
      toast.success("Pi session started")
    })
  }

  async function sendComposeMessage({
    confirmed,
    content,
    source,
  }: {
    confirmed?: boolean
    content: string
    source: "transcript" | "typed"
  }) {
    if (!composeSession) {
      toast.error("Start a Pi session first.")
      return
    }

    const actionId =
      source === "typed"
        ? "compose:typed"
        : confirmed
          ? "compose:confirm"
          : "compose:transcript"

    await runAction(actionId, async () => {
      const session = await connectorRequest<ComposeSessionRecord>(
        `/api/compose/sessions/${composeSession.id}/messages`,
        {
          body: JSON.stringify({
            confirmed,
            content,
            currentText: composeDraft,
            source,
          }),
          method: "POST",
        }
      )
      setComposeSession(session)

      if (source === "typed") {
        setTypedChatDraft("")
      } else if (confirmed) {
        setPendingTranscript("")
      } else {
        setPendingTranscript(content)
      }
    })
  }

  async function submitRecording(audio: Blob) {
    if (!composeSession) {
      toast.error("Start a Pi session first.")
      return
    }

    await runAction("compose:recording", async () => {
      const body = new FormData()
      body.set("audio", audio, "composer-recording.webm")
      const transcription = await connectorRequest<DeepgramTranscriptionResult>(
        `/api/compose/sessions/${composeSession.id}/transcriptions`,
        {
          body,
          method: "POST",
        }
      )

      await sendComposeMessage({
        content: transcription.transcript,
        source: "transcript",
      })
    })
  }

  async function toggleRecording() {
    if (isRecording) {
      mediaRecorderRef.current?.stop()
      return
    }

    if (!composeSession) {
      toast.error("Start a Pi session first.")
      return
    }

    if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
      toast.error("Speech recording is not available in this browser.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recordingChunksRef.current = []
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data)
        }
      }
      recorder.onstop = () => {
        setIsRecording(false)
        stream.getTracks().forEach((track) => track.stop())
        const audio = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        })
        recordingChunksRef.current = []
        mediaRecorderRef.current = null

        if (audio.size === 0) {
          toast.error("No audio was recorded.")
          return
        }

        void submitRecording(audio)
      }
      recorder.start()
      setIsRecording(true)
    } catch (recordingError) {
      toast.error(
        recordingError instanceof Error
          ? recordingError.message
          : "Could not start recording."
      )
    }
  }

  async function sendTypedChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await sendComposeMessage({ content: typedChatDraft, source: "typed" })
  }

  async function confirmPendingTranscript() {
    await sendComposeMessage({
      confirmed: true,
      content: pendingTranscript,
      source: "transcript",
    })
  }

  async function acceptProposal(proposal: ComposeEditProposal) {
    if (!composeSession) {
      return
    }

    await runAction(`compose:accept:${proposal.id}`, async () => {
      const payload = await connectorRequest<{
        appliedText: string
        session: ComposeSessionRecord
      }>(
        `/api/compose/sessions/${composeSession.id}/proposals/${proposal.id}/accept`,
        {
          body: JSON.stringify({ currentText: composeDraft }),
          method: "POST",
        }
      )
      setComposeDraft(payload.appliedText)
      setComposeSession(payload.session)
      toast.success("Applied")
    })
  }

  async function rejectProposal(proposal: ComposeEditProposal) {
    if (!composeSession) {
      return
    }

    await runAction(`compose:reject:${proposal.id}`, async () => {
      const payload = await connectorRequest<{ session: ComposeSessionRecord }>(
        `/api/compose/sessions/${composeSession.id}/proposals/${proposal.id}/reject`,
        { method: "POST" }
      )
      setComposeSession(payload.session)
      toast.success("Rejected")
    })
  }

  async function updateConnection(
    kind: ConnectorKind,
    connection: ConnectionBase,
    patch: Partial<Pick<ConnectionBase, "enabled" | "priority">>
  ) {
    await runAction(`${kind}:update:${connection.id}`, async () => {
      await connectorRequest(
        `/api/connectors/${kind}/connections/${connection.id}`,
        {
          body: JSON.stringify(patch),
          method: "PATCH",
        }
      )
      await loadPlan()
      toast.success("Saved")
    })
  }

  async function deleteConnection(kind: ConnectorKind, connection: ConnectionBase) {
    await runAction(`${kind}:delete:${connection.id}`, async () => {
      await connectorRequest(`/api/connectors/${kind}/connections/${connection.id}`, {
        method: "DELETE",
      })
      await loadPlan()
      toast.success("Removed")
    })
  }

  async function refreshCodex(connection: CodexConnection) {
    await runAction(`codex:refresh:${connection.id}`, async () => {
      await connectorRequest(
        `/api/connectors/codex/connections/${connection.id}/refresh`,
        { method: "POST" }
      )
      await loadPlan()
      toast.success("Refreshed")
    })
  }

  async function startCodexAuthorization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runAction("codex:start", async () => {
      const authorization = await connectorRequest<CodexAuthorization>(
        "/api/connectors/codex/authorizations",
        { method: "POST" }
      )
      setCodexAuthorization(authorization)
      setCodexCallbackInput("")
      toast.success("Ready")
    })
  }

  async function completeCodexAuthorization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!codexAuthorization) {
      toast.error("Start login first.")
      return
    }

    await runAction("codex:complete", async () => {
      await connectorRequest<CodexConnection>(
        "/api/connectors/codex/connections",
        {
          body: JSON.stringify({
            authorizationId: codexAuthorization.id,
            callbackInput: codexCallbackInput,
            name: codexName || undefined,
          }),
          method: "POST",
        }
      )
      setCodexAuthorization(null)
      setCodexCallbackInput("")
      setCodexName("")
      setConnectorSheetOpen(false)
      await loadPlan()
      toast.success("Added")
    })
  }

  async function createDeepgramConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runAction("deepgram:create", async () => {
      await connectorRequest<DeepgramConnection>(
        "/api/connectors/deepgram/connections",
        {
          body: JSON.stringify({
            accountIdentifier: deepgramAccount || undefined,
            apiKey: deepgramApiKey,
            name: deepgramName || undefined,
          }),
          method: "POST",
        }
      )
      setDeepgramAccount("")
      setDeepgramApiKey("")
      setDeepgramName("")
      setConnectorSheetOpen(false)
      await loadPlan()
      toast.success("Added")
    })
  }

  return (
    <SidebarProvider>
      <ComposerSidebar activeView={activeView} connectorCount={rows.length} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger type="button" />
          <Separator orientation="vertical" className="mx-1 h-4" />
          <div className="flex min-w-0 items-center text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{viewLabel}</span>
          </div>
        </header>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
          {activeView === "compose" ? (
            <ComposeView
              busyAction={busyAction}
              composeDraft={composeDraft}
              composeSession={composeSession}
              composeSessionLoading={composeSessionLoading}
              isRecording={isRecording}
              pendingTranscript={pendingTranscript}
              typedChatDraft={typedChatDraft}
              onAcceptProposal={acceptProposal}
              onComposeDraftChange={setComposeDraft}
              onConfirmTranscript={confirmPendingTranscript}
              onNewCompose={() => setComposeDraft("")}
              onRejectProposal={rejectProposal}
              onStartPiSession={startComposeSession}
              onToggleRecording={toggleRecording}
              onTypedChatDraftChange={setTypedChatDraft}
              onTypedChatSubmit={sendTypedChat}
              onClearPendingTranscript={() => setPendingTranscript("")}
            />
          ) : (
            <ConnectorsTableView
              busyAction={busyAction}
              loading={loading}
              rows={rows}
              onAddConnector={() => setConnectorSheetOpen(true)}
              onDelete={deleteConnection}
              onRefreshCodex={refreshCodex}
              onUpdate={updateConnection}
            />
          )}
        </main>
      </SidebarInset>
      <ConnectorSheet
        busyAction={busyAction}
        codexAuthorization={codexAuthorization}
        codexCallbackInput={codexCallbackInput}
        codexName={codexName}
        deepgramAccount={deepgramAccount}
        deepgramApiKey={deepgramApiKey}
        deepgramName={deepgramName}
        onCodexCallbackInputChange={setCodexCallbackInput}
        onCodexNameChange={setCodexName}
        onCompleteCodexAuthorization={completeCodexAuthorization}
        onCreateDeepgram={createDeepgramConnection}
        onDeepgramAccountChange={setDeepgramAccount}
        onDeepgramApiKeyChange={setDeepgramApiKey}
        onDeepgramNameChange={setDeepgramName}
        onOpenChange={setConnectorSheetOpen}
        onProviderChange={setConnectorProvider}
        onStartCodexAuthorization={startCodexAuthorization}
        open={connectorSheetOpen}
        provider={connectorProvider}
      />
    </SidebarProvider>
  )
}

function ComposerSidebar({
  activeView,
  connectorCount,
}: {
  activeView: PrimaryView
  connectorCount: number
}) {
  const { setOpenMobile } = useSidebar()
  const closeMobileSidebar = () => setOpenMobile(false)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="Compose">
              <Link href="/compose" onClick={closeMobileSidebar}>
                <span className="flex size-6 items-center justify-center rounded-sm bg-sidebar-primary text-sidebar-primary-foreground">
                  C
                </span>
                <span className="group-data-[collapsible=icon]:hidden">
                  Composer
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={activeView === "compose"}
                  tooltip="Compose"
                >
                  <Link href="/compose" onClick={closeMobileSidebar}>
                    <MessageSquareText />
                    <span>Compose</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={activeView === "connectors"}
                  tooltip="Connectors"
                >
                  <Link href="/connectors" onClick={closeMobileSidebar}>
                    <PlugZap />
                    <span>Connectors</span>
                  </Link>
                </SidebarMenuButton>
                <SidebarMenuBadge>{connectorCount}</SidebarMenuBadge>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

function ComposeView({
  busyAction,
  composeDraft,
  composeSession,
  composeSessionLoading,
  isRecording,
  onAcceptProposal,
  onClearPendingTranscript,
  onComposeDraftChange,
  onConfirmTranscript,
  onNewCompose,
  onRejectProposal,
  onStartPiSession,
  onToggleRecording,
  onTypedChatDraftChange,
  onTypedChatSubmit,
  pendingTranscript,
  typedChatDraft,
}: {
  busyAction: string | null
  composeDraft: string
  composeSession: ComposeSessionRecord | null
  composeSessionLoading: boolean
  isRecording: boolean
  onAcceptProposal: (proposal: ComposeEditProposal) => void
  onClearPendingTranscript: () => void
  onComposeDraftChange: (value: string) => void
  onConfirmTranscript: () => void
  onNewCompose: () => void
  onRejectProposal: (proposal: ComposeEditProposal) => void
  onStartPiSession: () => void
  onToggleRecording: () => void
  onTypedChatDraftChange: (value: string) => void
  onTypedChatSubmit: (event: FormEvent<HTMLFormElement>) => void
  pendingTranscript: string
  typedChatDraft: string
}) {
  const pendingProposals = composeSession?.proposals.filter(
    (proposal) => proposal.status === "pending"
  )

  return (
    <section className="grid min-h-[calc(100svh-6.5rem)] min-w-0 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:grid-rows-1">
      <section className="flex min-h-0 min-w-0 flex-col pb-4 lg:pb-0 lg:pr-6">
        <header className="flex items-center justify-between gap-2 px-1 pb-3">
          <span className="text-xs font-semibold tracking-wider uppercase">
            Writing
          </span>
          <Button
            aria-label="New compose"
            title="New compose"
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={onNewCompose}
          >
            <SquarePen />
          </Button>
        </header>
        <Separator />
        <Textarea
          aria-label="Writing"
          className="min-h-0 flex-1 resize-none border-0 px-1 py-4 focus-visible:border-transparent"
          value={composeDraft}
          onChange={(event) => onComposeDraftChange(event.target.value)}
        />
      </section>
      <Separator className="lg:hidden" />
      <Separator className="hidden lg:block" orientation="vertical" />
      <section className="flex min-h-0 min-w-0 flex-col pt-4 lg:pt-0 lg:pl-6">
        <header className="flex items-center justify-between gap-2 px-1 pb-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-semibold tracking-wider uppercase">
              AI Chat history
            </span>
            {composeSession ? (
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {composeSession.id}
              </span>
            ) : null}
          </div>
          <Button
            aria-label="Start Pi session"
            title="Start Pi session"
            type="button"
            size="icon-sm"
            variant={composeSession ? "outline" : "default"}
            disabled={busyAction === "compose:start"}
            onClick={onStartPiSession}
          >
            {busyAction === "compose:start" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Bot />
            )}
          </Button>
        </header>
        <Separator />
        <div
          aria-label="AI Chat history"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-4"
        >
          {composeSessionLoading ? (
            <p className="px-1 text-sm text-muted-foreground">
              Loading Pi sessions…
            </p>
          ) : null}
          {!composeSession && !composeSessionLoading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <Bot className="size-8" />
              <p>Start a Composer-managed Pi session.</p>
              <Button
                type="button"
                size="icon-sm"
                aria-label="Start Pi session"
                onClick={onStartPiSession}
              >
                <Bot />
              </Button>
            </div>
          ) : null}
          {composeSession?.messages.map((message) => (
            <ComposeMessageBubble key={message.id} message={message} />
          ))}
          {pendingProposals?.map((proposal) => (
            <ComposeProposalCard
              busyAction={busyAction}
              key={proposal.id}
              proposal={proposal}
              onAccept={onAcceptProposal}
              onReject={onRejectProposal}
            />
          ))}
        </div>
        {composeSession ? (
          <div className="flex flex-col gap-3 border-t pt-3">
            {pendingTranscript ? (
              <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-xs">
                <span className="font-medium">Confirm STT intent</span>
                <p className="text-muted-foreground">{pendingTranscript}</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyAction === "compose:confirm"}
                    onClick={onConfirmTranscript}
                  >
                    <Check data-icon="inline-start" />
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onClearPendingTranscript}
                  >
                    <X data-icon="inline-start" />
                    Clear
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <Button
                aria-label={isRecording ? "Stop recording" : "Record speech"}
                title={isRecording ? "Stop recording" : "Record speech"}
                type="button"
                size="icon-sm"
                variant={isRecording ? "destructive" : "outline"}
                disabled={busyAction === "compose:recording"}
                onClick={onToggleRecording}
              >
                {busyAction === "compose:recording" ? (
                  <Loader2 className="animate-spin" />
                ) : isRecording ? (
                  <X />
                ) : (
                  <Mic />
                )}
              </Button>
              <form className="flex min-w-0 flex-1 gap-2" onSubmit={onTypedChatSubmit}>
                <Input
                  aria-label="Typed local note"
                  placeholder="Typed note (not sent to Pi)"
                  value={typedChatDraft}
                  onChange={(event) => onTypedChatDraftChange(event.target.value)}
                />
                <Button
                  aria-label="Save typed note"
                  title="Save typed note"
                  type="submit"
                  size="icon-sm"
                  variant="outline"
                  disabled={busyAction === "compose:typed" || !typedChatDraft.trim()}
                >
                  {busyAction === "compose:typed" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Send />
                  )}
                </Button>
              </form>
            </div>
          </div>
        ) : null}
      </section>
    </section>
  )
}

function ComposeMessageBubble({ message }: { message: ComposeSessionMessage }) {
  const isAssistant = message.role === "assistant"
  const label = isAssistant
    ? "Pi"
    : message.source === "typed"
      ? "Typed note"
      : "Transcript"

  return (
    <article
      className={`max-w-[90%] rounded-md border px-3 py-2 text-sm ${
        isAssistant ? "bg-muted/40" : "ml-auto bg-background"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        <time>{friendlyDate(message.createdAt)}</time>
      </div>
      <p className="whitespace-pre-wrap">{message.content}</p>
    </article>
  )
}

function ComposeProposalCard({
  busyAction,
  onAccept,
  onReject,
  proposal,
}: {
  busyAction: string | null
  onAccept: (proposal: ComposeEditProposal) => void
  onReject: (proposal: ComposeEditProposal) => void
  proposal: ComposeEditProposal
}) {
  const acceptAction = `compose:accept:${proposal.id}`
  const rejectAction = `compose:reject:${proposal.id}`

  return (
    <article className="rounded-md border bg-muted/20 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{proposal.summary}</p>
          <p className="text-xs text-muted-foreground">
            {proposal.edits.length} ranged edit{proposal.edits.length === 1 ? "" : "s"}
          </p>
        </div>
        <Badge variant="secondary">pending</Badge>
      </div>
      <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-xs">
        {proposal.afterText || "(empty text)"}
      </pre>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busyAction === acceptAction}
          onClick={() => onAccept(proposal)}
        >
          {busyAction === acceptAction ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <Check data-icon="inline-start" />
          )}
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busyAction === rejectAction}
          onClick={() => onReject(proposal)}
        >
          {busyAction === rejectAction ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <X data-icon="inline-start" />
          )}
          Reject
        </Button>
      </div>
    </article>
  )
}

function ConnectorsTableView({
  busyAction,
  loading,
  onAddConnector,
  onDelete,
  onRefreshCodex,
  onUpdate,
  rows,
}: {
  busyAction: string | null
  loading: boolean
  onAddConnector: () => void
  onDelete: (kind: ConnectorKind, connection: ConnectionBase) => void
  onRefreshCodex: (connection: CodexConnection) => void
  onUpdate: (
    kind: ConnectorKind,
    connection: ConnectionBase,
    patch: Partial<Pick<ConnectionBase, "enabled" | "priority">>
  ) => void
  rows: ConnectorRow[]
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex items-center justify-between gap-3 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
        <Button
          aria-label="Add connector"
          title="Add connector"
          type="button"
          size="icon-sm"
          onClick={onAddConnector}
        >
          <Plus />
        </Button>
      </div>
      <Separator />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Connector</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Credential Metadata</TableHead>
            <TableHead>Created At</TableHead>
            <TableHead>Updated At</TableHead>
            <TableHead className="sticky right-0 bg-background text-right">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <ConnectorTableRow
                busyAction={busyAction}
                key={`${row.kind}:${row.connection.id}`}
                row={row}
                onDelete={onDelete}
                onRefreshCodex={onRefreshCodex}
                onUpdate={onUpdate}
              />
            ))
          ) : (
            <TableRow>
              <TableCell
                className="h-24 text-left text-muted-foreground md:text-center"
                colSpan={7}
              >
                {loading ? "Loading connectors…" : "No connectors yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  )
}

function ConnectorTableRow({
  busyAction,
  onDelete,
  onRefreshCodex,
  onUpdate,
  row,
}: {
  busyAction: string | null
  onDelete: (kind: ConnectorKind, connection: ConnectionBase) => void
  onRefreshCodex: (connection: CodexConnection) => void
  onUpdate: (
    kind: ConnectorKind,
    connection: ConnectionBase,
    patch: Partial<Pick<ConnectionBase, "enabled" | "priority">>
  ) => void
  row: ConnectorRow
}) {
  const updateAction = `${row.kind}:update:${row.connection.id}`
  const deleteAction = `${row.kind}:delete:${row.connection.id}`
  const metadata = credentialMetadata(row)

  return (
    <TableRow>
      <TableCell>
        <div className="flex max-w-72 min-w-56 flex-col gap-1 whitespace-normal">
          <span className="font-medium">{row.connection.name}</span>
          <span className="font-mono text-xs break-all text-muted-foreground">
            {row.connection.id}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.capability} · {row.provider}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex max-w-72 min-w-44 flex-col gap-2 text-xs whitespace-normal">
          <Badge variant={statusBadgeVariant(row.connection.status)}>
            {statusLabel(row.connection.status)}
          </Badge>
          <span className="text-muted-foreground">
            {row.connection.enabled ? "Enabled" : "Disabled"}
          </span>
          {row.connection.statusMessage ? (
            <span className="break-words">{row.connection.statusMessage}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex max-w-72 min-w-48 flex-col gap-1 text-xs whitespace-normal">
          <span>{accountLabel(row)}</span>
          <span className="text-muted-foreground">{row.provider} connector</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex max-w-72 min-w-48 flex-col gap-1 text-xs whitespace-normal">
          {metadata.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </TableCell>
      <TableCell>{friendlyDate(row.connection.createdAt)}</TableCell>
      <TableCell>{friendlyDate(row.connection.updatedAt)}</TableCell>
      <TableCell className="sticky right-0 bg-background text-right">
        <div className="flex justify-end gap-2">
          <Switch
            aria-label={`Enable ${row.connection.name}`}
            checked={row.connection.enabled}
            onCheckedChange={(enabled) =>
              onUpdate(row.kind, row.connection, { enabled })
            }
          />
          <Button
            aria-label={`Make ${row.connection.name} primary`}
            title="Make primary"
            disabled={busyAction === updateAction}
            onClick={() => onUpdate(row.kind, row.connection, { priority: 1 })}
            size="icon-xs"
            type="button"
            variant="outline"
          >
            <Star />
          </Button>
          {row.kind === "codex" ? (
            <Button
              aria-label={`Refresh ${row.connection.name}`}
              title="Refresh"
              disabled={busyAction === `codex:refresh:${row.connection.id}`}
              onClick={() => onRefreshCodex(row.connection)}
              size="icon-xs"
              type="button"
              variant="outline"
            >
              {busyAction === `codex:refresh:${row.connection.id}` ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
            </Button>
          ) : null}
          <Button
            aria-label={`Delete ${row.connection.name}`}
            title="Delete"
            disabled={busyAction === deleteAction}
            onClick={() => onDelete(row.kind, row.connection)}
            size="icon-xs"
            type="button"
            variant="destructive"
          >
            {busyAction === deleteAction ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Trash2 />
            )}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function ConnectorSheet({
  busyAction,
  codexAuthorization,
  codexCallbackInput,
  codexName,
  deepgramAccount,
  deepgramApiKey,
  deepgramName,
  onCodexCallbackInputChange,
  onCodexNameChange,
  onCompleteCodexAuthorization,
  onCreateDeepgram,
  onDeepgramAccountChange,
  onDeepgramApiKeyChange,
  onDeepgramNameChange,
  onOpenChange,
  onProviderChange,
  onStartCodexAuthorization,
  open,
  provider,
}: {
  busyAction: string | null
  codexAuthorization: CodexAuthorization | null
  codexCallbackInput: string
  codexName: string
  deepgramAccount: string
  deepgramApiKey: string
  deepgramName: string
  onCodexCallbackInputChange: (value: string) => void
  onCodexNameChange: (value: string) => void
  onCompleteCodexAuthorization: (event: FormEvent<HTMLFormElement>) => void
  onCreateDeepgram: (event: FormEvent<HTMLFormElement>) => void
  onDeepgramAccountChange: (value: string) => void
  onDeepgramApiKeyChange: (value: string) => void
  onDeepgramNameChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onProviderChange: (value: ConnectorKind) => void
  onStartCodexAuthorization: (event: FormEvent<HTMLFormElement>) => void
  open: boolean
  provider: ConnectorKind
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Connector</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-8 pb-8">
          <Field>
            <FieldLabel>Provider</FieldLabel>
            <Select value={provider} onValueChange={onProviderChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="codex">OpenAI Codex</SelectItem>
                  <SelectItem value="deepgram">Deepgram</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Separator />

          {provider === "codex" ? (
            <CodexConnectorForm
              authorization={codexAuthorization}
              busyAction={busyAction}
              callbackInput={codexCallbackInput}
              name={codexName}
              onCallbackInputChange={onCodexCallbackInputChange}
              onCompleteAuthorization={onCompleteCodexAuthorization}
              onNameChange={onCodexNameChange}
              onStartAuthorization={onStartCodexAuthorization}
            />
          ) : (
            <DeepgramConnectorForm
              accountIdentifier={deepgramAccount}
              apiKey={deepgramApiKey}
              busyAction={busyAction}
              name={deepgramName}
              onAccountIdentifierChange={onDeepgramAccountChange}
              onApiKeyChange={onDeepgramApiKeyChange}
              onCreate={onCreateDeepgram}
              onNameChange={onDeepgramNameChange}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function CodexConnectorForm({
  authorization,
  busyAction,
  callbackInput,
  name,
  onCallbackInputChange,
  onCompleteAuthorization,
  onNameChange,
  onStartAuthorization,
}: {
  authorization: CodexAuthorization | null
  busyAction: string | null
  callbackInput: string
  name: string
  onCallbackInputChange: (value: string) => void
  onCompleteAuthorization: (event: FormEvent<HTMLFormElement>) => void
  onNameChange: (value: string) => void
  onStartAuthorization: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <>
      <form className="flex flex-col gap-5" onSubmit={onStartAuthorization}>
        <Field>
          <FieldLabel htmlFor="codex-name">Name</FieldLabel>
          <Input
            id="codex-name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </Field>
        <Button disabled={busyAction === "codex:start"} type="submit">
          {busyAction === "codex:start" ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : null}
          Start Codex login
        </Button>
      </form>

      {authorization ? (
        <>
          <Separator />
          <form className="flex flex-col gap-5" onSubmit={onCompleteAuthorization}>
            <Button asChild type="button" variant="outline">
              <a href={authorization.authUrl} target="_blank" rel="noreferrer">
                <ExternalLink data-icon="inline-start" />
                Open Codex login
              </a>
            </Button>
            <Field>
              <FieldLabel htmlFor="codex-callback">Callback URL</FieldLabel>
              <Textarea
                id="codex-callback"
                className="min-h-28"
                value={callbackInput}
                onChange={(event) =>
                  onCallbackInputChange(event.target.value)
                }
              />
            </Field>
            <Button
              disabled={busyAction === "codex:complete" || !callbackInput}
              type="submit"
            >
              {busyAction === "codex:complete" ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : null}
              Complete Codex login
            </Button>
          </form>
        </>
      ) : null}
    </>
  )
}

function DeepgramConnectorForm({
  accountIdentifier,
  apiKey,
  busyAction,
  name,
  onAccountIdentifierChange,
  onApiKeyChange,
  onCreate,
  onNameChange,
}: {
  accountIdentifier: string
  apiKey: string
  busyAction: string | null
  name: string
  onAccountIdentifierChange: (value: string) => void
  onApiKeyChange: (value: string) => void
  onCreate: (event: FormEvent<HTMLFormElement>) => void
  onNameChange: (value: string) => void
}) {
  return (
    <form className="flex flex-col gap-5" onSubmit={onCreate}>
      <FieldGroup className="gap-5">
        <Field>
          <FieldLabel htmlFor="deepgram-name">Name</FieldLabel>
          <Input
            id="deepgram-name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="deepgram-account">Account</FieldLabel>
          <Input
            id="deepgram-account"
            value={accountIdentifier}
            onChange={(event) => onAccountIdentifierChange(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="deepgram-api-key">API key</FieldLabel>
          <Input
            id="deepgram-api-key"
            autoComplete="off"
            type="password"
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
          />
        </Field>
      </FieldGroup>
      <Button disabled={busyAction === "deepgram:create" || !apiKey} type="submit">
        {busyAction === "deepgram:create" ? (
          <Loader2 className="animate-spin" data-icon="inline-start" />
        ) : null}
        Save Deepgram
      </Button>
    </form>
  )
}
