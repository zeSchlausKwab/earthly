import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '../..')

describe('production deployment runtime', () => {
	test('uses one PM2 definition for the four HTTP and worker processes', async () => {
		const config = await Bun.file(join(repositoryRoot, 'ops/vps/services.config.cjs')).text()
		for (const service of [
			'earthly-web',
			'earthly-contextvm',
			'earthly-mapnolia',
			'earthly-relay',
		]) {
			expect(config).toContain(service)
		}
		expect(config).not.toContain('earthly-cordn')
	})

	test('verifies and stages releases before activation', async () => {
		const deploy = await Bun.file(join(repositoryRoot, 'ops/vps/deploy.sh')).text()
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()

		expect(deploy).toContain('git ls-files --cached --others --exclude-standard')
		expect(deploy).toContain('archive_sha256')
		expect(deploy).toContain('sha256_file .env.production')
		expect(deploy).toContain('sha256_file ops/vps/activate.sh')
		expect(deploy).toContain("sha256sum -c '$remote_checksum'")
		expect(deploy).toContain("grep -qi '^bsdtar'")
		expect(activate).toContain('sha256sum -c')
		expect(activate).toContain('release_root="$app_root/releases"')
		expect(activate).toContain('restoring the previous runtime')
		expect(await Bun.file(join(repositoryRoot, 'ops/vps/rollback.sh')).text()).toContain(
			'No retained previous release is available',
		)
	})

	test('audits Caddy without letting an application deploy replace it', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()
		const setup = await Bun.file(join(repositoryRoot, 'ops/vps/setup.sh')).text()

		expect(activate).not.toContain('/etc/caddy/Caddyfile')
		expect(setup).toContain('caddy adapt --config /etc/caddy/Caddyfile')
		expect(setup).toContain('systemctl is-active --quiet caddy')
		expect(setup).not.toContain('sudo -n')
	})

	test('pins Mapnolia and PMTiles rather than following latest', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()
		const pmtiles = await Bun.file(join(repositoryRoot, 'scripts/ensure-pmtiles.sh')).text()

		expect(activate).toContain('mapnolia_version="v0.1.3"')
		expect(activate).not.toContain('/releases/latest/')
		expect(pmtiles).toContain('PMTILES_VERSION="1.29.1"')
		expect(pmtiles).toContain('archive_sha256=')
	})

	test('does not duplicate a legacy Mapnolia tile store during first activation', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()

		expect(activate).toContain('Referenced existing persistent Mapnolia data without copying it')
		expect(activate).not.toContain('cp -a -- "$app_root/mapnolia-data/."')
		expect(activate).toContain('Both legacy and shared Mapnolia directories contain data')
	})

	test('stages persistent migrations and replaces setup-created empty directories', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()

		expect(activate).toContain('target.migrating-$release_id')
		expect(activate).toContain('if [[ "$target_is_empty" == "true" ]]')
		expect(activate).toContain('mv "$staging_path" "$target"')
	})

	test('keeps a live legacy relay and Cordn data root in place', async () => {
		const activate = await Bun.file(join(repositoryRoot, 'ops/vps/activate.sh')).text()

		expect(activate).toContain('persistent_data_root="$app_root/data"')
		expect(activate).toContain('Referenced existing persistent relay and Cordn data without copying it')
		expect(activate).toContain('link_shared "$persistent_data_root" "$new_release/data"')
	})
})
