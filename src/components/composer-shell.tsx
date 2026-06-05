"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Bot,
  Loader2,
  MessageSquareText,
  PlugZap,
  RefreshCw,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
  const [composePrompt, setComposePrompt] = useState("")

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
      setNotice("Connector failover settings updated.")
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
      setNotice(`${connection.name} token refreshed.`)
      await loadPlan()
    })
  }

  return (
    <SidebarProvider>
      <ComposerSidebar
        activeView={primaryView}
        connectorCount={rows.length}
        loading={loading}
        onRefresh={() => void loadPlan()}
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
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6">
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
              composePrompt={composePrompt}
              onComposePromptChange={setComposePrompt}
            />
          ) : (
            <ConnectorsTableView
              busyAction={busyAction}
              loading={loading}
              rows={rows}
              onDelete={deleteConnection}
              onRefreshCodex={refreshCodex}
              onUpdate={updateConnection}
            />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function ComposerSidebar({
  activeView,
  connectorCount,
  loading,
  onRefresh,
  onViewChange,
}: {
  activeView: PrimaryView
  connectorCount: number
  loading: boolean
  onRefresh: () => void
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
      <SidebarFooter className="pb-4 group-data-[collapsible=icon]:hidden">
        <div className="flex flex-col gap-3 px-2 text-xs text-muted-foreground">
          <p>
            Local no-auth mode. Keep Composer bound to 127.0.0.1 unless the
            connector APIs are protected elsewhere.
          </p>
          <Button
            disabled={loading}
            onClick={onRefresh}
            size="xs"
            type="button"
            variant="outline"
          >
            {loading ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            Sync
          </Button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function ComposeView({
  composePrompt,
  onComposePromptChange,
}: {
  composePrompt: string
  onComposePromptChange: (value: string) => void
}) {
  return (
    <section className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Compose</h1>
        <p className="text-sm text-muted-foreground">
          Draft messages here once the Pi-agent writing runtime lands. For now,
          this space stays local and connector readiness lives in the sidebar
          table view.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText />
            Compose message
          </CardTitle>
          <CardDescription>
            The writing runtime is intentionally disabled until the Composer
            Pi-agent session slice is implemented.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="compose-prompt">What should Composer write?</FieldLabel>
              <Textarea
                id="compose-prompt"
                className="min-h-48"
                placeholder="Example: Write a concise reply confirming the meeting time and asking for the agenda."
                value={composePrompt}
                onChange={(event) => onComposePromptChange(event.target.value)}
              />
              <FieldDescription>
                Nothing is sent to a model yet. This is the future composing
                surface.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button disabled type="button">
              <Bot data-icon="inline-start" />
              Compose with Pi agent
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function ConnectorsTableView({
  busyAction,
  loading,
  onDelete,
  onRefreshCodex,
  onUpdate,
  rows,
}: {
  busyAction: string | null
  loading: boolean
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
    <section className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
        <p className="text-sm text-muted-foreground">
          Manage Codex and Deepgram connector readiness. Secrets stay encrypted
          on the local server and are never displayed.
        </p>
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
                  {loading
                    ? "Loading connectors…"
                    : "No connectors yet. Add Codex or Deepgram credentials through the local connector APIs."}
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
