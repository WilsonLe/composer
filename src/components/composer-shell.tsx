"use client"

import type { FormEvent, ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import {
  Bot,
  CheckCircle2,
  KeyRound,
  Loader2,
  MessageSquareText,
  Mic,
  PlugZap,
  RefreshCw,
  Settings2,
  ShieldCheck,
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
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type PrimaryView = "compose" | "connectors"
type ConnectorView = "overview" | "codex" | "deepgram"
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

const ADMIN_TOKEN_STORAGE_KEY = "composer.adminToken"

function statusBadgeVariant(status: string) {
  if (status === "connected") {
    return "default" as const
  }

  return "destructive" as const
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

function connectionSummary(plan: FailoverPlan<ConnectionBase>) {
  if (!plan.active) {
    return "No active connector"
  }

  if (!plan.fallbacks.length) {
    return `${plan.active.name} only`
  }

  return `${plan.active.name} + ${plan.fallbacks.length} fallback${
    plan.fallbacks.length === 1 ? "" : "s"
  }`
}

export function ComposerShell() {
  const [primaryView, setPrimaryView] = useState<PrimaryView>("compose")
  const [connectorView, setConnectorView] =
    useState<ConnectorView>("overview")
  const [adminToken, setAdminToken] = useState("")
  const [tokenInput, setTokenInput] = useState("")
  const [plan, setPlan] = useState<ConnectorPlan>(EMPTY_PLAN)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const [composePrompt, setComposePrompt] = useState("")
  const [codexName, setCodexName] = useState("")
  const [codexAuthorization, setCodexAuthorization] =
    useState<CodexAuthorization | null>(null)
  const [codexCallbackInput, setCodexCallbackInput] = useState("")
  const [deepgramName, setDeepgramName] = useState("")
  const [deepgramAccount, setDeepgramAccount] = useState("")
  const [deepgramApiKey, setDeepgramApiKey] = useState("")

  const hasAdminToken = adminToken.trim().length > 0
  const connectorCounts = useMemo(
    () => ({
      codex: plan.connections.codex.length,
      deepgram: plan.connections.deepgram.length,
    }),
    [plan]
  )

  useEffect(() => {
    queueMicrotask(() => {
      const saved = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || ""
      setAdminToken(saved)
      setTokenInput(saved)
    })
  }, [])

  useEffect(() => {
    if (adminToken) {
      void loadPlan()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken])

  async function connectorRequest<TResponse>(
    path: string,
    options: RequestInit = {}
  ) {
    const headers = new Headers(options.headers)

    if (adminToken) {
      headers.set("authorization", `Bearer ${adminToken}`)
    }

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

  function saveAdminToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextToken = tokenInput.trim()
    window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, nextToken)
    setAdminToken(nextToken)
    setNotice(nextToken ? "Admin token saved locally in this browser." : "")
    setError("")
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
      setNotice("Codex login link is ready. Open it, then paste the final callback URL here.")
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
      setNotice("Codex connection saved.")
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
      setNotice("Deepgram connection saved.")
      await loadPlan()
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
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="sticky top-0 z-10 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.35em] text-muted-foreground uppercase">
                Wilson Le
              </p>
              <h1 className="text-2xl font-semibold tracking-tight">
                composer
              </h1>
            </div>
            <nav
              aria-label="Composer sections"
              className="grid grid-cols-2 gap-2 sm:flex sm:w-auto"
            >
              <Button
                type="button"
                variant={primaryView === "compose" ? "default" : "outline"}
                onClick={() => setPrimaryView("compose")}
              >
                <MessageSquareText />
                Compose
              </Button>
              <Button
                type="button"
                variant={primaryView === "connectors" ? "default" : "outline"}
                onClick={() => setPrimaryView("connectors")}
              >
                <PlugZap />
                Connectors
              </Button>
            </nav>
          </div>
        </header>

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
            connectorCounts={connectorCounts}
            onComposePromptChange={setComposePrompt}
            onOpenConnectors={(next) => {
              setPrimaryView("connectors")
              setConnectorView(next)
            }}
            plan={plan}
          />
        ) : (
          <section className="grid gap-5 lg:grid-cols-[18rem_1fr]">
            <aside className="flex flex-col gap-4">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="size-4" />
                    Admin
                  </CardTitle>
                  <CardDescription>
                    The token is stored only in this browser and sent as a
                    bearer token to connector APIs.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="flex flex-col gap-3" onSubmit={saveAdminToken}>
                    <Field>
                      <FieldLabel htmlFor="admin-token">Admin token</FieldLabel>
                      <Input
                        id="admin-token"
                        autoComplete="off"
                        placeholder="COMPOSER_CONNECTOR_ADMIN_TOKEN"
                        type="password"
                        value={tokenInput}
                        onChange={(event) => setTokenInput(event.target.value)}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="submit">Save</Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void loadPlan()}
                        disabled={!hasAdminToken || loading}
                      >
                        {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        Refresh
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <CardTitle>Menu</CardTitle>
                  <CardDescription>
                    Jump between connector readiness and provider setup.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <nav className="grid gap-2" aria-label="Connector menu">
                    <MenuButton
                      active={connectorView === "overview"}
                      icon={<Settings2 className="size-4" />}
                      label="Overview"
                      onClick={() => setConnectorView("overview")}
                    />
                    <MenuButton
                      active={connectorView === "codex"}
                      icon={<Bot className="size-4" />}
                      label={`Codex (${connectorCounts.codex})`}
                      onClick={() => setConnectorView("codex")}
                    />
                    <MenuButton
                      active={connectorView === "deepgram"}
                      icon={<Mic className="size-4" />}
                      label={`Deepgram (${connectorCounts.deepgram})`}
                      onClick={() => setConnectorView("deepgram")}
                    />
                  </nav>
                </CardContent>
              </Card>
            </aside>

            <div className="min-w-0">
              {!hasAdminToken ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Connector admin token required</CardTitle>
                    <CardDescription>
                      Paste the local Composer admin token to load, create, and
                      manage connector failover. The app never renders the token
                      back to the page.
                    </CardDescription>
                  </CardHeader>
                </Card>
              ) : connectorView === "overview" ? (
                <ConnectorsOverview
                  onOpenConnector={setConnectorView}
                  plan={plan}
                />
              ) : connectorView === "codex" ? (
                <CodexPanel
                  authorization={codexAuthorization}
                  busyAction={busyAction}
                  callbackInput={codexCallbackInput}
                  connections={plan.connections.codex}
                  name={codexName}
                  onCallbackInputChange={setCodexCallbackInput}
                  onCompleteAuthorization={completeCodexAuthorization}
                  onDelete={(connection) => deleteConnection("codex", connection)}
                  onNameChange={setCodexName}
                  onRefresh={refreshCodex}
                  onStartAuthorization={startCodexAuthorization}
                  onUpdate={(connection, patch) =>
                    updateConnection("codex", connection, patch)
                  }
                />
              ) : (
                <DeepgramPanel
                  accountIdentifier={deepgramAccount}
                  apiKey={deepgramApiKey}
                  busyAction={busyAction}
                  connections={plan.connections.deepgram}
                  name={deepgramName}
                  onAccountIdentifierChange={setDeepgramAccount}
                  onApiKeyChange={setDeepgramApiKey}
                  onCreate={createDeepgramConnection}
                  onDelete={(connection) =>
                    deleteConnection("deepgram", connection)
                  }
                  onNameChange={setDeepgramName}
                  onUpdate={(connection, patch) =>
                    updateConnection("deepgram", connection, patch)
                  }
                />
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

function MenuButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      className="justify-start"
      variant={active ? "default" : "outline"}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  )
}

function ComposeView({
  composePrompt,
  connectorCounts,
  onComposePromptChange,
  onOpenConnectors,
  plan,
}: {
  composePrompt: string
  connectorCounts: { codex: number; deepgram: number }
  onComposePromptChange: (value: string) => void
  onOpenConnectors: (view: ConnectorView) => void
  plan: ConnectorPlan
}) {
  return (
    <section className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText className="size-5" />
            Compose message
          </CardTitle>
          <CardDescription>
            Mobile-first drafting space for the upcoming Pi-agent writing
            runtime. Connector readiness is live; composing sessions are the
            next implementation slice.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="compose-prompt">What should Composer write?</FieldLabel>
              <Textarea
                id="compose-prompt"
                className="min-h-40"
                placeholder="Example: Write a concise reply confirming the meeting time and asking for the agenda."
                value={composePrompt}
                onChange={(event) => onComposePromptChange(event.target.value)}
              />
              <FieldDescription>
                This text area is intentionally local for now; no text is sent to
                a model until the Composer runtime lands.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button disabled>
              <Bot />
              Compose with Pi agent
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenConnectors("overview")}
            >
              <PlugZap />
              Check connectors
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5">
        <ReadinessCard
          icon={<Bot className="size-5" />}
          label="Codex failover"
          summary={connectionSummary(plan.composer)}
          total={connectorCounts.codex}
          onOpen={() => onOpenConnectors("codex")}
        />
        <ReadinessCard
          icon={<Mic className="size-5" />}
          label="Deepgram failover"
          summary={connectionSummary(plan.speechToText)}
          total={connectorCounts.deepgram}
          onOpen={() => onOpenConnectors("deepgram")}
        />
      </div>
    </section>
  )
}

function ReadinessCard({
  icon,
  label,
  onOpen,
  summary,
  total,
}: {
  icon: ReactNode
  label: string
  onOpen: () => void
  summary: string
  total: number
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            {icon}
            {label}
          </span>
          <Badge variant={total > 0 ? "default" : "secondary"}>{total}</Badge>
        </CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={onOpen}>
          Manage
        </Button>
      </CardContent>
    </Card>
  )
}

function ConnectorsOverview({
  onOpenConnector,
  plan,
}: {
  onOpenConnector: (view: ConnectorView) => void
  plan: ConnectorPlan
}) {
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Failover overview</CardTitle>
          <CardDescription>
            Composer selects the first enabled, connected provider by priority.
            Lower priority numbers run first; remaining connected providers are
            retained as fallbacks.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FailoverSummary
            actionLabel="Manage Codex"
            icon={<Bot className="size-5" />}
            label="Text composition"
            onAction={() => onOpenConnector("codex")}
            plan={plan.composer}
          />
          <FailoverSummary
            actionLabel="Manage Deepgram"
            icon={<Mic className="size-5" />}
            label="Speech to text"
            onAction={() => onOpenConnector("deepgram")}
            plan={plan.speechToText}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function FailoverSummary<TConnection extends ConnectionBase>({
  actionLabel,
  icon,
  label,
  onAction,
  plan,
}: {
  actionLabel: string
  icon: ReactNode
  label: string
  onAction: () => void
  plan: FailoverPlan<TConnection>
}) {
  return (
    <div className="flex flex-col gap-4 border p-4">
      <div className="flex items-start gap-3">
        <div className="mt-1">{icon}</div>
        <div className="min-w-0">
          <h2 className="font-semibold uppercase tracking-wide">{label}</h2>
          <p className="text-sm text-muted-foreground">
            {connectionSummary(plan)}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs uppercase tracking-wider text-muted-foreground">
        <div className="border p-2">
          <p className="text-lg font-semibold text-foreground">
            {plan.active ? 1 : 0}
          </p>
          Active
        </div>
        <div className="border p-2">
          <p className="text-lg font-semibold text-foreground">
            {plan.fallbacks.length}
          </p>
          Fallback
        </div>
        <div className="border p-2">
          <p className="text-lg font-semibold text-foreground">
            {plan.needsAttention.length}
          </p>
          Attention
        </div>
      </div>
      <Button type="button" variant="outline" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  )
}

function CodexPanel({
  authorization,
  busyAction,
  callbackInput,
  connections,
  name,
  onCallbackInputChange,
  onCompleteAuthorization,
  onDelete,
  onNameChange,
  onRefresh,
  onStartAuthorization,
  onUpdate,
}: {
  authorization: CodexAuthorization | null
  busyAction: string | null
  callbackInput: string
  connections: CodexConnection[]
  name: string
  onCallbackInputChange: (value: string) => void
  onCompleteAuthorization: (event: FormEvent<HTMLFormElement>) => void
  onDelete: (connection: CodexConnection) => void
  onNameChange: (value: string) => void
  onRefresh: (connection: CodexConnection) => void
  onStartAuthorization: (event: FormEvent<HTMLFormElement>) => void
  onUpdate: (
    connection: CodexConnection,
    patch: Partial<Pick<ConnectionBase, "enabled" | "priority">>
  ) => void
}) {
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-5" />
            Codex connectors
          </CardTitle>
          <CardDescription>
            Add OpenAI Codex accounts for text composition. Composer will use
            the lowest-priority enabled, connected account first.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <form className="grid gap-4" onSubmit={onStartAuthorization}>
            <Field>
              <FieldLabel htmlFor="codex-name">Connection name</FieldLabel>
              <Input
                id="codex-name"
                placeholder="Personal Codex"
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
              />
              <FieldDescription>
                Optional. Defaults to the OpenAI email returned by Codex login.
              </FieldDescription>
            </Field>
            <Button type="submit" disabled={busyAction === "codex:start"}>
              {busyAction === "codex:start" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <KeyRound />
              )}
              Start Codex login
            </Button>
          </form>

          {authorization && (
            <>
              <Separator />
              <form className="grid gap-4" onSubmit={onCompleteAuthorization}>
                <Button asChild type="button" variant="outline">
                  <a
                    href={authorization.authUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <KeyRound />
                    Open Codex login
                  </a>
                </Button>
                <Field>
                  <FieldLabel htmlFor="codex-callback">Callback URL</FieldLabel>
                  <Textarea
                    id="codex-callback"
                    className="min-h-28"
                    placeholder="Paste the final callback URL after Codex redirects."
                    value={callbackInput}
                    onChange={(event) =>
                      onCallbackInputChange(event.target.value)
                    }
                  />
                  <FieldDescription>
                    Authorization expires {friendlyDate(authorization.expiresAt)}.
                  </FieldDescription>
                </Field>
                <Button
                  type="submit"
                  disabled={busyAction === "codex:complete" || !callbackInput}
                >
                  {busyAction === "codex:complete" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <CheckCircle2 />
                  )}
                  Complete Codex login
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>

      <ConnectionList
        emptyCopy="No Codex connections yet. Start Codex login to add the first text provider."
        kind="codex"
        connections={connections}
        renderMeta={(connection) => (
          <>
            <span>{connection.openaiEmail}</span>
            <span>{connection.defaultModel}</span>
            <span>Token expires {friendlyDate(connection.tokenExpiresAt)}</span>
          </>
        )}
        busyAction={busyAction}
        onDelete={onDelete}
        onRefresh={onRefresh}
        onUpdate={onUpdate}
      />
    </div>
  )
}

function DeepgramPanel({
  accountIdentifier,
  apiKey,
  busyAction,
  connections,
  name,
  onAccountIdentifierChange,
  onApiKeyChange,
  onCreate,
  onDelete,
  onNameChange,
  onUpdate,
}: {
  accountIdentifier: string
  apiKey: string
  busyAction: string | null
  connections: DeepgramConnection[]
  name: string
  onAccountIdentifierChange: (value: string) => void
  onApiKeyChange: (value: string) => void
  onCreate: (event: FormEvent<HTMLFormElement>) => void
  onDelete: (connection: DeepgramConnection) => void
  onNameChange: (value: string) => void
  onUpdate: (
    connection: DeepgramConnection,
    patch: Partial<Pick<ConnectionBase, "enabled" | "priority">>
  ) => void
}) {
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="size-5" />
            Deepgram connectors
          </CardTitle>
          <CardDescription>
            Add Deepgram API keys for speech-to-text. Keys are verified before
            they are encrypted into the connector store.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onCreate}>
            <Field>
              <FieldLabel htmlFor="deepgram-name">Connection name</FieldLabel>
              <Input
                id="deepgram-name"
                placeholder="Production Deepgram"
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="deepgram-account">Account identifier</FieldLabel>
              <Input
                id="deepgram-account"
                placeholder="Optional account or project label"
                value={accountIdentifier}
                onChange={(event) =>
                  onAccountIdentifierChange(event.target.value)
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="deepgram-api-key">API key</FieldLabel>
              <Input
                id="deepgram-api-key"
                autoComplete="off"
                placeholder="dg_..."
                type="password"
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
              />
              <FieldDescription>
                The raw key is sent only to the local server for verification and
                encryption.
              </FieldDescription>
            </Field>
            <Button
              type="submit"
              disabled={busyAction === "deepgram:create" || !apiKey}
            >
              {busyAction === "deepgram:create" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <KeyRound />
              )}
              Save Deepgram key
            </Button>
          </form>
        </CardContent>
      </Card>

      <ConnectionList
        emptyCopy="No Deepgram connections yet. Save a verified API key to enable speech-to-text."
        kind="deepgram"
        connections={connections}
        renderMeta={(connection) => (
          <>
            <span>{connection.accountIdentifier || "No account label"}</span>
            <span>{connection.defaultModel}</span>
            <span>{connection.providerType}</span>
          </>
        )}
        busyAction={busyAction}
        onDelete={onDelete}
        onUpdate={onUpdate}
      />
    </div>
  )
}

function ConnectionList<TConnection extends ConnectionBase>({
  busyAction,
  connections,
  emptyCopy,
  kind,
  onDelete,
  onRefresh,
  onUpdate,
  renderMeta,
}: {
  busyAction: string | null
  connections: TConnection[]
  emptyCopy: string
  kind: ConnectorKind
  onDelete: (connection: TConnection) => void
  onRefresh?: (connection: TConnection) => void
  onUpdate: (
    connection: TConnection,
    patch: Partial<Pick<ConnectionBase, "enabled" | "priority">>
  ) => void
  renderMeta: (connection: TConnection) => ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Failover order</CardTitle>
        <CardDescription>
          Connections are tried by priority. Disable a connector to keep it as a
          saved credential without using it in routing.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {connections.length === 0 ? (
          <div className="border border-dashed p-6 text-sm text-muted-foreground">
            {emptyCopy}
          </div>
        ) : (
          connections.map((connection, index) => (
            <article key={connection.id} className="grid gap-4 border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">#{index + 1}</Badge>
                    <h3 className="truncate font-semibold">{connection.name}</h3>
                    <Badge variant={statusBadgeVariant(connection.status)}>
                      {connection.status.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {connection.statusMessage}
                  </p>
                </div>
                <Switch
                  aria-label={`Enable ${connection.name}`}
                  checked={connection.enabled}
                  onCheckedChange={(enabled) =>
                    onUpdate(connection, { enabled })
                  }
                />
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {renderMeta(connection)}
                <span>Priority {connection.priority}</span>
                <span>Updated {friendlyDate(connection.updatedAt)}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onUpdate(connection, { priority: 1 })}
                  disabled={busyAction === `${kind}:update:${connection.id}`}
                >
                  Make primary
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onUpdate(connection, { priority: connection.priority + 10 })
                  }
                  disabled={busyAction === `${kind}:update:${connection.id}`}
                >
                  Lower priority
                </Button>
                {onRefresh && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onRefresh(connection)}
                    disabled={busyAction === `codex:refresh:${connection.id}`}
                  >
                    {busyAction === `codex:refresh:${connection.id}` ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <RefreshCw />
                    )}
                    Refresh
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => onDelete(connection)}
                  disabled={busyAction === `${kind}:delete:${connection.id}`}
                >
                  {busyAction === `${kind}:delete:${connection.id}` ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
                  Delete
                </Button>
              </div>
            </article>
          ))
        )}
      </CardContent>
    </Card>
  )
}
