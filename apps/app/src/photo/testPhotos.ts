import { Asset } from 'expo-asset'

import front from '../../e2e/fixtures/front.jpg'
import markings from '../../e2e/fixtures/markings.jpg'
import side from '../../e2e/fixtures/side.jpg'
import type { GuidedView } from './views'

// Required statically, so Metro bundles them (Ruling 41: they are kept small). They are for the
// "Use test photo" button, which only end-to-end builds show (`env.e2e`).
const TEST_PHOTOS: Record<GuidedView, number> = { front, side, markings }

/**
 * A URI `preparePhoto` can read for the bundled test photo of `view`: the file in the app bundle,
 * or a copy of it in the cache when the bundle is a dev server's (`expo-asset` works on the web
 * too, where `Image.resolveAssetSource` does not exist).
 */
export async function testPhotoUri(view: GuidedView): Promise<string> {
  const asset = await Asset.fromModule(TEST_PHOTOS[view]).downloadAsync()
  return asset.localUri ?? asset.uri
}
