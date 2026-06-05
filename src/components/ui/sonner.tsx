"use client"

import { Toaster as Sonner } from "sonner"

export function Toaster() {
  return (
    <Sonner
      closeButton={false}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "rounded-none border-border bg-background text-foreground shadow-sm",
          description: "text-muted-foreground",
        },
      }}
    />
  )
}
