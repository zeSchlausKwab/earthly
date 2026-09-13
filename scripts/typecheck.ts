#!/usr/bin/env bun
import { relative, resolve } from 'node:path'
import ts from 'typescript'
import { compareDiagnostics, parseBaseline, summarizeDiagnostics } from './typecheck-baseline'

const root = resolve(import.meta.dir, '..')
const baselinePath = resolve(root, 'scripts/typecheck-baseline.json')
const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--prune-baseline')) {
	console.error('Usage: bun run scripts/typecheck.ts [--prune-baseline]')
	process.exit(1)
}

const formatHost: ts.FormatDiagnosticsHost = {
	getCanonicalFileName: (file) => file,
	getCurrentDirectory: () => root,
	getNewLine: () => '\n',
}

try {
	const baseline = parseBaseline(await Bun.file(baselinePath).json(), ts.version)
	const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile)
	if (config.error) throw new Error(ts.formatDiagnostics([config.error], formatHost))
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, { noEmit: true })
	if (parsed.errors.length) throw new Error(ts.formatDiagnostics(parsed.errors, formatHost))
	const program = ts.createProgram({
		rootNames: parsed.fileNames,
		options: parsed.options,
		projectReferences: parsed.projectReferences,
	})
	const diagnostics = ts.getPreEmitDiagnostics(program)
	const globalErrors = diagnostics.filter((diagnostic) => !diagnostic.file)
	if (globalErrors.length) throw new Error(ts.formatDiagnostics(globalErrors, formatHost))
	const current = summarizeDiagnostics(
		diagnostics.map((diagnostic) => ({
			file: relative(root, diagnostic.file?.fileName ?? ''),
			code: diagnostic.code,
			message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
		})),
	)
	const { additions, resolved } = compareDiagnostics(current, baseline.diagnostics)
	if (additions.length) {
		console.error('New TypeScript diagnostics:')
		for (const entry of additions) {
			console.error(`${entry.file}: TS${entry.code} (${entry.count} new): ${entry.message}`)
		}
		console.error('Run bun run typecheck:strict for source locations. Baseline was not changed.')
		process.exit(1)
	}
	if (args[0] === '--prune-baseline') {
		await Bun.write(
			baselinePath,
			`${JSON.stringify({ ...baseline, diagnostics: current }, null, 2)}\n`,
		)
		console.log(`Removed ${resolved} resolved diagnostics from the TypeScript baseline.`)
	}
	console.log(
		`No new TypeScript diagnostics. ${diagnostics.length} existing diagnostics remain; ${resolved} resolved since the baseline.`,
	)
	if (resolved && !args.length)
		console.log('Run bun run typecheck:prune to retain this reduction in the baseline.')
} catch (error) {
	console.error(error instanceof Error ? error.message : error)
	process.exit(1)
}
