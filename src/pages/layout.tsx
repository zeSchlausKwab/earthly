import React, { type ReactNode } from "react"
import { Toaster } from "~/components/ui/toaster"
import Header from "~/components/header"
import useMedia from "use-media"

export default function Layout({ children }: { children: ReactNode }) {
  const isWide = useMedia({ minWidth: "1024px" })

  return (
    <div className={"flex h-screen flex-col"}>
      {isWide ? <Header /> : null}
      {children}
      <Toaster />
    </div>
  )
}
