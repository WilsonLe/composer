import type { TextRangeEdit } from "@/lib/composer/types"

export function clampTextEdit(edit: TextRangeEdit, textLength: number) {
  const start = Math.max(0, Math.min(textLength, Math.round(edit.start)))
  const end = Math.max(start, Math.min(textLength, Math.round(edit.end)))

  return {
    ...edit,
    end,
    start,
  }
}

export function applyTextEdits(baseText: string, edits: TextRangeEdit[]) {
  const normalized = edits
    .map((edit) => clampTextEdit(edit, baseText.length))
    .sort((left, right) => left.start - right.start || left.end - right.end)

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].start < normalized[index - 1].end) {
      throw new Error("Edit ranges cannot overlap.")
    }
  }

  let nextText = baseText

  for (const edit of [...normalized].reverse()) {
    nextText = `${nextText.slice(0, edit.start)}${edit.replacement}${nextText.slice(edit.end)}`
  }

  return nextText
}
