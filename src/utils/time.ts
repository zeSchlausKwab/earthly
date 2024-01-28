import { format } from "date-fns"

export const formatNostrTime = (nosteredTime: string) => {
  return format(parseInt(nosteredTime) * 1000, "dd.MM.yyyy HH:mm")
}
