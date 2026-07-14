import { basename } from 'node:path'

interface BuildOutput {
	kind: string
	path: string
}

export interface HtmlEntrypointResult {
	corrected: boolean
	htmlPath: string
	scriptPath: string
}

/**
 * Bun 1.3 can emit an HTML module tag pointing at a dependency chunk instead
 * of the JavaScript artifact it identifies as the entry point. Repair that
 * association from Bun's own output metadata and fail closed on ambiguity.
 */
export async function ensureHtmlEntrypoint(
	outputs: readonly BuildOutput[],
	publicPath = '/',
): Promise<HtmlEntrypointResult> {
	const htmlOutputs = outputs.filter(
		(output) => output.kind === 'entry-point' && output.path.endsWith('.html'),
	)
	const scriptOutputs = outputs.filter(
		(output) => output.kind === 'entry-point' && output.path.endsWith('.js'),
	)
	if (htmlOutputs.length !== 1 || scriptOutputs.length !== 1) {
		throw new Error(
			`Expected one HTML and one JavaScript entry point, received ${htmlOutputs.length} HTML and ${scriptOutputs.length} JavaScript outputs`,
		)
	}

	const htmlOutput = htmlOutputs[0]
	const scriptOutput = scriptOutputs[0]
	if (!htmlOutput || !scriptOutput) throw new Error('Build entry-point metadata is incomplete')
	if (!(await Bun.file(scriptOutput.path).exists())) {
		throw new Error(`JavaScript entry point does not exist: ${scriptOutput.path}`)
	}

	const expectedScriptPath = `${publicPath.replace(/\/$/u, '')}/${basename(scriptOutput.path)}`
	const html = await Bun.file(htmlOutput.path).text()
	const moduleScriptPattern = /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["'][^"']+["'][^>]*><\/script>/iu
	const moduleScript = html.match(moduleScriptPattern)?.[0]
	if (!moduleScript) throw new Error(`No module entry script found in ${htmlOutput.path}`)

	const currentScriptPath = moduleScript.match(/\bsrc=["']([^"']+)["']/iu)?.[1]
	if (!currentScriptPath) throw new Error(`Module entry script has no src in ${htmlOutput.path}`)
	const corrected = currentScriptPath !== expectedScriptPath
	if (corrected) {
		const correctedScript = moduleScript.replace(
			/\bsrc=["'][^"']+["']/iu,
			`src="${expectedScriptPath}"`,
		)
		await Bun.write(htmlOutput.path, html.replace(moduleScript, correctedScript))
	}

	const verifiedHtml = await Bun.file(htmlOutput.path).text()
	if (!verifiedHtml.includes(`src="${expectedScriptPath}"`)) {
		throw new Error(`HTML does not reference JavaScript entry point ${expectedScriptPath}`)
	}
	return {
		corrected,
		htmlPath: htmlOutput.path,
		scriptPath: expectedScriptPath,
	}
}
