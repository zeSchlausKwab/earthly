const os = require('os')
const path = require('path')

const releaseDir = process.env.EARTHLY_RELEASE_DIR || path.resolve(__dirname, '../..')
const sharedDir = process.env.EARTHLY_SHARED_DIR || path.join(releaseDir, 'shared')
const bunPath = process.env.BUN_INSTALL
	? path.join(process.env.BUN_INSTALL, 'bin', 'bun')
	: path.join(os.homedir(), '.bun', 'bin', 'bun')

const common = {
	cwd: releaseDir,
	instances: 1,
	autorestart: true,
	watch: false,
	log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
	merge_logs: true,
}

const logFile = (name, stream) => path.join(sharedDir, 'logs', `${name}-${stream}.log`)

module.exports = {
	apps: [
		{
			...common,
			name: 'earthly-web',
			script: 'src/index.ts',
			interpreter: bunPath,
			env: { NODE_ENV: 'production', PORT: 3000 },
			max_memory_restart: '1G',
			error_file: logFile('web', 'error'),
			out_file: logFile('web', 'out'),
		},
		{
			...common,
			name: 'earthly-contextvm',
			script: 'contextvm/server.ts',
			interpreter: bunPath,
			env: {
				NODE_ENV: 'production',
				PMTILES_CLI_PATH: path.join(releaseDir, 'contextvm', 'bin', 'pmtiles'),
			},
			max_memory_restart: '500M',
			error_file: logFile('contextvm', 'error'),
			out_file: logFile('contextvm', 'out'),
		},
		{
			...common,
			name: 'earthly-mapnolia',
			script: 'mapnolia-server',
			interpreter: 'none',
			max_memory_restart: '1G',
			error_file: logFile('mapnolia', 'error'),
			out_file: logFile('mapnolia', 'out'),
		},
		{
			...common,
			name: 'earthly-relay',
			script: 'relay/relay',
			interpreter: 'none',
			env: { PORT: 3334 },
			max_memory_restart: '500M',
			error_file: logFile('relay', 'error'),
			out_file: logFile('relay', 'out'),
		},
	],
}
