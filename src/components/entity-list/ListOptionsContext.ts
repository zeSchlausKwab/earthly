import { createContext, type ReactNode } from 'react'
export const ListOptionsContext = createContext<{ controls?: ReactNode; activeCount: number }>({ activeCount: 0 })
