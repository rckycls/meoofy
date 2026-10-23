// Metro turns an imported image into an asset id, which `Image.resolveAssetSource` resolves.
declare module '*.jpg' {
  const asset: number
  export default asset
}
