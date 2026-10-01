import { test, expect } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'
import { addPointToGeometryDraft, expectGeometryFeatureCount } from '../tasks/create/geometry'
import { openPanel } from '../tasks/navigation/open-panel'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'

test('unsupported WebMCP leaves ordinary draft editing available @editor-contract', async ({
	earthly,
}) => {
	await installIsolatedRelays(earthly)
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await startDataset(earthly)
	await addPointToGeometryDraft(earthly)
	await openPanel(earthly, 'Settings')
	await earthly.page.getByRole('tab', { name: 'Chat', exact: true }).click()
	const section = earthly.page.getByRole('region', { name: 'Desktop agent access', exact: true })
	await expect(
		section.getByRole('switch', { name: 'Desktop agent access', exact: true }),
	).toBeDisabled()
	await expect(section.getByRole('status')).toHaveText(/WebMCP is unavailable/)
	await expectGeometryFeatureCount(earthly, 1)
})
