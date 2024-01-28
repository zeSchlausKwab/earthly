import React, { type ReactNode } from "react"
import { Toaster } from "~/components/ui/toaster"
import Header from "~/components/header"
import Footer from "~/components/footer"

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className={"flex h-screen flex-col"}>
      <Header />
      {children}
      <Toaster />
      <Footer />
    </div>
  )
}
