"use client"

import type { FormEvent } from "react"
import { useEffect, useMemo, useState } from "react"
import {
  ExternalLink,
  Loader2,
  MessageSquareText,
  PlugZap,
  RefreshCw,
  Trash2,
} from "lucide-react"

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
import { cn } from "@/lib/utils"

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

export function ComposerShell() {
  const [primaryView, setPrimaryView] = useState<PrimaryView>("compose")
  const [plan, setPlan] = useState<ConnectorPlan>(EMPTY_PLAN)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
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

  const rows = useMemo(() => connectorRows(plan), [plan])

  useEffect(() => {
    void loadPlan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connectorRequest<TResponse>(
    path: string,
    options: RequestInit = {}
  ) {
    const headers = new Headers(options.headers)

    if (options.body && !headers.has("content-type")) {
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
    setError("")
    setNotice("")

    try {
      await action()
    } catch (actionError) {
      setError(
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
    setError("")

    try {
      const nextPlan = await connectorRequest<ConnectorPlan>("/api/connectors")
      setPlan(nextPlan)
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load connectors."
      )
    } finally {
      setLoading(false)
    }
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
      setNotice("Connector updated.")
      await loadPlan()
    })
  }

  async function deleteConnection(kind: ConnectorKind, connection: ConnectionBase) {
    await runAction(`${kind}:delete:${connection.id}`, async () => {
      await connectorRequest(`/api/connectors/${kind}/connections/${connection.id}`, {
        method: "DELETE",
      })
      setNotice(`${connection.name} removed.`)
      await loadPlan()
    })
  }

  async function refreshCodex(connection: CodexConnection) {
    await runAction(`codex:refresh:${connection.id}`, async () => {
      await connectorRequest(
        `/api/connectors/codex/connections/${connection.id}/refresh`,
        { method: "POST" }
      )
      setNotice(`${connection.name} refreshed.`)
      await loadPlan()
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
      setNotice("Codex login ready.")
    })
  }

  async function completeCodexAuthorization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!codexAuthorization) {
      setError("Start Codex login first.")
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
      setNotice("Codex added.")
      await loadPlan()
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
      setNotice("Deepgram added.")
      await loadPlan()
    })
  }

  return (
    <SidebarProvider>
      <ComposerSidebar
        activeView={primaryView}
        connectorCount={rows.length}
        onViewChange={setPrimaryView}
      />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger type="button" />
          <Separator orientation="vertical" className="mx-1 h-4" />
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Composer</span>
            <span>/</span>
            <span className="capitalize">{primaryView}</span>
          </div>
        </header>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
          {(notice || error) && (
            <div
              className={cn(
                "border px-4 py-3 text-sm",
                error
                  ? "border-destructive/25 bg-destructive/5 text-destructive"
                  : "border-primary/20 bg-primary/5 text-foreground"
              )}
              role={error ? "alert" : "status"}
            >
              {error || notice}
            </div>
          )}

          {primaryView === "compose" ? (
            <ComposeView
              composeDraft={composeDraft}
              onComposeDraftChange={setComposeDraft}
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
  onViewChange,
}: {
  activeView: PrimaryView
  connectorCount: number
  onViewChange: (view: PrimaryView) => void
}) {
  const { setOpenMobile } = useSidebar()

  function chooseView(view: PrimaryView) {
    onViewChange(view)
    setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => chooseView("compose")}
              size="lg"
              tooltip="Composer"
              type="button"
            >
              <span className="flex size-6 items-center justify-center rounded-sm bg-sidebar-primary text-sidebar-primary-foreground">
                C
              </span>
              <span>Composer</span>
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
                  isActive={activeView === "compose"}
                  onClick={() => chooseView("compose")}
                  tooltip="Compose"
                  type="button"
                >
                  <MessageSquareText />
                  <span>Compose</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeView === "connectors"}
                  onClick={() => chooseView("connectors")}
                  tooltip="Connectors"
                  type="button"
                >
                  <PlugZap />
                  <span>Connectors</span>
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
  composeDraft,
  onComposeDraftChange,
}: {
  composeDraft: string
  onComposeDraftChange: (value: string) => void
}) {
  return (
    <section className="grid min-h-[calc(100svh-6.5rem)] min-w-0 grid-rows-2 gap-4 lg:grid-cols-2 lg:grid-rows-1">
      <section className="flex min-h-0 min-w-0 flex-col border bg-card">
        <header className="border-b px-4 py-3 text-xs font-semibold tracking-wider uppercase">
          Writing
        </header>
        <Textarea
          aria-label="Writing"
          className="min-h-0 flex-1 resize-none border-0 p-4 focus-visible:border-transparent"
          value={composeDraft}
          onChange={(event) => onComposeDraftChange(event.target.value)}
        />
      </section>
      <section className="flex min-h-0 min-w-0 flex-col border bg-card">
        <header className="border-b px-4 py-3 text-xs font-semibold tracking-wider uppercase">
          AI Chat history
        </header>
        <div aria-label="AI Chat history" className="min-h-0 flex-1" />
      </section>
    </section>
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
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
        <Button type="button" onClick={onAddConnector}>
          + Connector
        </Button>
      </div>

      <div className="min-w-0 overflow-x-auto rounded-none border">
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
                  className="h-24 text-center text-muted-foreground"
                  colSpan={7}
                >
                  {loading ? "Loading connectors…" : "No connectors yet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
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
            disabled={busyAction === updateAction}
            onClick={() => onUpdate(row.kind, row.connection, { priority: 1 })}
            size="xs"
            type="button"
            variant="outline"
          >
            Primary
          </Button>
          {row.kind === "codex" ? (
            <Button
              disabled={busyAction === `codex:refresh:${row.connection.id}`}
              onClick={() => onRefreshCodex(row.connection)}
              size="xs"
              type="button"
              variant="outline"
            >
              {busyAction === `codex:refresh:${row.connection.id}` ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              Refresh
            </Button>
          ) : null}
          <Button
            disabled={busyAction === deleteAction}
            onClick={() => onDelete(row.kind, row.connection)}
            size="xs"
            type="button"
            variant="destructive"
          >
            {busyAction === deleteAction ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Trash2 data-icon="inline-start" />
            )}
            Delete
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
        <div className="flex flex-col gap-8 px-8 pb-8">
          <FieldGroup className="gap-6">
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
          </FieldGroup>

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
    <div className="flex flex-col gap-6">
      <form className="flex flex-col gap-5" onSubmit={onStartAuthorization}>
        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel htmlFor="codex-name">Name</FieldLabel>
            <Input
              id="codex-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <Button disabled={busyAction === "codex:start"} type="submit">
          {busyAction === "codex:start" ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : null}
          Start Codex login
        </Button>
      </form>

      {authorization ? (
        <form className="flex flex-col gap-5" onSubmit={onCompleteAuthorization}>
          <Button asChild type="button" variant="outline">
            <a href={authorization.authUrl} target="_blank" rel="noreferrer">
              <ExternalLink data-icon="inline-start" />
              Open Codex login
            </a>
          </Button>
          <FieldGroup className="gap-5">
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
          </FieldGroup>
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
      ) : null}
    </div>
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
