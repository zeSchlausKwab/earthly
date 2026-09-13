import { setWorkerUrl } from 'maplibre-gl'
import { workerUrl } from './workers/workerAssets'

/** Use the worker bundled by Earthly in both Bun development and packaged builds. */
export function configureMapLibreWorker(): void {
	setWorkerUrl(workerUrl('maplibre'))
}
