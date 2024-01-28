import { Separator } from "~/components/ui/separator"
import React from "react"

export default function Footer() {
  return (
    <footer className="flex flex-none flex-row justify-between p-4 text-center">
      <div>
        &copy; {new Date().getFullYear()} Your Company Name. All rights
        reserved.
      </div>
      <div className={"flex flex-row gap-4"}>
        <a href="/privacy-policy" className="text-blue-500 hover:underline">
          Privacy Policy
        </a>
        <Separator orientation={"vertical"} />
        <a href="/terms-of-service" className="text-blue-500 hover:underline">
          Terms of Service
        </a>
        <Separator orientation={"vertical"} />
        <a href="/contact" className="text-blue-500 hover:underline">
          Contact Us
        </a>
      </div>
    </footer>
  )
}
