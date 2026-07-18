import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { GeoComment } from '@/lib/nostr/geo-comment'
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
	comments = [],
	actions,
	visibleCommentIds = new Set(),
	onCommentGeometryVisibilityChange,
	onZoomToCommentGeometry,
}: {
	workspaceId: string
	datasets: GeoDataset[]
	comments?: GeoComment[]
	actions?: PrivateDatasetActions
	visibleCommentIds?: ReadonlySet<string>
	onCommentGeometryVisibilityChange?: (comment: GeoComment, visible: boolean) => void
	onZoomToCommentGeometry?: (comment: GeoComment) => void
}) {
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)
	const geometryComments = comments.filter((comment) => (comment.geojson?.features.length ?? 0) > 0)

	if (datasets.length === 0 && geometryComments.length === 0) {
		return (
			<div className="border-y border-border px-3 py-8 text-center">
				<DatasetGlyphIcon className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
				<p className="text-xs font-medium text-foreground">No private geometry yet</p>
				<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
					Datasets and geometry attached to comments will appear here.
				</p>
			</div>
		)
	}

	return (
		<div>
			{datasets.length > 0 && geometryComments.length > 0 ? (
				<div className="border-y border-border bg-muted/25 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
					Datasets
				</div>
			) : null}
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
												isInMapStack
													? actions.onRemoveFromMap(dataset)
													: actions.onAddToMap(dataset)
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

			{geometryComments.length > 0 ? (
				<>
					<div className="border-y border-border bg-muted/25 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
						Comment attachments
					</div>
					<div>
						{geometryComments.map((comment) => {
							const commentId = comment.commentId ?? comment.id ?? ''
							const featureCount = comment.geojson?.features.length ?? 0
							const title = comment.text.trim() || 'Geometry attachment'
							const visible = visibleCommentIds.has(commentId)

							return (
								<ListRow
									key={commentId}
									leading={<GlyphTile icon={DatasetGlyphIcon} />}
									title={title}
									onTitleClick={
										onZoomToCommentGeometry ? () => onZoomToCommentGeometry(comment) : undefined
									}
									titleAriaLabel={`Show and zoom to ${title}`}
									badges={
										<RowBadge
											label={`${featureCount} feature${featureCount === 1 ? '' : 's'}`}
											className="bg-ok/10 text-ok"
										/>
									}
									meta={
										<UserProfile
											pubkey={comment.pubkey}
											mode="avatar-name"
											size="xs"
											showNip05Badge={false}
											interactive={false}
										/>
									}
									note="Attached to an MLS-encrypted comment"
									actions={
										onCommentGeometryVisibilityChange || onZoomToCommentGeometry ? (
											<>
												{onCommentGeometryVisibilityChange ? (
													<RowActionButton
														icon={MapStackActionIcon}
														label={visible ? 'Hide comment geometry' : 'Show comment geometry'}
														hover="hover:text-ok"
														active={visible}
														activeClassName="text-ok hover:text-ok"
														onClick={() => onCommentGeometryVisibilityChange(comment, !visible)}
													/>
												) : null}
												{onZoomToCommentGeometry ? (
													<RowActionButton
														icon={ZoomActionIcon}
														label="Zoom to comment geometry"
														onClick={() => onZoomToCommentGeometry(comment)}
													/>
												) : null}
											</>
										) : undefined
									}
								/>
							)
						})}
					</div>
				</>
			) : null}
		</div>
	)
}
