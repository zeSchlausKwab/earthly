import React, { type ReactNode } from "react";
import { Header } from "~/pages/components/header";
import { Footer } from "~/pages/components/footer";
import { Toaster } from "~/components/ui/toaster";

export const Layout = ({ children }: { children: ReactNode }) => (
  <div className={"flex h-screen flex-col"}>
    <Header />
    {children}
    <Toaster />
    <Footer />
  </div>
);
