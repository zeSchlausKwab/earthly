/**
 * Tool definitions for AI chat.
 *
 * The advertised tool list is now DERIVED from live registry state (D-04/D-06)
 * — `registry.advertise()` is the single source of truth. The registry
 * self-populates on import (built-ins, editor writers, remote-mcp tools, and
 * the self-registered `editor_*` commands), so this module simply exposes the
 * derived list. The old static `geoTools` array + the `editorCommandTools`
 * derivation + the `executeEditorAiTool` re-export are gone (D-01).
 */

import type { Tool } from './types'
import { advertise } from './registry'

export const geoTools: Tool[] = advertise()
