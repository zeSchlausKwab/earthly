import type { GeoDataset } from '@/lib/nostr/geo-event'
import { UserProfile } from '@/components/user-profile/UserProfile'
import { GlyphTile, ListRow, RowActionButton, RowBadge } from '@/components/entity-list'
import {
	DatasetGlyphIcon,
	LoadEditorActionIcon,
	MapStackActionIcon,
	ZoomActionIcon,
} from '@/components/entity-action-icons'
import { useEditorStore } from '@/features/geo-editor/store'
import { privateDatasetStackEntryId } from './privateDatasetStack'

export interface PrivateDatasetActions {
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	onAddToMap: (event: GeoDataset) => void
	onRemoveFromMap: (event: GeoDataset) => void
	onZoomTo: (event: GeoDataset) => void
	onLoadIntoEditor: (event: GeoDataset) => void
}

export function PrivateGeometryReferences({
	workspaceId,
	datasets,
	actions,
}: {
	workspaceId: string
	datasets: GeoDataset[]
	actions?: PrivateDatasetActions
}) {
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)

	if (datasets.length === 0) {
		return (
			<div className="border-y border-border px-3 py-8 text-center">
				<DatasetGlyphIcon className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
				<p className="text-xs font-medium text-foreground">No geometry attached yet</p>
				<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
					Datasets created in this private group will appear here as encrypted references.
				</p>
			</div>
		)
	}

	return (
		<div className="border-t border-border">
			{datasets.map((dataset) => {
				const datasetKey = actions?.getDatasetKey(dataset) ?? dataset.datasetId ?? dataset.id
				const title =
					actions?.getDatasetName(dataset) ?? dataset.datasetId ?? dataset.id ?? 'Private dataset'
				const entryId = privateDatasetStackEntryId(workspaceId, datasetKey)
				const isInMapStack = Boolean(mapStackEntries[entryId])
				const featureCount = dataset.featureCollection.features.length

				const showAndZoom = () => {
					if (!actions) return
					if (!isInMapStack) actions.onAddToMap(dataset)
					actions.onZoomTo(dataset)
				}

				return (
					<ListRow
						key={entryId}
						leading={<GlyphTile icon={DatasetGlyphIcon} />}
						title={title}
						onTitleClick={actions ? showAndZoom : undefined}
						titleAriaLabel={`Show and zoom to ${title}`}
						titleTitle={isInMapStack ? 'Zoom to dataset' : 'Show on map and zoom'}
						badges={
							<RowBadge
								label={`${featureCount} feature${featureCount === 1 ? '' : 's'}`}
								className="bg-info/10 text-info"
							/>
						}
						meta={
							<UserProfile
								pubkey={dataset.pubkey}
								mode="avatar-name"
								size="xs"
								showNip05Badge={false}
								interactive={false}
							/>
						}
						note="MLS-encrypted group geometry"
						actions={
							actions ? (
								<>
									<RowActionButton
										icon={MapStackActionIcon}
										label={isInMapStack ? 'Remove from map stack' : 'Add to map stack'}
										hover="hover:text-ok"
										active={isInMapStack}
										activeClassName="text-ok hover:text-ok"
										onClick={() =>
											isInMapStack ? actions.onRemoveFromMap(dataset) : actions.onAddToMap(dataset)
										}
									/>
									<RowActionButton
										icon={ZoomActionIcon}
										label="Zoom to dataset"
										onClick={showAndZoom}
									/>
									<RowActionButton
										icon={LoadEditorActionIcon}
										label="Edit private dataset"
										hover="hover:text-ok"
										onClick={() => actions.onLoadIntoEditor(dataset)}
									/>
								</>
							) : undefined
						}
					/>
				)
			})}
		</div>
	)
}
