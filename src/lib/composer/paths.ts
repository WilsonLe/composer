import "server-only"

import { mkdir } from "node:fs/promises"
import path from "node:path"

export function composerDataDir() {
  return path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.COMPOSER_DATA_DIR?.trim() || ".data"
  )
}

export function composeSessionsStorePath() {
  return path.join(composerDataDir(), "compose-sessions.json")
}

export function composerPiAgentDir() {
  return path.join(composerDataDir(), "pi-agent")
}

export function composerPiSessionDir() {
  return path.join(composerPiAgentDir(), "sessions")
}

export async function ensureComposerDataDirectories() {
  await mkdir(composerDataDir(), { recursive: true })
  await mkdir(composerPiAgentDir(), { recursive: true })
  await mkdir(composerPiSessionDir(), { recursive: true })
}
